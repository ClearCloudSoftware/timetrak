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
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
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
    // Detach from calendar source so future syncs don't overwrite this manual edit.
    if e.source_event_id.is_some() && !e.source_edited_locally {
        repo::entries::mark_edited_locally(&conn, id)?;
    }
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
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
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn list_recent_combos(db: State<'_, Database>) -> AppResult<Vec<repo::entries::RecentCombo>> {
    let conn = db.conn.lock().unwrap();
    let since = Utc::now() - chrono::Duration::days(14);
    repo::entries::recent_combos(&conn, since, 6)
}
