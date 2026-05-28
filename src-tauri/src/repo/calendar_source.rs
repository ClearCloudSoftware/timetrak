use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::calendar::types::CalendarSource;
use crate::error::AppResult;

pub fn get(conn: &Connection) -> AppResult<Option<CalendarSource>> {
    let row = conn.query_row(
        "SELECT id, kind, account_email, keychain_ref, connected_at, last_sync_at, last_sync_error
         FROM calendar_source LIMIT 1",
        [],
        map_row,
    ).optional()?;
    Ok(row)
}

pub fn set(conn: &Connection, src: &CalendarSource) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM calendar_source", [])?;
    tx.execute(
        "INSERT INTO calendar_source
            (id, kind, account_email, keychain_ref, connected_at, last_sync_at, last_sync_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            src.id.to_string(),
            src.kind,
            src.account_email,
            src.keychain_ref,
            src.connected_at.to_rfc3339(),
            src.last_sync_at.map(|t| t.to_rfc3339()),
            src.last_sync_error,
        ],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn clear(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM calendar_source", [])?;
    Ok(())
}

pub fn touch_last_sync(conn: &Connection, ok: bool, error: Option<&str>) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE calendar_source SET last_sync_at = ?1, last_sync_error = ?2",
        rusqlite::params![now, if ok { None } else { error }],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarSource> {
    let id_s: String = row.get(0)?;
    let connected_s: String = row.get(4)?;
    let last_sync_s: Option<String> = row.get(5)?;
    Ok(CalendarSource {
        id: Uuid::parse_str(&id_s).unwrap(),
        kind: row.get(1)?,
        account_email: row.get(2)?,
        keychain_ref: row.get(3)?,
        connected_at: DateTime::parse_from_rfc3339(&connected_s).unwrap().with_timezone(&Utc),
        last_sync_at: last_sync_s.map(|s| DateTime::parse_from_rfc3339(&s).unwrap().with_timezone(&Utc)),
        last_sync_error: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn set_and_get_round_trip() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(get(&conn).unwrap().is_none());

        let src = CalendarSource {
            id: Uuid::new_v4(),
            kind: "ics".into(),
            account_email: None,
            keychain_ref: "ics:default".into(),
            connected_at: t("2026-05-28T10:00:00Z"),
            last_sync_at: None,
            last_sync_error: None,
        };
        set(&conn, &src).unwrap();
        let fetched = get(&conn).unwrap().unwrap();
        assert_eq!(fetched.id, src.id);
        assert_eq!(fetched.kind, "ics");

        clear(&conn).unwrap();
        assert!(get(&conn).unwrap().is_none());
    }
}
