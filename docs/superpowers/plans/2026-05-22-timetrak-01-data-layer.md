# TimeTrak — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the Rust data layer — repositories for categories/projects/time_entry, the reporting aggregator, and the CSV exporter. Each unit has full unit-test coverage.

**Depends on:** Plan 00 (foundation) must be tagged `foundation-complete`.

**Touches:**
- `src-tauri/src/repo/categories.rs`
- `src-tauri/src/repo/projects.rs`
- `src-tauri/src/repo/entries.rs`
- `src-tauri/src/reporting.rs`
- `src-tauri/src/csv_export.rs`
- Adds `chrono-tz` to `Cargo.toml`

**No UI changes. No command handlers. No Tauri integration.** This plan only exposes Rust free functions consumed by plans 02–05.

---

## Task 1: Add `chrono-tz` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `chrono-tz`**

In `[dependencies]`, add:

```toml
chrono-tz = "0.9"
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: builds.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add chrono-tz dependency"
```

---

## Task 2: Test helpers module

**Files:**
- Create: `src-tauri/src/test_support.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/test_support.rs`**

```rust
#![cfg(test)]

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{Category, NewEntry};

pub const CAT_MEETING: &str = "00000000-0000-0000-0000-000000000001";
pub const CAT_CODING:  &str = "00000000-0000-0000-0000-000000000002";
pub const CAT_EMAIL:   &str = "00000000-0000-0000-0000-000000000003";
pub const CAT_BREAK:   &str = "00000000-0000-0000-0000-000000000004";

pub fn fresh_db() -> Database {
    Database::open_in_memory().expect("open_in_memory")
}

pub fn t(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}

pub fn cat_id(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

pub fn meeting() -> Uuid { cat_id(CAT_MEETING) }
pub fn coding() -> Uuid { cat_id(CAT_CODING) }

/// Insert a closed entry. Returns the inserted id.
pub fn insert_closed(
    conn: &Connection,
    category: Uuid,
    start: &str,
    end: &str,
) -> Uuid {
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note)
         VALUES (?1, ?2, NULL, ?3, ?4, NULL)",
        rusqlite::params![id.to_string(), category.to_string(), start, end],
    ).unwrap();
    id
}
```

- [ ] **Step 2: Register module**

Edit `src-tauri/src/lib.rs`, add at the bottom:

```rust
#[cfg(test)]
mod test_support;
```

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo test --lib`
Expected: existing tests still pass.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/test_support.rs src-tauri/src/lib.rs
git commit -m "test: add shared test helpers"
```

---

## Task 3: Category repository — list/find

**Files:**
- Modify: `src-tauri/src/repo/categories.rs`

- [ ] **Step 1: Write failing tests**

Replace `src-tauri/src/repo/categories.rs` with:

```rust
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::Category;
use crate::error::{AppError, AppResult};

pub fn list(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM category ORDER BY name")?;
    let rows = stmt.query_map([], row_to_category)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn find(conn: &Connection, id: Uuid) -> AppResult<Category> {
    let cat = conn.query_row(
        "SELECT id, name, color FROM category WHERE id = ?1",
        [id.to_string()],
        row_to_category,
    ).optional()?;
    cat.ok_or_else(|| AppError::NotFound(format!("category {}", id)))
}

fn row_to_category(row: &rusqlite::Row<'_>) -> rusqlite::Result<Category> {
    let id: String = row.get(0)?;
    Ok(Category {
        id: Uuid::parse_str(&id).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
        name: row.get(1)?,
        color: row.get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn list_returns_seeded_categories_sorted_by_name() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cats = list(&conn).unwrap();
        let names: Vec<_> = cats.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["Break", "Coding", "Email", "Meeting"]);
    }

    #[test]
    fn find_returns_category() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cat = find(&conn, meeting()).unwrap();
        assert_eq!(cat.name, "Meeting");
    }

    #[test]
    fn find_unknown_returns_not_found() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let err = find(&conn, Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
```

