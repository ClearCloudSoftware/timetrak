import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { Category, EntryEdit, NewEntry, Project, TimeEntry } from '../../types';

type Mode =
  | { kind: 'edit'; entry: TimeEntry }
  | { kind: 'create' };

interface Props {
  mode: Mode;
  categories: Category[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

export function EntryEditorSheet({ mode, categories, projects, onClose, onSaved }: Props) {
  const defaults = useMemo(() => computeDefaults(mode, categories), [mode, categories]);
  const [categoryId, setCategoryId] = useState<string>(defaults.categoryId);
  const [projectId, setProjectId] = useState<string | null>(defaults.projectId);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [note, setNote] = useState(defaults.note);

  const startedAt = combineDateTime(startDate, startTime);
  const endedAt = endDate && endTime ? combineDateTime(endDate, endTime) : null;
  const partialEnd = (endDate && !endTime) || (!endDate && endTime);

  const save = useMutation({
    mutationFn: () => {
      if (!startedAt) throw new Error('Start date and time are required.');
      if (partialEnd) throw new Error('End needs both date and time, or neither.');
      const payload = {
        category_id: categoryId,
        project_id: projectId,
        started_at: startedAt,
        ended_at: endedAt,
        note: note.trim() || null,
      };
      if (mode.kind === 'edit') return api.updateEntry(mode.entry.id, payload as EntryEdit);
      return api.createEntry(payload as NewEntry);
    },
    onSuccess: onSaved,
  });

  const title = mode.kind === 'edit' ? 'Edit entry' : 'Add entry';

  // Esc dismisses, like a native sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-10 flex items-start justify-center bg-black/25 pt-12"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet-in w-[440px] rounded-xl bg-raised p-4 shadow-2xl ring-1 ring-separator">
        <div className="mb-3 text-[13px] font-semibold text-label">{title}</div>
        <div className="grid grid-cols-[88px_1fr] items-start gap-x-3 gap-y-2.5 text-[12px]">
          <Field label="Category">
            <select
              className="w-full rounded border border-separator bg-raised px-2 py-1.5 text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {!categoryId && <option value="" disabled>Select a category…</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select
              className="w-full rounded border border-separator bg-raised px-2 py-1.5 text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            <DateTimeRow
              date={startDate}
              time={startTime}
              onDateChange={setStartDate}
              onTimeChange={setStartTime}
            />
          </Field>
          <Field label="Ended">
            <DateTimeRow
              date={endDate}
              time={endTime}
              onDateChange={setEndDate}
              onTimeChange={setEndTime}
            />
            <div className="mt-1 text-[10px] text-label-2">Leave blank if still running.</div>
          </Field>
          <Field label="Description">
            <input
              className="w-full rounded border border-separator px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
              maxLength={250}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mt-0.5 text-right text-xs text-label-2">{note.length} / 250</div>
          </Field>
        </div>
        {save.isError && (
          <div className="mt-2 text-xs text-destructive">{String(save.error)}</div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] text-label-2 transition-colors hover:text-label"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-label-2/30 disabled:text-label-2"
            onClick={() => save.mutate()}
            disabled={save.isPending || !categoryId}
          >
            {mode.kind === 'edit' ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function computeDefaults(mode: Mode, categories: Category[]) {
  if (mode.kind === 'edit') {
    const s = splitLocal(new Date(mode.entry.started_at));
    const e = mode.entry.ended_at ? splitLocal(new Date(mode.entry.ended_at)) : { date: '', time: '' };
    return {
      categoryId: mode.entry.category_id,
      projectId: mode.entry.project_id,
      startDate: s.date,
      startTime: s.time,
      endDate: e.date,
      endTime: e.time,
      note: mode.entry.note ?? '',
    };
  }
  const lastUsed = localStorage.getItem('timetrak.lastCategoryId') ?? '';
  const fallbackCategory = categories[0]?.id ?? '';
  const categoryId = categories.some((c) => c.id === lastUsed) ? lastUsed : fallbackCategory;
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const s = splitLocal(hourAgo);
  const e = splitLocal(now);
  return {
    categoryId,
    projectId: null as string | null,
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
    note: '',
  };
}

export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Plain text input; masked to HH:mm 24hr. Avoids WKWebView's locale-driven
  // 12hr `<input type="time">` rendering.
  const [draft, setDraft] = useState(value);
  // Keep draft in sync when the parent's value changes (e.g. defaults load).
  useMemo(() => { setDraft(value); }, [value]);

  const commit = (raw: string) => {
    const norm = normalizeTime(raw);
    setDraft(norm);
    onChange(norm);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? 1 : -1;
    const stepped = stepMinutes(draft || '00:00', delta * (e.shiftKey ? 15 : 1));
    setDraft(stepped);
    onChange(stepped);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      maxLength={5}
      className="w-20 rounded border border-separator px-2 py-1.5 text-center tabular-nums text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      value={draft}
      onChange={(e) => {
        const next = autoFormat(e.target.value, draft);
        setDraft(next);
        // Only push fully-formed values up; commit incomplete values on blur.
        if (/^\d{2}:\d{2}$/.test(next)) onChange(next);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

function autoFormat(input: string, previous: string): string {
  // Allow only digits and one colon.
  const cleaned = input.replace(/[^\d:]/g, '');
  // If user is deleting, don't auto-insert the colon back.
  if (cleaned.length < previous.length) return cleaned;
  // Auto-insert colon after two digits.
  const digits = cleaned.replace(/:/g, '');
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2, 4);
}

function normalizeTime(raw: string): string {
  const m = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return raw; // leave unparseable values for save-side validation
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, m[2] ? parseInt(m[2], 10) : 0));
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function stepMinutes(value: string, deltaMinutes: number): string {
  const [hStr, mStr] = value.split(':');
  const total = (parseInt(hStr || '0', 10) * 60 + parseInt(mStr || '0', 10) + deltaMinutes + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function DateTimeRow({
  date, time, onDateChange, onTimeChange,
}: {
  date: string;
  time: string;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <DateInput value={date} onChange={onDateChange} className="flex-1" />
      <TimeInput value={time} onChange={onTimeChange} />
    </div>
  );
}

/// Masked DD/MM/YYYY text input. Internal value is ISO YYYY-MM-DD. Avoids
/// WKWebView's locale-driven `<input type="date">` rendering (which often
/// shows MM/DD/YYYY on macOS regardless of `lang`).
export function DateInput({
  value, onChange, className,
}: {
  value: string;          // ISO YYYY-MM-DD
  onChange: (v: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(isoToDisplay(value));
  useMemo(() => { setDraft(isoToDisplay(value)); }, [value]);

  const commit = (raw: string) => {
    const iso = parseDisplayToIso(raw);
    if (iso) {
      setDraft(isoToDisplay(iso));
      onChange(iso);
    } else if (!raw.trim()) {
      setDraft('');
      onChange('');
    } else {
      // Leave as-is; let save-side validation handle.
      setDraft(raw);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="DD/MM/YYYY"
      maxLength={10}
      className={
        'rounded border border-separator px-2 py-1.5 text-center tabular-nums text-label outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
        (className ?? '')
      }
      value={draft}
      onChange={(e) => setDraft(autoFormatDate(e.target.value, draft))}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}

function autoFormatDate(input: string, previous: string): string {
  const cleaned = input.replace(/[^\d/]/g, '');
  // Allow free deletion.
  if (cleaned.length < previous.length) return cleaned;
  const digits = cleaned.replace(/\//g, '');
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

function isoToDisplay(iso: string): string {
  // iso = YYYY-MM-DD
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseDisplayToIso(raw: string): string | null {
  // Accept DD/MM/YYYY or DD/MM/YY.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (m[3].length === 2) y += 2000;
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[1], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // macOS form idiom: right-aligned label column, control column.
  return (
    <>
      <label className="pt-1.5 text-right text-[12px] text-label-2">{label}</label>
      <div className="min-w-0">{children}</div>
    </>
  );
}

function splitLocal(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function combineDateTime(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
