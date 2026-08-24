//! Calendar scheduler.
//!
//! Runs in the background:
//! - Every 30 minutes: triggers a sync against the active source.
//! - After each successful sync: schedules a precise Tokio wake-up at
//!   each upcoming meeting's start time to perform the auto-switch,
//!   and another at the meeting's end for the Stop/Extend prompt.
//! - The user can also click "Sync now" in Settings, which triggers a
//!   sync directly and then refreshes scheduled wake-ups.
//!
//! The scheduler is robust to: connect/disconnect, calendar enable/disable,
//! manual edits (which detach an entry from the source), and app restart
//! (everything is rederived from DB state on startup).

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

use crate::calendar::sync;
use crate::db::Database;
use crate::error::AppResult;
use crate::repo;

const DEFAULT_POLL_MINUTES: u64 = 30;
const DEFAULT_EXTEND_MINUTES: u64 = 15;

fn read_minutes(app: &AppHandle, key: &str, default: u64) -> u64 {
    let db = app.state::<Database>();
    let conn = db.conn.lock().unwrap();
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.parse::<u64>().ok())
    .filter(|n| *n >= 1)
    .unwrap_or(default)
}

#[derive(Default)]
pub struct Scheduler {
    /// Per-event abort handles for auto-switch wake-ups, keyed by entry id (the
    /// time_entry's UUID after auto-switch creates it) or by source key
    /// (source_calendar_id, source_event_id).
    handles: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn the long-running scheduler loop. Owned by the app for its lifetime.
    pub fn spawn(self: Arc<Self>, app: AppHandle) {
        let app_for_task = app.clone();
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if let Err(e) = me.run_one_cycle(&app_for_task).await {
                    eprintln!("scheduler cycle error: {e}");
                }
                let minutes = read_minutes(&app_for_task, "poll_interval_minutes", DEFAULT_POLL_MINUTES);
                sleep(Duration::from_secs(minutes * 60)).await;
            }
        });
    }

    /// One iteration: sync (if connected) + schedule precise wake-ups for known upcoming events.
    async fn run_one_cycle(&self, app: &AppHandle) -> AppResult<()> {
        if !is_connected(app) {
            return Ok(());
        }
        let db = app.state::<Database>();
        let _ = sync::sync_now(&db, app).await; // errors get logged via touch_last_sync

        self.reschedule_upcoming(app).await
    }

    /// Cancel existing per-event timers and schedule new ones from current DB state.
    pub async fn reschedule_upcoming(&self, app: &AppHandle) -> AppResult<()> {
        // Cancel everything previously scheduled.
        {
            let mut handles = self.handles.lock().await;
            for (_, h) in handles.drain() {
                h.abort();
            }
        }

        // Snapshot rows (in-progress + upcoming) in a tight scope so the
        // connection lock is released before any .await.
        let now = Utc::now();
        let (rows, running) = {
            let db = app.state::<Database>();
            let conn = db.conn.lock().unwrap();
            let rows = repo::entries::calendar_entries_active_or_upcoming(&conn, now)?;
            let running = repo::entries::running(&conn)?;
            (rows, running)
        };

        for (id, started_at, ended_at) in rows {
            if started_at > now {
                self.schedule_start(app.clone(), id, started_at).await;
            } else if running.is_none() {
                // Meeting already in progress (e.g. imported mid-meeting by a
                // manual sync): switch to it immediately — but never hijack a
                // timer that is already running.
                self.schedule_start(app.clone(), id, now).await;
            }
            self.schedule_end_prompt(app.clone(), id, ended_at).await;
        }

        Ok(())
    }

    async fn schedule_start(&self, app: AppHandle, entry_id: Uuid, when: DateTime<Utc>) {
        let now = Utc::now();
        let delay = (when - now).to_std().unwrap_or(Duration::from_millis(0));
        let key = format!("start:{entry_id}");
        let app_for_task = app.clone();
        let handle = tauri::async_runtime::spawn(async move {
            sleep(delay).await;
            let _ = auto_switch_to(&app_for_task, entry_id).await;
        });
        let mut map = self.handles.lock().await;
        if let Some(prev) = map.insert(key, handle) {
            prev.abort();
        }
    }

    async fn schedule_end_prompt(&self, app: AppHandle, entry_id: Uuid, when: DateTime<Utc>) {
        let now = Utc::now();
        let delay = (when - now).to_std().unwrap_or(Duration::from_millis(0));
        let key = format!("end:{entry_id}");
        let app_for_task = app.clone();
        let handle = tauri::async_runtime::spawn(async move {
            sleep(delay).await;
            send_stop_extend_prompt(&app_for_task, entry_id);
        });
        let mut map = self.handles.lock().await;
        if let Some(prev) = map.insert(key, handle) {
            prev.abort();
        }
    }

    /// Extend the currently-running entry by N minutes (configurable) and re-fire the prompt.
    pub async fn schedule_extend(&self, app: AppHandle, entry_id: Uuid) {
        let minutes = read_minutes(&app, "extend_meeting_minutes", DEFAULT_EXTEND_MINUTES);
        let key = format!("end:{entry_id}");
        let app_for_task = app.clone();
        let handle = tauri::async_runtime::spawn(async move {
            sleep(Duration::from_secs(minutes * 60)).await;
            send_stop_extend_prompt(&app_for_task, entry_id);
        });
        let mut map = self.handles.lock().await;
        if let Some(prev) = map.insert(key, handle) {
            prev.abort();
        }
    }

    /// Cancel all wake-ups (called on disconnect).
    pub async fn clear_all(&self) {
        let mut map = self.handles.lock().await;
        for (_, h) in map.drain() {
            h.abort();
        }
    }
}