- [ ] **Step 2: Run tests — expect to pass on first attempt (implementation already there)**

Run: `cd src-tauri && cargo test --lib repo::categories::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/repo/categories.rs
git commit -m "feat: category repo list and find"
```

---

## Task 4: Category repository — create/update/delete

**Files:**
- Modify: `src-tauri/src/repo/categories.rs`

- [ ] **Step 1: Write failing tests** — append to the `tests` mod in `categories.rs`:

```rust
    #[test]
    fn create_inserts_category_and_returns_it() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cat = create(&conn, "Reading", "#ff0000").unwrap();
        assert_eq!(cat.name, "Reading");
        assert!(find(&conn, cat.id).is_ok());
    }

    #[test]
    fn create_rejects_duplicate_name() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let err = create(&conn, "Meeting", "#000000").unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn update_changes_name_and_color() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cat = update(&conn, meeting(), "Standup", "#abcdef").unwrap();
        assert_eq!(cat.name, "Standup");
        assert_eq!(cat.color, "#abcdef");
    }

    #[test]
    fn delete_without_entries_removes_row() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        delete(&conn, meeting(), false).unwrap();
        assert!(find(&conn, meeting()).is_err());
    }

    #[test]
    fn delete_with_referenced_entries_without_cascade_errors() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        let err = delete(&conn, meeting(), false).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn delete_with_referenced_entries_with_cascade_removes_entries_and_category() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        delete(&conn, meeting(), true).unwrap();
        assert!(find(&conn, meeting()).is_err());
        let cnt: i64 = conn.query_row(
            "SELECT COUNT(*) FROM time_entry WHERE category_id = ?1",
            [meeting().to_string()], |r| r.get(0)
        ).unwrap();
        assert_eq!(cnt, 0);
    }
```

- [ ] **Step 2: Run — expect compilation failure**

Run: `cd src-tauri && cargo test --lib repo::categories::tests`
Expected: fails because `create`, `update`, `delete` are not defined.

- [ ] **Step 3: Implement — add to `categories.rs` above the `#[cfg(test)]` block**

```rust
pub fn create(conn: &Connection, name: &str, color: &str) -> AppResult<Category> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO category (id, name, color) VALUES (?1, ?2, ?3)",
        rusqlite::params![id.to_string(), name, color],
    ).map_err(map_unique_violation)?;
    find(conn, id)
}

pub fn update(conn: &Connection, id: Uuid, name: &str, color: &str) -> AppResult<Category> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let rows = conn.execute(
        "UPDATE category SET name = ?2, color = ?3 WHERE id = ?1",
        rusqlite::params![id.to_string(), name, color],
    ).map_err(map_unique_violation)?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("category {}", id)));
    }
    find(conn, id)
}

pub fn delete(conn: &Connection, id: Uuid, cascade_entries: bool) -> AppResult<()> {
    let has_entries: i64 = conn.query_row(
        "SELECT COUNT(*) FROM time_entry WHERE category_id = ?1",
        [id.to_string()], |r| r.get(0),
    )?;
    if has_entries > 0 && !cascade_entries {
        return Err(AppError::Invalid(
            "category has entries; pass cascade_entries=true to delete them too".into(),
        ));
    }
    let tx = conn.unchecked_transaction()?;
    if cascade_entries {
        tx.execute("DELETE FROM time_entry WHERE category_id = ?1", [id.to_string()])?;
    }
    let rows = tx.execute("DELETE FROM category WHERE id = ?1", [id.to_string()])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("category {}", id)));
    }
    tx.commit()?;
    Ok(())
}

fn map_unique_violation(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, msg) if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
            AppError::Invalid(format!("unique constraint: {}", msg.as_deref().unwrap_or("category.name")))
        }
        _ => AppError::Db(err),
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib repo::categories::tests`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```sh
git add src-tauri/src/repo/categories.rs
git commit -m "feat: category repo create/update/delete with cascade"
```

