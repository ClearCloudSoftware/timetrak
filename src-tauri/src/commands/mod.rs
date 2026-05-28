//! Each follow-up plan adds its command handlers to its own submodule
//! and registers them in `register_handlers` below.

pub mod calendar;
pub mod categories;
pub mod entries;
pub mod export;
pub mod projects;
pub mod timer;
pub mod windows;

/// Builds the Tauri invoke_handler. Add new command functions to the
/// `tauri::generate_handler!` list as follow-up plans land.
#[macro_export]
macro_rules! timetrak_handlers {
    () => {
        tauri::generate_handler![
            timetrak_lib::commands::timer::get_timer_state,
            timetrak_lib::commands::timer::start_timer,
            timetrak_lib::commands::timer::stop_timer,
            timetrak_lib::commands::timer::switch_timer,
            timetrak_lib::commands::entries::list_entries,
            timetrak_lib::commands::entries::create_entry,
            timetrak_lib::commands::entries::update_entry,
            timetrak_lib::commands::entries::delete_entry,
            timetrak_lib::commands::export::export_csv,
            timetrak_lib::commands::categories::list_categories,
            timetrak_lib::commands::categories::create_category,
            timetrak_lib::commands::categories::update_category,
            timetrak_lib::commands::categories::delete_category,
            timetrak_lib::commands::projects::list_projects,
            timetrak_lib::commands::projects::create_project,
            timetrak_lib::commands::projects::update_project,
            timetrak_lib::commands::projects::delete_project,
            timetrak_lib::commands::windows::open_window,
            timetrak_lib::commands::windows::request_new_entry,
            timetrak_lib::commands::windows::consume_pending_new_entry,
            timetrak_lib::commands::calendar::calendar_status,
            timetrak_lib::commands::calendar::set_meeting_category,
            // (other plans append here)
        ]
    };
}
