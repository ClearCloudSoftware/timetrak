use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::TimeEntry;
use crate::error::AppResult;
use crate::timer::{self, TimerState};

#[tauri::command]
pub fn get_timer_state(db: State<'_, Database>) -> AppResult<TimerState> {
    let conn = db.conn.lock().unwrap();
    timer::state(&conn)
}

#[tauri::command]
pub fn start_timer(
    app: AppHandle,
    db: State<'_, Database>,
    category_id: Uuid,
    project_id: Option<Uuid>,
    note: Option<String>,
) -> AppResult<TimeEntry> {
    let mut conn = db.conn.lock().unwrap();
    let entry = timer::start(&mut conn, category_id, project_id, note)?;
    emit_changed(&app, Some(&entry));
    Ok(entry)
}

#[tauri::command]
pub fn stop_timer(app: AppHandle, db: State<'_, Database>) -> AppResult<Option<TimeEntry>> {
    let conn = db.conn.lock().unwrap();
    let stopped = timer::stop(&conn)?;
    emit_changed(&app, None);
    Ok(stopped)
}

#[tauri::command]
pub fn switch_timer(
    app: AppHandle,
    db: State<'_, Database>,
    category_id: Uuid,
    project_id: Option<Uuid>,
    note: Option<String>,
) -> AppResult<TimeEntry> {
    // `start` already stops any running entry atomically.
    start_timer(app, db, category_id, project_id, note)
}

fn emit_changed(app: &AppHandle, running: Option<&TimeEntry>) {
    let _ = app.emit(crate::events::TIMER_CHANGED, serde_json::json!({ "running": running }));
}
