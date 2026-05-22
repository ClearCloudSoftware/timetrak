//! Each follow-up plan adds its command handlers to its own submodule
//! and registers them in `register_handlers` below.

pub mod categories;
pub mod entries;
pub mod export;
pub mod projects;
pub mod timer;

/// Builds the Tauri invoke_handler. Add new command functions to the
/// `tauri::generate_handler!` list as follow-up plans land.
#[macro_export]
macro_rules! timetrak_handlers {
    () => {
        tauri::generate_handler![
            // categories
            // crate::commands::categories::list_categories,
            // crate::commands::categories::create_category,
            // ...
            // (Each follow-up plan uncomments / adds entries here.)
        ]
    };
}
