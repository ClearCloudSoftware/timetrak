# TimeTrak — Plan Index & Parallel Execution Graph

This is the entry point for implementing TimeTrak. Read it before
dispatching agents.

## Plans

| # | Plan | Depends on | Touches | Parallel-safe with |
|---|------|------------|---------|--------------------|
| 00 | [Foundation](./2026-05-22-timetrak-00-foundation.md) | — | everything (scaffold) | nothing |
| 01 | [Data layer](./2026-05-22-timetrak-01-data-layer.md) | 00 | `src-tauri/src/repo/*`, `src-tauri/src/reporting.rs`, `src-tauri/src/csv_export.rs` | 02-window-shell |
| 02 | [Timer + tray popover](./2026-05-22-timetrak-02-timer-and-tray.md) | 01 | `src-tauri/src/timer.rs`, `src-tauri/src/commands/timer.rs`, tray code in `main.rs`, `src/windows/tray/*` | 03, 04 |
| 03 | [Dashboard window](./2026-05-22-timetrak-03-dashboard.md) | 01 | `src-tauri/src/commands/entries.rs`, `src-tauri/src/commands/export.rs`, `src/windows/dashboard/*` | 02, 04 |
| 04 | [Settings + autostart](./2026-05-22-timetrak-04-settings.md) | 01 | `src-tauri/src/commands/categories.rs`, `src-tauri/src/commands/projects.rs`, `src/windows/settings/*` | 02, 03, 05 |
| 05 | [Daily summary notification](./2026-05-22-timetrak-05-notifications.md) | 01 | `src-tauri/src/notifications.rs`, `main.rs` scheduler bootstrap | 02, 03, 04 |
| 06 | [Packaging + CI](./2026-05-22-timetrak-06-packaging.md) | 02, 03, 04, 05 | `.github/workflows/`, icons, signing config | (final) |

## Dependency graph

```
                          ┌──────────────┐
                          │ 00 Foundation │
                          └──────┬───────┘
                                 │
                          ┌──────▼───────┐
                          │ 01 Data layer│
                          └──┬───┬───┬───┘
                ┌────────────┘   │   └────────────┐
                ▼                ▼                ▼
        ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
        │ 02 Timer +   │ │ 03 Dashboard│ │ 04 Settings  │
        │    tray      │ │             │ │              │
        └──────┬───────┘ └──────┬──────┘ └──────┬───────┘
               │                │                │
               │         ┌──────▼──────┐         │
               │         │ 05 Notif.   │         │
               │         └──────┬──────┘         │
               └────────────┐   │   ┌────────────┘
                            ▼   ▼   ▼
                       ┌──────────────┐
                       │ 06 Packaging │
                       └──────────────┘
```

## Parallel dispatch strategy

1. Execute plan **00** to completion. Tag the result `foundation-complete`.
2. Execute plan **01** to completion. Tag `data-layer-complete`.
3. Dispatch plans **02**, **03**, **04** in parallel — each on its own
   branch (`feat/02-timer`, `feat/03-dashboard`, `feat/04-settings`).
   Merge in any order; they touch disjoint files except for the shared
   handler list in `commands/mod.rs` and `main.rs` — see "Shared edit
   surface" below.
4. Plan **05** can run in parallel with 02/03/04 (depends only on 01).
5. Plan **06** runs last.

## Shared edit surface (merge contention)

Three files are touched by multiple follow-up plans. They are kept tiny
so merges are trivial:

- `src-tauri/src/main.rs` — each plan adds one `.invoke_handler(...)` /
  setup line. Conflicts resolved by appending.
- `src-tauri/src/commands/mod.rs` — `timetrak_handlers!` macro list.
  Each plan adds its command function names. Conflicts resolved by
  appending.
- `src/App.tsx` — window router. Each plan adds one route case for its
  window. Conflicts resolved by appending.

Discipline: each plan's last task is an explicit "wire into router /
handler list" step. Reviewer should treat conflicts in these files as
expected and resolve by union.

## UI design constraints (apply to plans 02, 03, 04)

