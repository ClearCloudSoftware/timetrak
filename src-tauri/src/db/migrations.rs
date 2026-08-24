use rusqlite::Connection;

use crate::error::AppResult;

const V2_CALENDAR: &str = include_str!("migrations/v2_calendar.sql");
const V3_SECRETS: &str = include_str!("migrations/v3_secrets.sql");
const V4_GOALS: &str = include_str!("migrations/v4_goals.sql");

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration { version: 2, sql: V2_CALENDAR },
    Migration { version: 3, sql: V3_SECRETS },
    Migration { version: 4, sql: V4_GOALS },
];

pub fn run(conn: &Connection) -> AppResult<()> {
    let current: u32 = conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM app_meta WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1);

    for m in MIGRATIONS {
        if m.version <= current {
            continue;
        }
        conn.execute_batch(m.sql)?;
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [m.version.to_string()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db::Database;

    #[test]
    fn migrates_fresh_db_to_latest() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let v: String = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "4");
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(time_entry)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(cols.contains(&"source".to_string()));
        assert!(cols.contains(&"source_event_id".to_string()));
        assert!(cols.contains(&"source_edited_locally".to_string()));
    }

    #[test]
    fn migration_is_idempotent() {
        let db = Database::open_in_memory().unwrap();
        super::run(&db.conn.lock().unwrap()).unwrap();
    }

    #[test]
    fn calendar_tables_exist() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        for t in &["calendar_source", "calendar", "pending_calendar_import"] {
            let cnt: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [t],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(cnt, 1, "table {} should exist", t);
        }
    }
}
