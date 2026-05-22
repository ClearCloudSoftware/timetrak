#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use timetrak_lib::db::Database;

const TRAY_WINDOW_LABEL: &str = "tray";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(timetrak_lib::timetrak_handlers!())
        .setup(|app| {
            // Database
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let db = Database::open(&data_dir.join("timetrak.sqlite"))
                .expect("open database");
            app.manage(db);

            // Tray menu
            let show_dashboard = MenuItem::with_id(app, "show_dashboard", "Show Dashboard", true, None::<&str>)?;
            let show_settings = MenuItem::with_id(app, "show_settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_dashboard, &show_settings, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_dashboard" => { let _ = open_window(app, "dashboard"); }
                    "show_settings" => { let _ = open_window(app, "settings"); }
                    "quit" => { app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        toggle_tray_window(app);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_tray_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        TRAY_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=tray".into()),
    )
    .inner_size(340.0, 440.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .build();
}

fn open_window(app: &tauri::AppHandle, name: &str) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(name) {
        w.show()?;
        w.set_focus()?;
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
        WebviewUrl::App(format!("index.html?window={}", name).into()),
    )
    .title(title)
    .inner_size(900.0, 600.0)
    .build()?;
    Ok(())
}
