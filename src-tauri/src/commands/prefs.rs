//! Small allowlisted key/value preference commands over app_meta.

use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::db::Database;
use crate::error::{AppError, AppResult};

const ALLOWED: &[&str] = &[
    "nudge_enabled",
    "nudge_work_start",
    "nudge_work_end",
    "idle_threshold_minutes",
];

fn check(key: &str) -> AppResult<()> {
    if ALLOWED.contains(&key) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("unknown preference: {key}")))
    }
}

pub fn get_pref_inner(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    check(key)?;
    Ok(conn
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set_pref_inner(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    check(key)?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_pref(db: State<'_, Database>, key: String) -> AppResult<Option<String>> {
    let conn = db.conn.lock().unwrap();
    get_pref_inner(&conn, &key)
}

#[tauri::command]
pub fn set_pref(db: State<'_, Database>, key: String, value: String) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    set_pref_inner(&conn, &key, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn set_pref_rejects_keys_outside_allowlist() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(set_pref_inner(&conn, "schema_version", "999").is_err());
        assert!(set_pref_inner(&conn, "nudge_enabled", "1").is_ok());
        assert_eq!(get_pref_inner(&conn, "nudge_enabled").unwrap(), Some("1".into()));
    }
}
