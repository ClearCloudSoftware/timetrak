# Google Calendar Integration — Plan Index

Spec: [`docs/superpowers/specs/2026-05-28-google-calendar-integration.md`](../specs/2026-05-28-google-calendar-integration.md).

The feature is decomposed into eight sequential phases. Each produces working,
testable software on its own. ICS lands before OAuth because it's the auth
fallback path and lets the polling/sync pipeline be exercised end-to-end
without the OAuth dance.

## Phases

| # | Plan | Depends on | What it produces |
|---|------|------------|------------------|
| 00 | [Foundation](./2026-05-28-google-calendar-00-foundation.md) | TimeTrak v0.2 main | Schema migration (source_* columns + 3 new tables), Rust domain types for `CalendarEvent` / `CalendarSource`, `keyring` crate wired into a keychain wrapper, Cargo deps, repo extensions to surface source fields. |
| 01 | ICS provider | 00 | `IcsProvider` implementing the `CalendarProvider` trait. Pasting an ICS URL into a (temporary) hidden setting fetches and prints events. End-to-end pipeline shape proven. |
| 02 | OAuth device-code | 00 | `OAuthProvider` implementing the same trait. Device-code connect flow, token storage, refresh. |
| 03 | Scheduler + auto-switch | 01 | 30-min polling task + per-event Tokio wake-ups + auto-switch behavior + Undo notification (30s). |
| 04 | Meeting-end Stop / Extend | 03 | Actionable Stop / Extend 15 min notification at scheduled event end; re-fire logic; precedence with auto-switch. |
| 05 | Conflict UI | 03 | `pending_calendar_import` write path on overlap detection + dashboard "Conflicts" panel + resolver actions. |
| 06 | Update propagation | 03 | Sync source changes onto entries; detach on local edit; delete cascade. |
| 07 | Settings UI | 02, 03, 06 | Settings "Calendar" pane: connect/disconnect, calendar checkboxes, Meeting category picker, Sync now, last-sync status. |

## Frozen contracts

Defined in phase 00; later phases must use these names verbatim.

### Rust types (`src-tauri/src/calendar/types.rs`)

```rust
pub struct CalendarEvent {
    pub source_event_id: String,   // Google event.id or ICS UID
    pub source_calendar_id: String,
    pub title: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub is_all_day: bool,
    pub rsvp_accepted: bool,       // True if user RSVP'd "yes" OR is organizer OR has no RSVP field (ICS without ATTENDEE block)
    pub updated_at: DateTime<Utc>,
}

pub struct DiscoveredCalendar {
    pub id: String,
    pub display_name: String,
}

#[async_trait::async_trait]
pub trait CalendarProvider: Send + Sync {
    async fn list_calendars(&self) -> AppResult<Vec<DiscoveredCalendar>>;
    async fn fetch_events(&self, calendar_id: &str, since: DateTime<Utc>, until: DateTime<Utc>) -> AppResult<Vec<CalendarEvent>>;
    fn kind(&self) -> &'static str; // "oauth" or "ics"
}
```

### Repo extensions (`src-tauri/src/repo/entries.rs`)

```rust
// Existing functions gain awareness of source columns through the
// updated NewEntry/EntryEdit types (see phase 00). New helpers:

pub fn find_by_source(conn: &Connection, source_event_id: &str, source_calendar_id: &str) -> AppResult<Option<TimeEntry>>;
pub fn mark_edited_locally(conn: &Connection, id: Uuid) -> AppResult<()>;
```

### Calendar-source repo (`src-tauri/src/repo/calendar_source.rs`)

```rust
pub fn get(conn: &Connection) -> AppResult<Option<CalendarSource>>;
pub fn set(conn: &Connection, src: &CalendarSource) -> AppResult<()>;
pub fn clear(conn: &Connection) -> AppResult<()>;
pub fn touch_last_sync(conn: &Connection, ok: bool, error: Option<&str>) -> AppResult<()>;
```

### Calendar list repo (`src-tauri/src/repo/calendars.rs`)

```rust
pub fn list(conn: &Connection) -> AppResult<Vec<CalendarRow>>;
pub fn upsert_many(conn: &Connection, items: &[DiscoveredCalendar]) -> AppResult<()>;
pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()>;
pub fn enabled_ids(conn: &Connection) -> AppResult<Vec<String>>;
```

### Pending conflicts repo (`src-tauri/src/repo/pending_imports.rs`)

```rust
pub fn list_pending(conn: &Connection) -> AppResult<Vec<PendingImport>>;
pub fn insert(conn: &Connection, p: &NewPendingImport) -> AppResult<PendingImport>;
pub fn resolve(conn: &Connection, id: Uuid, action: ResolutionAction) -> AppResult<()>;
```

### Tauri commands (defined across phases)

| TS API | Rust command | Phase |
|---|---|---|
| `calendarStatus()` | `calendar_status` | 00 |
| `calendarSyncNow()` | `calendar_sync_now` | 03 |
| `calendarListCalendars()` | `calendar_list_calendars` | 01 |
| `calendarToggleCalendar(id, enabled)` | `calendar_toggle_calendar` | 01 |
| `calendarSetIcs(urls)` | `calendar_set_ics` | 01 |
| `calendarConnectStart()` | `calendar_connect_start` | 02 |
| `calendarConnectComplete()` | `calendar_connect_complete` | 02 |
| `calendarDisconnect()` | `calendar_disconnect` | 02 |
| `pendingConflictsList()` | `pending_conflicts_list` | 05 |
| `pendingConflictResolve(id, action)` | `pending_conflict_resolve` | 05 |
| `setMeetingCategory(id)` | `set_meeting_category` | 00 |

### Events

| Event | Payload | Emitted by |
|---|---|---|
| `calendar-synced` | `{ ok: boolean; error: string | null; at: string }` | scheduler / sync_now |
| `calendar-conflicts-changed` | `{}` | sync, resolver |
| `calendar-auto-switched` | `{ entry: TimeEntry; previousEntryId: string | null }` | scheduler at switch |
| `calendar-meeting-ended` | `{ entryId: string }` | scheduler at scheduled end (used for the Stop/Extend prompt UI fallback) |

## Notes on phasing

- After phase 00 + 01 you have a working ICS-based importer (no auto-start yet — phase 03 adds that).
- After phase 03 the system can auto-switch and undo, but conflicts silently drop until phase 05.
- Phase 04 (Stop/Extend) and phase 05 (conflicts) can run in either order — both depend only on 03.
- Phase 07 (Settings UI) is the last thing to land so the UI is finished against complete backend functionality.

## Per-phase plans

Phase 00's plan is fully written. Subsequent phases will be written
just-in-time as they are picked up, so that contract drift between
phases gets folded into later plans rather than retroactively patched.
