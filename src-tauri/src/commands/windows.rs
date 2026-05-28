//! Window-management Tauri commands.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

/// Flag the dashboard reads on first mount to decide whether the editor should
/// auto-open in create mode. Set by `request_new_entry`, cleared by
/// `consume_pending_new_entry`.
#[derive(Default)]
pub struct PendingNewEntry(pub Mutex<bool>);

#[tauri::command]
pub fn open_window(app: AppHandle, name: String) -> AppResult<()> {
    open_window_internal(&app, &name)
}

fn open_window_internal(app: &AppHandle, name: &str) -> AppResult<()> {
    if name != "dashboard" && name != "settings" {
        return Err(AppError::Invalid(format!("unknown window: {name}")));
    }
    if let Some(w) = app.get_webview_window(name) {
        w.show().map_err(|e| AppError::Other(e.to_string()))?;
        w.set_focus().map_err(|e| AppError::Other(e.to_string()))?;
        return Ok(());
    }
    let title = match name {
        "dashboard" => "TimeTrak — Dashboard",
        "settings" => "TimeTrak — Settings",
        _ => "TimeTrak",
    };
    WebviewWindowBuilder::new(
        app,
        name,
        WebviewUrl::App(format!("index.html?window={name}").into()),
    )
    .title(title)
    .inner_size(900.0, 600.0)
    .build()
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Open the dashboard window and instruct it to open the entry editor in
/// create mode. Works whether or not the window already exists:
/// - Sets a pending flag the dashboard reads on first mount.
/// - Emits an event the dashboard listens for if it's already open.
#[tauri::command]
pub fn request_new_entry(app: AppHandle, pending: State<'_, PendingNewEntry>) -> AppResult<()> {
    *pending.0.lock().unwrap() = true;
    open_window_internal(&app, "dashboard")?;
    let _ = app.emit("open-new-entry", ());
    Ok(())
}

#[tauri::command]
pub fn consume_pending_new_entry(pending: State<'_, PendingNewEntry>) -> AppResult<bool> {
    let mut guard = pending.0.lock().unwrap();
    let was = *guard;
    *guard = false;
    Ok(was)
}
