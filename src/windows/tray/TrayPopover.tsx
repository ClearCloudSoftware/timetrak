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
import { HeaderIcons } from './HeaderIcons';
import { InlineTimerForm } from './InlineTimerForm';
import { QuickStartCard } from './QuickStartCard';
import { TodayList } from './TodayList';
import { TodayEntryRow } from './TodayEntryRow';
import { TodayFooter } from './TodayFooter';
import { CalendarToasts } from './CalendarToasts';

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

// ---------------------------------------------------------------------------
// Sub-components (local, inline)
// ---------------------------------------------------------------------------

function Header({ onError }: { onError: (msg: string) => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-black/5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#86868b]">TimeTrak</div>
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
      className="overflow-hidden rounded-xl bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur"
      style={{ borderLeft: `3px solid ${cat?.color ?? '#0a84ff'}` }}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#34c759]" />
          Tracking
        </div>
        <div className="mt-0.5 flex items-baseline justify-between">
          <div>
            <div className="text-[13px] font-medium leading-tight text-[#1d1d1f]">{cat?.name ?? '?'}</div>
            {proj && <div className="text-[11px] leading-tight text-[#86868b]">{proj.name}</div>}
          </div>
          <div className="font-mono text-[20px] font-light tabular-nums leading-none text-[#1d1d1f]">
            {formatElapsed(e)}
          </div>
        </div>
      </div>
      <button
        className="block w-full border-t border-black/5 bg-black/[0.02] px-3 py-1 text-center text-[12px] font-medium text-[#ff453a] transition-colors hover:bg-[#ff453a]/[0.06] disabled:opacity-50"
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
    }));
    track(onEntriesChanged(() => {
      qc.invalidateQueries({ queryKey: ['entries'] });
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

  const handleSubmit = (v: { categoryId: Id; projectId: Id | null; description: string | null }) => {
    startOrSwitchMut.mutate(v);
  };

  const fromEntry = (entry: TimeEntry) => ({
    categoryId: entry.category_id,
    projectId: entry.project_id,
    description: entry.note ?? '',
  });

  return (
    <div
      className="flex h-full flex-col bg-[#ebebee]"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <Header onError={setErrorMessage} />

      <div className="px-2 pt-1.5">
        <CalendarToasts />
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
          onStart={(categoryId, projectId) =>
            startOrSwitchMut.mutate({ categoryId, projectId, description: null })
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
              className="flex-1 rounded-md border border-dashed border-black/15 bg-white/40 px-3 py-1.5 text-[11px] text-[#86868b] transition-colors hover:border-black/30 hover:bg-white/70 hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
            >
              ＋ New timer
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
              className="rounded-md px-2 py-1.5 text-[11px] text-[#86868b] transition-colors hover:bg-black/[0.04] hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
              title="Add an entry for time already past"
            >
              Add past entry…
            </button>
          </div>
        )}

        {/* Today's entries — always below */}
        <section>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">Today</div>
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
                submitting={startOrSwitchMut.isPending}
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
          <div className="rounded-md bg-[#ff453a]/10 px-2 py-1 text-[10px] text-[#ff453a]">
            {errorMessage}
          </div>
        )}
      </div>

      <TodayFooter entries={allEntries} runningEntry={running} nowMs={nowMs} />
    </div>
  );
}
