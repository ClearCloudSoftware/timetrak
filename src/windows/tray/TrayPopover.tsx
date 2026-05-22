import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { onTimerChanged } from '../../lib/events';
import { qk } from '../../lib/query';
import type { Category, Project, TimeEntry } from '../../types';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

export function TrayPopover() {
  const qc = useQueryClient();
  const categories = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
  const timer = useQuery({ queryKey: qk.timerState, queryFn: api.getTimerState });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onTimerChanged(() => qc.invalidateQueries({ queryKey: qk.timerState })).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [qc]);

  const startMut = useMutation({
    mutationFn: ({ categoryId, projectId }: { categoryId: string; projectId: string | null }) =>
      api.startTimer(categoryId, projectId, null),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.timerState }),
  });
  const stopMut = useMutation({
    mutationFn: () => api.stopTimer(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.timerState }),
  });

  const running = timer.data?.running ?? null;

  return (
    <div className="flex h-full flex-col gap-2 bg-[#ebebee] p-2" style={FONT}>
      <StatusCard
        running={running}
        categories={categories.data ?? []}
        projects={projects.data ?? []}
        onStop={() => stopMut.mutate()}
        isStopping={stopMut.isPending}
      />
      <QuickStartCard
        running={running}
        categories={categories.data ?? []}
        projects={projects.data ?? []}
        onStart={(categoryId, projectId) => startMut.mutate({ categoryId, projectId })}
        isStarting={startMut.isPending}
        error={startMut.isError ? startMut.error : null}
      />
    </div>
  );
}

function StatusCard({
  running, categories, projects, onStop, isStopping,
}: {
  running: TimeEntry | null;
  categories: Category[];
  projects: Project[];
  onStop: () => void;
  isStopping: boolean;
}) {
  if (!running) {
    return (
      <div className="rounded-xl bg-white/80 px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[#86868b]">Now</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#1d1d1f]">Not tracking</span>
          <span className="text-[11px] text-[#86868b]">Pick below ↓</span>
        </div>
      </div>
    );
  }

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

function QuickStartCard({
  running, categories, projects, onStart, isStarting, error,
}: {
  running: TimeEntry | null;
  categories: Category[];
  projects: Project[];
  onStart: (categoryId: string, projectId: string | null) => void;
  isStarting: boolean;
  error: unknown;
}) {
  const disabled = isStarting || !!running;
  return (
    <div className="flex-1 overflow-y-auto rounded-xl bg-white/80 p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">Quick start</div>
      <div className="grid grid-cols-2 gap-1.5">
        {categories.map((c) => (
          <button
            key={c.id}
            disabled={disabled}
            onClick={() => onStart(c.id, null)}
            className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-left text-[12px] ring-1 ring-inset ring-black/5 transition-colors hover:bg-[#0a84ff]/5 disabled:opacity-40"
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
          </button>
        ))}
      </div>
      {projects.length > 0 && categories[0] && (
        <>
          <div className="px-1 pb-1 pt-2 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">By project</div>
          <div className="space-y-1">
            {projects.slice(0, 4).map((pr) => (
              <button
                key={pr.id}
                disabled={disabled}
                onClick={() => onStart(categories[0].id, pr.id)}
                className="flex w-full items-center gap-1.5 rounded-md bg-white px-2 py-1 text-left text-[11px] ring-1 ring-inset ring-black/5 hover:bg-[#0a84ff]/5 disabled:opacity-40"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: pr.color }} />
                <span className="truncate">{pr.name}</span>
                <span className="ml-auto text-[10px] text-[#86868b]">→ {categories[0].name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {Boolean(error) && (
        <div className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600">{String(error)}</div>
      )}
    </div>
  );
}

function elapsedSeconds(startedAtIso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000));
}
function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
