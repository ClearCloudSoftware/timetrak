# TimeTrak — Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Implement the Settings window for managing categories and projects, plus the launch-at-login toggle and daily-summary time picker.

**Depends on:** tag `data-layer-complete`.

**Touches:**
- `src-tauri/src/commands/categories.rs`
- `src-tauri/src/commands/projects.rs`
- `src-tauri/src/commands/mod.rs` (append handlers — merge by union)
- `src/windows/settings/` (new)
- `src/App.tsx` (append route case)

**Parallel-safe with:** plans 02, 03, 05.

**UI design:** All UI work in this plan MUST follow the design
constraints in `2026-05-22-timetrak-INDEX.md`. Every task that creates
or modifies a `.tsx` file starts by invoking the `ui-ux-pro-max` skill
with the component's purpose and those constraints. The TSX skeletons
in this plan are functional contracts — refine class lists, structure,
and micro-copy from the skill's output without changing the contract.

---

## Task 1: Category Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/categories.rs`

- [ ] **Step 1: Implement**

Replace `src-tauri/src/commands/categories.rs` with:

```rust
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::Category;
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn list_categories(db: State<'_, Database>) -> AppResult<Vec<Category>> {
    let conn = db.conn.lock().unwrap();
    repo::categories::list(&conn)
}

#[tauri::command]
pub fn create_category(
    app: AppHandle,
    db: State<'_, Database>,
    name: String,
    color: String,
) -> AppResult<Category> {
    let conn = db.conn.lock().unwrap();
    let c = repo::categories::create(&conn, &name, &color)?;
    let _ = app.emit("entries-changed", ());
    Ok(c)
}

#[tauri::command]
pub fn update_category(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    name: String,
    color: String,
) -> AppResult<Category> {
    let conn = db.conn.lock().unwrap();
    let c = repo::categories::update(&conn, id, &name, &color)?;
    let _ = app.emit("entries-changed", ());
    Ok(c)
}

#[tauri::command]
pub fn delete_category(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    cascade_entries: bool,
) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    repo::categories::delete(&conn, id, cascade_entries)?;
    let _ = app.emit("entries-changed", ());
    Ok(())
}
```

- [ ] **Step 2: Verify and commit**

Run: `cd src-tauri && cargo check`

```sh
git add src-tauri/src/commands/categories.rs
git commit -m "feat: category tauri commands"
```

---

## Task 2: Project Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/projects.rs`

- [ ] **Step 1: Implement**

Replace `src-tauri/src/commands/projects.rs` with:

```rust
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::Project;
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn list_projects(db: State<'_, Database>) -> AppResult<Vec<Project>> {
    let conn = db.conn.lock().unwrap();
    repo::projects::list(&conn)
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    db: State<'_, Database>,
    name: String,
    color: String,
) -> AppResult<Project> {
    let conn = db.conn.lock().unwrap();
    let p = repo::projects::create(&conn, &name, &color)?;
    let _ = app.emit("entries-changed", ());
    Ok(p)
}

#[tauri::command]
pub fn update_project(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    name: String,
    color: String,
) -> AppResult<Project> {
    let conn = db.conn.lock().unwrap();
    let p = repo::projects::update(&conn, id, &name, &color)?;
    let _ = app.emit("entries-changed", ());
    Ok(p)
}

#[tauri::command]
pub fn delete_project(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    repo::projects::delete(&conn, id)?;
    let _ = app.emit("entries-changed", ());
    Ok(())
}
```

- [ ] **Step 2: Verify and commit**

```sh
cd src-tauri && cargo check && cd ..
git add src-tauri/src/commands/projects.rs
git commit -m "feat: project tauri commands"
```

---

## Task 3: Register commands

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Append to `timetrak_handlers!`**

Inside `tauri::generate_handler![]`, append:

```rust
            crate::commands::categories::list_categories,
            crate::commands::categories::create_category,
            crate::commands::categories::update_category,
            crate::commands::categories::delete_category,
            crate::commands::projects::list_projects,
            crate::commands::projects::create_project,
            crate::commands::projects::update_project,
            crate::commands::projects::delete_project,
```

- [ ] **Step 2: Verify and commit**

```sh
cd src-tauri && cargo check && cd ..
git add src-tauri/src/commands/mod.rs
git commit -m "feat: register settings commands"
```

---

## Task 4: Settings window — categories tab

