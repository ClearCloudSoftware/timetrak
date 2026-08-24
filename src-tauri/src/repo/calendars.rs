use rusqlite::Connection;

use crate::calendar::types::{CalendarRow, DiscoveredCalendar};
use crate::error::AppResult;

pub fn list(conn: &Connection) -> AppResult<Vec<CalendarRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, enabled FROM calendar ORDER BY display_name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CalendarRow {
            id: r.get(0)?,
            display_name: r.get(1)?,
            enabled: r.get::<_, i64>(2)? != 0,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_many(conn: &Connection, items: &[DiscoveredCalendar]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    for it in items {
        tx.execute(
            "INSERT INTO calendar (id, display_name, enabled) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name",
            rusqlite::params![it.id, it.display_name, if it.primary { 1 } else { 0 }],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE calendar SET enabled = ?2 WHERE id = ?1",
        rusqlite::params![id, if enabled { 1 } else { 0 }],
    )?;
    Ok(())
}

pub fn enabled_ids(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM calendar WHERE enabled = 1")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn primary_calendar_enabled_by_default_on_first_discovery_only() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        upsert_many(&conn, &[
            DiscoveredCalendar { id: "p".into(), display_name: "Primary".into(), primary: true },
            DiscoveredCalendar { id: "s".into(), display_name: "Shared".into(), primary: false },
        ]).unwrap();
        assert_eq!(enabled_ids(&conn).unwrap(), vec!["p".to_string()]);

        // User turns it off; a later re-discovery must not re-enable it.
        set_enabled(&conn, "p", false).unwrap();
        upsert_many(&conn, &[
            DiscoveredCalendar { id: "p".into(), display_name: "Primary".into(), primary: true },
        ]).unwrap();
        assert!(enabled_ids(&conn).unwrap().is_empty());
    }

    #[test]
    fn upsert_then_toggle_then_query_enabled() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        upsert_many(&conn, &[
            DiscoveredCalendar { id: "a".into(), display_name: "Alpha".into(), primary: false },
            DiscoveredCalendar { id: "b".into(), display_name: "Beta".into(), primary: false },
        ]).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
        assert!(enabled_ids(&conn).unwrap().is_empty());

        set_enabled(&conn, "a", true).unwrap();
        assert_eq!(enabled_ids(&conn).unwrap(), vec!["a".to_string()]);

        // Upsert again with new display name; should not lose enabled state.
        upsert_many(&conn, &[
            DiscoveredCalendar { id: "a".into(), display_name: "Alpha 2".into(), primary: false },
        ]).unwrap();
        assert_eq!(enabled_ids(&conn).unwrap(), vec!["a".to_string()]);
    }
}
