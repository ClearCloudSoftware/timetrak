# TimeTrak — Timer + Tray Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` syntax.

**Goal:** Implement the timer service in the Rust core, expose it via Tauri commands, install a system tray icon, and render the tray popover window with start / stop / switch controls.

**Depends on:** tag `data-layer-complete` (plans 00, 01).

**Touches:**
- `src-tauri/src/timer.rs`
- `src-tauri/src/commands/timer.rs`
- `src-tauri/src/main.rs` (tray setup + register handlers — append-only)
- `src-tauri/src/commands/mod.rs` (`timetrak_handlers!` list — append-only)
- `src/windows/tray/` (new)
- `src/App.tsx` (route case — append-only)

**Parallel-safe with:** plans 03, 04, 05.

**UI design:** All UI work in this plan MUST follow the design
constraints in `2026-05-22-timetrak-INDEX.md` (minimalism + flat,
neutral grays + single blue accent, system font, 4px grid). Each UI
task's first step is to **invoke the `ui-ux-pro-max` skill** with the
component's purpose and those constraints. The TSX in this plan is a
functional skeleton — props, queries, mutations, and event wiring are
frozen; the agent refines class lists, structure, and micro-copy from
the skill's output.

---

## Task 1: Timer service in Rust

**Files:**
- Modify: `src-tauri/src/timer.rs`

- [ ] **Step 1: Implement `timer` with tests**

Replace `src-tauri/src/timer.rs` with:

```rust
use chrono::Utc;
use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::{NewEntry, TimeEntry};
use crate::error::AppResult;
use crate::repo;

#[derive(Debug, Clone, Serialize)]
pub struct TimerState {
    pub running: Option<TimeEntry>,
}

pub fn state(conn: &Connection) -> AppResult<TimerState> {
    Ok(TimerState { running: repo::entries::running(conn)? })
}

/// Atomically: stop any running entry, then start a new one.
pub fn start(
    conn: &mut Connection,
    category_id: Uuid,
    project_id: Option<Uuid>,
    note: Option<String>,
) -> AppResult<TimeEntry> {
    let tx = conn.transaction()?;
    let now = Utc::now();
    repo::entries::stop_running_now(&tx, now)?;
    let entry = repo::entries::create(&tx, &NewEntry {
        category_id,
        project_id,
        started_at: now,
        ended_at: None,
        note,
    })?;
    tx.commit()?;
    Ok(entry)
}

pub fn stop(conn: &Connection) -> AppResult<Option<TimeEntry>> {
    repo::entries::stop_running_now(conn, Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn start_with_nothing_running_creates_running_entry() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let e = start(&mut conn, meeting(), None, None).unwrap();
        assert!(e.ended_at.is_none());
        assert_eq!(state(&conn).unwrap().running.unwrap().id, e.id);
    }

    #[test]
    fn start_when_already_running_stops_previous_in_same_transaction() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let first = start(&mut conn, meeting(), None, None).unwrap();
        let second = start(&mut conn, coding(), None, None).unwrap();
        assert_ne!(first.id, second.id);
        let prev = repo::entries::find(&conn, first.id).unwrap();
        assert!(prev.ended_at.is_some());
        assert_eq!(state(&conn).unwrap().running.unwrap().id, second.id);
    }

    #[test]
    fn stop_without_running_returns_none() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(stop(&conn).unwrap().is_none());
    }
}
```

- [ ] **Step 2: Run**

Run: `cd src-tauri && cargo test --lib timer::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/timer.rs
git commit -m "feat: timer service with atomic stop+start"
```

---

## Task 2: Timer Tauri commands

**Files:**
- Modify: `src-tauri/src/commands/timer.rs`

- [ ] **Step 1: Implement command wrappers**

Replace `src-tauri/src/commands/timer.rs` with:

```rust
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::TimeEntry;
use crate::error::AppResult;
use crate::timer::{self, TimerState};

#[tauri::command]
pub fn get_timer_state(db: State<'_, Database>) -> AppResult<TimerState> {
    let conn = db.conn.lock().unwrap();
    timer::state(&conn)
}

#[tauri::command]
pub fn start_timer(
    app: AppHandle,
    db: State<'_, Database>,
    category_id: Uuid,
    project_id: Option<Uuid>,
    note: Option<String>,
) -> AppResult<TimeEntry> {
    let mut conn = db.conn.lock().unwrap();
    let entry = timer::start(&mut conn, category_id, project_id, note)?;
    emit_changed(&app, Some(&entry));
    Ok(entry)
}

#[tauri::command]
pub fn stop_timer(app: AppHandle, db: State<'_, Database>) -> AppResult<Option<TimeEntry>> {
    let conn = db.conn.lock().unwrap();
    let stopped = timer::stop(&conn)?;
    emit_changed(&app, None);
    Ok(stopped)
}

#[tauri::command]
pub fn switch_timer(
    app: AppHandle,
    db: State<'_, Database>,
    category_id: Uuid,
    project_id: Option<Uuid>,
    note: Option<String>,
) -> AppResult<TimeEntry> {
    // `start` already stops any running entry atomically.
    start_timer(app, db, category_id, project_id, note)
}

fn emit_changed(app: &AppHandle, running: Option<&TimeEntry>) {
    let _ = app.emit("timer-changed", serde_json::json!({ "running": running }));
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/commands/timer.rs
git commit -m "feat: timer commands with timer-changed event"
```

