# TimeTrak — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Implement the dashboard window — list of entries by date range, charts of category/project totals, entry editor sheet, and CSV export.

**Depends on:** tag `data-layer-complete`.

**Touches:**
- `src-tauri/src/commands/entries.rs`
- `src-tauri/src/commands/export.rs`
- `src-tauri/src/commands/mod.rs` (append handlers — merge by union)
- `src/windows/dashboard/` (new)
- `src/App.tsx` (append route case)
- `package.json` (add `recharts`)

**Parallel-safe with:** plans 02, 04, 05.

**UI design:** All UI work in this plan MUST follow the design
constraints in `2026-05-22-timetrak-INDEX.md`. Every task that creates
or modifies a `.tsx` file starts by invoking the `ui-ux-pro-max` skill
with the component's purpose and those constraints. The TSX skeletons
in this plan are functional contracts (props, queries, mutations,
events) — refine class lists, structure, and micro-copy from the
skill's output without changing the contract.

---

## Task 1: Entry Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/entries.rs`

- [ ] **Step 1: Implement**

Replace `src-tauri/src/commands/entries.rs` with:

```rust
use chrono::{DateTime, Utc};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{EntryEdit, NewEntry, TimeEntry};
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn list_entries(
    db: State<'_, Database>,
    start_utc: DateTime<Utc>,
    end_utc: DateTime<Utc>,
) -> AppResult<Vec<TimeEntry>> {
    let conn = db.conn.lock().unwrap();
    repo::entries::list_in_range(&conn, start_utc, end_utc)
}

#[tauri::command]
pub fn create_entry(
    app: AppHandle,
    db: State<'_, Database>,
    entry: NewEntry,
) -> AppResult<TimeEntry> {
    let conn = db.conn.lock().unwrap();
    let e = repo::entries::create(&conn, &entry)?;
    let _ = app.emit("entries-changed", ());
    Ok(e)
}

#[tauri::command]
pub fn update_entry(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    edit: EntryEdit,
) -> AppResult<TimeEntry> {
    let conn = db.conn.lock().unwrap();
    let e = repo::entries::update(&conn, id, &edit)?;
    let _ = app.emit("entries-changed", ());
    Ok(e)
}

#[tauri::command]
pub fn delete_entry(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    repo::entries::delete(&conn, id)?;
    let _ = app.emit("entries-changed", ());
    Ok(())
}
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/commands/entries.rs
git commit -m "feat: entry tauri commands"
```

---

## Task 2: Export Tauri command

**Files:**
- Modify: `src-tauri/src/commands/export.rs`

- [ ] **Step 1: Implement**

Replace `src-tauri/src/commands/export.rs` with:

```rust
use chrono::{DateTime, Utc};
use tauri::State;

use crate::csv_export::entries_to_csv;
use crate::db::Database;
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn export_csv(
    db: State<'_, Database>,
    start_utc: DateTime<Utc>,
    end_utc: DateTime<Utc>,
) -> AppResult<String> {
    let conn = db.conn.lock().unwrap();
    let entries = repo::entries::list_in_range(&conn, start_utc, end_utc)?;
    let categories = repo::categories::list(&conn)?;
    let projects = repo::projects::list(&conn)?;
    // Default to UTC for now; settings plan adds a configurable tz.
    let tz = chrono_tz::UTC;
    Ok(entries_to_csv(&entries, &categories, &projects, tz))
}
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/commands/export.rs
git commit -m "feat: csv export tauri command"
```

---

## Task 3: Register commands in handler list

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Add entries to `timetrak_handlers!`**

Inside `tauri::generate_handler![]`, append:

```rust
            crate::commands::entries::list_entries,
            crate::commands::entries::create_entry,
            crate::commands::entries::update_entry,
            crate::commands::entries::delete_entry,
            crate::commands::export::export_csv,
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/commands/mod.rs
git commit -m "feat: register dashboard commands"
```

---

## Task 4: Install Recharts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install recharts`

- [ ] **Step 2: Commit**

