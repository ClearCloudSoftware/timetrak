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

pub fn idle_resolve_inner(
    conn: &mut rusqlite::Connection,
    entry_id: uuid::Uuid,
    action: &str,
    idle_started_at: chrono::DateTime<chrono::Utc>,
) -> crate::error::AppResult<()> {
    if action == "keep" {
        return Ok(());
    }
    let entry = crate::repo::entries::find(conn, entry_id)?;
    if entry.ended_at.is_some() {
        return Ok(()); // already stopped elsewhere; nothing to truncate
    }
    let edit = crate::domain::EntryEdit {
        category_id: entry.category_id,
        project_id: entry.project_id,
        started_at: entry.started_at,
        ended_at: Some(idle_started_at),
        note: entry.note.clone(),
    };
    crate::repo::entries::update(conn, entry_id, &edit)?;
    if action == "resume" {
        crate::timer::start(conn, entry.category_id, entry.project_id, entry.note)?;
    }
    Ok(())
}

#[tauri::command]
pub fn idle_resolve(
    app: AppHandle,
    db: State<'_, Database>,
    entry_id: uuid::Uuid,
    action: String,
    idle_started_at: chrono::DateTime<chrono::Utc>,
) -> AppResult<()> {
    {
        let mut conn = db.conn.lock().unwrap();
        idle_resolve_inner(&mut conn, entry_id, &action, idle_started_at)?;
    }
    let _ = app.emit(crate::events::TIMER_CHANGED, ());
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
    Ok(())
}

#[cfg(test)]
mod idle_resolve_tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn stop_at_idle_truncates_running_entry() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let e = crate::timer::start(&mut conn, coding(), None, Some("deep work".into())).unwrap();
        let idle_start = e.started_at + chrono::Duration::minutes(5);
        idle_resolve_inner(&mut conn, e.id, "stop_at_idle", idle_start).unwrap();
        let stored = crate::repo::entries::find(&conn, e.id).unwrap();
        assert_eq!(stored.ended_at, Some(idle_start));
        assert!(crate::repo::entries::running(&conn).unwrap().is_none());
    }

    #[test]
    fn resume_truncates_and_starts_same_combo() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let e = crate::timer::start(&mut conn, coding(), None, Some("deep work".into())).unwrap();
        // Backdate the entry so idle_started_at (a few minutes after its start)
        // lands before the real wall-clock `Utc::now()` the resumed timer stamps
        // itself with. In production idle_started_at is always in the past by
        // the time idle_resolve runs (idle detection only fires after the user
        // returns); a unit test executing in microseconds can't reproduce that
        // gap starting from "now", so we push the entry's start back an hour.
        let backdated_start = e.started_at - chrono::Duration::hours(1);
        crate::repo::entries::update(&conn, e.id, &crate::domain::EntryEdit {
            category_id: e.category_id,
            project_id: e.project_id,
            started_at: backdated_start,
            ended_at: None,
            note: e.note.clone(),
        }).unwrap();
        let idle_start = backdated_start + chrono::Duration::minutes(5);
        idle_resolve_inner(&mut conn, e.id, "resume", idle_start).unwrap();
        let running = crate::repo::entries::running(&conn).unwrap().expect("new timer");
        assert_ne!(running.id, e.id);
        assert_eq!(running.category_id, coding());
        assert_eq!(running.note.as_deref(), Some("deep work"));
    }
}
