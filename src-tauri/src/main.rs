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
            app.manage(timetrak_lib::commands::windows::PendingNewEntry::default());
            app.manage(timetrak_lib::commands::calendar::DeviceCodeState(std::sync::Mutex::new(None)));

            let scheduler = std::sync::Arc::new(timetrak_lib::calendar::scheduler::Scheduler::new());
            app.manage(scheduler.clone());
            scheduler.spawn(app.handle().clone());
            timetrak_lib::notifications::spawn_scheduler(app.handle().clone());

            // Tray menu
            let show_dashboard = MenuItem::with_id(app, "show_dashboard", "Show Dashboard", true, None::<&str>)?;
            let show_settings = MenuItem::with_id(app, "show_settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_dashboard, &show_settings, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon({
                    // Embedded at compile time: a cwd-relative from_path works in
                    // `tauri dev` (cwd = src-tauri) but panics in a bundled .app
                    // (cwd = /), killing the app before the icon ever appears.
                    #[cfg(target_os = "macos")]
                    {
                        tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))
                            .expect("embedded tray icon")
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        tauri::image::Image::from_bytes(include_bytes!("../icons/tray.ico"))
                            .expect("embedded tray icon")
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

            // Live timer readout next to the menu bar icon (macOS). Refreshes
            // on timer changes and every 30s for the minute rollover.
            {
                use tauri::Listener;
                let handle = app.handle().clone();
                app.listen(timetrak_lib::events::TIMER_CHANGED, move |_| update_tray_title(&handle));
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    update_tray_title(&handle);
                    std::thread::sleep(std::time::Duration::from_secs(30));
                });
            }

            // Idle detection: poll while a timer runs; prompt when the user returns.
            #[cfg(target_os = "macos")]
            {
                use tauri::Emitter;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut watcher = timetrak_lib::idle::IdleWatcher::new();
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(15));
                        let (running, threshold_secs) = {
                            let db = handle.state::<Database>();
                            let conn = db.conn.lock().unwrap();
                            let running = timetrak_lib::timer::state(&conn).ok().and_then(|s| s.running);
                            let mins: f64 = conn
                                .query_row(
                                    "SELECT value FROM app_meta WHERE key = 'idle_threshold_minutes'",
                                    [],
                                    |r| r.get::<_, String>(0),
                                )
                                .ok()
                                .and_then(|s| s.parse().ok())
                                .unwrap_or(10.0);
                            (running, mins * 60.0)
                        };
                        let action = watcher.observe(
                            chrono::Utc::now(),
                            system_idle_seconds(),
                            threshold_secs,
                            running.is_some(),
                        );
                        if let timetrak_lib::idle::IdleAction::Prompt { idle_started_at } = action {
                            if let Some(entry) = running {
                                let _ = handle.emit(
                                    timetrak_lib::events::IDLE_DETECTED,
                                    serde_json::json!({
                                        "entry_id": entry.id.to_string(),
                                        "idle_started_at": idle_started_at.to_rfc3339(),
                                    }),
                                );
                                use tauri_plugin_notification::NotificationExt;
                                let _ = handle
                                    .notification()
                                    .builder()
                                    .title("Were you away?")
                                    .body("A timer kept running while you were idle.")
                                    .show();
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn system_idle_seconds() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    // 1 = kCGEventSourceStateCombinedSessionState, u32::MAX = kCGAnyInputEventType
    unsafe { CGEventSourceSecondsSinceLastEventType(1, u32::MAX) }
}

/// Set the menu bar title to the running timer's elapsed time ("1:42"), or
/// clear it when idle. macOS only — other platforms have no tray title.
fn update_tray_title(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let title = {
            let db = app.state::<Database>();
            let conn = db.conn.lock().unwrap();
            timetrak_lib::timer::state(&conn).ok().and_then(|s| s.running).map(|e| {
                let mins = (chrono::Utc::now() - e.started_at).num_minutes().max(0);
                format!("{}:{:02}", mins / 60, mins % 60)
            })
        };
        if let Some(tray) = app.tray_by_id("main-tray") {
            let _ = tray.set_title(title);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
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
    .transparent(cfg!(target_os = "macos"))
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true);
    if let Some(p) = position {
        builder = builder.position(p.x, p.y);
    }
    match builder.build() {
        Ok(window) => {
            // Native menu-bar-popover material: vibrancy + rounded corners. The
            // 13px radius matches the root div's border-radius in TrayPopover.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Popover, None, Some(13.0));
            }
            // Hide the popover when it loses focus — clicking outside (or opening
            // another window via the header icons) auto-dismisses it.
            let win_for_blur = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = win_for_blur.hide();
                }
            });
        }
        Err(e) => {
            // The tray icon is the app's only entry point (LSUIElement). A
            // silent failure here would leave clicks doing nothing — log so
            // the issue surfaces in `npm run tauri dev` output.
            eprintln!("failed to build tray popover window: {e}");
        }
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