```sh
git add package.json package-lock.json
git commit -m "chore: add recharts"
```

---

## Task 5: Dashboard window — entry list

**Files:**
- Create: `src/windows/dashboard/Dashboard.tsx`
- Create: `src/windows/dashboard/DateRangePicker.tsx`
- Create: `src/windows/dashboard/EntryRow.tsx`
- Create: `src/windows/dashboard/index.ts`
- Create: `src/windows/dashboard/format.ts`
- Modify: `src/App.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> Build a dashboard window for a time-tracker desktop app, 900×600.
> Layout: a top bar with the window title on the left and a date range
> picker + "Export CSV" primary button on the right. Below the top bar,
> a two-column chart row (bar chart by category, donut by project),
> then a wide entries table filling the remaining height with sticky
> header. Each entries row has: started, ended, duration, category
> (color dot + name), project, note, and inline Edit/Delete actions.
> Style: minimalism + flat, calm spacing, neutral surfaces, single blue
> accent, red text-only for destructive. Use the design system from
> INDEX.md. Output: refined Tailwind class lists and structure for
> `Dashboard`, `DateRangePicker`, and `EntryRow`. Do not change props,
> queries, mutations, or event listeners.

Apply the skill's output as you create the components.

- [ ] **Step 1: Create `src/windows/dashboard/format.ts`**

```ts
export function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString();
}
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
  return `${m}m`;
}
export function startOfWeekUtc(): { startUtc: string; endUtc: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return { startUtc: monday.toISOString(), endUtc: sunday.toISOString() };
}
```

- [ ] **Step 2: Create `src/windows/dashboard/DateRangePicker.tsx`**

```tsx
interface Props {
  startUtc: string;
  endUtc: string;
  onChange: (next: { startUtc: string; endUtc: string }) => void;
}
export function DateRangePicker({ startUtc, endUtc, onChange }: Props) {
  const startLocal = toLocalInput(startUtc);
  const endLocal = toLocalInput(endUtc);
  return (
    <div className="flex items-center gap-2 text-sm">
      <label>From</label>
      <input
        type="datetime-local"
        className="rounded border px-2 py-1"
        value={startLocal}
        onChange={(e) => onChange({ startUtc: fromLocalInput(e.target.value), endUtc })}
      />
      <label>To</label>
      <input
        type="datetime-local"
        className="rounded border px-2 py-1"
        value={endLocal}
        onChange={(e) => onChange({ startUtc, endUtc: fromLocalInput(e.target.value) })}
      />
    </div>
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
```

- [ ] **Step 3: Create `src/windows/dashboard/EntryRow.tsx`**

```tsx
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
    ? Math.max(0, (new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime()) / 1000)
    : null;
  return (
    <tr className="border-b text-sm">
      <td className="px-2 py-1">{formatLocal(entry.started_at)}</td>
      <td className="px-2 py-1">{entry.ended_at ? formatLocal(entry.ended_at) : '(running)'}</td>
      <td className="px-2 py-1">{duration != null ? formatDuration(duration) : ''}</td>
      <td className="px-2 py-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: cat?.color }} />
        {' '}{cat?.name ?? '?'}
      </td>
      <td className="px-2 py-1">{proj?.name ?? ''}</td>
      <td className="px-2 py-1">{entry.note ?? ''}</td>
      <td className="px-2 py-1 text-right">
        <button className="mr-2 text-blue-600 hover:underline" onClick={() => onEdit(entry)}>Edit</button>
        <button className="text-red-600 hover:underline" onClick={() => onDelete(entry)}>Delete</button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Create `src/windows/dashboard/Dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs'; // see note below if plugin missing
import * as api from '../../lib/api';
import { onEntriesChanged, onTimerChanged } from '../../lib/events';
import { qk } from '../../lib/query';
import type { TimeEntry } from '../../types';
import { DateRangePicker } from './DateRangePicker';
import { EntryRow } from './EntryRow';
import { startOfWeekUtc } from './format';
import { ChartsPanel } from './ChartsPanel';
import { EntryEditorSheet } from './EntryEditorSheet';

export function Dashboard() {
  const qc = useQueryClient();
  const [range, setRange] = useState(startOfWeekUtc());
  const entries = useQuery({
    queryKey: qk.entries(range.startUtc, range.endUtc),
    queryFn: () => api.listEntries(range.startUtc, range.endUtc),
  });
  const categories = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    onEntriesChanged(() => qc.invalidateQueries({ queryKey: ['entries'] })).then((u) => unsubs.push(u));
    onTimerChanged(() => qc.invalidateQueries({ queryKey: ['entries'] })).then((u) => unsubs.push(u));
    return () => { unsubs.forEach((u) => u()); };
  }, [qc]);

  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });

  const onExport = async () => {
    const csv = await api.exportCsv(range.startUtc, range.endUtc);
    const path = await save({ defaultPath: 'timetrak.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (path) await writeTextFile(path, csv);
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <DateRangePicker startUtc={range.startUtc} endUtc={range.endUtc} onChange={setRange} />
          <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={onExport}>Export CSV</button>
        </div>
      </div>

      <ChartsPanel
        entries={entries.data ?? []}
        categories={categories.data ?? []}
        projects={projects.data ?? []}
      />

      <div className="mt-4 flex-1 overflow-auto rounded border">
        <table className="w-full">
          <thead className="sticky top-0 bg-gray-100 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-2 py-1">Started</th>
              <th className="px-2 py-1">Ended</th>
              <th className="px-2 py-1">Duration</th>
              <th className="px-2 py-1">Category</th>
              <th className="px-2 py-1">Project</th>
              <th className="px-2 py-1">Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(entries.data ?? []).map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                categories={categories.data ?? []}
                projects={projects.data ?? []}
                onEdit={setEditing}
                onDelete={(x) => deleteMut.mutate(x.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EntryEditorSheet
          entry={editing}
          categories={categories.data ?? []}
          projects={projects.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['entries'] }); }}
        />
      )}
    </div>
  );
}
```

> Note on `@tauri-apps/plugin-fs`: if not installed yet, add it:
> ```sh
> npm install @tauri-apps/plugin-fs
> ```
> Then in `src-tauri/Cargo.toml` add `tauri-plugin-fs = "2"`, and in `main.rs` register it with `.plugin(tauri_plugin_fs::init())`.
> Alternative if you want zero-extra-plugins: have the Rust `export_csv` command take an optional `path` argument and write the file itself using `std::fs::write`, returning unit. Both are valid — pick one and stay consistent.

- [ ] **Step 5: Create `src/windows/dashboard/index.ts`**

```ts
export { Dashboard } from './Dashboard';
```

- [ ] **Step 6: Update `src/App.tsx`** — add dashboard route

```tsx
import { TrayPopover } from './windows/tray';
import { Dashboard } from './windows/dashboard';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('window') ?? 'tray';

  if (w === 'tray') return <TrayPopover />;
  if (w === 'dashboard') return <Dashboard />;
  return <div className="p-4 text-sm text-gray-500">Unknown window: {w}</div>;
}
```

- [ ] **Step 7: Commit**

```sh
git add src/windows/dashboard src/App.tsx
git commit -m "feat: dashboard window with entry list and csv export"
```

---

## Task 6: Charts panel

**Files:**
- Create: `src/windows/dashboard/ChartsPanel.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> Two minimal Recharts cards side by side inside a dashboard. Left: bar
> chart "Time by category". Right: donut "Time by project". Cards have
> 1px gray-200 borders, `rounded-md`, no shadow, small uppercase label
> at top, generous interior padding. Chart fills use user-defined
> category/project colors (passed as data). Axis labels small, gray
> tick text, no chart titles inside the SVG. Output: refined class
> lists for `ChartCard` and the chart container layout, plus any
> recharts prop tweaks for a minimal look (no grid lines, slim axis,
> compact tooltip).

- [ ] **Step 1: Create**

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { Category, Project, TimeEntry } from '../../types';

interface Props {
  entries: TimeEntry[];
  categories: Category[];
  projects: Project[];
}

export function ChartsPanel({ entries, categories, projects }: Props) {
  const byCategory = aggregate(entries, (e) => e.category_id);
  const byProject = aggregate(entries, (e) => e.project_id ?? null);

  const catData = categories
    .map((c) => ({ name: c.name, minutes: Math.round((byCategory.get(c.id) ?? 0) / 60), color: c.color }))
    .filter((d) => d.minutes > 0);

  const projData = [
    ...projects.map((p) => ({ name: p.name, minutes: Math.round((byProject.get(p.id) ?? 0) / 60), color: p.color })),
    { name: '(No project)', minutes: Math.round((byProject.get(null) ?? 0) / 60), color: '#9ca3af' },
  ].filter((d) => d.minutes > 0);

  return (
    <div className="grid grid-cols-2 gap-4">
      <ChartCard title="Time by category">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={catData}>
            <XAxis dataKey="name" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Bar dataKey="minutes">
              {catData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Time by project">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={projData} dataKey="minutes" nameKey="name" outerRadius={80}>
              {projData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">{title}</div>
      {children}
    </div>
  );
}

function aggregate<T>(entries: TimeEntry[], keyOf: (e: TimeEntry) => T): Map<T, number> {
  const out = new Map<T, number>();
  for (const e of entries) {
    if (!e.ended_at) continue;
    const seconds = (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000;
    const k = keyOf(e);
    out.set(k, (out.get(k) ?? 0) + seconds);
  }
  return out;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: passes.

- [ ] **Step 3: Commit**

```sh
git add src/windows/dashboard/ChartsPanel.tsx
git commit -m "feat: dashboard charts panel"
```

---

## Task 7: Entry editor sheet

**Files:**
- Create: `src/windows/dashboard/EntryEditorSheet.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> Modal sheet for editing a time entry. 420px wide, centered, white
> surface with `rounded-md` and `shadow-lg` (the only place we use a
> shadow). Dimmed backdrop. Fields stacked: Category select, Project
> select, Started (datetime-local), Ended (datetime-local, blank means
> running), Note. Footer: Cancel (text-only) and Save (primary blue).
> Inline error text in red beneath the form on failure. Style:
> minimalism, calm, consistent with the dashboard. Output: refined
> class lists for the modal shell, fields layout, and footer.

- [ ] **Step 1: Create**

```tsx
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
      <div className="w-[420px] rounded bg-white p-4 shadow-lg">
        <div className="mb-2 text-base font-semibold">Edit entry</div>
        <div className="space-y-2 text-sm">
          <Field label="Category">
            <select className="w-full rounded border px-2 py-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Project">
            <select className="w-full rounded border px-2 py-1" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Started">
            <input type="datetime-local" className="w-full rounded border px-2 py-1" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ended (blank = still running)">
            <input type="datetime-local" className="w-full rounded border px-2 py-1" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Note">
            <input className="w-full rounded border px-2 py-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {save.isError && <div className="mt-2 text-xs text-red-600">{String(save.error)}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded px-3 py-1 text-sm" onClick={onClose}>Cancel</button>
          <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
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
```

- [ ] **Step 2: Type-check + smoke**

Run: `npx tsc -b && npm run tauri dev`

Open the dashboard from the tray menu. Verify entries appear, charts render, editing saves, deleting works, CSV export prompts a save dialog.

- [ ] **Step 3: Commit**

```sh
git add src/windows/dashboard/EntryEditorSheet.tsx
git commit -m "feat: entry editor sheet"
```

---

## Task 8: Self-verify and tag

- [ ] **Step 1: Full check**

```sh
npx tsc -b && npm test && cd src-tauri && cargo test
```

- [ ] **Step 2: Tag**

```sh
git tag plan-03-complete
```

---

## Done

Dashboard window is functional with date range, charts, list, edit
sheet, and CSV export. Settings, autostart, and notifications follow
in plans 04 and 05.