---

## Task 5: Project repository

**Files:**
- Modify: `src-tauri/src/repo/projects.rs`

- [ ] **Step 1: Implement project repo (no cascade — FK is ON DELETE SET NULL)**

Replace `src-tauri/src/repo/projects.rs` with:

```rust
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::Project;
use crate::error::{AppError, AppResult};

pub fn list(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM project ORDER BY name")?;
    let rows = stmt.query_map([], row_to_project)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn find(conn: &Connection, id: Uuid) -> AppResult<Project> {
    let p = conn.query_row(
        "SELECT id, name, color FROM project WHERE id = ?1",
        [id.to_string()],
        row_to_project,
    ).optional()?;
    p.ok_or_else(|| AppError::NotFound(format!("project {}", id)))
}

pub fn create(conn: &Connection, name: &str, color: &str) -> AppResult<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO project (id, name, color) VALUES (?1, ?2, ?3)",
        rusqlite::params![id.to_string(), name, color],
    ).map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(c, msg) if c.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
            AppError::Invalid(format!("unique constraint: {}", msg.as_deref().unwrap_or("project.name")))
        }
        _ => AppError::Db(e),
    })?;
    find(conn, id)
}

pub fn update(conn: &Connection, id: Uuid, name: &str, color: &str) -> AppResult<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let rows = conn.execute(
        "UPDATE project SET name = ?2, color = ?3 WHERE id = ?1",
        rusqlite::params![id.to_string(), name, color],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("project {}", id)));
    }
    find(conn, id)
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let rows = conn.execute("DELETE FROM project WHERE id = ?1", [id.to_string()])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("project {}", id)));
    }
    Ok(())
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let id: String = row.get(0)?;
    Ok(Project {
        id: Uuid::parse_str(&id).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
        name: row.get(1)?,
        color: row.get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn create_and_list() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let p = create(&conn, "Acme", "#123456").unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, p.id);
    }

    #[test]
    fn delete_sets_project_id_null_on_entries() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let p = create(&conn, "Acme", "#123456").unwrap();
        // Insert entry referencing project
        let eid = Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at)
             VALUES (?1, ?2, ?3, '2026-05-22T10:00:00Z', '2026-05-22T11:00:00Z')",
            rusqlite::params![eid.to_string(), meeting().to_string(), p.id.to_string()],
        ).unwrap();
        delete(&conn, p.id).unwrap();
        let pid: Option<String> = conn.query_row(
            "SELECT project_id FROM time_entry WHERE id = ?1",
            [eid.to_string()], |r| r.get(0),
        ).unwrap();
        assert!(pid.is_none(), "project_id should be nulled by FK ON DELETE SET NULL");
    }

    #[test]
    fn duplicate_name_rejected() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        create(&conn, "Acme", "#123").unwrap();
        let err = create(&conn, "Acme", "#456").unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib repo::projects::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/repo/projects.rs
git commit -m "feat: project repo with FK set-null on delete"
```

---

## Task 6: Time entry repo — reads (list, find, running)

**Files:**
- Modify: `src-tauri/src/repo/entries.rs`

- [ ] **Step 1: Implement read paths with tests**

Replace `src-tauri/src/repo/entries.rs` with:

