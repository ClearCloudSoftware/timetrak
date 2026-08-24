//! Each follow-up plan adds its command handlers to its own submodule
//! and registers them in `register_handlers` below.

pub mod backup;
pub mod calendar;
pub mod categories;
pub mod entries;
pub mod export;
pub mod prefs;
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
            timetrak_lib::commands::timer::idle_resolve,
            timetrak_lib::commands::entries::list_entries,
            timetrak_lib::commands::entries::create_entry,
            timetrak_lib::commands::entries::update_entry,
            timetrak_lib::commands::entries::delete_entry,
            timetrak_lib::commands::entries::list_recent_combos,
            timetrak_lib::commands::export::export_csv,
            timetrak_lib::commands::prefs::get_pref,
            timetrak_lib::commands::prefs::set_pref,
            timetrak_lib::commands::categories::list_categories,
            timetrak_lib::commands::categories::create_category,
            timetrak_lib::commands::categories::update_category,
            timetrak_lib::commands::categories::delete_category,
            timetrak_lib::commands::categories::goals_list,
            timetrak_lib::commands::categories::goal_set,
            timetrak_lib::commands::projects::list_projects,
            timetrak_lib::commands::projects::create_project,
            timetrak_lib::commands::projects::update_project,
            timetrak_lib::commands::projects::delete_project,
            timetrak_lib::commands::windows::open_window,
            timetrak_lib::commands::windows::request_new_entry,
            timetrak_lib::commands::windows::consume_pending_new_entry,
            timetrak_lib::commands::calendar::calendar_status,
            timetrak_lib::commands::calendar::set_meeting_category,
            timetrak_lib::commands::calendar::set_initial_backfill_days,
            timetrak_lib::commands::calendar::set_poll_interval_minutes,
            timetrak_lib::commands::calendar::set_extend_meeting_minutes,
            timetrak_lib::commands::calendar::calendar_connect_ics,
            timetrak_lib::commands::calendar::calendar_connect_start,
            timetrak_lib::commands::calendar::calendar_connect_complete,
            timetrak_lib::commands::calendar::calendar_disconnect,
            timetrak_lib::commands::calendar::calendar_list_calendars,
            timetrak_lib::commands::calendar::calendar_toggle_calendar,
            timetrak_lib::commands::calendar::calendar_sync_now,
            timetrak_lib::commands::calendar::pending_conflicts_list,
            timetrak_lib::commands::calendar::pending_conflict_resolve,
            timetrak_lib::calendar::scheduler::calendar_extend,
            timetrak_lib::calendar::scheduler::calendar_stop_meeting,
            timetrak_lib::calendar::scheduler::calendar_undo_switch,
            timetrak_lib::commands::backup::backup_db,
            timetrak_lib::commands::backup::restore_db,
            // (other plans append here)
        ]
    };
}
