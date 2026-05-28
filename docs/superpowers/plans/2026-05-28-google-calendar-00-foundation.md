# Google Calendar — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or superpowers:subagent-driven-development.

**Goal:** Land the schema migration, domain types, repository extensions, and keychain wrapper that all subsequent calendar phases build on. No user-visible behavior changes.

**Depends on:** TimeTrak v0.2 (current `dev`).

**Architecture:** A real migrations runner replaces the previous "idempotent CREATE on every open" pattern, because we now need ALTER TABLE. New domain types and provider trait sit in `src-tauri/src/calendar/`. Repo extensions surface `source_*` columns through the existing `TimeEntry`/`NewEntry`/`EntryEdit` types.

**Tech Stack additions:** `keyring = "3"`, `async-trait = "0.1"`, `ical = "0.11"`, `tokio` already present.

---

## Task 1: Cargo dependencies

**Files:** `src-tauri/Cargo.toml`

- [ ] **Step 1: Add deps**

In `[dependencies]`, append:

```toml
async-trait = "0.1"
keyring = "3"
ical = "0.11"
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: builds.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: deps for calendar integration (keyring, ical, async-trait)"
```

---

## Task 2: Migrations runner

**Files:**
- Create: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/migrations/v2_calendar.sql`

- [ ] **Step 1: Create `src-tauri/src/db/migrations/v2_calendar.sql`**

```sql
-- Schema v2: calendar integration.

-- time_entry source columns
ALTER TABLE time_entry ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE time_entry ADD COLUMN source_event_id TEXT;
ALTER TABLE time_entry ADD COLUMN source_calendar_id TEXT;
ALTER TABLE time_entry ADD COLUMN source_edited_locally INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_time_entry_source_event
  ON time_entry (source_calendar_id, source_event_id);

-- Calendar source (single-row): the active connection.
CREATE TABLE IF NOT EXISTS calendar_source (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,            -- 'oauth' | 'ics'
  account_email   TEXT,
  keychain_ref    TEXT NOT NULL,
  connected_at    TEXT NOT NULL,
  last_sync_at    TEXT,
  last_sync_error TEXT
);

-- Discovered calendars (one row per calendar discovered from the source).
CREATE TABLE IF NOT EXISTS calendar (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0
);

-- Pending imports flagged due to overlap with a manual entry.
CREATE TABLE IF NOT EXISTS pending_calendar_import (
  id                  TEXT PRIMARY KEY,
  source_event_id     TEXT NOT NULL,
  source_calendar_id  TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  ended_at            TEXT NOT NULL,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL,        -- 'pending_conflict' | 'resolved'
  detected_at         TEXT NOT NULL,
  resolved_action     TEXT,                 -- 'kept_mine' | 'used_calendar' | 'edited'
  resolved_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_status
  ON pending_calendar_import (status);

-- Meta keys for calendar integration.
INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('initial_backfill_days', '14');

-- meeting_category_id: pick existing "Meeting" category if present.
INSERT OR IGNORE INTO app_meta (key, value)
  SELECT 'meeting_category_id', id FROM category WHERE name = 'Meeting' LIMIT 1;
```

- [ ] **Step 2: Create `src-tauri/src/db/migrations.rs`**

```rust
use rusqlite::Connection;

use crate::error::AppResult;

const V2_CALENDAR: &str = include_str!("migrations/v2_calendar.sql");

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration { version: 2, sql: V2_CALENDAR },
];

