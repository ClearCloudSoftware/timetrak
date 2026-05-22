use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::{EntryEdit, NewEntry, TimeEntry};
use crate::error::{AppError, AppResult};

pub fn list_in_range(
    conn: &Connection,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> AppResult<Vec<TimeEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, project_id, started_at, ended_at, note
         FROM time_entry
         WHERE started_at < ?2
           AND (ended_at IS NULL OR ended_at > ?1)
         ORDER BY started_at",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![iso(start), iso(end)],
        row_to_entry,
    )?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn find(conn: &Connection, id: Uuid) -> AppResult<TimeEntry> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note
         FROM time_entry WHERE id = ?1",
        [id.to_string()],
        row_to_entry,
    ).optional()?;
    e.ok_or_else(|| AppError::NotFound(format!("entry {}", id)))
}

pub fn running(conn: &Connection) -> AppResult<Option<TimeEntry>> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note
         FROM time_entry WHERE ended_at IS NULL",
        [],
        row_to_entry,
    ).optional()?;
    Ok(e)
}

fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeEntry> {
    use rusqlite::Error;
    use rusqlite::types::Type;
    let id_s: String = row.get(0)?;
    let cat_s: String = row.get(1)?;
    let proj_s: Option<String> = row.get(2)?;
    let start_s: String = row.get(3)?;
    let end_s: Option<String> = row.get(4)?;
    let note: Option<String> = row.get(5)?;
    Ok(TimeEntry {
        id: Uuid::parse_str(&id_s).map_err(|e| Error::FromSqlConversionFailure(0, Type::Text, Box::new(e)))?,
        category_id: Uuid::parse_str(&cat_s).map_err(|e| Error::FromSqlConversionFailure(1, Type::Text, Box::new(e)))?,
        project_id: proj_s
            .map(|s| Uuid::parse_str(&s))
            .transpose()
            .map_err(|e| Error::FromSqlConversionFailure(2, Type::Text, Box::new(e)))?,
        started_at: parse_iso(&start_s).map_err(|e| Error::FromSqlConversionFailure(3, Type::Text, Box::new(e)))?,
        ended_at: end_s
            .map(|s| parse_iso(&s))
            .transpose()
            .map_err(|e| Error::FromSqlConversionFailure(4, Type::Text, Box::new(e)))?,
        note,
    })
}

fn parse_iso(s: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn list_in_range_returns_overlapping_entries() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T08:00:00Z", "2026-05-22T09:00:00Z"); // before
        insert_closed(&conn, meeting(), "2026-05-22T09:30:00Z", "2026-05-22T10:30:00Z"); // overlap left
        insert_closed(&conn, meeting(), "2026-05-22T10:30:00Z", "2026-05-22T11:30:00Z"); // inside
        insert_closed(&conn, meeting(), "2026-05-22T11:30:00Z", "2026-05-22T12:30:00Z"); // overlap right
        insert_closed(&conn, meeting(), "2026-05-22T13:00:00Z", "2026-05-22T14:00:00Z"); // after

        let res = list_in_range(&conn, t("2026-05-22T10:00:00Z"), t("2026-05-22T12:00:00Z")).unwrap();
        assert_eq!(res.len(), 3);
    }

    #[test]
    fn running_returns_running_entry_only() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T08:00:00Z", "2026-05-22T09:00:00Z");
        let running_id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at) VALUES (?1, ?2, '2026-05-22T10:00:00Z')",
            rusqlite::params![running_id.to_string(), meeting().to_string()],
        ).unwrap();

        let r = running(&conn).unwrap().unwrap();
        assert_eq!(r.id, running_id);
    }

    #[test]
    fn running_returns_none_when_no_running_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(running(&conn).unwrap().is_none());
    }
}
