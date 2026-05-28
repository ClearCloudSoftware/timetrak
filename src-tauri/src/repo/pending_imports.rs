use chrono::{DateTime, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::calendar::types::{NewPendingImport, PendingImport, ResolutionAction};
use crate::error::AppResult;

pub fn list_pending(conn: &Connection) -> AppResult<Vec<PendingImport>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_event_id, source_calendar_id, started_at, ended_at, title,
                status, detected_at, resolved_action, resolved_at
         FROM pending_calendar_import
         WHERE status = 'pending_conflict'
         ORDER BY started_at",
    )?;
    let rows = stmt.query_map([], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn insert(conn: &Connection, p: &NewPendingImport) -> AppResult<PendingImport> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    conn.execute(
        "INSERT INTO pending_calendar_import
            (id, source_event_id, source_calendar_id, started_at, ended_at, title,
             status, detected_at, resolved_action, resolved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending_conflict', ?7, NULL, NULL)",
        rusqlite::params![
            id.to_string(),
            p.source_event_id,
            p.source_calendar_id,
            p.started_at.to_rfc3339(),
            p.ended_at.to_rfc3339(),
            p.title,
            now.to_rfc3339(),
        ],
    )?;
    Ok(PendingImport {
        id,
        source_event_id: p.source_event_id.clone(),
        source_calendar_id: p.source_calendar_id.clone(),
        started_at: p.started_at,
        ended_at: p.ended_at,
        title: p.title.clone(),
        status: "pending_conflict".into(),
        detected_at: now,
        resolved_action: None,
        resolved_at: None,
    })
}

pub fn resolve(conn: &Connection, id: Uuid, action: ResolutionAction) -> AppResult<()> {
    let action_s = match action {
        ResolutionAction::KeptMine => "kept_mine",
        ResolutionAction::UsedCalendar => "used_calendar",
        ResolutionAction::Edited => "edited",
    };
    conn.execute(
        "UPDATE pending_calendar_import
         SET status = 'resolved', resolved_action = ?2, resolved_at = ?3
         WHERE id = ?1",
        rusqlite::params![id.to_string(), action_s, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingImport> {
    let id_s: String = row.get(0)?;
    let start_s: String = row.get(3)?;
    let end_s: String = row.get(4)?;
    let detected_s: String = row.get(7)?;
    let resolved_s: Option<String> = row.get(9)?;
    Ok(PendingImport {
        id: Uuid::parse_str(&id_s).unwrap(),
        source_event_id: row.get(1)?,
        source_calendar_id: row.get(2)?,
        started_at: DateTime::parse_from_rfc3339(&start_s).unwrap().with_timezone(&Utc),
        ended_at: DateTime::parse_from_rfc3339(&end_s).unwrap().with_timezone(&Utc),
        title: row.get(5)?,
        status: row.get(6)?,
        detected_at: DateTime::parse_from_rfc3339(&detected_s).unwrap().with_timezone(&Utc),
        resolved_action: row.get(8)?,
        resolved_at: resolved_s.map(|s| DateTime::parse_from_rfc3339(&s).unwrap().with_timezone(&Utc)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn insert_then_resolve() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let p = insert(&conn, &NewPendingImport {
            source_event_id: "e1".into(),
            source_calendar_id: "c1".into(),
            started_at: t("2026-05-28T10:00:00Z"),
            ended_at: t("2026-05-28T11:00:00Z"),
            title: "Standup".into(),
        }).unwrap();

        assert_eq!(list_pending(&conn).unwrap().len(), 1);
        resolve(&conn, p.id, ResolutionAction::KeptMine).unwrap();
        assert_eq!(list_pending(&conn).unwrap().len(), 0);
    }
}