```rust
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::{EntryEdit, NewEntry, TimeEntry};
use crate::error::{AppError, AppResult};

pub fn list_in_range(
    conn: &Connection,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> AppResult<Vec<TimeEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, project_id, started_at, ended_at, note
         FROM time_entry
         WHERE started_at < ?2
           AND (ended_at IS NULL OR ended_at > ?1)
         ORDER BY started_at",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![iso(start), iso(end)],
        row_to_entry,
    )?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn find(conn: &Connection, id: Uuid) -> AppResult<TimeEntry> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note
         FROM time_entry WHERE id = ?1",
        [id.to_string()],
        row_to_entry,
    ).optional()?;
    e.ok_or_else(|| AppError::NotFound(format!("entry {}", id)))
}

pub fn running(conn: &Connection) -> AppResult<Option<TimeEntry>> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note
         FROM time_entry WHERE ended_at IS NULL",
        [],
        row_to_entry,
    ).optional()?;
    Ok(e)
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeEntry> {
    use rusqlite::Error;
    use rusqlite::types::Type;
    let id_s: String = row.get(0)?;
    let cat_s: String = row.get(1)?;
    let proj_s: Option<String> = row.get(2)?;
    let start_s: String = row.get(3)?;
    let end_s: Option<String> = row.get(4)?;
    let note: Option<String> = row.get(5)?;
    Ok(TimeEntry {
        id: Uuid::parse_str(&id_s).map_err(|e| Error::FromSqlConversionFailure(0, Type::Text, Box::new(e)))?,
        category_id: Uuid::parse_str(&cat_s).map_err(|e| Error::FromSqlConversionFailure(1, Type::Text, Box::new(e)))?,
        project_id: proj_s
            .map(|s| Uuid::parse_str(&s))
            .transpose()
            .map_err(|e| Error::FromSqlConversionFailure(2, Type::Text, Box::new(e)))?,
        started_at: parse_iso(&start_s).map_err(|e| Error::FromSqlConversionFailure(3, Type::Text, Box::new(e)))?,
        ended_at: end_s
            .map(|s| parse_iso(&s))
            .transpose()
            .map_err(|e| Error::FromSqlConversionFailure(4, Type::Text, Box::new(e)))?,
        note,
    })
}

fn parse_iso(s: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn list_in_range_returns_overlapping_entries() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T08:00:00Z", "2026-05-22T09:00:00Z"); // before
        insert_closed(&conn, meeting(), "2026-05-22T09:30:00Z", "2026-05-22T10:30:00Z"); // overlap left
        insert_closed(&conn, meeting(), "2026-05-22T10:30:00Z", "2026-05-22T11:30:00Z"); // inside
        insert_closed(&conn, meeting(), "2026-05-22T11:30:00Z", "2026-05-22T12:30:00Z"); // overlap right
        insert_closed(&conn, meeting(), "2026-05-22T13:00:00Z", "2026-05-22T14:00:00Z"); // after

        let res = list_in_range(&conn, t("2026-05-22T10:00:00Z"), t("2026-05-22T12:00:00Z")).unwrap();
        assert_eq!(res.len(), 3);
    }

    #[test]
    fn running_returns_running_entry_only() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T08:00:00Z", "2026-05-22T09:00:00Z");
        let running_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at) VALUES (?1, ?2, '2026-05-22T10:00:00Z')",
            rusqlite::params![running_id.to_string(), meeting().to_string()],
        ).unwrap();

        let r = running(&conn).unwrap().unwrap();
        assert_eq!(r.id, running_id);
    }

    #[test]
    fn running_returns_none_when_no_running_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(running(&conn).unwrap().is_none());
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib repo::entries::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/repo/entries.rs
git commit -m "feat: entry repo reads (list_in_range, find, running)"
```

---

## Task 7: Time entry repo — create with overlap check

**Files:**
- Modify: `src-tauri/src/repo/entries.rs`

- [ ] **Step 1: Add failing tests** — append to `tests` mod:

```rust
    #[test]
    fn create_inserts_closed_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let e = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: Some(t("2026-05-22T11:00:00Z")),
            note: Some("standup".into()),
        }).unwrap();
        assert_eq!(e.note.as_deref(), Some("standup"));
    }

    #[test]
    fn create_rejects_end_before_start() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let err = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T11:00:00Z"),
            ended_at: Some(t("2026-05-22T10:00:00Z")),
            note: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn create_rejects_overlap_with_existing_closed_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        let err = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:30:00Z"),
            ended_at: Some(t("2026-05-22T11:30:00Z")),
            note: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::Overlap));
    }

    #[test]
    fn create_running_when_one_already_running_errors() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: None,
            note: None,
        }).unwrap();
        let err = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T11:00:00Z"),
            ended_at: None,
            note: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::AlreadyRunning));
    }
```

