//! Canonical Tauri event names emitted by the backend.
//!
//! Strings live here so a typo can only happen once. The TS side mirrors
//! these in `src/lib/event-names.ts`; the INDEX table documents the pairing.

pub const TIMER_CHANGED: &str = "timer-changed";
pub const ENTRIES_CHANGED: &str = "entries-changed";
pub const CATEGORIES_CHANGED: &str = "categories-changed";
pub const PROJECTS_CHANGED: &str = "projects-changed";
pub const IDLE_DETECTED: &str = "idle-detected";
