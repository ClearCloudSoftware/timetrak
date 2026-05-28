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
    let meeting: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'meeting_category_id'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let backfill: String = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'initial_backfill_days'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "14".into());
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
        [id.to_string()],
        |r| r.get(0),
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
