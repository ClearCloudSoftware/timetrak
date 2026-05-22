import type { Category, Id, Project } from '../../types';

interface PickerValue {
  categoryId: Id | null;
  projectId: Id | null;
  note: string;
}

interface Props {
  categories: Category[];
  projects: Project[];
  categoryId: Id | null;
  projectId: Id | null;
  note: string;
  onChange: (v: PickerValue) => void;
}

export function CategoryPicker({
  categories,
  projects,
  categoryId,
  projectId,
  note,
  onChange,
}: Props) {
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
          Category
        </label>
        <select
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={categoryId ?? ''}
          onChange={(e) => onChange({ categoryId: e.target.value || null, projectId, note })}
        >
          <option value="">— Select —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
          Project
        </label>
        <select
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={projectId ?? ''}
          onChange={(e) => onChange({ categoryId, projectId: e.target.value || null, note })}
        >
          <option value="">— None —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
          Description (optional)
        </label>
        <input
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          maxLength={250}
          value={note}
          onChange={(e) => onChange({ categoryId, projectId, note: e.target.value })}
        />
        <div className="mt-0.5 text-right text-xs text-gray-400">{note.length} / 250</div>
      </div>
    </div>
  );
}
