//! Sync engine.
//!
//! Pulls events from the active provider, applies the filter rules,
//! and reconciles with the local `time_entry` and
//! `pending_calendar_import` tables:
//!
//! - New event, no overlap → create entry.
//! - New event, overlaps a manual entry → queue a pending conflict.
//! - Existing entry sourced from event, not edited locally → update if changed.
//! - Existing entry source-linked, edited locally → leave alone.
//! - Existing source-linked entry, event no longer present → delete (if not edited).

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::Emitter;
use uuid::Uuid;

use crate::calendar::ics::{IcsCalendarConfig, IcsProvider};
use crate::calendar::oauth::{self, OAuthProvider, StoredTokens};
use crate::calendar::provider::CalendarProvider;
use crate::calendar::secret_store;
use crate::calendar::types::{CalendarEvent, CalendarSource, NewPendingImport};
use crate::db::Database;
use crate::domain::{EntryEdit, NewEntry};
use crate::error::{AppError, AppResult};
use crate::repo;

#[derive(Debug, Default, Clone, Serialize)]
pub struct SyncReport {
    pub created: u32,
    pub updated: u32,
    pub deleted: u32,
    pub conflicts: u32,
    pub skipped_filter: u32,
    pub skipped_edited: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct StoredOAuth {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_at: DateTime<Utc>,
    pub account_email: Option<String>,
}

/// Run a full sync against the currently-configured calendar source.
pub async fn sync_now(db: &Database, app: &tauri::AppHandle) -> AppResult<SyncReport> {
    let outcome = sync_inner(db).await;

    // Touch last_sync, emit event, return outcome.
    let conn = db.conn.lock().unwrap();
    match &outcome {
        Ok(_) => {
            let _ = repo::calendar_source::touch_last_sync(&conn, true, None);
        }
        Err(e) => {
            let _ = repo::calendar_source::touch_last_sync(&conn, false, Some(&e.to_string()));
        }
    }
    drop(conn);

    let _ = app.emit(
        "calendar-synced",
        serde_json::json!({
            "ok": outcome.is_ok(),
            "error": outcome.as_ref().err().map(|e| e.to_string()),
            "at": Utc::now().to_rfc3339(),
        }),
    );
    let _ = app.emit("entries-changed", ());
    let _ = app.emit("calendar-conflicts-changed", ());

    outcome
}

async fn sync_inner(db: &Database) -> AppResult<SyncReport> {
    // Snapshot config under the lock; release before async work.
    let (src, meeting_cat, since, until, enabled_ids) = {
        let conn = db.conn.lock().unwrap();
        let src = repo::calendar_source::get(&conn)?
            .ok_or_else(|| AppError::Invalid("no calendar source connected".into()))?;
        let meeting_cat: Option<String> = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'meeting_category_id'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let meeting_cat = meeting_cat
            .as_deref()
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| AppError::Invalid("meeting_category_id not set".into()))?;
        let backfill_days: String = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'initial_backfill_days'",
                [],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "14".into());
        let days: i64 = backfill_days.parse().unwrap_or(14);
        let now = Utc::now();
        let since = now - chrono::Duration::days(days);
        let until = now + chrono::Duration::hours(2);
        let enabled = repo::calendars::enabled_ids(&conn)?;
        (src, meeting_cat, since, until, enabled)
    };

    if enabled_ids.is_empty() {
        return Ok(SyncReport::default());
    }

    let provider = build_provider(&db, &src).await?;

    let mut report = SyncReport::default();
    let mut seen_ids: HashSet<(String, String)> = HashSet::new();

    for cal_id in &enabled_ids {
        let events = provider
            .fetch_events(cal_id, since, until)
            .await
            .map_err(|e| AppError::Other(format!("fetch {cal_id}: {e}")))?;
        let conn = db.conn.lock().unwrap();
        for ev in events {
            seen_ids.insert((ev.source_calendar_id.clone(), ev.source_event_id.clone()));
            if !passes_filter(&ev) {
                report.skipped_filter += 1;
                continue;
            }
            reconcile_event(&conn, &ev, meeting_cat, &mut report)?;
        }
        drop(conn);
    }

    // Delete entries whose source events were not seen in this sync (and weren't edited locally).
    let conn = db.conn.lock().unwrap();
    delete_unseen(&conn, &enabled_ids, since, until, &seen_ids, &mut report)?;
    drop(conn);

    Ok(report)
}

fn passes_filter(ev: &CalendarEvent) -> bool {
    !ev.is_all_day && ev.rsvp_accepted && ev.ended_at > ev.started_at
}

