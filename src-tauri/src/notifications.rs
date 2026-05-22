use chrono::{NaiveTime, Utc};
use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::reporting;

pub fn get_summary_time(conn: &Connection) -> AppResult<NaiveTime> {
    let s: Option<String> = conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'daily_summary_time'",
        [],
        |r| r.get(0),
    ).optional()?;
    let s = s.unwrap_or_else(|| "18:00".into());
    NaiveTime::parse_from_str(&s, "%H:%M").map_err(|e| AppError::Other(e.to_string()))
}

pub fn get_last_summary_date(conn: &Connection) -> AppResult<Option<String>> {
    let s: Option<String> = conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'last_summary_date'",
        [],
        |r| r.get(0),
    ).optional()?;
    Ok(s)
}

pub fn set_last_summary_date(conn: &Connection, date_iso: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('last_summary_date', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [date_iso],
    )?;
    Ok(())
}

pub fn build_summary_body(conn: &Connection) -> AppResult<String> {
    let tz = local_tz();
    let totals = reporting::today_totals(conn, tz)?;
    if totals.is_empty() {
        return Ok("No time tracked today.".into());
    }
    let parts: Vec<String> = totals
        .into_iter()
        .map(|(c, secs)| format!("{} {}", c.name, fmt_hm(secs)))
        .collect();
    Ok(format!("Today: {}", parts.join(" · ")))
}

fn fmt_hm(seconds: i64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    if h > 0 { format!("{}h{:02}m", h, m) } else { format!("{}m", m) }
}

fn local_tz() -> chrono_tz::Tz {
    // System tz detection isn't in chrono-tz; fall back to UTC for v1.
    // Users can override via app_meta.local_tz in a follow-up.
    chrono_tz::UTC
}

pub fn today_iso() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Spawns a tokio task that wakes once per minute, checks whether the
/// summary time has passed for "today", and posts a notification if it
/// hasn't already been posted today.
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = tick(&app).await {
                eprintln!("notification scheduler error: {e}");
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

async fn tick(app: &AppHandle) -> AppResult<()> {
    let db: tauri::State<'_, crate::db::Database> = app.state();
    let conn = db.conn.lock().unwrap();
    let summary_time = get_summary_time(&conn)?;
    let now = chrono::Local::now().time();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if now < summary_time { return Ok(()); }
    if get_last_summary_date(&conn)?.as_deref() == Some(today.as_str()) {
        return Ok(());
    }
    let body = build_summary_body(&conn)?;
    set_last_summary_date(&conn, &today)?;
    drop(conn);

    let _ = app
        .notification()
        .builder()
        .title("TimeTrak — daily summary")
        .body(&body)
        .show();
    let _ = Arc::new(()); // keep import warning quiet if unused
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn default_summary_time_is_1800() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let t = get_summary_time(&conn).unwrap();
        assert_eq!(t, NaiveTime::from_hms_opt(18, 0, 0).unwrap());
    }

    #[test]
    fn last_summary_date_round_trip() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(get_last_summary_date(&conn).unwrap().is_none());
        set_last_summary_date(&conn, "2026-05-22").unwrap();
        assert_eq!(get_last_summary_date(&conn).unwrap().as_deref(), Some("2026-05-22"));
    }

    #[test]
    fn build_summary_body_empty() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let body = build_summary_body(&conn).unwrap();
        assert!(body.contains("No time"));
    }
}
