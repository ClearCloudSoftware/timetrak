import type { Category, Project, TimeEntry } from '../../types';
import { formatLocal, formatDuration } from './format';

interface Props {
  entry: TimeEntry;
  categories: Category[];
  projects: Project[];
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
}

export function EntryRow({ entry, categories, projects, onEdit, onDelete }: Props) {
  const cat = categories.find((c) => c.id === entry.category_id);
  const proj = projects.find((p) => p.id === entry.project_id);
  const duration = entry.ended_at
    ? Math.max(
        0,
        (new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime()) / 1000,
      )
    : null;

  return (
    <tr className="border-b border-gray-200 text-sm transition-colors hover:bg-gray-50">
      <td className="px-3 py-2 text-gray-700 tabular-nums">{formatLocal(entry.started_at)}</td>
      <td className="px-3 py-2 text-gray-700 tabular-nums">
        {entry.ended_at ? formatLocal(entry.ended_at) : <span className="text-gray-400">(running)</span>}
      </td>
      <td className="px-3 py-2 tabular-nums text-gray-700">
        {duration != null ? formatDuration(duration) : ''}
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: cat?.color }}
          />
          <span className="text-gray-700">{cat?.name ?? '?'}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-gray-700">{proj?.name ?? ''}</td>
      <td className="px-3 py-2 text-gray-500">{entry.note ?? ''}</td>
      <td className="px-3 py-2 text-right">
        <button
          className="mr-3 cursor-pointer text-blue-600 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => onEdit(entry)}
        >
          Edit
        </button>
        <button
          className="cursor-pointer text-red-600 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => onDelete(entry)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