fn reconcile_event(
    conn: &rusqlite::Connection,
    ev: &CalendarEvent,
    meeting_category_id: Uuid,
    report: &mut SyncReport,
) -> AppResult<()> {
    let existing = repo::entries::find_by_source(conn, &ev.source_event_id, &ev.source_calendar_id)?;
    match existing {
        Some(e) if e.source_edited_locally => {
            report.skipped_edited += 1;
            Ok(())
        }
        Some(e) => {
            let unchanged = e.started_at == ev.started_at
                && e.ended_at == Some(ev.ended_at)
                && e.note.as_deref() == Some(ev.title.as_str());
            if unchanged {
                return Ok(());
            }
            let edit = EntryEdit {
                category_id: e.category_id, // keep whatever the user (or last sync) set
                project_id: e.project_id,
                started_at: ev.started_at,
                ended_at: Some(ev.ended_at),
                note: Some(ev.title.clone()),
            };
            match repo::entries::update(conn, e.id, &edit) {
                Ok(_) => {
                    report.updated += 1;
                    Ok(())
                }
                Err(AppError::Overlap) => {
                    // The updated time overlaps something else — log as conflict.
                    insert_conflict(conn, ev)?;
                    report.conflicts += 1;
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        None => {
            let new = NewEntry {
                category_id: meeting_category_id,
                project_id: None,
                started_at: ev.started_at,
                ended_at: Some(ev.ended_at),
                note: Some(ev.title.clone()),
                source: "calendar".into(),
                source_event_id: Some(ev.source_event_id.clone()),
                source_calendar_id: Some(ev.source_calendar_id.clone()),
            };
            match repo::entries::create(conn, &new) {
                Ok(_) => {
                    report.created += 1;
                    Ok(())
                }
                Err(AppError::Overlap) | Err(AppError::AlreadyRunning) => {
                    insert_conflict(conn, ev)?;
                    report.conflicts += 1;
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
    }
}

fn insert_conflict(conn: &rusqlite::Connection, ev: &CalendarEvent) -> AppResult<()> {
    // Skip if there's already a pending conflict for this (cal, event).
    let dup: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pending_calendar_import
         WHERE source_event_id = ?1 AND source_calendar_id = ?2 AND status = 'pending_conflict'",
        [&ev.source_event_id, &ev.source_calendar_id],
        |r| r.get(0),
    )?;
    if dup > 0 {
        return Ok(());
    }
    repo::pending_imports::insert(
        conn,
        &NewPendingImport {
            source_event_id: ev.source_event_id.clone(),
            source_calendar_id: ev.source_calendar_id.clone(),
            started_at: ev.started_at,
            ended_at: ev.ended_at,
            title: ev.title.clone(),
        },
    )?;
    Ok(())
}

fn delete_unseen(
    conn: &rusqlite::Connection,
    enabled_ids: &[String],
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    seen: &HashSet<(String, String)>,
    report: &mut SyncReport,
) -> AppResult<()> {
    if enabled_ids.is_empty() {
        return Ok(());
    }
    // Build "?,?,?" placeholder list for the IN clause.
    let placeholders = std::iter::repeat("?").take(enabled_ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, source_calendar_id, source_event_id
         FROM time_entry
         WHERE source = 'calendar'
           AND source_edited_locally = 0
           AND source_calendar_id IN ({placeholders})
           AND started_at >= ?{since_idx}
           AND started_at < ?{until_idx}",
        since_idx = enabled_ids.len() + 1,
        until_idx = enabled_ids.len() + 2,
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut params: Vec<rusqlite::types::Value> = enabled_ids
        .iter()
        .map(|s| rusqlite::types::Value::Text(s.clone()))
        .collect();
    params.push(rusqlite::types::Value::Text(since.to_rfc3339()));
    params.push(rusqlite::types::Value::Text(until.to_rfc3339()));
    let rows = stmt.query_map(rusqlite::params_from_iter(params), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut to_delete: Vec<Uuid> = Vec::new();
    for r in rows {
        let (id, cal, ev) = r?;
        if !seen.contains(&(cal, ev)) {
            if let Ok(uuid) = Uuid::parse_str(&id) {
                to_delete.push(uuid);
            }
        }
    }
    for id in to_delete {
        repo::entries::delete(conn, id)?;
        report.deleted += 1;
    }
    Ok(())
}

async fn build_provider(
    db: &Database,
    src: &CalendarSource,
) -> AppResult<Box<dyn CalendarProvider>> {
    match src.kind.as_str() {
        "ics" => {
            let configs_json = {
                let conn = db.conn.lock().unwrap();
                secret_store::get(&conn, &src.keychain_ref)?
                    .ok_or_else(|| AppError::Other("ICS configs missing from store".into()))?
            };
            let configs: Vec<IcsCalendarConfig> = serde_json::from_str(&configs_json)
                .map_err(|e| AppError::Other(format!("ICS configs parse: {e}")))?;
            Ok(Box::new(IcsProvider::new(configs)))
        }
        "oauth" => {
            let stored_json = {
                let conn = db.conn.lock().unwrap();
                secret_store::get(&conn, &src.keychain_ref)?
                    .ok_or_else(|| AppError::Other("OAuth tokens missing from store".into()))?
            };
            let mut stored: StoredOAuth = serde_json::from_str(&stored_json)
                .map_err(|e| AppError::Other(format!("OAuth tokens parse: {e}")))?;
            let client = reqwest::Client::new();
            if Utc::now() >= stored.access_expires_at - chrono::Duration::seconds(60) {
                let refreshed = oauth::refresh_access_token(&client, &stored.refresh_token).await?;
                stored = StoredOAuth {
                    access_token: refreshed.access_token,
                    refresh_token: refreshed.refresh_token,
                    access_expires_at: refreshed.access_expires_at,
                    account_email: stored.account_email.clone(),
                };
                let json = serde_json::to_string(&stored).unwrap();
                let conn = db.conn.lock().unwrap();
                secret_store::put(&conn, &src.keychain_ref, &json)?;
            }
            Ok(Box::new(OAuthProvider::new(stored.access_token)))
        }
        other => Err(AppError::Invalid(format!("unknown calendar kind: {other}"))),
    }
}

// `StoredTokens` is currently only used by `oauth.rs`; this `From` keeps the
// types aligned in case future code wants to convert.
impl From<StoredTokens> for StoredOAuth {
    fn from(t: StoredTokens) -> Self {
        Self {
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            access_expires_at: t.access_expires_at,
            account_email: None,
        }
    }
}
