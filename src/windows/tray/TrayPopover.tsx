import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  onTimerChanged,
  onEntriesChanged,
  onCategoriesChanged,
  onProjectsChanged,
} from '../../lib/events';
import { qk } from '../../lib/query';
import type { Category, Id, Project, TimeEntry } from '../../types';
import { todayRangeUtc } from './format';
import { Plus } from 'lucide-react';
import { HeaderIcons } from './HeaderIcons';
import { InlineTimerForm } from './InlineTimerForm';
import type { SubmitValue } from './InlineTimerForm';
import { QuickStartCard } from './QuickStartCard';
import { TodayList } from './TodayList';
import { TodayEntryRow } from './TodayEntryRow';
import { TodayFooter } from './TodayFooter';
import { CalendarToasts } from './CalendarToasts';
import { IdleToast } from './IdleToast';

// ---------------------------------------------------------------------------
// Mode state machine
// ---------------------------------------------------------------------------

type Mode =
  | { kind: 'browse' }
  | { kind: 'new' }
  | { kind: 'edit'; sourceEntry: TimeEntry };

const BLANK_INITIAL = { categoryId: null, projectId: null, description: '' } as const;

// ---------------------------------------------------------------------------
// Helpers (kept inline — same as before)
// ---------------------------------------------------------------------------

function elapsedSeconds(startedAtIso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000));
}
function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Local HH:mm for an ISO instant. */
function localHhMm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Re-time an ISO instant to a new HH:mm on the same local day. `refIso` anchors
 * the day: an end time earlier than the start rolls to the next day so an entry
 * crossing midnight stays positive.
 * ponytail: same-day (or next-day) only — moving an entry to another date is a
 * dashboard job.
 */
