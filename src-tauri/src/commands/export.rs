use chrono::{DateTime, Utc};
use tauri::State;

use crate::csv_export::entries_to_csv;
use crate::db::Database;
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn export_csv(
    db: State<'_, Database>,
    start_utc: DateTime<Utc>,
    end_utc: DateTime<Utc>,
) -> AppResult<String> {
    let conn = db.conn.lock().unwrap();
    let entries = repo::entries::list_in_range(&conn, start_utc, end_utc)?;
    let categories = repo::categories::list(&conn)?;
    let projects = repo::projects::list(&conn)?;
    // Default to UTC for now; settings plan adds a configurable tz.
    let tz = chrono_tz::UTC;
    Ok(entries_to_csv(&entries, &categories, &projects, tz))
}