---

## Task 3: Register timer commands

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Update `commands/mod.rs`** — replace `timetrak_handlers!` body:

```rust
#[macro_export]
macro_rules! timetrak_handlers {
    () => {
        tauri::generate_handler![
            crate::commands::timer::get_timer_state,
            crate::commands::timer::start_timer,
            crate::commands::timer::stop_timer,
            crate::commands::timer::switch_timer,
            // (other plans append here)
        ]
    };
}
```

- [ ] **Step 2: Update `main.rs`** — register `.invoke_handler(...)`:

In `tauri::Builder::default()` chain after `.plugin(...)` calls and before `.setup(...)`, add:

```rust
        .invoke_handler(timetrak_lib::timetrak_handlers!())
```

- [ ] **Step 3: Verify compiles**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/commands/mod.rs src-tauri/src/main.rs
git commit -m "feat: register timer commands in tauri handler"
```

---

## Task 4: Tray icon + popover window

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Update `main.rs` to install a tray icon and toggle a popover window**

Replace `src-tauri/src/main.rs` with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use timetrak_lib::db::Database;

const TRAY_WINDOW_LABEL: &str = "tray";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(timetrak_lib::timetrak_handlers!())
        .setup(|app| {
            // Database
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let db = Database::open(&data_dir.join("timetrak.sqlite"))
                .expect("open database");
            app.manage(db);

            // Tray menu
            let show_dashboard = MenuItem::with_id(app, "show_dashboard", "Show Dashboard", true, None::<&str>)?;
            let show_settings = MenuItem::with_id(app, "show_settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_dashboard, &show_settings, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_dashboard" => { let _ = open_window(app, "dashboard"); }
                    "show_settings" => { let _ = open_window(app, "settings"); }
                    "quit" => { app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        toggle_tray_window(app);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_tray_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        TRAY_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=tray".into()),
    )
    .inner_size(340.0, 440.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .build();
}

fn open_window(app: &tauri::AppHandle, name: &str) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(name) {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    let title = match name {
        "dashboard" => "TimeTrak — Dashboard",
        "settings" => "TimeTrak — Settings",
        _ => "TimeTrak",
    };
    WebviewWindowBuilder::new(
        app,
        name,
        WebviewUrl::App(format!("index.html?window={}", name).into()),
    )
    .title(title)
    .inner_size(900.0, 600.0)
    .build()?;
    Ok(())
}
```

- [ ] **Step 2: Verify build**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Smoke-test the tray manually**

Run: `npm run tauri dev`

Verify:
- A tray icon appears in the menu bar (macOS) / system tray (Windows).
- Left-clicking shows/hides a small empty popover at the default position.
- Right-clicking shows the context menu with Dashboard / Settings / Quit.

Ctrl-C to stop.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/main.rs
git commit -m "feat: tray icon, context menu, and popover toggle"
```

---

## Task 5: Tray popover UI

**Files:**
- Create: `src/windows/tray/TrayPopover.tsx`
- Create: `src/windows/tray/CategoryPicker.tsx`
- Create: `src/windows/tray/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 0: Invoke `ui-ux-pro-max` skill**

Invoke the skill with:

> Build a macOS/Windows tray popover for a personal time-tracking app.
> Size 340×440px, two states:
>  1. **Idle:** category dropdown (required), project dropdown
>     (optional, includes "— None —"), note input, and a primary
>     "Start" button at the bottom.
>  2. **Running:** label "Running" above the active category · project,
>     optional note below, a large monospace HH:MM:SS counter, and a
>     "Stop" button at the bottom.
> Style: minimalism + flat. Neutral grays for surface and text; single
> blue accent (`#2563eb`) for the Start button; red text-only for Stop.
> System font, 4px Tailwind grid. No shadows, no gradients. Generous
> whitespace; the popover should feel calm.
> Output: refined Tailwind class lists and structure for two
> components — `CategoryPicker` (idle pickers) and `TrayPopover` (the
> shell + running view). Don't change props, queries, mutations, or
> event listeners shown in the skeleton below.

Apply the skill's output to the components in the next steps.

- [ ] **Step 1: Create `src/windows/tray/CategoryPicker.tsx`**

