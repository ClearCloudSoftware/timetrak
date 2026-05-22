# TimeTrak — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Platforms:** macOS and Windows (tray / menu bar app)

## Summary

TimeTrak is a personal cross-platform tray application for tracking time
spent on categorized activities (meetings, coding, email, etc.) with
optional project tagging. The user starts and stops timers manually from
the tray popover. A dashboard window provides reports, charts, and CSV
export. The app stores data locally in SQLite and runs as a
background-only app (no Dock icon on macOS, hidden from the taskbar on
Windows).

## Goals

- Frictionless manual start/stop from the tray.
- Two-level classification: required **category** + optional **project**.
- Local-first storage with full edit/delete control over entries.
- Reporting dashboard with charts and CSV export.
- Launch at login and a daily end-of-day summary notification.
- Single codebase, native-feeling tray on both macOS and Windows.

## Non-goals (v1)

- Automatic activity detection (window/calendar/Zoom).
- Cloud sync, multi-device, multi-user.
- Billing/invoice generation (CSV is the export surface).
- Global hotkeys.
- Tags beyond category + project.
- Mobile or Linux builds.
- UI snapshot testing.

## Tech stack

- **Shell:** Tauri 2 (Rust core + system webview).
- **UI:** React + TypeScript + Vite.
- **Styling:** Tailwind CSS.
- **Charts:** Recharts.
- **Persistence:** SQLite via `rusqlite` (bundled) in the Rust core,
  exposed to the UI through Tauri commands.
- **Tray:** Tauri 2 built-in tray API.
- **Autostart:** `tauri-plugin-autostart`.
- **Notifications:** `tauri-plugin-notification`.
- **OS visibility:**
  - macOS: `LSUIElement = true` in `Info.plist` (no Dock icon).
  - Windows: all windows created with `skip_taskbar: true`; no main
    window is shown at launch.

### Local dev dependencies (macOS)

- Xcode Command Line Tools.
- Rust toolchain (via rustup).
- Node.js (LTS) + npm.

### Distribution

- macOS: notarized `.dmg` (built locally or on a macOS CI runner).
- Windows: `.msi` (built on a Windows CI runner via GitHub Actions).

## Architecture

A single Tauri app with a Rust core that owns persistence and OS
integration, and a React UI rendered across three webview windows. The
Rust core is the source of truth for data; the UI calls into it via
Tauri commands and listens for events.

### UI surfaces

- **Tray popover** — primary control. A small, borderless, always-on-top
  window shown/hidden when the tray icon is clicked, positioned near
  the tray icon. Shows current state, start/stop/switch controls,
  today's totals.
- **Dashboard window** — opened from the popover. Standard window with
  day/week/month views, charts, filtering, entry editing, CSV export.
- **Settings window** — manage categories, projects, launch-at-login
  toggle, daily-summary time.

All three are separate Tauri windows created lazily on first open.
None of them are created at app launch; only the tray icon is.

### Rust core modules (`src-tauri/src/`)

- **`db`** — owns the `rusqlite::Connection` (behind a `Mutex`), runs
  migrations on startup, vends repository types.
- **`repo::categories`**, **`repo::projects`**, **`repo::entries`** —
  CRUD plus queries (`running_entry()`, `entries_in_range`, overlap
  checks). Pure data layer; no Tauri imports.
- **`reporting`** — pure aggregation: turns entries into per-day,
  per-category, per-project totals over a date range.
- **`csv_export`** — pure function `&[TimeEntry] -> String`, RFC 4180
  quoting.
- **`timer`** — state machine for "what is running right now". Holds
  the current running entry id in memory and broadcasts changes via
  a Tauri event (`timer-changed`) so any open window can react.
- **`commands`** — thin Tauri command handlers that delegate to the
  modules above. This is the only layer the UI sees.
- **`notifications`** — schedules the daily summary using
  `tauri-plugin-notification` and an async tokio task.
- **`autostart`** — wraps `tauri-plugin-autostart`.

### React UI modules (`src/`)

- `lib/api.ts` — typed wrappers around `invoke<T>(...)` for every
  command; the **only** place that touches Tauri.
- `lib/events.ts` — typed wrappers around `listen(...)` for events
  (`timer-changed`, `entries-changed`).
- `state/` — React Query for server-state caching of repo reads;
  `timer-changed` event invalidates the relevant queries.
- `windows/tray/` — popover view.
- `windows/dashboard/` — dashboard window + `EntryEditorSheet`.
- `windows/settings/` — settings window.
- `components/` — shared UI primitives.

**Boundary rule:** UI code calls `lib/api.ts` and nothing else from
Tauri. The Rust core never reaches up into the UI; it communicates by
returning values from commands and by emitting events.

## Data model

Stored in SQLite. All timestamps UTC ISO-8601; UI renders in local
timezone; reports bucket by **local** day boundaries.

### `category`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | PK |
| `name` | TEXT | unique, non-empty |
| `color` | TEXT | hex `#RRGGBB` |

Seeded on first run: Meeting, Coding, Email, Break. User-editable.

### `project`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | PK |
| `name` | TEXT | unique, non-empty |
| `color` | TEXT | hex `#RRGGBB` |

### `time_entry`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | PK |
| `category_id` | TEXT | FK → `category.id`, **NOT NULL**, `ON DELETE RESTRICT` |
| `project_id` | TEXT | FK → `project.id`, nullable, `ON DELETE SET NULL` |
| `started_at` | TEXT (ISO-8601 UTC) | NOT NULL |
| `ended_at` | TEXT (ISO-8601 UTC) | nullable; NULL means "running" |
| `note` | TEXT | nullable |

Indexes:

- Unique partial index on `(ended_at IS NULL)` enforcing **at most one
  running entry** at any time.
