import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import * as api from '../../lib/api';
import type { PendingImport, ResolutionAction } from '../../types';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

export function ConflictsPanel() {
  const qc = useQueryClient();
  const conflicts = useQuery({
    queryKey: ['conflicts'],
    queryFn: api.pendingConflictsList,
  });

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    listen('calendar-conflicts-changed', () => {
      qc.invalidateQueries({ queryKey: ['conflicts'] });
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [qc]);

  const [open, setOpen] = useState(false);
  const list = conflicts.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="border-b border-[#ff9f0a]/30 bg-[#fff8e6]" style={FONT}>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[#ff9f0a]">⚠</span>
        <span className="font-medium">{list.length} calendar {list.length === 1 ? 'conflict' : 'conflicts'}</span>
        <span className="ml-auto text-[10px] text-[#86868b]">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-[#ff9f0a]/20 bg-white">
          {list.map((c) => <ConflictRow key={c.id} conflict={c} qc={qc} />)}
        </div>
      )}
    </div>
  );
}

function ConflictRow({ conflict, qc }: { conflict: PendingImport; qc: ReturnType<typeof useQueryClient> }) {
  const resolve = useMutation({
    mutationFn: ({ action }: { action: ResolutionAction }) =>
      api.pendingConflictResolve(conflict.id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conflicts'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });

  return (
    <div className="flex items-center gap-2 border-b border-black/5 px-3 py-1.5 text-[12px] last:border-b-0">
      <div className="flex-1">
        <div className="truncate font-medium text-[#1d1d1f]">{conflict.title}</div>
        <div className="text-[11px] text-[#86868b]">
          {new Date(conflict.started_at).toLocaleString()} – {new Date(conflict.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <button
        className="h-6 rounded-md border border-black/10 px-2 text-[11px] hover:bg-black/[0.04] disabled:opacity-50"
        onClick={() => resolve.mutate({ action: 'kept_mine' })}
        disabled={resolve.isPending}
      >Keep mine</button>
      <button
        className="h-6 rounded-md bg-[#0a84ff] px-2 text-[11px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
        onClick={() => resolve.mutate({ action: 'used_calendar' })}
        disabled={resolve.isPending}
      >Use calendar</button>
    </div>
  );
}