- [ ] **Step 2: Implement `create`** — add above `#[cfg(test)]`:

```rust
pub fn create(conn: &Connection, new: &NewEntry) -> AppResult<TimeEntry> {
    if let Some(end) = new.ended_at {
        if end <= new.started_at {
            return Err(AppError::Invalid("ended_at must be after started_at".into()));
        }
    }
    if has_overlap(conn, None, new.started_at, new.ended_at)? {
        return Err(AppError::Overlap);
    }
    let id = Uuid::new_v4();
    let res = conn.execute(
        "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id.to_string(),
            new.category_id.to_string(),
            new.project_id.map(|p| p.to_string()),
            iso(new.started_at),
            new.ended_at.map(iso),
            new.note,
        ],
    );
    match res {
        Ok(_) => find(conn, id),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
            Err(AppError::AlreadyRunning)
        }
        Err(e) => Err(AppError::Db(e)),
    }
}

/// True if any other entry's [start, end) overlaps the given range.
/// A running entry counts as extending to "end of time" for overlap purposes
/// only when checking against closed entries that occur after its start.
fn has_overlap(
    conn: &Connection,
    exclude_id: Option<Uuid>,
    start: DateTime<Utc>,
    end: Option<DateTime<Utc>>,
) -> AppResult<bool> {
    // Two entries overlap iff start_a < end_b AND start_b < end_a.
    // Treat NULL ended_at as +infinity.
    let exclude = exclude_id.map(|i| i.to_string()).unwrap_or_default();
    let end_s = end.map(iso);
    let cnt: i64 = match end_s {
        Some(end_str) => conn.query_row(
            "SELECT COUNT(*) FROM time_entry
             WHERE id != ?1
               AND started_at < ?3
               AND (ended_at IS NULL OR ended_at > ?2)",
            rusqlite::params![exclude, iso(start), end_str],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT COUNT(*) FROM time_entry
             WHERE id != ?1
               AND (ended_at IS NULL OR ended_at > ?2)",
            rusqlite::params![exclude, iso(start)],
            |r| r.get(0),
        )?,
    };
    Ok(cnt > 0)
}
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test --lib repo::entries::tests`
Expected: 4 new + 3 prior = 7 tests pass.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/repo/entries.rs
git commit -m "feat: entry repo create with overlap and running validation"
```

---

## Task 8: Time entry repo — update / delete / stop_running_now

**Files:**
- Modify: `src-tauri/src/repo/entries.rs`

- [ ] **Step 1: Add failing tests**:

```rust
    #[test]
    fn update_changes_fields_and_rejects_overlap() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let a = insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        let b = insert_closed(&conn, meeting(), "2026-05-22T12:00:00Z", "2026-05-22T13:00:00Z");
        // Move b to overlap a -> error
        let err = update(&conn, b, &EntryEdit {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:30:00Z"),
            ended_at: Some(t("2026-05-22T11:30:00Z")),
            note: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::Overlap));
        // Move b to a non-overlapping range -> ok
        let updated = update(&conn, b, &EntryEdit {
            category_id: coding(),
            project_id: None,
            started_at: t("2026-05-22T14:00:00Z"),
            ended_at: Some(t("2026-05-22T15:00:00Z")),
            note: Some("refactor".into()),
        }).unwrap();
        assert_eq!(updated.category_id, coding());
        assert_eq!(updated.note.as_deref(), Some("refactor"));
        assert_eq!(updated.id, b);
        let _ = a; // silence unused
    }

    #[test]
    fn delete_removes_row() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let a = insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        delete(&conn, a).unwrap();
        assert!(find(&conn, a).is_err());
    }

    #[test]
    fn stop_running_now_closes_running_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at) VALUES (?1, ?2, '2026-05-22T10:00:00Z')",
            rusqlite::params![id.to_string(), meeting().to_string()],
        ).unwrap();
        let stopped = stop_running_now(&conn, t("2026-05-22T11:00:00Z")).unwrap().unwrap();
        assert_eq!(stopped.id, id);
        assert_eq!(stopped.ended_at, Some(t("2026-05-22T11:00:00Z")));
        assert!(running(&conn).unwrap().is_none());
    }

    #[test]
    fn stop_running_now_returns_none_when_nothing_running() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(stop_running_now(&conn, t("2026-05-22T11:00:00Z")).unwrap().is_none());
    }
