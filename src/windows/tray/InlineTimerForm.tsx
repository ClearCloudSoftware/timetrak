import { useState } from 'react';
import type { Category, Id, Project } from '../../types';
import { CategoryPicker } from './CategoryPicker';
// Reused from the dashboard editor: masked HH:mm input that avoids WKWebView's
// locale-driven 12hr `<input type="time">` rendering.
import { TimeInput } from '../dashboard/EntryEditorSheet';

interface Initial {
  categoryId: Id | null;
  projectId: Id | null;
  description: string;
  /** HH:mm local. Present only in edit mode — enables the time row. */
  startTime?: string;
  /** HH:mm local, or null for a still-running entry. */
  endTime?: string | null;
}

export interface SubmitValue {
  categoryId: Id;
  projectId: Id | null;
  description: string | null;
  startTime?: string;
  endTime?: string | null;
}

interface Props {
  initial: Initial;
  categories: Category[];
  projects: Project[];
  onCancel: () => void;
  onSubmit: (v: SubmitValue) => void;
  submitting: boolean;
  submitLabel?: string;
  onDelete?: () => void;
  deleting?: boolean;
}

export function InlineTimerForm({
  initial,
  categories,
  projects,
  onCancel,
  onSubmit,
  submitting,
  submitLabel = 'Start',
  onDelete,
  deleting = false,
}: Props) {
  const [categoryId, setCategoryId] = useState<Id | null>(initial.categoryId);
  const [projectId, setProjectId] = useState<Id | null>(initial.projectId);
  const [note, setNote] = useState(initial.description);
  const [startTime, setStartTime] = useState(initial.startTime ?? '');
  const [endTime, setEndTime] = useState(initial.endTime ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editingTimes = initial.startTime !== undefined;

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
      ...(editingTimes
        ? { startTime, endTime: initial.endTime === null ? null : endTime }
        : {}),
    });
  };

  const startDisabled = !categoryId || submitting || deleting;

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

      {editingTimes && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#86868b]">
          <TimeInput value={startTime} onChange={setStartTime} />
          <span>→</span>
          {initial.endTime === null ? (
            <span className="italic">running</span>
          ) : (
            <TimeInput value={endTime} onChange={setEndTime} />
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-1">
        {onDelete && (
          <button
            type="button"
            disabled={submitting || deleting}
            className="mr-auto rounded-md px-2.5 py-1 text-[11px] text-[#ff453a] transition-colors hover:bg-[#ff453a]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff453a] disabled:opacity-50"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Sure?' : 'Delete'}
          </button>
        )}
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
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