All UI work in this project MUST be built using the **`ui-ux-pro-max`**
skill. Before writing any component, the agent invokes the skill with
the constraints below and follows its output.

**Design direction (frozen):**

- **Style:** minimalism + flat design. Generous whitespace, restrained
  ornamentation, no skeuomorphism, no gradients on chrome.
- **Feel:** professional, calm, low-contrast surfaces with high-contrast
  text. Optimized for hours of daily use.
- **Color system:** neutral grays for surfaces and text; a single
  accent color (blue `#2563eb` / `bg-blue-600`) for primary actions and
  active states; category/project user-defined colors appear only as
  small dots, chart fills, and left borders — never as button or
  surface fills.
- **Typography:** system font stack (already set in `index.css`). One
  type scale: `text-xs` for labels, `text-sm` for body, `text-base` for
  emphasized counters, `text-lg` for window titles. No custom fonts.
- **Spacing:** Tailwind 4px grid. Default padding `p-3` for popover,
  `p-4` for windows. Gap `gap-2`/`gap-3`.
- **Borders + radii:** 1px gray-200 borders; `rounded` (4px) on
  controls; `rounded-md` (6px) on cards. No drop shadows except modal
  overlays (`shadow-lg`).
- **States:** clear focus rings (`focus-visible:ring-2 ring-blue-500`),
  disabled is `bg-gray-200 text-gray-400`, destructive is text-only
  red (`text-red-600 hover:underline`), not red surfaces.
- **Motion:** none beyond default browser focus/hover transitions.
- **Dark mode:** out of scope for v1 (but don't hard-code white
  backgrounds — use `bg-white` so a future `dark:` pass is trivial).

**Skill invocation pattern (every UI task in plans 02–04):**

The first step of any task that creates or modifies a `.tsx` file is:

> Invoke the `ui-ux-pro-max` skill with the design constraints from
> `INDEX.md` and the component's purpose. Use the skill's output as the
> visual guide; the code in this plan is a functional skeleton — match
> the structure, but apply the spacing, hierarchy, and component
> patterns the skill recommends.

The plan's TSX is the **contract** (props, state, queries, mutations,
event listeners). The skill's output is the **styling and layout**.
Don't change props or queries; do refine class lists, structure, and
micro-copy.

---

## Frozen contracts (do not change across plans)

These were defined in plan 00 and are referenced by every follow-up:

### Rust domain types (`src-tauri/src/domain.rs`)

`Category`, `Project`, `TimeEntry`, `NewEntry`, `EntryEdit`,
`Id = uuid::Uuid`.

### TypeScript domain types (`src/types.ts`)

Identical shape; `Id` is `string` (UUID v4); timestamps are ISO-8601
strings.

### `AppError` / `AppResult<T>` (`src-tauri/src/error.rs`)

All command handlers return `AppResult<T>`; `AppError` serializes to a
string at the Tauri boundary.

### Command signatures (must match `src/lib/api.ts`)