- Index on `started_at` for range queries.

### `app_meta`

Single-row key/value table for: schema version, `last_summary_date`,
`last_used_category_id`, `last_used_project_id`, daily-summary time.

### Database location

Stored in the OS app-data directory via
`tauri::api::path::app_data_dir()`:

- macOS: `~/Library/Application Support/com.timetrak.app/timetrak.sqlite`
- Windows: `%APPDATA%\com.timetrak.app\timetrak.sqlite`

### Invariants

- A running entry has `ended_at IS NULL`. Starting a new timer first
  stops the previous one (`ended_at = now`) in the **same SQL
  transaction**.
- Editing an entry validates `ended_at > started_at` and that the new
  range does not overlap any other entry.
- Hard delete is supported for entries, categories, and projects:
  - Deleting an **entry**: row removed.
  - Deleting a **project**: `project_id` set to `NULL` on referencing
    entries (history preserved).
  - Deleting a **category**: blocked if any entry references it; UI
    surfaces a confirm dialog offering to delete those entries too
    (cascading hard delete in a single transaction).

## Key user flows

### Start a timer

1. Click tray icon → popover window shows or toggles visible.
2. Popover shows category picker (defaults to `last_used_category_id`)
   and optional project picker.
3. Click **Start** → `invoke('start_timer', { categoryId, projectId,
   note })`.
4. Rust core, in one transaction: stops any running entry
   (`ended_at = now`), inserts a new entry with `started_at = now`,
   emits `timer-changed`.
5. Popover re-renders to "Running: Coding · ProjectX · 00:12" with
   **Stop** and **Switch to…** buttons. Tray icon updates to a variant
   tinted with the active category color.

### Switch tasks

"Switch to…" in the popover opens the same pickers, then calls
`invoke('switch_timer', ...)` which performs stop-and-start in a single
transaction. No window of "untracked" time.

### Edit a past entry

Dashboard row → click → `EntryEditorSheet` with start, end, category,
project, note. Save validates:

- `end > start`.
- New range does not overlap any other entry.

On conflict, inline error; sheet stays open.

### CSV export

Dashboard toolbar → **Export…** → date range picker → native save
dialog via `@tauri-apps/plugin-dialog`. Output columns (UTF-8, header
row, RFC 4180 quoting):

```
started_at,ended_at,duration_minutes,category,project,note
```

`started_at` / `ended_at` written as local ISO-8601 with offset
(e.g. `2026-05-22T09:13:00-04:00`).

### Daily summary notification

- Default schedule: 18:00 local time.
- A tokio task in the Rust core sleeps until the configured time,
  then calls `reporting::today_totals()` and posts a notification:
  "Today: Coding 4h12m · Meetings 1h30m · Email 25m".
- `app_meta.last_summary_date` prevents duplicates across relaunches.
- If notification permission is denied (macOS / Windows toast),
  Settings disables the toggle with a link to OS notification
  settings.

### Launch at login

Settings toggle → `tauri-plugin-autostart` enable/disable. The plugin
handles the platform difference (LaunchAgent on macOS,
HKCU\Software\Microsoft\Windows\CurrentVersion\Run on Windows).

## Tray behavior

- Single tray icon visible on both platforms.
- macOS: template icon (monochrome PNG with `@2x`); when a timer is
  running, the icon switches to a non-template colored variant.
- Windows: `.ico` with sizes 16/32/48; running state uses a different
  `.ico`.
- Left click toggles the popover window visible/hidden.
- Right click opens a context menu: Show Dashboard, Settings, Quit.
- Popover window is borderless, `decorations: false`,
  `always_on_top: true`, `skip_taskbar: true`, sized ~320×420.
  Position is computed from tray icon location on click.

## Error handling

- **DB write errors** are returned from the Tauri command as an
  `Err(String)`; the UI shows a non-blocking toast ("Couldn't save —
  retry"). The failed write is retried once automatically.
- **Migration failure on startup** shows a blocking native dialog with
  the DB file path and **Quit** / **Reveal in Finder/Explorer**
  actions. Never silently wipe data.
- **Notification permission denied** disables the daily summary toggle
  with a deep link to OS settings.
- **CSV export** quotes any field containing `,`, `"`, or `\n` per
  RFC 4180.
- **Clock / DST changes** are handled by storing UTC and computing
  duration as `ended_at - started_at` from stored timestamps; report
  bucketing converts to local day on read.

## Testing

- **Rust unit tests** (`cargo test`):
  - Repositories against an in-memory `rusqlite` connection.
  - `reporting` aggregation with fixtures crossing day boundaries
    and DST transitions.
  - `csv_export` golden-file tests including quoting edge cases.
  - `timer` state transitions (start, stop, switch, no-op stop when
    nothing running).
- **Rust integration tests** against a temp-file DB: full
  start → switch → stop → edit → export pipeline through the public
  command surface.
- **UI unit tests** (Vitest): `lib/api.ts` wrapper shapes,
  reducers/selectors, pure formatting helpers. UI components rendered
  with React Testing Library against mocked `invoke`.
- **Manual smoke checklist** committed to the repo, run on both
  macOS and Windows: tray interactions, launch-at-login round-trip,
  notification firing, dashboard render with empty / one-day /
  multi-month datasets.

## Open items deferred to planning

- Exact popover layout and category/project picker affordance.
- Dashboard chart selection (bar vs. stacked vs. pie) per view.
- Icon set / colors and the running-state icon variants.
- Tray-popover positioning details on multi-monitor Windows setups.
- CI pipeline shape for cross-platform builds (matrix on macOS +
  Windows runners).
- Code signing approach for Windows (self-signed vs. EV cert) and
  notarization for macOS.