**Files:**
- Create: `src/windows/settings/Settings.tsx`
- Create: `src/windows/settings/CategoriesTab.tsx`
- Create: `src/windows/settings/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> CategoriesTab inside a Settings window. Top: an "Add category" row
> with name input, color picker, and a primary Add button — laid out
> horizontally and aligned to baseline. Below: a list/table of
> existing categories, each row inline-editable (name input + color
> picker), with Save (enabled only when changed) and Delete (text-only
> red) actions on the right. Use the design system: minimal, flat,
> neutral surfaces, single blue accent. Output: refined class lists
> and structure.

- [ ] **Step 1: Create `src/windows/settings/CategoriesTab.tsx`**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { qk } from '../../lib/query';
import type { Category } from '../../types';

export function CategoriesTab() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

  const create = useMutation({
    mutationFn: () => api.createCategory(newName, newColor),
    onSuccess: () => { setNewName(''); qc.invalidateQueries({ queryKey: qk.categories }); },
  });

  const update = useMutation({
    mutationFn: (c: Category) => api.updateCategory(c.id, c.name, c.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });

  const del = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) => api.deleteCategory(id, cascade),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });

  const handleDelete = async (c: Category) => {
    try {
      await del.mutateAsync({ id: c.id, cascade: false });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('category has entries')) {
        if (confirm(`"${c.name}" has time entries. Delete the category AND all its entries?`)) {
          del.mutate({ id: c.id, cascade: true });
        }
      } else {
        alert(msg);
      }
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-end gap-2">
        <Field label="New category"><input className="rounded border px-2 py-1" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
        <Field label="Color"><input type="color" className="h-8 w-12 rounded border" value={newColor} onChange={(e) => setNewColor(e.target.value)} /></Field>
        <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:bg-gray-300" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate()}>Add</button>
      </div>
      {create.isError && <div className="text-xs text-red-600">{String(create.error)}</div>}

      <table className="w-full">
        <thead className="text-left text-xs uppercase text-gray-500">
          <tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">Color</th><th /></tr>
        </thead>
        <tbody>
          {(cats.data ?? []).map((c) => (
            <Row key={c.id} cat={c} onUpdate={update.mutate} onDelete={handleDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ cat, onUpdate, onDelete }: { cat: Category; onUpdate: (c: Category) => void; onDelete: (c: Category) => void }) {
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);
  const changed = name !== cat.name || color !== cat.color;
  return (
    <tr className="border-b">
      <td className="px-2 py-1"><input className="rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="px-2 py-1"><input type="color" className="h-7 w-10 rounded border" value={color} onChange={(e) => setColor(e.target.value)} /></td>
      <td className="px-2 py-1 text-right">
        <button className="mr-2 text-blue-600 hover:underline disabled:text-gray-400" disabled={!changed} onClick={() => onUpdate({ ...cat, name, color })}>Save</button>
        <button className="text-red-600 hover:underline" onClick={() => onDelete(cat)}>Delete</button>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs text-gray-500">{label}</span>{children}</label>;
}
```

- [ ] **Step 2: Commit**

```sh
git add src/windows/settings/CategoriesTab.tsx
git commit -m "feat: settings categories tab"
```

---

## Task 5: Projects tab

**Files:**
- Create: `src/windows/settings/ProjectsTab.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> ProjectsTab — visually identical to CategoriesTab (same add row +
> editable list), minus the cascade-delete confirmation. Keep total
> visual parity so users feel the two tabs are part of the same
> system. Output: class lists matching CategoriesTab's refined
> structure.

- [ ] **Step 1: Create — mirror of CategoriesTab without cascade**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { qk } from '../../lib/query';
import type { Project } from '../../types';

export function ProjectsTab() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#10b981');

  const create = useMutation({
    mutationFn: () => api.createProject(newName, newColor),
    onSuccess: () => { setNewName(''); qc.invalidateQueries({ queryKey: qk.projects }); },
  });
  const update = useMutation({
    mutationFn: (p: Project) => api.updateProject(p.id, p.name, p.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-500">New project</span>
          <input className="rounded border px-2 py-1" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-500">Color</span>
          <input type="color" className="h-8 w-12 rounded border" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
        </label>
        <button className="rounded bg-blue-600 px-3 py-1 text-white disabled:bg-gray-300" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate()}>Add</button>
      </div>
      {create.isError && <div className="text-xs text-red-600">{String(create.error)}</div>}

      <table className="w-full">
        <thead className="text-left text-xs uppercase text-gray-500">
          <tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">Color</th><th /></tr>
        </thead>
        <tbody>
          {(projects.data ?? []).map((p) => <Row key={p.id} p={p} onUpdate={update.mutate} onDelete={(id) => del.mutate(id)} />)}
        </tbody>
      </table>
    </div>
  );
}

function Row({ p, onUpdate, onDelete }: { p: Project; onUpdate: (p: Project) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState(p.name);
  const [color, setColor] = useState(p.color);
  const changed = name !== p.name || color !== p.color;
  return (
    <tr className="border-b">
      <td className="px-2 py-1"><input className="rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="px-2 py-1"><input type="color" className="h-7 w-10 rounded border" value={color} onChange={(e) => setColor(e.target.value)} /></td>
      <td className="px-2 py-1 text-right">
        <button className="mr-2 text-blue-600 hover:underline disabled:text-gray-400" disabled={!changed} onClick={() => onUpdate({ ...p, name, color })}>Save</button>
        <button className="text-red-600 hover:underline" onClick={() => onDelete(p.id)}>Delete</button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Commit**

```sh
git add src/windows/settings/ProjectsTab.tsx
git commit -m "feat: settings projects tab"
```

---

## Task 6: Preferences tab — autostart toggle

**Files:**
- Create: `src/windows/settings/PreferencesTab.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> PreferencesTab — a vertical list of preferences. First row: a
> "Launch TimeTrak at login" toggle (checkbox with a clear, calm
> label). Below: a small muted help note. Use the design system.
> Output: refined class lists and structure.