```

- [ ] **Step 2: Implement** — add above `#[cfg(test)]`:

```rust
pub fn update(conn: &Connection, id: Uuid, edit: &EntryEdit) -> AppResult<TimeEntry> {
    if let Some(end) = edit.ended_at {
        if end <= edit.started_at {
            return Err(AppError::Invalid("ended_at must be after started_at".into()));
        }
    }
    if has_overlap(conn, Some(id), edit.started_at, edit.ended_at)? {
        return Err(AppError::Overlap);
    }
    let rows = conn.execute(
        "UPDATE time_entry SET category_id = ?2, project_id = ?3, started_at = ?4, ended_at = ?5, note = ?6
         WHERE id = ?1",
        rusqlite::params![
            id.to_string(),
            edit.category_id.to_string(),
            edit.project_id.map(|p| p.to_string()),
            iso(edit.started_at),
            edit.ended_at.map(iso),
            edit.note,
        ],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("entry {}", id)));
    }
    find(conn, id)
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let rows = conn.execute("DELETE FROM time_entry WHERE id = ?1", [id.to_string()])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("entry {}", id)));
    }
    Ok(())
}

/// Closes any running entry by setting ended_at = now. Returns the
/// previously-running entry, or None if nothing was running.
pub fn stop_running_now(conn: &Connection, now: DateTime<Utc>) -> AppResult<Option<TimeEntry>> {
    let running_id: Option<String> = conn.query_row(
        "SELECT id FROM time_entry WHERE ended_at IS NULL",
        [],
        |r| r.get(0),
    ).optional()?;
    let Some(id_s) = running_id else { return Ok(None); };
    conn.execute(
        "UPDATE time_entry SET ended_at = ?1 WHERE id = ?2",
        rusqlite::params![iso(now), id_s],
    )?;
    let id = Uuid::parse_str(&id_s).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(Some(find(conn, id)?))
}
```

- [ ] **Step 3: Run all entry tests**

Run: `cd src-tauri && cargo test --lib repo::entries::tests`
Expected: all tests pass (11 total).

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/repo/entries.rs
git commit -m "feat: entry repo update/delete/stop_running_now"
```

---

## Task 9: Reporting service

**Files:**
- Modify: `src-tauri/src/reporting.rs`

- [ ] **Step 1: Implement reporting with tests**

Replace `src-tauri/src/reporting.rs` with:

```rust
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::Connection;
use uuid::Uuid;

use crate::domain::Category;
use crate::error::AppResult;
use crate::repo;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DayTotal {
    pub date: NaiveDate,
    pub category_id: Uuid,
    pub project_id: Option<Uuid>,
    pub seconds: i64,
}

