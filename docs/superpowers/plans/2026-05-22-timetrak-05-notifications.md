# TimeTrak — Daily Summary Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Post a daily end-of-day notification with today's totals at the user-configured time, idempotent across relaunches.

**Depends on:** tag `data-layer-complete`.

**Touches:**
- `src-tauri/src/notifications.rs`
- `src-tauri/src/main.rs` (spawn task — append-only)

**Parallel-safe with:** plans 02, 03, 04.

---

## Task 1: Helpers in `app_meta`

**Files:**
- Modify: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Implement meta helpers and totals lookup**

Replace `src-tauri/src/notifications.rs` with:

```rust
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
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib notifications::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/notifications.rs
git commit -m "feat: notification helpers and summary body builder"
```

---

## Task 2: Scheduler task

**Files:**
- Modify: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Add the scheduler entry point** — append to `notifications.rs`:

```rust
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
```

> If `chrono::Local` is missing, add `local` feature: in `Cargo.toml` change the chrono line to:
> ```toml
> chrono = { version = "0.4", features = ["serde", "clock"] }
> ```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/notifications.rs src-tauri/Cargo.toml
git commit -m "feat: notification scheduler tick loop"
```

---

## Task 3: Wire scheduler into setup

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: In `setup`, after `app.manage(db)`, add**

```rust
            timetrak_lib::notifications::spawn_scheduler(app.handle().clone());
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: ok.

- [ ] **Step 3: Smoke test (optional manual)**

Set the summary time to a minute from now via the SQLite CLI:

```sh
sqlite3 ~/Library/Application\ Support/com.timetrak.app/timetrak.sqlite \
  "UPDATE app_meta SET value = '<HH:MM one minute from now>' WHERE key='daily_summary_time';"
```

Run: `npm run tauri dev`
Expected: within ~60s a system notification appears.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/main.rs
git commit -m "feat: spawn daily summary scheduler on app start"
```

---

## Task 4: Tag

```sh
git tag plan-05-complete
```

---

## Done

A background task posts a daily summary notification at the configured
time, once per local-day. UI for changing the time is a follow-up
enhancement (database column already exists).