pub fn run(conn: &Connection) -> AppResult<()> {
    let current: u32 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);

    for m in MIGRATIONS {
        if m.version <= current { continue; }
        conn.execute_batch(m.sql)?;
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [m.version.to_string()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn migrates_fresh_db_to_latest() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let v: String = conn.query_row(
            "SELECT value FROM app_meta WHERE key = 'schema_version'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(v, "2");
        // Source columns are present.
        let cols: Vec<String> = conn.prepare("PRAGMA table_info(time_entry)").unwrap()
            .query_map([], |r| r.get::<_, String>(1)).unwrap()
            .filter_map(Result::ok).collect();
        assert!(cols.contains(&"source".to_string()));
        assert!(cols.contains(&"source_event_id".to_string()));
        assert!(cols.contains(&"source_edited_locally".to_string()));
    }

    #[test]
    fn migration_is_idempotent() {
        let db = Database::open_in_memory().unwrap();
        // running migrations again must not error
        run(&db.conn.lock().unwrap()).unwrap();
    }
}
```

- [ ] **Step 3: Update `db/mod.rs` to invoke the migration runner**

In `Database::open` and `Database::open_in_memory`, after `execute_batch(SCHEMA_SQL)` add:

```rust
crate::db::migrations::run(&conn)?;
```

Add `pub mod migrations;` at the top of `db/mod.rs`.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib db::`
Expected: all existing tests still pass; new migration tests pass.

- [ ] **Step 5: Commit**

```sh
git add src-tauri/src/db/
git commit -m "feat(db): migrations runner + v2 schema for calendar"
```

---

## Task 3: Extend domain types with source fields

**Files:** `src-tauri/src/domain.rs`

- [ ] **Step 1: Update `TimeEntry`, `NewEntry`, `EntryEdit`**

Replace the existing structs in `domain.rs` with these (keep prior fields, add the new ones):

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeEntry {
    pub id: Id,
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,                   // "manual" | "calendar"
    #[serde(default)]
    pub source_event_id: Option<String>,
    #[serde(default)]
    pub source_calendar_id: Option<String>,
    #[serde(default)]
    pub source_edited_locally: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEntry {
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub source_event_id: Option<String>,
    #[serde(default)]
    pub source_calendar_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryEdit {
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

fn default_source() -> String { "manual".into() }
```

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo check`
Expected: builds. (Existing call sites in commands/repos still work since they don't reference the new fields yet; `NewEntry { ... }` literals will fail compile until we update them in the next task.)

- [ ] **Step 3: Note for next task**

`NewEntry { ... }` and `TimeEntry { ... }` literal construction sites will fail. They're updated in Task 4.

---

## Task 4: Extend `repo::entries` to persist + read source columns

**Files:** `src-tauri/src/repo/entries.rs`

- [ ] **Step 1: Update `row_to_entry` to read the new columns**

```rust
fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeEntry> {
    use rusqlite::Error;
    use rusqlite::types::Type;
    let id_s: String = row.get(0)?;
    let cat_s: String = row.get(1)?;
    let proj_s: Option<String> = row.get(2)?;
    let start_s: String = row.get(3)?;
    let end_s: Option<String> = row.get(4)?;
    let note: Option<String> = row.get(5)?;
    let source: String = row.get(6)?;
    let source_event_id: Option<String> = row.get(7)?;
    let source_calendar_id: Option<String> = row.get(8)?;
    let source_edited: i64 = row.get(9)?;
    Ok(TimeEntry {
        id: Uuid::parse_str(&id_s).map_err(|e| Error::FromSqlConversionFailure(0, Type::Text, Box::new(e)))?,
        category_id: Uuid::parse_str(&cat_s).map_err(|e| Error::FromSqlConversionFailure(1, Type::Text, Box::new(e)))?,
        project_id: proj_s.map(|s| Uuid::parse_str(&s)).transpose()
            .map_err(|e| Error::FromSqlConversionFailure(2, Type::Text, Box::new(e)))?,
        started_at: parse_iso(&start_s).map_err(|e| Error::FromSqlConversionFailure(3, Type::Text, Box::new(e)))?,
        ended_at: end_s.map(|s| parse_iso(&s)).transpose()
            .map_err(|e| Error::FromSqlConversionFailure(4, Type::Text, Box::new(e)))?,
        note,
        source,
        source_event_id,
        source_calendar_id,
        source_edited_locally: source_edited != 0,
    })
}
```

- [ ] **Step 2: Update SELECT lists**

Every `SELECT id, category_id, project_id, started_at, ended_at, note FROM time_entry ...` becomes `SELECT id, category_id, project_id, started_at, ended_at, note, source, source_event_id, source_calendar_id, source_edited_locally FROM time_entry ...`. Apply to all queries in the file (`list_in_range`, `find`, `running`).

- [ ] **Step 3: Update `create` to persist new fields**

Replace the INSERT in `create`:

```rust
let res = conn.execute(
    "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note, source, source_event_id, source_calendar_id, source_edited_locally)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
    rusqlite::params![
        id.to_string(),
        new.category_id.to_string(),
        new.project_id.map(|p| p.to_string()),
        iso(new.started_at),
        new.ended_at.map(iso),
        new.note,
        new.source,
        new.source_event_id,
        new.source_calendar_id,
    ],
);
```

- [ ] **Step 4: Add `find_by_source` + `mark_edited_locally`**

```rust
pub fn find_by_source(
    conn: &Connection,
    source_event_id: &str,
    source_calendar_id: &str,
) -> AppResult<Option<TimeEntry>> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note,
                source, source_event_id, source_calendar_id, source_edited_locally
         FROM time_entry
         WHERE source_event_id = ?1 AND source_calendar_id = ?2",
        [source_event_id, source_calendar_id],
        row_to_entry,
    ).optional()?;
    Ok(e)
}

pub fn mark_edited_locally(conn: &Connection, id: Uuid) -> AppResult<()> {
    let rows = conn.execute(
        "UPDATE time_entry SET source_edited_locally = 1 WHERE id = ?1",
        [id.to_string()],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("entry {}", id)));
    }
    Ok(())
}
```

- [ ] **Step 5: Run all entry repo tests**

Run: `cd src-tauri && cargo test --lib repo::entries`
Expected: all pass.

- [ ] **Step 6: Add coverage for the new functions** — append to `tests`:

```rust
    #[test]
    fn find_by_source_returns_match() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let e = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: Some(t("2026-05-22T11:00:00Z")),
            note: None,
            source: "calendar".into(),
            source_event_id: Some("evt-1".into()),
            source_calendar_id: Some("cal-a".into()),
        }).unwrap();
        let found = find_by_source(&conn, "evt-1", "cal-a").unwrap().unwrap();
        assert_eq!(found.id, e.id);
    }

    #[test]
    fn mark_edited_locally_sets_flag() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let e = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: Some(t("2026-05-22T11:00:00Z")),
            note: None,
            source: "calendar".into(),
            source_event_id: Some("evt-2".into()),
            source_calendar_id: Some("cal-a".into()),
        }).unwrap();
        mark_edited_locally(&conn, e.id).unwrap();
        let re = find(&conn, e.id).unwrap();
        assert!(re.source_edited_locally);
    }
```

> Note: existing `insert_closed` in `test_support.rs` writes with the legacy columns. Since the migration applies to the in-memory DB on `Database::open_in_memory`, the new columns default to `source='manual'` etc. — existing tests still work.

Run: `cd src-tauri && cargo test --lib repo::entries`
Expected: all pass including new ones.

- [ ] **Step 7: Commit**

```sh
git add src-tauri/src/repo/entries.rs src-tauri/src/domain.rs
git commit -m "feat(repo): entries gain source columns + find_by_source + mark_edited_locally"
```

---

## Task 5: Update existing callers of `NewEntry { ... }`

**Files:** any file constructing `NewEntry` literals.

- [ ] **Step 1: Find call sites**

Run: `cd src-tauri && grep -rn "NewEntry {" src/`
Expected list (will vary): `src/timer.rs`, possibly tests.

- [ ] **Step 2: Add `source: "manual".into(), source_event_id: None, source_calendar_id: None,` to each literal**

For example in `src-tauri/src/timer.rs`:

```rust
let entry = repo::entries::create(&tx, &NewEntry {
    category_id,
    project_id,
    started_at: now,
    ended_at: None,
    note,
    source: "manual".into(),
    source_event_id: None,
    source_calendar_id: None,
})?;
```

- [ ] **Step 3: Verify build**

Run: `cd src-tauri && cargo build`
Expected: success.

- [ ] **Step 4: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 5: Commit**

```sh
git add src-tauri/src/
git commit -m "fix: pass default manual source to NewEntry construction sites"
```

---

## Task 6: TypeScript types

**Files:** `src/types.ts`

- [ ] **Step 1: Extend `TimeEntry`, `NewEntry`**

```ts
export interface TimeEntry {
  id: Id;
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  source: 'manual' | 'calendar';
  source_event_id: string | null;
  source_calendar_id: string | null;
  source_edited_locally: boolean;
}

export interface NewEntry {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  source?: 'manual' | 'calendar';
  source_event_id?: string | null;
  source_calendar_id?: string | null;
}

export interface CalendarStatus {
  connected: boolean;
  kind: 'oauth' | 'ics' | null;
  account_email: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  meeting_category_id: string | null;
  initial_backfill_days: number;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc -b`
Expected: passes.

- [ ] **Step 3: Commit**

```sh
git add src/types.ts
git commit -m "feat(types): TimeEntry source fields + CalendarStatus"
```

---

## Task 7: Calendar module skeleton + types

**Files:**
- Create: `src-tauri/src/calendar/mod.rs`
- Create: `src-tauri/src/calendar/types.rs`
- Create: `src-tauri/src/calendar/provider.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: `src-tauri/src/calendar/types.rs`**

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub source_event_id: String,
    pub source_calendar_id: String,
    pub title: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub is_all_day: bool,
    pub rsvp_accepted: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredCalendar {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarSource {
    pub id: Uuid,
    pub kind: String, // 'oauth' | 'ics'
    pub account_email: Option<String>,
    pub keychain_ref: String,
    pub connected_at: DateTime<Utc>,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarRow {
    pub id: String,
    pub display_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingImport {
    pub id: Uuid,
    pub source_event_id: String,
    pub source_calendar_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub title: String,
    pub status: String,
    pub detected_at: DateTime<Utc>,
    pub resolved_action: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewPendingImport {
    pub source_event_id: String,
    pub source_calendar_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub title: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionAction {
    KeptMine,
    UsedCalendar,
    Edited,
}
```

- [ ] **Step 2: `src-tauri/src/calendar/provider.rs`**

```rust
use chrono::{DateTime, Utc};
use async_trait::async_trait;

use crate::calendar::types::{CalendarEvent, DiscoveredCalendar};
use crate::error::AppResult;

#[async_trait]
pub trait CalendarProvider: Send + Sync {
    async fn list_calendars(&self) -> AppResult<Vec<DiscoveredCalendar>>;
    async fn fetch_events(
        &self,
        calendar_id: &str,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> AppResult<Vec<CalendarEvent>>;
    fn kind(&self) -> &'static str;
}
```

- [ ] **Step 3: `src-tauri/src/calendar/mod.rs`**

```rust
pub mod provider;
pub mod types;
```

- [ ] **Step 4: Register in `lib.rs`**

Add `pub mod calendar;` at the top.

- [ ] **Step 5: Build**

Run: `cd src-tauri && cargo build`
Expected: ok.

- [ ] **Step 6: Commit**

```sh
git add src-tauri/src/calendar/ src-tauri/src/lib.rs
git commit -m "feat(calendar): module skeleton with types and provider trait"
```

---

## Task 8: Keychain wrapper

**Files:** `src-tauri/src/calendar/keychain.rs`, `src-tauri/src/calendar/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/calendar/keychain.rs`**

```rust
use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.timetrak.app";

pub fn put(key: &str, value: &str) -> AppResult<()> {
    Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(value))
        .map_err(|e| AppError::Other(format!("keychain put: {e}")))
}

pub fn get(key: &str) -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE, key)
        .map_err(|e| AppError::Other(format!("keychain entry: {e}")))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!("keychain get: {e}"))),
    }
}

pub fn delete(key: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE, key)
        .map_err(|e| AppError::Other(format!("keychain entry: {e}")))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("keychain delete: {e}"))),
    }
}
```

- [ ] **Step 2: Add `pub mod keychain;` to `calendar/mod.rs`**

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: ok. (No tests — keychain side effects require an OS, skipped in CI.)

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/calendar/
git commit -m "feat(calendar): keychain wrapper using `keyring`"
```

---

## Task 9: `repo::calendar_source`

**Files:**
- Create: `src-tauri/src/repo/calendar_source.rs`
- Modify: `src-tauri/src/repo/mod.rs`

- [ ] **Step 1: Create**

```rust
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::calendar::types::CalendarSource;
use crate::error::AppResult;

pub fn get(conn: &Connection) -> AppResult<Option<CalendarSource>> {
    let row = conn.query_row(
        "SELECT id, kind, account_email, keychain_ref, connected_at, last_sync_at, last_sync_error
         FROM calendar_source LIMIT 1",
        [], map_row,
    ).optional()?;
    Ok(row)
}

pub fn set(conn: &Connection, src: &CalendarSource) -> AppResult<()> {
    // Single-row table: clear then insert.
    conn.execute("DELETE FROM calendar_source", [])?;
    conn.execute(
        "INSERT INTO calendar_source
            (id, kind, account_email, keychain_ref, connected_at, last_sync_at, last_sync_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            src.id.to_string(),
            src.kind,
            src.account_email,
            src.keychain_ref,
            src.connected_at.to_rfc3339(),
            src.last_sync_at.map(|t| t.to_rfc3339()),
            src.last_sync_error,
        ],
    )?;
    Ok(())
}

pub fn clear(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM calendar_source", [])?;
    Ok(())
}

pub fn touch_last_sync(conn: &Connection, ok: bool, error: Option<&str>) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE calendar_source SET last_sync_at = ?1, last_sync_error = ?2",
        rusqlite::params![now, if ok { None } else { error }],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarSource> {
    let id_s: String = row.get(0)?;
    let connected_s: String = row.get(4)?;
    let last_sync_s: Option<String> = row.get(5)?;
    Ok(CalendarSource {
        id: Uuid::parse_str(&id_s).unwrap(),
        kind: row.get(1)?,
        account_email: row.get(2)?,
        keychain_ref: row.get(3)?,
        connected_at: DateTime::parse_from_rfc3339(&connected_s).unwrap().with_timezone(&Utc),
        last_sync_at: last_sync_s.map(|s| DateTime::parse_from_rfc3339(&s).unwrap().with_timezone(&Utc)),
        last_sync_error: row.get(6)?,
    })
}
```

- [ ] **Step 2: Add to `repo/mod.rs`**

```rust
pub mod calendar_source;
```

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/repo/calendar_source.rs src-tauri/src/repo/mod.rs
git commit -m "feat(repo): calendar_source CRUD"
```

---

## Task 10: `repo::calendars`

**Files:**
- Create: `src-tauri/src/repo/calendars.rs`
- Modify: `src-tauri/src/repo/mod.rs`

- [ ] **Step 1: Create**

```rust
use rusqlite::Connection;

use crate::calendar::types::{CalendarRow, DiscoveredCalendar};
use crate::error::AppResult;

pub fn list(conn: &Connection) -> AppResult<Vec<CalendarRow>> {
    let mut stmt = conn.prepare("SELECT id, display_name, enabled FROM calendar ORDER BY display_name")?;
    let rows = stmt.query_map([], |r| Ok(CalendarRow {
        id: r.get(0)?,
        display_name: r.get(1)?,
        enabled: r.get::<_, i64>(2)? != 0,
    }))?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn upsert_many(conn: &Connection, items: &[DiscoveredCalendar]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    for it in items {
        tx.execute(
            "INSERT INTO calendar (id, display_name, enabled) VALUES (?1, ?2, 0)
             ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name",
            rusqlite::params![it.id, it.display_name],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE calendar SET enabled = ?2 WHERE id = ?1",
        rusqlite::params![id, if enabled { 1 } else { 0 }],
    )?;
    Ok(())
}

pub fn enabled_ids(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM calendar WHERE enabled = 1")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}
```

- [ ] **Step 2: Register**

In `repo/mod.rs` add `pub mod calendars;`.

- [ ] **Step 3: Build + commit**

```sh
cd src-tauri && cargo build && cd ..
git add src-tauri/src/repo/calendars.rs src-tauri/src/repo/mod.rs
git commit -m "feat(repo): calendars list/upsert/toggle"
```

---

## Task 11: `repo::pending_imports`

**Files:**
- Create: `src-tauri/src/repo/pending_imports.rs`
- Modify: `src-tauri/src/repo/mod.rs`

- [ ] **Step 1: Create**

```rust
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::calendar::types::{NewPendingImport, PendingImport, ResolutionAction};
use crate::error::AppResult;

pub fn list_pending(conn: &Connection) -> AppResult<Vec<PendingImport>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_event_id, source_calendar_id, started_at, ended_at, title,
                status, detected_at, resolved_action, resolved_at
         FROM pending_calendar_import
         WHERE status = 'pending_conflict'
         ORDER BY started_at",
    )?;
    let rows = stmt.query_map([], map_row)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn insert(conn: &Connection, p: &NewPendingImport) -> AppResult<PendingImport> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    conn.execute(
        "INSERT INTO pending_calendar_import
            (id, source_event_id, source_calendar_id, started_at, ended_at, title,
             status, detected_at, resolved_action, resolved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending_conflict', ?7, NULL, NULL)",
        rusqlite::params![
            id.to_string(),
            p.source_event_id,
            p.source_calendar_id,
            p.started_at.to_rfc3339(),
            p.ended_at.to_rfc3339(),
            p.title,
            now.to_rfc3339(),
        ],
    )?;
    Ok(PendingImport {
        id,
        source_event_id: p.source_event_id.clone(),
        source_calendar_id: p.source_calendar_id.clone(),
        started_at: p.started_at,
        ended_at: p.ended_at,
        title: p.title.clone(),
        status: "pending_conflict".into(),
        detected_at: now,
        resolved_action: None,
        resolved_at: None,
    })
}

pub fn resolve(conn: &Connection, id: Uuid, action: ResolutionAction) -> AppResult<()> {
    let action_s = match action {
        ResolutionAction::KeptMine => "kept_mine",
        ResolutionAction::UsedCalendar => "used_calendar",
        ResolutionAction::Edited => "edited",
    };
    conn.execute(
        "UPDATE pending_calendar_import
         SET status = 'resolved', resolved_action = ?2, resolved_at = ?3
         WHERE id = ?1",
        rusqlite::params![id.to_string(), action_s, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingImport> {
    let id_s: String = row.get(0)?;
    let start_s: String = row.get(3)?;
    let end_s: String = row.get(4)?;
    let detected_s: String = row.get(7)?;
    let resolved_s: Option<String> = row.get(9)?;
    Ok(PendingImport {
        id: Uuid::parse_str(&id_s).unwrap(),
        source_event_id: row.get(1)?,
        source_calendar_id: row.get(2)?,
        started_at: DateTime::parse_from_rfc3339(&start_s).unwrap().with_timezone(&Utc),
        ended_at: DateTime::parse_from_rfc3339(&end_s).unwrap().with_timezone(&Utc),
        title: row.get(5)?,
        status: row.get(6)?,
        detected_at: DateTime::parse_from_rfc3339(&detected_s).unwrap().with_timezone(&Utc),
        resolved_action: row.get(8)?,
        resolved_at: resolved_s.map(|s| DateTime::parse_from_rfc3339(&s).unwrap().with_timezone(&Utc)),
    })
}
```

- [ ] **Step 2: Register**

In `repo/mod.rs` add `pub mod pending_imports;`.

- [ ] **Step 3: Build + commit**

```sh
cd src-tauri && cargo build && cd ..
git add src-tauri/src/repo/pending_imports.rs src-tauri/src/repo/mod.rs
git commit -m "feat(repo): pending_calendar_import CRUD"
```

---

## Task 12: Tauri commands — `calendar_status` and `set_meeting_category`

**Files:**
- Create: `src-tauri/src/commands/calendar.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create**

```rust
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::repo;

#[derive(Serialize)]
pub struct CalendarStatus {
    pub connected: bool,
    pub kind: Option<String>,
    pub account_email: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_sync_error: Option<String>,
    pub meeting_category_id: Option<String>,
    pub initial_backfill_days: i64,
}

#[tauri::command]
pub fn calendar_status(db: State<'_, Database>) -> AppResult<CalendarStatus> {
    let conn = db.conn.lock().unwrap();
    let src = repo::calendar_source::get(&conn)?;
    let meeting: Option<String> = conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'meeting_category_id'",
        [], |r| r.get(0),
    ).optional()?;
    let backfill: String = conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'initial_backfill_days'",
        [], |r| r.get(0),
    ).unwrap_or_else(|_| "14".into());
    Ok(CalendarStatus {
        connected: src.is_some(),
        kind: src.as_ref().map(|s| s.kind.clone()),
        account_email: src.as_ref().and_then(|s| s.account_email.clone()),
        last_sync_at: src.as_ref().and_then(|s| s.last_sync_at.map(|t| t.to_rfc3339())),
        last_sync_error: src.as_ref().and_then(|s| s.last_sync_error.clone()),
        meeting_category_id: meeting,
        initial_backfill_days: backfill.parse().unwrap_or(14),
    })
}

#[tauri::command]
pub fn set_meeting_category(db: State<'_, Database>, id: Uuid) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM category WHERE id = ?1",
        [id.to_string()], |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("category {}", id)));
    }
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('meeting_category_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [id.to_string()],
    )?;
    Ok(())
}
```

- [ ] **Step 2: Register in `commands/mod.rs`**

Add `pub mod calendar;` to the module list, and add to the handler macro:

```rust
            timetrak_lib::commands::calendar::calendar_status,
            timetrak_lib::commands::calendar::set_meeting_category,
