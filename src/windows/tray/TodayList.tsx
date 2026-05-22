import type { Category, Id, Project, TimeEntry } from '../../types';
import { TodayEntryRow } from './TodayEntryRow';

interface Props {
  entries: TimeEntry[];
  categories: Category[];
  projects: Project[];
  runningId: Id | null;
  onResume: (entry: TimeEntry) => void;
}

export function TodayList({ entries, categories, projects, runningId, onResume }: Props) {
  const stopped = entries
    .filter((e) => e.id !== runningId)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  if (stopped.length === 0) {
    return (
      <div className="px-2 py-3 text-[11px] text-[#86868b]">No timers stopped today yet.</div>
    );
  }

  return (
    <div className="flex flex-col">
      {stopped.map((e) => (
        <TodayEntryRow
          key={e.id}
          entry={e}
          categories={categories}
          projects={projects}
          onResume={onResume}
        />
      ))}
    </div>
  );
}
