use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

use crate::error::AppResult;

pub mod migrations;

/// Owns the SQLite connection. Wrapped in a Mutex because rusqlite::Connection
/// is not Sync. Tauri stores this as managed state.
pub struct Database {
    pub conn: Mutex<Connection>,
}

const SCHEMA_SQL: &str = include_str!("schema.sql");

/// Path of the staged restore file for a given live DB path.
pub fn restore_pending_path(db_path: &Path) -> std::path::PathBuf {
    let mut name = db_path.file_name().unwrap_or_default().to_os_string();
    name.push(".restore-pending");
    db_path.with_file_name(name)
}

impl Database {
    /// Open or create the DB at `path`, run migrations, enable foreign keys.
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // A staged restore (Settings → Restore from backup) wins over the live file.
        let pending = restore_pending_path(path);
        if pending.exists() {
            std::fs::rename(&pending, path)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        // v1 base schema is idempotent (CREATE IF NOT EXISTS / INSERT OR IGNORE).
        // It establishes the schema_version row that migrations::run reads from.
        conn.execute_batch(SCHEMA_SQL)?;
        migrations::run(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Open an in-memory database for tests.
    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA_SQL)?;
        migrations::run(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_creates_schema() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();

        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM category", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 4, "should seed 4 default categories");

        let version: String = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "4");

        let goal_cnt: i64 = conn.query_row("SELECT COUNT(*) FROM weekly_goal", [], |r| r.get(0)).unwrap();
        assert_eq!(goal_cnt, 0);
    }

    #[test]
    fn open_swaps_in_pending_restore_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("timetrak.sqlite");
        // Seed a live DB and add a marker row.
        {
            let db = Database::open(&path).unwrap();
            let conn = db.conn.lock().unwrap();
            conn.execute("INSERT INTO app_meta (key, value) VALUES ('marker', 'live')", []).unwrap();
        }
        // Stage a different DB as pending restore.
        let pending = restore_pending_path(&path);
        {
            let db2 = Database::open(&dir.path().join("staged.sqlite")).unwrap();
            let conn = db2.conn.lock().unwrap();
            conn.execute("INSERT INTO app_meta (key, value) VALUES ('marker', 'restored')", []).unwrap();
            conn.execute("VACUUM INTO ?1", [pending.to_str().unwrap()]).unwrap();
        }
        // Re-open the live path: pending must win.
        let db = Database::open(&path).unwrap();
        let conn = db.conn.lock().unwrap();
        let marker: String = conn
            .query_row("SELECT value FROM app_meta WHERE key = 'marker'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(marker, "restored");
        assert!(!pending.exists());
    }

    #[test]
    fn one_running_entry_unique_index_blocks_second_running_entry() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at, ended_at)
             VALUES ('a', '00000000-0000-0000-0000-000000000001', '2026-05-22T10:00:00Z', NULL)",
            [],
        )
        .unwrap();

        let err = conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at, ended_at)
             VALUES ('b', '00000000-0000-0000-0000-000000000001', '2026-05-22T11:00:00Z', NULL)",
            [],
        );
        assert!(err.is_err(), "second running entry should be blocked by unique index");
    }
}
