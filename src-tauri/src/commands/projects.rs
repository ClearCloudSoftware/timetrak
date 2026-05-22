use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::Project;
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn list_projects(db: State<'_, Database>) -> AppResult<Vec<Project>> {
    let conn = db.conn.lock().unwrap();
    repo::projects::list(&conn)
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    db: State<'_, Database>,
    name: String,
    color: String,
) -> AppResult<Project> {
    let conn = db.conn.lock().unwrap();
    let p = repo::projects::create(&conn, &name, &color)?;
    let _ = app.emit("entries-changed", ());
    Ok(p)
}

#[tauri::command]
pub fn update_project(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    name: String,
    color: String,
) -> AppResult<Project> {
    let conn = db.conn.lock().unwrap();
    let p = repo::projects::update(&conn, id, &name, &color)?;
    let _ = app.emit("entries-changed", ());
    Ok(p)
}

#[tauri::command]
pub fn delete_project(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    repo::projects::delete(&conn, id)?;
    let _ = app.emit("entries-changed", ());
    Ok(())
}