/// Bucket entries into per-local-day, per-category, per-project totals
/// within [start, end). Entries crossing local-midnight are split.
pub fn day_totals(
    conn: &Connection,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    local_tz: Tz,
) -> AppResult<Vec<DayTotal>> {
    let entries = repo::entries::list_in_range(conn, start, end)?;
    let mut buckets: std::collections::BTreeMap<(NaiveDate, Uuid, Option<Uuid>), i64> =
        std::collections::BTreeMap::new();

    for e in entries {
        let entry_end = e.ended_at.unwrap_or(end).min(end);
        let entry_start = e.started_at.max(start);
        if entry_end <= entry_start { continue; }

        // Walk by local days
        let mut cursor = entry_start;
        while cursor < entry_end {
            let local = cursor.with_timezone(&local_tz);
            let day = local.date_naive();
            let next_local_midnight = local_tz
                .from_local_datetime(&(day.succ_opt().unwrap()).and_hms_opt(0, 0, 0).unwrap())
                .single()
                .map(|t| t.with_timezone(&Utc))
                .unwrap_or(entry_end);
            let segment_end = entry_end.min(next_local_midnight);
            let seconds = (segment_end - cursor).num_seconds().max(0);
            *buckets.entry((day, e.category_id, e.project_id)).or_insert(0) += seconds;
            cursor = segment_end;
        }
    }

    Ok(buckets
        .into_iter()
        .map(|((date, category_id, project_id), seconds)| DayTotal {
            date, category_id, project_id, seconds,
        })
        .collect())
}

/// Totals for "today" in the user's local timezone, grouped by category.
pub fn today_totals(conn: &Connection, local_tz: Tz) -> AppResult<Vec<(Category, i64)>> {
    let now_local = Utc::now().with_timezone(&local_tz);
    let day = now_local.date_naive();
    let start_local = local_tz.from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap()).single().unwrap();
    let end_local = local_tz.from_local_datetime(&day.succ_opt().unwrap().and_hms_opt(0, 0, 0).unwrap()).single().unwrap();
    let start = start_local.with_timezone(&Utc);
    let end = end_local.with_timezone(&Utc);

    let totals = day_totals(conn, start, end, local_tz)?;
    let categories = repo::categories::list(conn)?;

    let mut by_cat: std::collections::BTreeMap<Uuid, i64> = Default::default();
    for d in totals {
        *by_cat.entry(d.category_id).or_insert(0) += d.seconds;
    }
    Ok(categories
        .into_iter()
        .filter_map(|c| by_cat.get(&c.id).copied().map(|s| (c, s)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn day_totals_single_entry_within_day() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T13:00:00Z", "2026-05-22T14:30:00Z");
        let res = day_totals(
            &conn,
            t("2026-05-22T00:00:00Z"),
            t("2026-05-23T00:00:00Z"),
            chrono_tz::UTC,
        ).unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].seconds, 90 * 60);
    }

    #[test]
    fn day_totals_splits_at_local_midnight() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        // 23:30Z to 01:30Z spans UTC midnight -> two days under UTC tz
        insert_closed(&conn, meeting(), "2026-05-22T23:30:00Z", "2026-05-23T01:30:00Z");
        let res = day_totals(
            &conn,
            t("2026-05-22T00:00:00Z"),
            t("2026-05-24T00:00:00Z"),
            chrono_tz::UTC,
        ).unwrap();
        assert_eq!(res.len(), 2);
        assert_eq!(res[0].seconds, 30 * 60);
        assert_eq!(res[1].seconds, 90 * 60);
    }
}
```

- [ ] **Step 2: Run**

Run: `cd src-tauri && cargo test --lib reporting::tests`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/reporting.rs
git commit -m "feat: reporting day_totals and today_totals with DST-safe bucketing"
```

---

## Task 10: CSV exporter

**Files:**
- Modify: `src-tauri/src/csv_export.rs`

- [ ] **Step 1: Implement with tests**

Replace `src-tauri/src/csv_export.rs` with:

