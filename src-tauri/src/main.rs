#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use timetrak_lib::db::Database;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db_path = data_dir.join("timetrak.sqlite");
            let db = Database::open(&db_path)
                .expect("failed to open database");
            app.manage(db);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
