import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { onTimerChanged } from '../../lib/events';
import { qk } from '../../lib/query';
import type { Id, TimeEntry } from '../../types';
import { CategoryPicker } from './CategoryPicker';

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

  const [categoryId, setCategoryId] = useState<Id | null>(null);
  const [projectId, setProjectId] = useState<Id | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (categoryId == null && categories.data && categories.data.length > 0) {
      setCategoryId(categories.data[0].id);
    }
  }, [categories.data, categoryId]);

  const startMut = useMutation({
    mutationFn: () => api.startTimer(categoryId!, projectId, note.trim() || null),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.timerState }),
  });
  const stopMut = useMutation({
    mutationFn: () => api.stopTimer(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.timerState }),
  });

  const running = timer.data?.running ?? null;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header bar — thin, low-weight, keeps eye on the content */}
      <div className="flex items-center border-b border-gray-200 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 select-none">
          TimeTrak
        </span>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col p-3">
        {running ? (
          <RunningView
            entry={running}
            categories={categories.data ?? []}
            projects={projects.data ?? []}
            onStop={() => stopMut.mutate()}
            stopPending={stopMut.isPending}
          />
        ) : (
          <div className="flex flex-1 flex-col justify-between">
            <CategoryPicker
              categories={categories.data ?? []}
              projects={projects.data ?? []}
              categoryId={categoryId}
              projectId={projectId}
              note={note}
              onChange={(n) => {
                setCategoryId(n.categoryId);
                setProjectId(n.projectId);
                setNote(n.note);
              }}
            />

            <div className="mt-4 space-y-2">
              {startMut.isError && (
                <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600">
                  {String(startMut.error)}
                </div>
              )}
              <button
                className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                disabled={!categoryId || startMut.isPending}
                onClick={() => startMut.mutate()}
              >
                {startMut.isPending ? 'Starting…' : 'Start'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RunningView({
  entry, categories, projects, onStop, stopPending,
}: { entry: TimeEntry; categories: any[]; projects: any[]; onStop: () => void; stopPending?: boolean }) {
  const cat = categories.find((c) => c.id === entry.category_id);
  const proj = projects.find((p) => p.id === entry.project_id);
  const [elapsed, setElapsed] = useState(elapsedSeconds(entry.started_at));
  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsedSeconds(entry.started_at)), 1000);
    return () => clearInterval(t);
  }, [entry.started_at]);

  return (
    <div className="flex flex-1 flex-col justify-between">
      <div className="space-y-3">
        {/* Running indicator */}
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-widest text-gray-400">Running</span>
        </div>

        {/* Category · Project */}
        <div>
          <div className="text-sm font-medium text-gray-800">
            {cat?.name ?? '?'}
            {proj && (
              <span className="text-gray-400"> · {proj.name}</span>
            )}
          </div>
          {entry.note && (
            <div className="mt-0.5 text-xs text-gray-500">{entry.note}</div>
          )}
        </div>

        {/* Elapsed counter — tabular monospace, large but calm */}
        <div
          className="font-mono text-3xl font-light tabular-nums tracking-tight text-gray-800"
          aria-live="off"
          aria-label={`Elapsed: ${formatElapsed(elapsed)}`}
        >
          {formatElapsed(elapsed)}
        </div>
      </div>

      {/* Stop — text-only destructive, no red surface */}
      <div className="mt-4">
        <button
          className="w-full rounded border border-gray-200 px-3 py-2 text-sm text-red-600 transition-colors duration-150 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-gray-400"
          disabled={stopPending}
          onClick={onStop}
        >
          {stopPending ? 'Stopping…' : 'Stop'}
        </button>
      </div>
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
