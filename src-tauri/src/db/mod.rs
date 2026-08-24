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

impl Database {
    /// Open or create the DB at `path`, run migrations, enable foreign keys.
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
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