- [ ] **Step 1: Create**

```tsx
import { useEffect, useState } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

export function PreferencesTab() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => { isEnabled().then(setAutostart); }, []);

  const toggle = async () => {
    if (autostart) { await disable(); setAutostart(false); }
    else { await enable(); setAutostart(true); }
  };

  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={autostart ?? false}
          disabled={autostart == null}
          onChange={toggle}
        />
        Launch TimeTrak at login
      </label>
      <p className="text-xs text-gray-500">
        Daily summary time is set by editing <code>app_meta.daily_summary_time</code> in the database (UI TODO in plan 05).
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```sh
git add src/windows/settings/PreferencesTab.tsx
git commit -m "feat: preferences tab with autostart toggle"
```

---

## Task 7: Settings shell + routing

**Files:**
- Create: `src/windows/settings/Settings.tsx`
- Create: `src/windows/settings/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke with:

> Settings window shell, 900×600. Title at top, then a horizontal tab
> strip (Categories, Projects, Preferences) with the active tab
> underlined in blue and inactive tabs muted. Below, the active tab's
> content fills the remaining height with scroll. Minimal, calm,
> consistent with the dashboard window. Output: refined class lists
> for the shell, title, and tab strip.

- [ ] **Step 1: Create `src/windows/settings/Settings.tsx`**

```tsx
import { useState } from 'react';
import { CategoriesTab } from './CategoriesTab';
import { ProjectsTab } from './ProjectsTab';
import { PreferencesTab } from './PreferencesTab';

type Tab = 'categories' | 'projects' | 'preferences';

export function Settings() {
  const [tab, setTab] = useState<Tab>('categories');
  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-3 text-lg font-semibold">Settings</h1>
      <div className="mb-4 flex gap-2 border-b">
        {(['categories', 'projects', 'preferences'] as Tab[]).map((t) => (
          <button
            key={t}
            className={'px-3 py-1 text-sm capitalize ' + (tab === t ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-500')}
            onClick={() => setTab(t)}
          >{t}</button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'preferences' && <PreferencesTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/windows/settings/index.ts`**

```ts
export { Settings } from './Settings';
```

- [ ] **Step 3: Update `src/App.tsx`** — add settings route

```tsx
import { TrayPopover } from './windows/tray';
import { Dashboard } from './windows/dashboard';
import { Settings } from './windows/settings';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('window') ?? 'tray';

  if (w === 'tray') return <TrayPopover />;
  if (w === 'dashboard') return <Dashboard />;
  if (w === 'settings') return <Settings />;
  return <div className="p-4 text-sm text-gray-500">Unknown window: {w}</div>;
}
```

- [ ] **Step 4: Type-check + smoke**

Run: `npx tsc -b && npm run tauri dev`

Open Settings via the tray right-click menu. Verify category and project CRUD work, and the autostart checkbox toggles correctly.

- [ ] **Step 5: Commit**

```sh
git add src/windows/settings src/App.tsx
git commit -m "feat: settings window with tabs and autostart"
```

---

## Task 8: Self-verify and tag

```sh
npx tsc -b && npm test && cd src-tauri && cargo test
git tag plan-04-complete
```

---

## Done

Settings window manages categories, projects, and launch-at-login.
Daily summary scheduling is implemented in plan 05.
