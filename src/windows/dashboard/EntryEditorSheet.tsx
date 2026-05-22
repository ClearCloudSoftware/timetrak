import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { Category, EntryEdit, Project, TimeEntry } from '../../types';

interface Props {
  entry: TimeEntry;
  categories: Category[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

export function EntryEditorSheet({ entry, categories, projects, onClose, onSaved }: Props) {
  const [categoryId, setCategoryId] = useState(entry.category_id);
  const [projectId, setProjectId] = useState<string | null>(entry.project_id);
  const [start, setStart] = useState(toLocalInput(entry.started_at));
  const [end, setEnd] = useState(entry.ended_at ? toLocalInput(entry.ended_at) : '');
  const [note, setNote] = useState(entry.note ?? '');

  const save = useMutation({
    mutationFn: () => {
      const edit: EntryEdit = {
        category_id: categoryId,
        project_id: projectId,
        started_at: fromLocalInput(start),
        ended_at: end ? fromLocalInput(end) : null,
        note: note.trim() || null,
      };
      return api.updateEntry(entry.id, edit);
    },
    onSuccess: onSaved,
  });

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
      <div className="w-[420px] rounded-md bg-white p-4 shadow-lg">
        <div className="mb-3 text-base font-semibold text-gray-900">Edit entry</div>
        <div className="space-y-3 text-sm">
          <Field label="Category">
            <select
              className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select
              className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value || null)}
            >
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Started">
            <input
              type="datetime-local"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Ended (blank = still running)">
            <input
              type="datetime-local"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <input
              className="w-full rounded border border-gray-200 px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              maxLength={250}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-0.5 text-right text-xs text-gray-400">{note.length} / 250</div>
          </Field>
        </div>
        {save.isError && (
          <div className="mt-2 text-xs text-red-600">{String(save.error)}</div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="cursor-pointer px-3 py-1.5 text-sm text-gray-600 transition-colors hover:text-gray-900"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
