/**
 * Canonical Tauri event names emitted by the backend.
 *
 * Strings live here so a typo can only happen once. The Rust side mirrors
 * these in `src-tauri/src/events.rs`; the INDEX table documents the pairing.
 */
export const EVENT_TIMER_CHANGED = 'timer-changed' as const;
export const EVENT_ENTRIES_CHANGED = 'entries-changed' as const;
export const EVENT_CATEGORIES_CHANGED = 'categories-changed' as const;
export const EVENT_PROJECTS_CHANGED = 'projects-changed' as const;