```tsx
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
    <div className="space-y-2">
      <label className="block text-xs text-gray-500">Category</label>
      <select
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        value={categoryId ?? ''}
        onChange={(e) => onChange({ categoryId: e.target.value || null, projectId, note })}
      >
        <option value="" disabled>Select a category…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <label className="block text-xs text-gray-500">Project (optional)</label>
      <select
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        value={projectId ?? ''}
        onChange={(e) => onChange({ categoryId, projectId: e.target.value || null, note })}
      >
        <option value="">— None —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <label className="block text-xs text-gray-500">Note (optional)</label>
      <input
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        value={note}
        onChange={(e) => onChange({ categoryId, projectId, note: e.target.value })}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/windows/tray/TrayPopover.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { onTimerChanged } from '../../lib/events';
import { qk } from '../../lib/query';
import type { Id, TimeEntry } from '../../types';
import { CategoryPicker } from './CategoryPicker';

export function TrayPopover() {
  const qc = useQueryClient();
  const categories = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
  const timer = useQuery({ queryKey: qk.timerState, queryFn: api.getTimerState });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onTimerChanged(() => qc.invalidateQueries({ queryKey: qk.timerState })).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [qc]);

  const [categoryId, setCategoryId] = useState<Id | null>(null);
  const [projectId, setProjectId] = useState<Id | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (categoryId == null && categories.data && categories.data.length > 0) {
      setCategoryId(categories.data[0].id);
    }
  }, [categories.data, categoryId]);

  const startMut = useMutation({
    mutationFn: () => api.startTimer(categoryId!, projectId, note.trim() || null),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.timerState }),
  });
  const stopMut = useMutation({
    mutationFn: () => api.stopTimer(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.timerState }),
  });

  const running = timer.data?.running ?? null;

  return (
    <div className="flex h-full flex-col p-3 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        TimeTrak
      </div>
      {running ? (
        <RunningView entry={running} categories={categories.data ?? []} projects={projects.data ?? []} onStop={() => stopMut.mutate()} />
      ) : (
        <div className="space-y-3">
          <CategoryPicker
            categories={categories.data ?? []}
            projects={projects.data ?? []}
            categoryId={categoryId}
            projectId={projectId}
            note={note}
            onChange={(n) => { setCategoryId(n.categoryId); setProjectId(n.projectId); setNote(n.note); }}
          />
          <button
            className="w-full rounded bg-blue-600 px-3 py-2 text-white disabled:bg-gray-300"
            disabled={!categoryId || startMut.isPending}
            onClick={() => startMut.mutate()}
          >
            Start
          </button>
          {startMut.isError && (
            <div className="text-xs text-red-600">{String(startMut.error)}</div>
          )}
        </div>
      )}
    </div>
  );
}

function RunningView({
  entry, categories, projects, onStop,
}: { entry: TimeEntry; categories: any[]; projects: any[]; onStop: () => void }) {
  const cat = categories.find((c) => c.id === entry.category_id);
  const proj = projects.find((p) => p.id === entry.project_id);
  const [elapsed, setElapsed] = useState(elapsedSeconds(entry.started_at));
  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsedSeconds(entry.started_at)), 1000);
    return () => clearInterval(t);
  }, [entry.started_at]);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-gray-500">Running</div>
        <div className="text-base font-medium">
          {cat?.name ?? '?'}{proj ? ` · ${proj.name}` : ''}
        </div>
        {entry.note && <div className="text-xs text-gray-600">{entry.note}</div>}
        <div className="mt-1 font-mono text-2xl">{formatElapsed(elapsed)}</div>
      </div>
      <button
        className="w-full rounded bg-red-600 px-3 py-2 text-white"
        onClick={onStop}
      >
        Stop
      </button>
    </div>
  );
}

function elapsedSeconds(startedAtIso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000));
}
function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
```

- [ ] **Step 3: Create `src/windows/tray/index.ts`**

```ts
export { TrayPopover } from './TrayPopover';
```

- [ ] **Step 4: Update `src/App.tsx`** — route `window=tray` to popover

Replace with:

```tsx
import { TrayPopover } from './windows/tray';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('window') ?? 'tray';

  if (w === 'tray') return <TrayPopover />;
  // other plans append cases below
  return <div className="p-4 text-sm text-gray-500">Unknown window: {w}</div>;
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: passes.

- [ ] **Step 6: Smoke test**

Run: `npm run tauri dev`. Click the tray icon, pick a category, click Start, verify the running view appears with a ticking timer. Click Stop.

- [ ] **Step 7: Commit**

```sh
git add src/windows/tray src/App.tsx
git commit -m "feat: tray popover ui with start/stop and live elapsed timer"
```

---

## Task 6: Self-verify

- [ ] **Step 1: Run everything**

```sh
npx tsc -b
npm test
cd src-tauri && cargo test
```

Expected: all green.

- [ ] **Step 2: Tag**

```sh
git tag plan-02-complete
```

---

## Done

Tray icon, context menu, popover window with start/stop/switch all
functional. The dashboard and settings menu items open empty windows;
plans 03 and 04 fill those in.
