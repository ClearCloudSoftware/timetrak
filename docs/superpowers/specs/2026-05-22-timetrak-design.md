# TimeTrak — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Platform:** macOS (menu bar app)

## Summary

TimeTrak is a personal macOS menu bar application for tracking time spent on
categorized activities (meetings, coding, email, etc.) with optional project
tagging. The user starts and stops timers manually from a menu bar popover.
A dashboard window provides reports, charts, and CSV export. The app stores
data locally in SQLite and runs as a background-only app (no Dock icon).

## Goals

- Frictionless manual start/stop from the menu bar.
- Two-level classification: required **category** + optional **project**.
- Local-first storage with full edit/delete control over entries.
- Reporting dashboard with charts and CSV export.
- Launch at login and a daily end-of-day summary notification.

## Non-goals (v1)

- Automatic activity detection (window/calendar/Zoom).
- Cloud sync, multi-device, multi-user.
- Billing/invoice generation (CSV is the export surface).
- Global hotkeys.
- Tags beyond category + project.
- UI snapshot testing.

## Tech stack

- **Language/UI:** Swift, SwiftUI, `MenuBarExtra`.
- **Persistence:** SQLite via [GRDB](https://github.com/groue/GRDB.swift).
- **Charts:** Apple Swift Charts.
- **Login item:** `SMAppService.mainApp`.
- **Notifications:** `UNUserNotificationCenter`.
- App is `LSUIElement = true` (no Dock icon, no main menu bar).

## Architecture

A single SwiftUI app process with three UI surfaces backed by a shared data
layer:

- **Menu bar popover** — primary control: current state, start/stop/switch,
  today's totals. Always one click away.
- **Dashboard window** — opened from the popover. Day/week/month views with
  charts, filtering, entry editing, CSV export.
- **Settings window** — manage categories, projects, launch-at-login,
  daily-summary time.

A single `TimerStore` (`@Observable`) is the source of truth for "what is
running right now" and is injected into all views.

### Component map

Data layer (no SwiftUI imports):

- **`Database`** — owns the GRDB `DatabasePool`, runs migrations, vends
  repositories.
- **`CategoryRepository`** — CRUD for categories.
- **`ProjectRepository`** — CRUD for projects.
- **`TimeEntryRepository`** — CRUD plus `runningEntry()`,
  `entriesInRange(start:end:)`, overlap checks.
- **`ReportingService`** — pure aggregation: turns entries into per-day,
  per-category, per-project totals over a date range.
- **`CSVExporter`** — pure function `[TimeEntry] -> String`, RFC 4180
  quoting.

Service layer:

- **`TimerStore`** (`@Observable`) — `start(category:project:note:)`,
  `stop()`, `switchTo(...)`. Wraps repo calls in a single transaction so
  switches never lose or double-count time.
- **`NotificationScheduler`** — schedules and posts the daily summary
  using `ReportingService` totals.
- **`LoginItemController`** — wraps `SMAppService` for launch-at-login.

UI layer (depends only on the service layer + repos via environment):

- `MenuBarContent` — popover view.
- `DashboardWindow`, `EntryEditorSheet`.
- `SettingsWindow`.

**Boundary rule:** Views never touch GRDB directly. They go through
`TimerStore` or a repository injected via SwiftUI environment.

## Data model

Stored in SQLite. All timestamps UTC; UI renders in local timezone; reports
bucket by **local** day boundaries.

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

Single-row key/value table for schema version, `last_summary_date`,
`last_used_category_id`, `last_used_project_id`, daily-summary time.

### Invariants

- A running entry has `ended_at IS NULL`. Starting a new timer first stops
  the previous one (`ended_at = now`) in the **same transaction**.
- Editing an entry validates `ended_at > started_at` and that the new
  range does not overlap any other entry.
- Hard delete is supported for entries, categories, and projects:
  - Deleting an **entry**: row removed.
  - Deleting a **project**: `project_id` set to `NULL` on referencing
    entries (history preserved).
  - Deleting a **category**: blocked if any entry references it; UI
    surfaces a confirm dialog that offers to delete those entries too
    (cascading hard delete in a single transaction).

## Key user flows

### Start a timer

1. Click menu bar icon → popover opens.
2. Popover shows category picker (defaults to `last_used_category_id`)
   and optional project picker.
3. Click **Start** → `TimerStore.start(category:project:note:)`.
4. In one transaction: any running entry is stopped (`ended_at = now`),
   a new entry is inserted with `started_at = now`.
5. Popover re-renders to "Running: Coding · ProjectX · 00:12" with a
   **Stop** and **Switch to…** button. Menu bar icon shows a colored
   dot matching the active category.

### Switch tasks

"Switch to…" in the popover opens the same pickers, then performs
stop-and-start in a single transaction. No window of "untracked" time.

### Edit a past entry

Dashboard row → click → `EntryEditorSheet` with start, end, category,
project, note. Save validates:

- `end > start`.
- New range does not overlap any other non-deleted entry.

On conflict, inline error; sheet stays open.

### CSV export

Dashboard toolbar → **Export…** → date range picker → macOS save panel.
Output columns (UTF-8, header row, RFC 4180 quoting):

```
started_at,ended_at,duration_minutes,category,project,note
```

`started_at` / `ended_at` written as local ISO-8601 with offset
(e.g. `2026-05-22T09:13:00-04:00`).

### Daily summary notification

- Default schedule: 18:00 local time.
- At fire time, `NotificationScheduler` asks `ReportingService` for
  today's totals (local-day bucket) and posts a notification:
  "Today: Coding 4h12m · Meetings 1h30m · Email 25m".
- `app_meta.last_summary_date` prevents duplicates across relaunches.
- If notification permission is denied, the toggle in Settings is
  disabled with a "Open System Settings" link.

### Launch at login

Settings toggle → `LoginItemController.setEnabled(_:)` via
`SMAppService.mainApp.register()` / `.unregister()`.

## Error handling

- **DB write errors** surface as a non-blocking banner in the popover
  ("Couldn't save — retry"); the failed write is retried once
  automatically.
- **Migration failure on startup** shows a blocking alert with the DB
  file path and **Quit** / **Reveal in Finder** actions. Never silently
  wipe data.
- **Notification permission denied** disables the daily summary toggle
  with a deep link to System Settings.
- **CSV export** quotes any field containing `,`, `"`, or `\n` per
  RFC 4180.
- **Clock / DST changes** are handled by storing UTC and computing
  duration as `ended_at - started_at` from stored timestamps; report
  bucketing converts to local day on read.

## Testing

- **Unit tests** (XCTest):
  - Repositories against an in-memory GRDB pool.
  - `ReportingService` aggregation with fixtures crossing day
    boundaries and DST transitions.
  - `CSVExporter` golden-file tests including quoting edge cases.
  - `TimerStore` state transitions (start, stop, switch, no-op stop
    when nothing running).
- **Integration tests** against a temp-file DB: full
  start → switch → stop → edit → export pipeline.
- **Manual smoke checklist** committed to the repo: menu bar
  interactions, launch-at-login round-trip, notification firing,
  dashboard render with empty / one-day / multi-month datasets.

## Open items deferred to planning

- Exact popover layout and category/project picker affordance.
- Dashboard chart selection (bar vs. stacked vs. pie) per view.
- Icon set / colors.
- Distribution: ad-hoc signed build vs. notarized DMG.
