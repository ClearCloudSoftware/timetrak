import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../../lib/api';

interface AutoSwitchPayload {
  entry_id: string;
  previous_entry_id: string | null;
}

interface MeetingEndedPayload {
  entry_id: string;
  title: string | null;
}

type Toast =
  | { kind: 'auto-switched'; entryId: string; previousEntryId: string | null; expiresAt: number }
  | { kind: 'meeting-ended'; entryId: string; title: string | null };

const UNDO_WINDOW_MS = 30_000;

/// Renders a stack of small floating toasts at the bottom of the tray popover
/// that respond to calendar events emitted by the scheduler.
export function CalendarToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    listen<AutoSwitchPayload>('calendar-auto-switched', (e) => {
      setToasts((cur) => [
        ...cur,
        {
          kind: 'auto-switched',
          entryId: e.payload.entry_id,
          previousEntryId: e.payload.previous_entry_id,
          expiresAt: Date.now() + UNDO_WINDOW_MS,
        },
      ]);
    }).then((u) => unsubs.push(u));

    listen<MeetingEndedPayload>('calendar-meeting-ended', (e) => {
      setToasts((cur) => [
        ...cur,
        { kind: 'meeting-ended', entryId: e.payload.entry_id, title: e.payload.title },
      ]);
    }).then((u) => unsubs.push(u));

    const tick = setInterval(() => {
      setToasts((cur) =>
        cur.filter((t) => t.kind !== 'auto-switched' || t.expiresAt > Date.now()),
      );
    }, 1000);

    return () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="space-y-1">
      {toasts.map((t, i) => (
        <Toast
          key={i}
          toast={t}
          onDismiss={() => setToasts((cur) => cur.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  if (toast.kind === 'auto-switched') {
    return (
      <div className="flex items-center gap-2 rounded-md bg-[#0a84ff]/[0.08] px-2 py-1.5 text-[11px]">
        <span className="flex-1 truncate text-[#1d1d1f]">Auto-started meeting timer.</span>
        <button
          className="text-[#0a84ff] hover:underline"
          onClick={async () => {
            try {
              await api.calendarUndoSwitch(toast.entryId, toast.previousEntryId);
            } finally {
              onDismiss();
            }
          }}
        >Undo</button>
      </div>
    );
  }
  return (
    <div className="rounded-md bg-[#ff9f0a]/[0.1] px-2 py-1.5 text-[11px]">
      <div className="text-[#1d1d1f]">
        {toast.title ?? 'Meeting'} ended.
      </div>
      <div className="mt-1 flex gap-2">
        <button
          className="h-6 flex-1 rounded-md bg-[#0a84ff] text-[11px] font-medium text-white hover:bg-[#0a74e0]"
          onClick={async () => {
            try { await api.calendarExtend(toast.entryId); } finally { onDismiss(); }
          }}
        >Extend 15 min</button>
        <button
          className="h-6 flex-1 rounded-md border border-black/10 text-[11px] hover:bg-black/[0.04]"
          onClick={async () => {
            try { await api.calendarStopMeeting(toast.entryId); } finally { onDismiss(); }
          }}
        >Stop</button>
      </div>
    </div>
  );
}
