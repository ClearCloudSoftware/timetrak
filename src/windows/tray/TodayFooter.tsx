import type { TimeEntry } from '../../types';
import { formatDuration } from './format';

interface Props {
  entries: TimeEntry[];
  runningEntry: TimeEntry | null;
  nowMs: number;
}

export function TodayFooter({ entries, runningEntry, nowMs }: Props) {
  let totalSeconds = 0;

  for (const e of entries) {
    if (runningEntry && e.id === runningEntry.id) {
      // skip — we'll add the running contribution separately
      continue;
    }
    if (e.ended_at != null) {
      totalSeconds +=
        Math.max(0, (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000);
    }
  }

  if (runningEntry) {
    totalSeconds += Math.max(
      0,
      (nowMs - new Date(runningEntry.started_at).getTime()) / 1000,
    );
  }

  return (
    <div className="border-t border-separator px-3 py-1.5 text-[11px] text-label-2 tabular-nums">
      Today: {formatDuration(totalSeconds)}
    </div>
  );
}
