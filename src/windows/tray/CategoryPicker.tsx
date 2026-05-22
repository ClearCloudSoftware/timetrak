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

const LABEL =
  'block text-[10px] font-medium uppercase tracking-[0.08em] text-[#86868b]';
const FIELD =
  'mt-0.5 w-full rounded-md bg-white px-2 py-1 text-[12px] text-[#1d1d1f] ring-1 ring-inset ring-black/10 outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]';

export function CategoryPicker({
  categories,
  projects,
  categoryId,
  projectId,
  note,
  onChange,
}: Props) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className={LABEL}>Category</label>
        <select
          className={FIELD}
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
        <label className={LABEL}>Project</label>
        <select
          className={FIELD}
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
        <label className={LABEL}>Description (optional)</label>
        <input
          className={FIELD}
          maxLength={250}
          value={note}
          onChange={(e) => onChange({ categoryId, projectId, note: e.target.value })}
        />
        <div className="mt-0.5 text-right text-[10px] tabular-nums text-[#86868b]">
          {note.length} / 250
        </div>
      </div>
    </div>
  );
}
