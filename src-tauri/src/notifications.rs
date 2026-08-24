use chrono::{NaiveTime, Utc};
use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::reporting;

pub struct NudgeConfig {
    pub enabled: bool,
    pub work_start: NaiveTime,
    pub work_end: NaiveTime,
}

fn meta_str(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn get_nudge_config(conn: &Connection) -> NudgeConfig {
    let time = |key: &str, default: &str| {
        NaiveTime::parse_from_str(&meta_str(conn, key).unwrap_or_else(|| default.into()), "%H:%M")
            .unwrap_or_else(|_| NaiveTime::parse_from_str(default, "%H:%M").unwrap())
    };
    NudgeConfig {
        enabled: meta_str(conn, "nudge_enabled").as_deref() == Some("1"),
        work_start: time("nudge_work_start", "09:00"),
        work_end: time("nudge_work_end", "18:00"),
    }
}

/// One nudge per hour, weekdays, inside [work_start, work_end), only while idle.
pub fn should_nudge(
    cfg: &NudgeConfig,
    now_local: chrono::NaiveDateTime,
    timer_running: bool,
    last_nudge: Option<chrono::NaiveDateTime>,
) -> bool {
    use chrono::Datelike;
    if !cfg.enabled || timer_running {
        return false;
    }
    if matches!(now_local.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
        return false;
    }
    let t = now_local.time();
    if t < cfg.work_start || t >= cfg.work_end {
        return false;
    }
    match last_nudge {
        Some(prev) => now_local - prev >= chrono::Duration::minutes(60),
        None => true,
    }
}

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
mod nudge_tests {
    use super::*;
    use chrono::{NaiveDateTime, NaiveTime};

    fn cfg() -> NudgeConfig {
        NudgeConfig {
            enabled: true,
            work_start: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            work_end: NaiveTime::from_hms_opt(18, 0, 0).unwrap(),
        }
    }
    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn nudges_on_a_weekday_in_work_hours_when_idle() {
        // 2026-08-24 is a Monday.
        assert!(should_nudge(&cfg(), dt("2026-08-24 10:00"), false, None));
    }
    #[test]
    fn never_nudges_when_disabled_running_offhours_or_weekend() {
        let mut off = cfg(); off.enabled = false;
        assert!(!should_nudge(&off, dt("2026-08-24 10:00"), false, None));
        assert!(!should_nudge(&cfg(), dt("2026-08-24 10:00"), true, None));      // timer running
        assert!(!should_nudge(&cfg(), dt("2026-08-24 08:59"), false, None));     // before start
        assert!(!should_nudge(&cfg(), dt("2026-08-24 18:00"), false, None));     // at/after end
        assert!(!should_nudge(&cfg(), dt("2026-08-23 10:00"), false, None));     // Sunday
    }
    #[test]
    fn rate_limited_to_once_per_hour() {
        assert!(!should_nudge(&cfg(), dt("2026-08-24 10:30"), false, Some(dt("2026-08-24 10:00"))));
        assert!(should_nudge(&cfg(), dt("2026-08-24 11:00"), false, Some(dt("2026-08-24 10:00"))));
    }
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