function withLocalTime(iso: string, hhmm: string, afterIso?: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return iso;
  const d = new Date(iso);
  d.setHours(h, m, 0, 0);
  if (afterIso && d.getTime() < new Date(afterIso).getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Sub-components (local, inline)
// ---------------------------------------------------------------------------

function Header({ onError }: { onError: (msg: string) => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-separator">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-label-2">TimeTrak</div>
      <HeaderIcons onError={onError} />
    </div>
  );
}

function StatusCard({
  running,
  categories,
  projects,
  onStop,
  isStopping,
}: {
  running: TimeEntry;
  categories: Category[];
  projects: Project[];
  onStop: () => void;
  isStopping: boolean;
}) {
  const [e, setE] = useState(elapsedSeconds(running.started_at));
  useEffect(() => {
    const t = setInterval(() => setE(elapsedSeconds(running.started_at)), 1000);
    return () => clearInterval(t);
  }, [running.started_at]);

  const cat = categories.find((c) => c.id === running.category_id);
  const proj = projects.find((p) => p.id === running.project_id);

  return (
    <div
      className="overflow-hidden rounded-xl bg-raised/90 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur"
      style={{ borderLeft: `3px solid ${cat?.color ?? '#0a84ff'}` }}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-label-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          Tracking
        </div>
        <div className="mt-0.5 flex items-baseline justify-between">
          <div>
            <div className="text-[13px] font-medium leading-tight text-label">{cat?.name ?? '?'}</div>
            {proj && <div className="text-[11px] leading-tight text-label-2">{proj.name}</div>}
          </div>
          <div className="font-mono text-[20px] font-light tabular-nums leading-none text-label">
            {formatElapsed(e)}
          </div>
        </div>
      </div>
      <button
        className="block w-full border-t border-separator bg-fill-hover px-3 py-1 text-center text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/[0.06] disabled:opacity-50"
        disabled={isStopping}
        onClick={onStop}
      >
        {isStopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function TrayPopover() {
  const qc = useQueryClient();

  // Today range is stateful so it can refresh across local-midnight while the
  // popover webview stays mounted (it's reused across hide/show by the Rust
  // tray handler). The focus listener below recomputes on each focus.
  const [today, setToday] = useState(todayRangeUtc);

  const categories = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
  const timer = useQuery({ queryKey: qk.timerState, queryFn: api.getTimerState });
  const entriesQuery = useQuery({
    queryKey: qk.entries(today.startUtc, today.endUtc),
    queryFn: () => api.listEntries(today.startUtc, today.endUtc),
  });
  const combos = useQuery({ queryKey: ['recentCombos'], queryFn: api.listRecentCombos });

  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [popoverFocused, setPopoverFocused] = useState(true);

  const running = timer.data?.running ?? null;

  // Live clock for TodayFooter — only tick while popover is visible AND a
  // timer is running. Avoids wasted renders when the window is hidden or idle.
  useEffect(() => {
    if (!popoverFocused || !running) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [popoverFocused, Boolean(running)]);

  // On window focus change: track focus state, refresh today range across
  // midnight, and reset transient UI on blur. The Rust side hides the window
  // on blur (main.rs `WindowEvent::Focused(false)`), but the webview is reused
  // — without the reset, the next show would still display whatever edit/new
  // mode the user left behind. Functional setState avoids no-op re-renders.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        setPopoverFocused((cur) => (cur === focused ? cur : focused));
        if (focused) {
          setToday((cur) => {
            const next = todayRangeUtc();
            return cur.startUtc === next.startUtc ? cur : next;
          });
        } else {
          setMode((m) => (m.kind === 'browse' ? m : { kind: 'browse' }));
          setErrorMessage((e) => (e === null ? e : null));
        }
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Esc: cancel an in-progress edit first; a second Esc dismisses the popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMode((m) => {
        if (m.kind !== 'browse') return { kind: 'browse' };
        void getCurrentWindow().hide();
        return m;
      });
      setErrorMessage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Event subscriptions — keep tray popover in sync with mutations from other
  // windows. The `cancelled` flag disposes of late-arriving listeners that
  // resolve after the cleanup runs (StrictMode + IPC round-trip race).
  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (cancelled) u();
        else unsubs.push(u);
      });
    };

    track(onTimerChanged(() => {
      qc.invalidateQueries({ queryKey: qk.timerState });
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['recentCombos'] });
    }));
    track(onEntriesChanged(() => {
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['recentCombos'] });
    }));
    track(onCategoriesChanged(() => {
      qc.invalidateQueries({ queryKey: qk.categories });
    }));
    track(onProjectsChanged(() => {
      qc.invalidateQueries({ queryKey: qk.projects });
    }));

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [qc]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: qk.timerState });
    qc.invalidateQueries({ queryKey: ['entries'] });
    qc.invalidateQueries({ queryKey: ['recentCombos'] });
  };

  const startOrSwitchMut = useMutation({
    mutationFn: ({
      categoryId,
      projectId,
      description,
    }: {
      categoryId: Id;
      projectId: Id | null;
      description: string | null;
    }) =>
      running
        ? api.switchTimer(categoryId, projectId, description)
        : api.startTimer(categoryId, projectId, description),
    onSuccess: () => {
      invalidateAll();
      setMode({ kind: 'browse' });
      setErrorMessage(null);
    },
    onError: (err: unknown) => {
      setErrorMessage(String(err));
    },
  });

  const updateEntryMut = useMutation({
    mutationFn: ({ entry, categoryId, projectId, description, startTime, endTime }:
      SubmitValue & { entry: TimeEntry }) => {
      const startedAt = startTime ? withLocalTime(entry.started_at, startTime) : entry.started_at;
      const endedAt =
        entry.ended_at && endTime ? withLocalTime(entry.ended_at, endTime, startedAt) : entry.ended_at;
      return api.updateEntry(entry.id, {
        category_id: categoryId,
        project_id: projectId,
        started_at: startedAt,
        ended_at: endedAt,
        note: description,
      });
    },
    onSuccess: () => {
      invalidateAll();
      setMode({ kind: 'browse' });
      setErrorMessage(null);
    },
    onError: (err: unknown) => {
      setErrorMessage(String(err));
    },
  });

  const deleteEntryMut = useMutation({
    mutationFn: (id: Id) => api.deleteEntry(id),
    onSuccess: () => {
      invalidateAll();
      setMode({ kind: 'browse' });
      setErrorMessage(null);
    },
    onError: (err: unknown) => {
      setErrorMessage(String(err));
    },
  });

  const stopMut = useMutation({
    mutationFn: () => api.stopTimer(),
    onSuccess: () => {
      invalidateAll();
      setErrorMessage(null);
    },
    onError: (err: unknown) => {
      setErrorMessage(String(err));
    },
  });

  const allEntries = entriesQuery.data ?? [];
  const cats = categories.data ?? [];
  const projs = projects.data ?? [];

  const handleNew = () => {
    setMode({ kind: 'new' });
    setErrorMessage(null);
  };

  const handleResume = (entry: TimeEntry) => {
    setMode({ kind: 'edit', sourceEntry: entry });
    setErrorMessage(null);
  };

  const handleCancel = () => {
    setMode({ kind: 'browse' });
    setErrorMessage(null);
  };

  const handleSubmit = (v: SubmitValue) => {
    if (mode.kind === 'edit') updateEntryMut.mutate({ entry: mode.sourceEntry, ...v });
    else startOrSwitchMut.mutate(v);
  };

  const fromEntry = (entry: TimeEntry) => ({
    categoryId: entry.category_id,
    projectId: entry.project_id,
    description: entry.note ?? '',
    startTime: localHhMm(entry.started_at),
    endTime: entry.ended_at ? localHhMm(entry.ended_at) : null,
  });

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-[13px] ring-1 ring-inset ring-separator"
      style={{ background: 'var(--tray-tint)', fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <Header onError={setErrorMessage} />

      <div className="px-2 pt-1.5">
        <CalendarToasts />
        <IdleToast />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {/* Running status card — only when tracking */}
        {running && (
          <StatusCard
            running={running}
            categories={cats}
            projects={projs}
            onStop={() => stopMut.mutate()}
            isStopping={stopMut.isPending}
          />
        )}

        {/* Quick-start chips — always visible above the history list */}
        <QuickStartCard
          categories={cats}
          projects={projs}
          combos={combos.data ?? []}
          onStart={(categoryId, projectId, note) =>
            startOrSwitchMut.mutate({ categoryId, projectId, description: note })
          }
          pending={startOrSwitchMut.isPending}
          error={startOrSwitchMut.isError ? startOrSwitchMut.error : null}
        />

        {/* New timer: form or dashed button (slow-path with description) */}
        {mode.kind === 'new' ? (
          <InlineTimerForm
            initial={BLANK_INITIAL}
            categories={cats}
            projects={projs}
            onCancel={handleCancel}
            onSubmit={handleSubmit}
            submitting={startOrSwitchMut.isPending}
          />
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNew}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-separator bg-raised/40 px-3 py-1.5 text-[11px] text-label-2 transition-colors hover:border-label-2/60 hover:bg-raised/70 hover:text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="h-3 w-3" aria-hidden /> New timer
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.requestNewEntry();
                  await getCurrentWindow().hide();
                } catch (err) {
                  setErrorMessage(String(err));
                }
              }}
              className="rounded-md px-2 py-1.5 text-[11px] text-label-2 transition-colors hover:bg-fill-hover hover:text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Add an entry for time already past"
            >
              Add past entry…
            </button>
          </div>
        )}

        {/* Today's entries — always below */}
        <section>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.08em] text-label-2">Today</div>
          {mode.kind === 'edit' ? (
            <div className="space-y-1">
              {/* Clicked entry pinned at the top of edit area */}
              <TodayEntryRow
                entry={mode.sourceEntry}
                categories={cats}
                projects={projs}
                onResume={() => {}}
              />
              {/* Inline form immediately below the entry */}
              <InlineTimerForm
                initial={fromEntry(mode.sourceEntry)}
                categories={cats}
                projects={projs}
                onCancel={handleCancel}
                onSubmit={handleSubmit}
                submitting={updateEntryMut.isPending}
                submitLabel="Save"
                onDelete={() => deleteEntryMut.mutate(mode.sourceEntry.id)}
                deleting={deleteEntryMut.isPending}
              />
              {/* Remaining stopped entries */}
              <TodayList
                entries={allEntries.filter((e) => e.id !== mode.sourceEntry.id)}
                categories={cats}
                projects={projs}
                runningId={running?.id ?? null}
                onResume={handleResume}
              />
            </div>
          ) : (
            <TodayList
              entries={allEntries}
              categories={cats}
              projects={projs}
              runningId={running?.id ?? null}
              onResume={handleResume}
            />
          )}
        </section>

        {/* Error toast */}
        {errorMessage && (
          <div className="rounded-md bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
            {errorMessage}
          </div>
        )}
      </div>

      <TodayFooter entries={allEntries} runningEntry={running} nowMs={nowMs} />
    </div>
  );
}
