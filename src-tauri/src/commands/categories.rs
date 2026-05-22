use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::Category;
use crate::error::AppResult;
use crate::repo;

#[tauri::command]
pub fn list_categories(db: State<'_, Database>) -> AppResult<Vec<Category>> {
    let conn = db.conn.lock().unwrap();
    repo::categories::list(&conn)
}

#[tauri::command]
pub fn create_category(
    app: AppHandle,
    db: State<'_, Database>,
    name: String,
    color: String,
) -> AppResult<Category> {
    let conn = db.conn.lock().unwrap();
    let c = repo::categories::create(&conn, &name, &color)?;
    let _ = app.emit(crate::events::CATEGORIES_CHANGED, ());
    Ok(c)
}

#[tauri::command]
pub fn update_category(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    name: String,
    color: String,
) -> AppResult<Category> {
    let conn = db.conn.lock().unwrap();
    let c = repo::categories::update(&conn, id, &name, &color)?;
    let _ = app.emit(crate::events::CATEGORIES_CHANGED, ());
    Ok(c)
}

#[tauri::command]
pub fn delete_category(
    app: AppHandle,
    db: State<'_, Database>,
    id: Uuid,
    cascade_entries: bool,
) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    repo::categories::delete(&conn, id, cascade_entries)?;
    let _ = app.emit(crate::events::CATEGORIES_CHANGED, ());
    if cascade_entries {
        // Cascade also removed time_entry rows referencing this category.
        let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
    }
    Ok(())
}