```

- [ ] **Step 3: Build + commit**

```sh
cd src-tauri && cargo build && cd ..
git add src-tauri/src/commands/
git commit -m "feat(commands): calendar_status + set_meeting_category"
```

---

## Task 13: TS API wrappers

**Files:** `src/lib/api.ts`

- [ ] **Step 1: Append after the existing windows section**

```ts
// --- Calendar (v0.3) ---
import type { CalendarStatus } from '../types';
export const calendarStatus = () => invoke<CalendarStatus>('calendar_status');
export const setMeetingCategory = (id: Id) =>
  invoke<void>('set_meeting_category', { id });
```

- [ ] **Step 2: Verify**

Run: `npx tsc -b`
Expected: passes.

- [ ] **Step 3: Commit**

```sh
git add src/lib/api.ts
git commit -m "feat(api): calendar_status and set_meeting_category wrappers"
```

---

## Task 14: Self-verify and tag

- [ ] **Step 1: Full build**

```sh
npx tsc -b && npm test && cd src-tauri && cargo test
```

Expected: all green.

- [ ] **Step 2: Tag**

```sh
git tag calendar-foundation-complete
```

---

## Done

Foundation in place. The next phase (01 — ICS provider) implements the provider trait against an ICS URL, exercises the pipeline end-to-end, and validates the migration on a real DB.
