import type { Category, Project, Id } from '../../types';

interface Props {
  categories: Category[];
  projects: Project[];
  categoryId: Id | null;
  projectId: Id | null;
  note: string;
  onChange: (next: { categoryId: Id | null; projectId: Id | null; note: string }) => void;
}

export function CategoryPicker({ categories, projects, categoryId, projectId, note, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
          Category
        </label>
        <select
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
          value={categoryId ?? ''}
          onChange={(e) => onChange({ categoryId: e.target.value || null, projectId, note })}
        >
          <option value="" disabled>Select a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
          Project
          <span className="ml-1 normal-case font-normal text-gray-400">(optional)</span>
        </label>
        <select
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
          value={projectId ?? ''}
          onChange={(e) => onChange({ categoryId, projectId: e.target.value || null, note })}
        >
          <option value="">— None —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
          Note
          <span className="ml-1 normal-case font-normal text-gray-400">(optional)</span>
        </label>
        <input
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          placeholder="e.g. code review, standup…"
          value={note}
          onChange={(e) => onChange({ categoryId, projectId, note: e.target.value })}
        />
      </div>
    </div>
  );
}
