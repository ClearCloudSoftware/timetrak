//! In-DB secret storage. Replaces the OS keychain for OAuth tokens and
//! ICS URLs. See `db/migrations/v3_secrets.sql` for rationale.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

pub fn put(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO secret_store (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let v = conn
        .query_row(
            "SELECT value FROM secret_store WHERE key = ?1",
            [key],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(v)
}

pub fn delete(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("DELETE FROM secret_store WHERE key = ?1", [key])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn round_trip() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(get(&conn, "k").unwrap().is_none());
        put(&conn, "k", "v").unwrap();
        assert_eq!(get(&conn, "k").unwrap().as_deref(), Some("v"));
        put(&conn, "k", "v2").unwrap();
        assert_eq!(get(&conn, "k").unwrap().as_deref(), Some("v2"));
        delete(&conn, "k").unwrap();
        assert!(get(&conn, "k").unwrap().is_none());
    }
}
