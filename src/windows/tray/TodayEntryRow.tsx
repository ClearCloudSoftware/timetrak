import type { Category, Project, TimeEntry } from '../../types';
import { formatDuration, formatStartTime } from './format';

interface Props {
  entry: TimeEntry;
  categories: Category[];
  projects: Project[];
  onResume: (entry: TimeEntry) => void;
}

export function TodayEntryRow({ entry, categories, projects, onResume }: Props) {
  const cat = categories.find((c) => c.id === entry.category_id);
  const proj = projects.find((p) => p.id === entry.project_id);

  const durationSec =
    entry.ended_at != null
      ? Math.max(0, (new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime()) / 1000)
      : 0;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onResume(entry);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-md px-2 py-1.5 hover:bg-[#0a84ff]/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
      onClick={() => onResume(entry)}
      onKeyDown={handleKey}
    >
      {/* Line 1: meta row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Start time */}
          <span className="shrink-0 text-[10px] tabular-nums text-[#86868b]">{formatStartTime(entry.started_at)}</span>
          {/* Category dot */}
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: cat?.color ?? '#86868b' }}
          />
          {/* Category name */}
          <span className="truncate text-[12px] text-[#1d1d1f]">{cat?.name ?? '?'}</span>
          {/* Project */}
          {proj && (
            <span className="shrink-0 text-[11px] text-[#86868b]">· {proj.name}</span>
          )}
        </div>
        {/* Duration */}
        <span className="shrink-0 text-[11px] tabular-nums text-[#86868b]">{formatDuration(durationSec)}</span>
      </div>
      {/* Line 2: description */}
      {entry.note && (
        <div className="truncate pl-[2.25rem] text-[10px] text-[#86868b]">{entry.note}</div>
      )}
    </div>
  );
}
