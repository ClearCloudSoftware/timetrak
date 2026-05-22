#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use timetrak_lib::db::Database;

const TRAY_WINDOW_LABEL: &str = "tray";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(timetrak_lib::timetrak_handlers!())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Database
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let db = Database::open(&data_dir.join("timetrak.sqlite"))
                .expect("open database");
            app.manage(db);
            timetrak_lib::notifications::spawn_scheduler(app.handle().clone());

            // Tray menu
            let show_dashboard = MenuItem::with_id(app, "show_dashboard", "Show Dashboard", true, None::<&str>)?;
            let show_settings = MenuItem::with_id(app, "show_settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_dashboard, &show_settings, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon({
                    #[cfg(target_os = "macos")]
                    {
                        tauri::image::Image::from_path("icons/tray-template.png").unwrap()
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        tauri::image::Image::from_path("icons/tray.ico").unwrap()
                    }
                })
                .icon_as_template(cfg!(target_os = "macos"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_dashboard" => { let _ = timetrak_lib::commands::windows::open_window(app.clone(), "dashboard".into()); }
                    "show_settings" => { let _ = timetrak_lib::commands::windows::open_window(app.clone(), "settings".into()); }
                    "quit" => { app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        toggle_tray_window(app, Some(rect));
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

const POPOVER_W: f64 = 340.0;
const POPOVER_H: f64 = 440.0;

fn toggle_tray_window(app: &tauri::AppHandle, tray_rect: Option<tauri::Rect>) {
    let position = tray_rect.map(compute_popover_position);

    if let Some(w) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            return;
        }
        if let Some(p) = position {
            let _ = w.set_position(p);
        }
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        TRAY_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=tray".into()),
    )
    .inner_size(POPOVER_W, POPOVER_H)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true);
    if let Some(p) = position {
        builder = builder.position(p.x, p.y);
    }
    if let Ok(window) = builder.build() {
        // Hide the popover when it loses focus — clicking outside (or opening
        // another window via the header icons) auto-dismisses it.
        let win_for_blur = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = win_for_blur.hide();
            }
        });
    }
}

#[cfg(target_os = "macos")]
fn compute_popover_position(rect: tauri::Rect) -> tauri::PhysicalPosition<f64> {
    let pos = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    let x = pos.x + (size.width / 2.0) - (POPOVER_W / 2.0);
    let y = pos.y + size.height + 4.0;
    tauri::PhysicalPosition::new(x, y)
}

#[cfg(not(target_os = "macos"))]
fn compute_popover_position(rect: tauri::Rect) -> tauri::PhysicalPosition<f64> {
    // Windows: taskbar at the bottom by default, so position the popover above the tray icon.
    let pos = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    let x = pos.x + (size.width / 2.0) - (POPOVER_W / 2.0);
    let y = pos.y - POPOVER_H - 4.0;
    tauri::PhysicalPosition::new(x, y)
}

