import { useState } from 'react';
import type { Category, Id, Project } from '../../types';
import { CategoryPicker } from './CategoryPicker';

interface Initial {
  categoryId: Id | null;
  projectId: Id | null;
  description: string;
}

interface Props {
  initial: Initial;
  categories: Category[];
  projects: Project[];
  onCancel: () => void;
  onSubmit: (v: { categoryId: Id; projectId: Id | null; description: string | null }) => void;
  submitting: boolean;
}

export function InlineTimerForm({
  initial,
  categories,
  projects,
  onCancel,
  onSubmit,
  submitting,
}: Props) {
  const [categoryId, setCategoryId] = useState<Id | null>(initial.categoryId);
  const [projectId, setProjectId] = useState<Id | null>(initial.projectId);
  const [note, setNote] = useState(initial.description);

  const handleChange = (v: { categoryId: Id | null; projectId: Id | null; note: string }) => {
    setCategoryId(v.categoryId);
    setProjectId(v.projectId);
    setNote(v.note);
  };

  const handleSubmit = () => {
    if (!categoryId) return;
    const trimmed = note.trim();
    onSubmit({
      categoryId,
      projectId,
      description: trimmed.length > 0 ? trimmed : null,
    });
  };

  const startDisabled = !categoryId || submitting;

  return (
    <div className="rounded-md bg-white/90 p-2 ring-1 ring-inset ring-black/5">
      <CategoryPicker
        categories={categories}
        projects={projects}
        categoryId={categoryId}
        projectId={projectId}
        note={note}
        onChange={handleChange}
      />
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          type="button"
          className="px-2.5 py-1 text-[11px] text-[#86868b] transition-colors hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={startDisabled}
          className="rounded-md bg-[#0a84ff] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#0070d1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] disabled:cursor-not-allowed disabled:bg-[#86868b]/30 disabled:text-white/60"
          onClick={handleSubmit}
        >
          Start
        </button>
      </div>
    </div>
  );
}