| TS function | Rust command (`#[tauri::command]`) | Owning plan |
|-------------|-------------------------------------|-------------|
| `listCategories()` | `list_categories() -> AppResult<Vec<Category>>` | 04 |
| `createCategory(name, color)` | `create_category(name: String, color: String) -> AppResult<Category>` | 04 |
| `updateCategory(id, name, color)` | `update_category(id: Uuid, name: String, color: String) -> AppResult<Category>` | 04 |
| `deleteCategory(id, cascadeEntries)` | `delete_category(id: Uuid, cascade_entries: bool) -> AppResult<()>` | 04 |
| `listProjects()` | `list_projects() -> AppResult<Vec<Project>>` | 04 |
| `createProject(name, color)` | `create_project(name: String, color: String) -> AppResult<Project>` | 04 |
| `updateProject(id, name, color)` | `update_project(id: Uuid, name: String, color: String) -> AppResult<Project>` | 04 |
| `deleteProject(id)` | `delete_project(id: Uuid) -> AppResult<()>` | 04 |
| `listEntries(startUtc, endUtc)` | `list_entries(start_utc: DateTime<Utc>, end_utc: DateTime<Utc>) -> AppResult<Vec<TimeEntry>>` | 03 |
| `createEntry(entry)` | `create_entry(entry: NewEntry) -> AppResult<TimeEntry>` | 03 |
| `updateEntry(id, edit)` | `update_entry(id: Uuid, edit: EntryEdit) -> AppResult<TimeEntry>` | 03 |
| `deleteEntry(id)` | `delete_entry(id: Uuid) -> AppResult<()>` | 03 |
| `getTimerState()` | `get_timer_state() -> AppResult<TimerState>` | 02 |
| `startTimer(categoryId, projectId, note)` | `start_timer(category_id: Uuid, project_id: Option<Uuid>, note: Option<String>) -> AppResult<TimeEntry>` | 02 |
| `stopTimer()` | `stop_timer() -> AppResult<Option<TimeEntry>>` | 02 |
| `switchTimer(categoryId, projectId, note)` | `switch_timer(category_id: Uuid, project_id: Option<Uuid>, note: Option<String>) -> AppResult<TimeEntry>` | 02 |
| `exportCsv(startUtc, endUtc)` | `export_csv(start_utc: DateTime<Utc>, end_utc: DateTime<Utc>) -> AppResult<String>` | 03 |
| `openWindow(name)` | `open_window(name: String) -> AppResult<()>` | v0.2 |

### Tauri events

| Event name | Payload (JSON) | Emitter |
|------------|----------------|---------|
| `timer-changed` | `{ "running": TimeEntry | null }` | plan 02 (after every start/stop/switch and on edit/delete that touches running entry) |
| `entries-changed` | `{}` | plans 03, 04 after any DB write |

### Repository public APIs (defined in plan 01)

Plan 01 defines free functions taking `&Connection`. Plans 02–05 call
them. The exact names below are frozen:

**`repo::categories`** (`src-tauri/src/repo/categories.rs`)
- `list(conn: &Connection) -> AppResult<Vec<Category>>`
- `find(conn: &Connection, id: Uuid) -> AppResult<Category>`
- `create(conn: &Connection, name: &str, color: &str) -> AppResult<Category>`
- `update(conn: &Connection, id: Uuid, name: &str, color: &str) -> AppResult<Category>`
- `delete(conn: &Connection, id: Uuid, cascade_entries: bool) -> AppResult<()>`

**`repo::projects`** (same shape as categories minus the cascade flag on delete)

**`repo::entries`** (`src-tauri/src/repo/entries.rs`)
- `list_in_range(conn: &Connection, start: DateTime<Utc>, end: DateTime<Utc>) -> AppResult<Vec<TimeEntry>>`
- `find(conn: &Connection, id: Uuid) -> AppResult<TimeEntry>`
- `running(conn: &Connection) -> AppResult<Option<TimeEntry>>`
- `create(conn: &Connection, new: &NewEntry) -> AppResult<TimeEntry>`
- `update(conn: &Connection, id: Uuid, edit: &EntryEdit) -> AppResult<TimeEntry>`
- `delete(conn: &Connection, id: Uuid) -> AppResult<()>`
- `stop_running_now(conn: &Connection, now: DateTime<Utc>) -> AppResult<Option<TimeEntry>>` — used by the timer service to perform stop-and-start atomically.

**`reporting`** (`src-tauri/src/reporting.rs`)
- `pub struct DayTotal { date: NaiveDate, category_id: Uuid, project_id: Option<Uuid>, seconds: i64 }`
- `pub fn day_totals(conn: &Connection, start: DateTime<Utc>, end: DateTime<Utc>, local_tz: Tz) -> AppResult<Vec<DayTotal>>`
- `pub fn today_totals(conn: &Connection, local_tz: Tz) -> AppResult<Vec<(Category, i64)>>`

**`csv_export`** (`src-tauri/src/csv_export.rs`)
- `pub fn entries_to_csv(entries: &[TimeEntry], categories: &[Category], projects: &[Project], local_tz: Tz) -> String`

If any plan needs to change one of these signatures, it MUST update
this INDEX in the same commit so other agents see the change.
