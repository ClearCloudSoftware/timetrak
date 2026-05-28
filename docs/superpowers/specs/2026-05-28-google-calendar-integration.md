# Google Calendar Integration — Design

**Date:** 2026-05-28
**Status:** Approved for planning
**Scope:** Add calendar-driven auto-tracking and past-event backfill to TimeTrak.

## Summary

TimeTrak gains a calendar source (Google Calendar). Two user-facing behaviors:

1. **Auto-start at meeting begin.** When a tracked calendar event reaches its start time, TimeTrak stops any running timer and starts one for the meeting. At the scheduled end, it asks the user to Stop or Extend by 15 minutes.
2. **Past-event backfill.** TimeTrak periodically imports past calendar events as already-stopped time entries.

The integration is read-only. No data flows from TimeTrak back to the user's calendar.

## Decisions (from the grilling session)

### Use cases (selected)

- Auto-start timer when meeting begins.
- Periodic background import of past events.

(Explicitly not in scope: showing today's events in the tray as picklist; writing entries back to Google Calendar.)

### Event filter

A calendar event is *trackable* if **all** of:

- Source calendar is enabled by the user.
- The user's RSVP on the event is **accepted**.
- The event is **not** all-day.

(Solo events — i.e. only the user is an attendee — are trackable. Focus blocks count.)

### Auto-start interruption behavior

When a trackable event reaches its start time and a timer is running:

- Silently stop the running timer.
- Start a new timer for the meeting.
- Post a system notification: **"Started: <title> — Undo?"** with a 30-second undo window.

If no timer is running, just start the meeting timer (no notification needed beyond the standard tray indicator).

### Meeting end behavior

At the event's scheduled end:

- Post an actionable notification with two buttons: **Stop** and **Extend 15 min**.
- **Stop** → close the running timer at the scheduled end (entry's `ended_at = event end`).
- **Extend 15 min** → keep the timer running; re-fire the same prompt 15 minutes later.
- **No response** → implicit Extend. Re-fire every 15 minutes until the user answers or the next auto-switch displaces the timer.

A subsequent auto-switch (next meeting starts) always takes precedence over the still-pending Stop/Extend prompt.

### Event → time entry mapping (v1)

For every imported or auto-started meeting:

- `category_id` = user-designated "Meeting" category (see Settings below).
- `project_id` = `NULL`.
- `note` = event title.
- New fields: `source_event_id`, `source_calendar_id`, `source_edited_locally`.

### Conflict handling

When an imported (or scheduled-to-import) event overlaps an existing time entry that isn't itself source-linked to the same event:

- Do **not** auto-create the time entry.
- Append a row to the `pending_calendar_import` table with the event's details and a `status = pending_conflict`.
- The dashboard surfaces a "Conflicts" panel showing each pending import with three actions: **Keep mine**, **Use calendar** (truncates / replaces overlapping manual entries), **Edit both** (opens a side-by-side editor sheet — out of scope for v1; in v1 "Edit both" routes to the existing entry editor pre-filled).
- A small badge next to the dashboard's view toggle shows the conflict count.

### Backfill

- **Initial backfill on connect:** import the last **14 days** (configurable later).
- **Ongoing:** rides the same 30-minute polling cycle.

### Polling architecture

- Every **30 minutes**, fetch upcoming events for the next ~2 hours and any new past events since the last successful fetch.
- For each known upcoming event, schedule a precise in-process Tokio timer at its start time to perform the auto-switch. No naive 30-min latency for known events.
- A manual **"Sync now"** button in Settings forces an immediate fetch.
- A meeting added to the calendar < 30 minutes before its start may be detected up to 30 minutes late. The user can hit "Sync now" if they know about a freshly-added meeting.

### Authentication

**Primary path: bundled OAuth client + device-code flow.**

- TimeTrak ships a Google OAuth client of type "TVs and Limited Input Devices".
- Scope: `https://www.googleapis.com/auth/calendar.readonly`.
- Connect UX: Settings → "Connect Google Calendar" → TimeTrak shows a code → user opens `google.com/device` in any browser, pastes the code, approves → TimeTrak polls Google's token endpoint, stores the resulting refresh token in the OS keychain.
- A fallback to loopback OAuth is acceptable if Google has further restricted device-flow scope coverage at implementation time — verify Calendar.readonly scope support against current Google docs before choosing.

**Fallback path: private ICS feed URL.**

If the bundled OAuth client is blocked by the user's Workspace admin policy, TimeTrak offers an ICS-feed mode. The user pastes one or more "private ICS URL" links from Google Calendar settings into TimeTrak's Settings. TimeTrak fetches them over HTTPS on the same 30-min cadence. Same filter rules; same downstream behavior. ICS feeds can be cached up to several hours by Google, so the ICS path has more event-staleness risk than the OAuth path.

Both paths produce the same downstream `CalendarEvent` value type; the rest of the system is auth-agnostic.

**Account scope (v1):** single Google account. Disconnect before connecting another.

### Update propagation

When a previously-imported event is updated in the calendar:

- If the corresponding time entry has `source_edited_locally = false`, **sync the change to the entry** (start, end, title, even deletion).
- If `source_edited_locally = true`, the entry is detached: no further updates, no deletion. The original calendar event ID stays recorded but no longer drives behavior.

A time entry becomes `source_edited_locally = true` the first time the user edits any field via the existing entry editor.

### Settings (new)

A new "Calendar" section in the Settings sidebar:

- **Connection status** (Connected as user@example.com / Not connected / Using ICS).
- **Connect / Disconnect** buttons.
- **Enabled calendars list** (checkboxes — populated after connect).
- **Meeting category** picker (required; defaults to a category named "Meeting" if present).
- **Initial backfill days** (default 14).
- **Sync now** button.
- **Last sync** timestamp + last error if any.

## Schema additions

### `time_entry` (alter)

| Column | Type | Notes |
|---|---|---|
| `source` | TEXT | `'manual'` (default) or `'calendar'`. |
| `source_event_id` | TEXT | Google event ID or ICS UID. NULL for manual. |
| `source_calendar_id` | TEXT | NULL for manual. |
| `source_edited_locally` | INTEGER (bool) | Defaults 0. Set 1 by entry-edit code path. |

Index: `(source_event_id)` for dedup lookups.

### `calendar_source` (new)

Single-row-or-empty table describing the active connection.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) | PK. |
| `kind` | TEXT | `'oauth'` or `'ics'`. |
| `account_email` | TEXT | For display; `NULL` for ICS. |
| `keychain_ref` | TEXT | Identifier for the OS-keychain entry containing the token or ICS URL. Never the raw secret. |
| `connected_at` | TEXT (ISO) | |
| `last_sync_at` | TEXT (ISO) | NULL until first sync. |
| `last_sync_error` | TEXT | Free-form. |

### `calendar` (new)

One row per discovered calendar.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | Google calendar ID or hash of ICS URL. |
| `display_name` | TEXT | |
| `enabled` | INTEGER (bool) | Defaults 0. User toggles. |

### `pending_calendar_import` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT (UUID) | PK. |
| `source_event_id` | TEXT | |
| `source_calendar_id` | TEXT | |
| `started_at` | TEXT (ISO UTC) | |
| `ended_at` | TEXT (ISO UTC) | |
| `title` | TEXT | |
| `status` | TEXT | `'pending_conflict'` for v1. (Reserved values: `'pending_approval'`.) |
| `detected_at` | TEXT (ISO) | |
| `resolved_action` | TEXT | Set on resolution: `'kept_mine'`, `'used_calendar'`, `'edited'`. |
| `resolved_at` | TEXT (ISO) | |

### `app_meta`

Add keys: `meeting_category_id`, `initial_backfill_days`.

## Components

### Rust core

- `calendar/mod.rs` — entry point + scheduler.
- `calendar/source.rs` — `CalendarSource` enum + provider trait (`fetch_events`, `disconnect`).
- `calendar/oauth_device.rs` — Google device-code flow implementation, token refresh.
- `calendar/ics.rs` — ICS URL fetching + parsing (use `ical` crate).
- `calendar/scheduler.rs` — owns the 30-min poll + per-event Tokio timers + Stop/Extend re-fire timer.
- `calendar/sync.rs` — applies fetched events: filter → conflict-check → create/update/delete entries → mark conflicts.
- `keychain.rs` — wraps the `keyring` crate.
- `commands/calendar.rs` — Tauri commands: `calendar_connect_start`, `calendar_connect_complete`, `calendar_disconnect`, `calendar_list_calendars`, `calendar_toggle_calendar`, `calendar_sync_now`, `calendar_status`, `pending_conflicts_list`, `pending_conflict_resolve`.
- Existing `repo::entries` extended with `source_*` fields and `set_edited_locally(id)`.

### React UI

- New `windows/settings/CalendarPane.tsx` slotted into the existing sidebar.
- New `windows/dashboard/ConflictsPanel.tsx` shown above the views when `pending_calendar_import` is non-empty.
- Existing `EntryEditorSheet` updated: on any save, if the entry has `source_event_id`, set `source_edited_locally = true`.

### Notifications

Use `tauri-plugin-notification` actionable notifications:

- "Started: <title> — Undo?" with action `Undo` (30s window; clicking after expiry is a no-op).
- "<title> ended — Stop / Extend 15 min" with two actions.

If actionable notifications are unreliable on a target platform, the fallback is: clicking the notification body opens the tray window with an inline banner exposing the same actions.

## Privacy and security

- OAuth refresh tokens and ICS URLs live in the OS keychain via the `keyring` crate. Never persisted in plaintext to disk.
- Event data is cached in SQLite only as needed for matching (event id + start/end/title for entries created). No attendee lists, no descriptions, no email addresses stored beyond `account_email` for the connection display.
- Disconnect revokes the local token (best-effort POST to Google's revoke endpoint) and clears the keychain entry, the `calendar_source`, `calendar`, and `pending_calendar_import` tables. Existing time entries with `source = 'calendar'` are **kept** but their `source_*` linkage is cleared.

## Edge cases & decisions

- **Meeting category missing:** Settings shows a warning + picker if the configured `meeting_category_id` no longer exists. Auto-sync is paused until resolved.
- **Connect mid-day with running timer:** initial backfill respects the conflict rule — anything overlapping the running timer becomes a pending conflict.
- **Late detection (meeting started > N minutes ago at sync time):** if the meeting hasn't ended yet, treat it as in-progress and auto-switch (with the same undo notification). If it has already ended, treat as backfill (no auto-start).
- **Recurring events:** Google API gives expanded instances when `singleEvents=true`. ICS expansion handled by the parser library; if a recurrence's instance is exception-modified, the modified instance wins.
- **Time zones:** events have explicit timezones in both Google API and ICS; we convert all to UTC for storage. The existing entry repo and reporting already assume UTC storage.
- **Multi-instance ambiguity (same event title at same time on two calendars):** dedup key is `(source_calendar_id, source_event_id)`, not title — so identical-looking events on different calendars create separate entries. Unusual case; v1 accepts it.

## Out of scope for v1

- Writing entries back to Google Calendar.
- Multiple Google accounts.
- Showing today's events in the tray as a quick-start picklist.
- Per-event title-regex rules for category/project mapping.
- Apple Calendar (EventKit) / Outlook integration.
- Webhook / push notifications (real-time updates).
- A side-by-side conflict resolver editor (the v1 "Edit both" routes to the existing single-entry editor).
