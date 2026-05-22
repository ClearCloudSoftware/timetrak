//! Window-management Tauri commands.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub fn open_window(app: AppHandle, name: String) -> AppResult<()> {
    if name != "dashboard" && name != "settings" {
        return Err(AppError::Invalid(format!("unknown window: {name}")));
    }
    if let Some(w) = app.get_webview_window(&name) {
        w.show().map_err(|e| AppError::Other(e.to_string()))?;
        w.set_focus().map_err(|e| AppError::Other(e.to_string()))?;
        return Ok(());
    }
    let title = match name.as_str() {
        "dashboard" => "TimeTrak — Dashboard",
        "settings" => "TimeTrak — Settings",
        _ => "TimeTrak",
    };
    WebviewWindowBuilder::new(
        &app,
        &name,
        WebviewUrl::App(format!("index.html?window={name}").into()),
    )
    .title(title)
    .inner_size(900.0, 600.0)
    .build()
    .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}