fn is_connected(app: &AppHandle) -> bool {
    let db = app.state::<Database>();
    let conn = db.conn.lock().unwrap();
    repo::calendar_source::get(&conn).ok().flatten().is_some()
}

#[derive(Serialize, Clone)]
pub struct AutoSwitchPayload {
    pub entry_id: String,
    pub previous_entry_id: Option<String>,
}

/// Perform the auto-switch: stop the currently-running entry (if any),
/// and ensure the meeting entry is the active one. Because the meeting
/// entry was created with both `started_at` and `ended_at` set during
/// sync, the user's "running" semantics need a small adjustment: we
/// re-open the meeting entry as the running entry until its scheduled
/// end (or until the user stops it).
async fn auto_switch_to(app: &AppHandle, entry_id: Uuid) -> AppResult<()> {
    let db = app.state::<Database>();
    let mut conn = db.conn.lock().unwrap();
    let entry = match repo::entries::find(&conn, entry_id) {
        Ok(e) => e,
        Err(_) => return Ok(()), // entry was deleted before we fired
    };
    if entry.source_edited_locally || entry.source.as_str() != "calendar" {
        return Ok(());
    }
    let tx = conn.transaction()?;
    let previous = repo::entries::stop_running_now(&tx, Utc::now())?;
    // Re-open the meeting entry as running (ended_at = NULL) for the
    // duration of the meeting. The user can press Stop early or let
    // the end-prompt fire.
    tx.execute(
        "UPDATE time_entry SET ended_at = NULL WHERE id = ?1",
        [entry_id.to_string()],
    )?;
    tx.commit()?;
    drop(conn);

    let payload = AutoSwitchPayload {
        entry_id: entry_id.to_string(),
        previous_entry_id: previous.as_ref().map(|p| p.id.to_string()),
    };
    let _ = app.emit("calendar-auto-switched", payload);
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());

    // Trigger notification with Undo
    let body = entry.note.unwrap_or_else(|| "Meeting".into());
    let _ = post_undo_notification(app, &body);
    Ok(())
}

fn post_undo_notification(app: &AppHandle, body: &str) -> AppResult<()> {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Started")
        .body(format!("Auto-started: {body}"))
        .show();
    Ok(())
}

#[derive(Serialize, Clone)]
pub struct StopExtendPayload {
    pub entry_id: String,
    pub title: Option<String>,
}

fn send_stop_extend_prompt(app: &AppHandle, entry_id: Uuid) {
    // Only fire if the meeting entry is still the running one.
    let db = app.state::<Database>();
    let conn = db.conn.lock().unwrap();
    let running = repo::entries::running(&conn).ok().flatten();
    drop(conn);
    let Some(r) = running else { return };
    if r.id != entry_id {
        return;
    }

    let payload = StopExtendPayload {
        entry_id: entry_id.to_string(),
        title: r.note.clone(),
    };
    let _ = app.emit("calendar-meeting-ended", payload);

    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Meeting ended")
        .body(format!(
            "{} — Stop or Extend 15 min?",
            r.note.as_deref().unwrap_or("Meeting")
        ))
        .show();
}

// ---------- Tauri command surface ----------

#[tauri::command]
pub async fn calendar_extend(app: AppHandle, entry_id: Uuid) -> AppResult<()> {
    // Push the running entry's scheduled end out by 15 min in the DB,
    // and re-arm the Stop/Extend wake-up.
    {
        let db = app.state::<Database>();
        let conn = db.conn.lock().unwrap();
        // For an extension, we adjust the implicit "scheduled end" by
        // updating any future end timer. Since ended_at is NULL while
        // running, there's no DB change here — the next prompt fires
        // EXTEND_AGAIN_SECS from now.
        let _ = repo::entries::find(&conn, entry_id).map_err(|e| e)?;
    }
    let sched = app.state::<Arc<Scheduler>>();
    sched.schedule_extend(app.clone(), entry_id).await;
    Ok(())
}

#[tauri::command]
pub async fn calendar_stop_meeting(app: AppHandle, entry_id: Uuid) -> AppResult<()> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().unwrap();
    let running = repo::entries::running(&conn).ok().flatten();
    drop(conn);
    if let Some(r) = running {
        if r.id == entry_id {
            let conn = db.conn.lock().unwrap();
            let _ = repo::entries::stop_running_now(&conn, Utc::now())?;
        }
    }
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub async fn calendar_undo_switch(
    app: AppHandle,
    entry_id: Uuid,
    previous_entry_id: Option<Uuid>,
) -> AppResult<()> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().unwrap();
    // Undo only if the meeting entry is still the running one — if the user
    // has since started something else, leave it alone.
    let running = repo::entries::running(&conn).ok().flatten();
    if running.is_some_and(|r| r.id == entry_id) {
        let _ = repo::entries::stop_running_now(&conn, Utc::now())?;
        // Reopen the previous entry as running if provided.
        if let Some(pid) = previous_entry_id {
            let _ = conn.execute(
                "UPDATE time_entry SET ended_at = NULL WHERE id = ?1",
                [pid.to_string()],
            );
        }
    }
    drop(conn);
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
    Ok(())
}