```rust
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use uuid::Uuid;

use crate::domain::{Category, Project, TimeEntry};

pub fn entries_to_csv(
    entries: &[TimeEntry],
    categories: &[Category],
    projects: &[Project],
    local_tz: Tz,
) -> String {
    let cat_by_id: HashMap<Uuid, &Category> = categories.iter().map(|c| (c.id, c)).collect();
    let proj_by_id: HashMap<Uuid, &Project> = projects.iter().map(|p| (p.id, p)).collect();

    let mut out = String::new();
    out.push_str("started_at,ended_at,duration_minutes,category,project,note\n");
    for e in entries {
        let started = local_iso(e.started_at, local_tz);
        let ended = e.ended_at.map(|t| local_iso(t, local_tz)).unwrap_or_default();
        let duration = e.ended_at
            .map(|end| (end - e.started_at).num_seconds() / 60)
            .map(|m| m.to_string())
            .unwrap_or_default();
        let cat_name = cat_by_id.get(&e.category_id).map(|c| c.name.as_str()).unwrap_or("");
        let proj_name = e.project_id
            .and_then(|p| proj_by_id.get(&p))
            .map(|p| p.name.as_str())
            .unwrap_or("");
        let note = e.note.as_deref().unwrap_or("");

        out.push_str(&csv_field(&started));
        out.push(',');
        out.push_str(&csv_field(&ended));
        out.push(',');
        out.push_str(&duration);
        out.push(',');
        out.push_str(&csv_field(cat_name));
        out.push(',');
        out.push_str(&csv_field(proj_name));
        out.push(',');
        out.push_str(&csv_field(note));
        out.push('\n');
    }
    out
}

fn local_iso(t: DateTime<Utc>, tz: Tz) -> String {
    t.with_timezone(&tz).to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;
    use crate::domain::{Category, TimeEntry};

    fn cat(name: &str) -> Category {
        Category { id: meeting(), name: name.into(), color: "#000000".into() }
    }

    #[test]
    fn header_and_one_row() {
        let entries = vec![TimeEntry {
            id: uuid::Uuid::new_v4(),
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T13:00:00Z"),
            ended_at: Some(t("2026-05-22T13:30:00Z")),
            note: Some("standup".into()),
        }];
        let csv = entries_to_csv(&entries, &[cat("Meeting")], &[], chrono_tz::UTC);
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(lines[0], "started_at,ended_at,duration_minutes,category,project,note");
        assert!(lines[1].contains(",30,"));
        assert!(lines[1].ends_with("standup"));
    }

    #[test]
    fn quotes_commas_and_newlines() {
        let entries = vec![TimeEntry {
            id: uuid::Uuid::new_v4(),
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T13:00:00Z"),
            ended_at: Some(t("2026-05-22T13:30:00Z")),
            note: Some("hello, \"world\"\nnewline".into()),
        }];
        let csv = entries_to_csv(&entries, &[cat("Meeting")], &[], chrono_tz::UTC);
        assert!(csv.contains("\"hello, \"\"world\"\"\nnewline\""));
    }

    #[test]
    fn running_entry_has_empty_end_and_duration() {
        let entries = vec![TimeEntry {
            id: uuid::Uuid::new_v4(),
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T13:00:00Z"),
            ended_at: None,
            note: None,
        }];
        let csv = entries_to_csv(&entries, &[cat("Meeting")], &[], chrono_tz::UTC);
        let row = csv.lines().nth(1).unwrap();
        // started_at,ended_at(empty),duration(empty),category,project(empty),note(empty)
        assert!(row.contains(",,"));
        assert!(row.ends_with(",Meeting,,"));
    }
}
```

- [ ] **Step 2: Run**

Run: `cd src-tauri && cargo test --lib csv_export::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/csv_export.rs
git commit -m "feat: csv exporter with RFC 4180 quoting"
```

---

## Task 11: Self-verify and tag

- [ ] **Step 1: Run the full Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests pass.

- [ ] **Step 2: Tag**

```sh
cd /Users/alex/projects/personal/timetrak
git tag data-layer-complete
```

---

## Done

The data layer is complete. Plans 02, 03, 04, 05 can now run in
parallel — they only depend on the Rust signatures defined here, which
are frozen in `2026-05-22-timetrak-INDEX.md`.
