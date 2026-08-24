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
        "SELECT id, category_id, project_id, started_at, ended_at, note,
                source, source_event_id, source_calendar_id, source_edited_locally
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
        "SELECT id, category_id, project_id, started_at, ended_at, note,
                source, source_event_id, source_calendar_id, source_edited_locally
         FROM time_entry WHERE id = ?1",
        [id.to_string()],
        row_to_entry,
    ).optional()?;
    e.ok_or_else(|| AppError::NotFound(format!("entry {}", id)))
}

pub fn running(conn: &Connection) -> AppResult<Option<TimeEntry>> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note,
                source, source_event_id, source_calendar_id, source_edited_locally
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
    let source: String = row.get(6)?;
    let source_event_id: Option<String> = row.get(7)?;
    let source_calendar_id: Option<String> = row.get(8)?;
    let source_edited: i64 = row.get(9)?;
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
        source,
        source_event_id,
        source_calendar_id,
        source_edited_locally: source_edited != 0,
    })
}

fn parse_iso(s: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc))
}

pub fn create(conn: &Connection, new: &NewEntry) -> AppResult<TimeEntry> {
    if let Some(end) = new.ended_at {
        if end <= new.started_at {
            return Err(AppError::Invalid("ended_at must be after started_at".into()));
        }
    }
    // A second running entry conflicts with the unique partial index — surface that
    // as AlreadyRunning before the generic overlap check.
    if new.ended_at.is_none() {
        if running(conn)?.is_some() {
            return Err(AppError::AlreadyRunning);
        }
    }
    if has_overlap(conn, None, new.started_at, new.ended_at)? {
        return Err(AppError::Overlap);
    }
    let id = Uuid::new_v4();
    let res = conn.execute(
        "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note,
                                  source, source_event_id, source_calendar_id, source_edited_locally)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)",
        rusqlite::params![
            id.to_string(),
            new.category_id.to_string(),
            new.project_id.map(|p| p.to_string()),
            iso(new.started_at),
            new.ended_at.map(iso),
            new.note,
            new.source,
            new.source_event_id,
            new.source_calendar_id,
        ],
    );
    match res {
        Ok(_) => find(conn, id),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
            Err(AppError::AlreadyRunning)
        }
        Err(e) => Err(AppError::Db(e)),
    }
}

/// True if any other entry's [start, end) overlaps the given range.
/// A running entry counts as extending to "end of time" for overlap purposes
/// only when checking against closed entries that occur after its start.
fn has_overlap(
    conn: &Connection,
    exclude_id: Option<Uuid>,
    start: DateTime<Utc>,
    end: Option<DateTime<Utc>>,
) -> AppResult<bool> {
    // Two entries overlap iff start_a < end_b AND start_b < end_a.
    // Treat NULL ended_at as +infinity.
    let exclude = exclude_id.map(|i| i.to_string()).unwrap_or_default();
    let end_s = end.map(iso);
    let cnt: i64 = match end_s {
        Some(end_str) => conn.query_row(
            "SELECT COUNT(*) FROM time_entry
             WHERE id != ?1
               AND started_at < ?3
               AND (ended_at IS NULL OR ended_at > ?2)",
            rusqlite::params![exclude, iso(start), end_str],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT COUNT(*) FROM time_entry
             WHERE id != ?1
               AND (ended_at IS NULL OR ended_at > ?2)",
            rusqlite::params![exclude, iso(start)],
            |r| r.get(0),
        )?,
    };
    Ok(cnt > 0)
}

pub fn update(conn: &Connection, id: Uuid, edit: &EntryEdit) -> AppResult<TimeEntry> {
    if let Some(end) = edit.ended_at {
        if end <= edit.started_at {
            return Err(AppError::Invalid("ended_at must be after started_at".into()));
        }
    }
    if has_overlap(conn, Some(id), edit.started_at, edit.ended_at)? {
        return Err(AppError::Overlap);
    }
    let rows = conn.execute(
        "UPDATE time_entry SET category_id = ?2, project_id = ?3, started_at = ?4, ended_at = ?5, note = ?6
         WHERE id = ?1",
        rusqlite::params![
            id.to_string(),
            edit.category_id.to_string(),
            edit.project_id.map(|p| p.to_string()),
            iso(edit.started_at),
            edit.ended_at.map(iso),
            edit.note,
        ],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("entry {}", id)));
    }
    find(conn, id)
}

pub fn find_by_source(
    conn: &Connection,
    source_event_id: &str,
    source_calendar_id: &str,
) -> AppResult<Option<TimeEntry>> {
    let e = conn.query_row(
        "SELECT id, category_id, project_id, started_at, ended_at, note,
                source, source_event_id, source_calendar_id, source_edited_locally
         FROM time_entry
         WHERE source_event_id = ?1 AND source_calendar_id = ?2",
        [source_event_id, source_calendar_id],
        row_to_entry,
    ).optional()?;
    Ok(e)
}

pub fn mark_edited_locally(conn: &Connection, id: Uuid) -> AppResult<()> {
    let rows = conn.execute(
        "UPDATE time_entry SET source_edited_locally = 1 WHERE id = ?1",
        [id.to_string()],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("entry {}", id)));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let rows = conn.execute("DELETE FROM time_entry WHERE id = ?1", [id.to_string()])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("entry {}", id)));
    }
    Ok(())
}

/// Closes any running entry by setting ended_at = now. Returns the
/// previously-running entry, or None if nothing was running.
pub fn stop_running_now(conn: &Connection, now: DateTime<Utc>) -> AppResult<Option<TimeEntry>> {
    let running_id: Option<String> = conn.query_row(
        "SELECT id FROM time_entry WHERE ended_at IS NULL",
        [],
        |r| r.get(0),
    ).optional()?;
    let Some(id_s) = running_id else { return Ok(None); };
    conn.execute(
        "UPDATE time_entry SET ended_at = ?1 WHERE id = ?2",
        rusqlite::params![iso(now), id_s],
    )?;
    let id = Uuid::parse_str(&id_s).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(Some(find(conn, id)?))
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

    #[test]
    fn create_inserts_closed_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let e = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: Some(t("2026-05-22T11:00:00Z")),
            note: Some("standup".into()),
            source: "manual".into(),
            source_event_id: None,
            source_calendar_id: None,
        }).unwrap();
        assert_eq!(e.note.as_deref(), Some("standup"));
    }

    #[test]
    fn create_rejects_end_before_start() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let err = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T11:00:00Z"),
            ended_at: Some(t("2026-05-22T10:00:00Z")),
            note: None,
            source: "manual".into(),
            source_event_id: None,
            source_calendar_id: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn create_rejects_overlap_with_existing_closed_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        let err = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:30:00Z"),
            ended_at: Some(t("2026-05-22T11:30:00Z")),
            note: None,
            source: "manual".into(),
            source_event_id: None,
            source_calendar_id: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::Overlap));
    }

    #[test]
    fn create_running_when_one_already_running_errors() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: None,
            note: None,
            source: "manual".into(),
            source_event_id: None,
            source_calendar_id: None,
        }).unwrap();
        let err = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T11:00:00Z"),
            ended_at: None,
            note: None,
            source: "manual".into(),
            source_event_id: None,
            source_calendar_id: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::AlreadyRunning));
    }

    #[test]
    fn update_changes_fields_and_rejects_overlap() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let a = insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        let b = insert_closed(&conn, meeting(), "2026-05-22T12:00:00Z", "2026-05-22T13:00:00Z");
        // Move b to overlap a -> error
        let err = update(&conn, b, &EntryEdit {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:30:00Z"),
            ended_at: Some(t("2026-05-22T11:30:00Z")),
            note: None,
        }).unwrap_err();
        assert!(matches!(err, AppError::Overlap));
        // Move b to a non-overlapping range -> ok
        let updated = update(&conn, b, &EntryEdit {
            category_id: coding(),
            project_id: None,
            started_at: t("2026-05-22T14:00:00Z"),
            ended_at: Some(t("2026-05-22T15:00:00Z")),
            note: Some("refactor".into()),
        }).unwrap();
        assert_eq!(updated.category_id, coding());
        assert_eq!(updated.note.as_deref(), Some("refactor"));
        assert_eq!(updated.id, b);
        let _ = a; // silence unused
    }

    #[test]
    fn delete_removes_row() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let a = insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        delete(&conn, a).unwrap();
        assert!(find(&conn, a).is_err());
    }

    #[test]
    fn stop_running_now_closes_running_entry() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let id = Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at) VALUES (?1, ?2, '2026-05-22T10:00:00Z')",
            rusqlite::params![id.to_string(), meeting().to_string()],
        ).unwrap();
        let stopped = stop_running_now(&conn, t("2026-05-22T11:00:00Z")).unwrap().unwrap();
        assert_eq!(stopped.id, id);
        assert_eq!(stopped.ended_at, Some(t("2026-05-22T11:00:00Z")));
        assert!(running(&conn).unwrap().is_none());
    }

    #[test]
    fn stop_running_now_returns_none_when_nothing_running() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(stop_running_now(&conn, t("2026-05-22T11:00:00Z")).unwrap().is_none());
    }

    #[test]
    fn find_by_source_returns_match() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let e = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: Some(t("2026-05-22T11:00:00Z")),
            note: None,
            source: "calendar".into(),
            source_event_id: Some("evt-1".into()),
            source_calendar_id: Some("cal-a".into()),
        }).unwrap();
        let found = find_by_source(&conn, "evt-1", "cal-a").unwrap().unwrap();
        assert_eq!(found.id, e.id);
        assert_eq!(found.source, "calendar");
    }

    #[test]
    fn find_by_source_returns_none_when_no_match() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(find_by_source(&conn, "x", "y").unwrap().is_none());
    }

    #[test]
    fn mark_edited_locally_sets_flag() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let e = create(&conn, &NewEntry {
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T10:00:00Z"),
            ended_at: Some(t("2026-05-22T11:00:00Z")),
            note: None,
            source: "calendar".into(),
            source_event_id: Some("evt-2".into()),
            source_calendar_id: Some("cal-a".into()),
        }).unwrap();
        mark_edited_locally(&conn, e.id).unwrap();
        let re = find(&conn, e.id).unwrap();
        assert!(re.source_edited_locally);
    }
}

/// Calendar-sourced, unedited entries that are still in progress or upcoming
/// at `now` — the set the scheduler arms auto-switch / end-prompt timers for.
pub fn calendar_entries_active_or_upcoming(
    conn: &Connection,
    now: DateTime<Utc>,
) -> AppResult<Vec<(Uuid, DateTime<Utc>, DateTime<Utc>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, ended_at
         FROM time_entry
         WHERE source = 'calendar'
           AND source_edited_locally = 0
           AND ended_at IS NOT NULL
           AND ended_at > ?1
         ORDER BY started_at",
    )?;
    let raw = stmt
        .query_map([now.to_rfc3339()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(raw
        .into_iter()
        .filter_map(|(id_s, start_s, end_s)| {
            let id = Uuid::parse_str(&id_s).ok()?;
            let s = DateTime::parse_from_rfc3339(&start_s).ok()?.with_timezone(&Utc);
            let e = DateTime::parse_from_rfc3339(&end_s).ok()?.with_timezone(&Utc);
            Some((id, s, e))
        })
        .collect())
}

#[cfg(test)]
mod calendar_schedule_tests {
    use super::*;
    use crate::test_support::*;

    fn insert_calendar_entry(
        conn: &rusqlite::Connection,
        start: &str,
        end: &str,
        edited: bool,
    ) -> uuid::Uuid {
        let id = uuid::Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note,
                                     source, source_event_id, source_calendar_id, source_edited_locally)
             VALUES (?1, ?2, NULL, ?3, ?4, NULL, 'calendar', ?5, 'cal1', ?6)",
            rusqlite::params![id.to_string(), CAT_MEETING, start, end, id.to_string(), edited as i64],
        ).unwrap();
        id
    }

    #[test]
    fn calendar_entries_active_or_upcoming_includes_in_progress_meetings() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let now = t("2026-08-24T12:00:00Z");
        insert_calendar_entry(&conn, "2026-08-24T09:00:00Z", "2026-08-24T10:00:00Z", false); // over
        let in_progress = insert_calendar_entry(&conn, "2026-08-24T11:30:00Z", "2026-08-24T12:30:00Z", false);
        let upcoming = insert_calendar_entry(&conn, "2026-08-24T14:00:00Z", "2026-08-24T15:00:00Z", false);
        insert_calendar_entry(&conn, "2026-08-24T16:00:00Z", "2026-08-24T17:00:00Z", true); // edited

        let rows = calendar_entries_active_or_upcoming(&conn, now).unwrap();
        let ids: Vec<uuid::Uuid> = rows.iter().map(|r| r.0).collect();
        assert_eq!(ids, vec![in_progress, upcoming]);
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RecentCombo {
    pub category_id: Uuid,
    pub project_id: Option<Uuid>,
    pub note: Option<String>,
}

/// Distinct (category, project, note) combinations used since `since`,
/// most recently used first. Feeds the tray's Quick Start chips.
pub fn recent_combos(conn: &Connection, since: DateTime<Utc>, limit: u32) -> AppResult<Vec<RecentCombo>> {
    let mut stmt = conn.prepare(
        "SELECT category_id, project_id, note, MAX(started_at) AS last_used
         FROM time_entry
         WHERE started_at >= ?1
         GROUP BY category_id, COALESCE(project_id, ''), COALESCE(note, '')
         ORDER BY last_used DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![since.to_rfc3339(), limit], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        let (cat, proj, note) = r?;
        let Ok(category_id) = Uuid::parse_str(&cat) else { continue };
        out.push(RecentCombo {
            category_id,
            project_id: proj.and_then(|p| Uuid::parse_str(&p).ok()),
            note,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod recent_combo_tests {
    use super::*;
    use crate::test_support::*;

    fn insert_with_note(conn: &rusqlite::Connection, cat: uuid::Uuid, start: &str, end: &str, note: Option<&str>) {
        conn.execute(
            "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), cat.to_string(), start, end, note],
        ).unwrap();
    }

    #[test]
    fn recent_combos_dedupes_and_orders_by_recency() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        // Same combo twice (older + newer) must appear once, ranked by newest use.
        insert_with_note(&conn, coding(), "2026-08-20T09:00:00Z", "2026-08-20T10:00:00Z", Some("review"));
        insert_with_note(&conn, coding(), "2026-08-22T09:00:00Z", "2026-08-22T10:00:00Z", Some("review"));
        insert_with_note(&conn, meeting(), "2026-08-21T09:00:00Z", "2026-08-21T10:00:00Z", None);

        let combos = recent_combos(&conn, t("2026-08-10T00:00:00Z"), 6).unwrap();
        assert_eq!(combos.len(), 2);
        assert_eq!(combos[0].category_id, coding());
        assert_eq!(combos[0].note.as_deref(), Some("review"));
        assert_eq!(combos[1].category_id, meeting());
    }

    #[test]
    fn recent_combos_respects_since_and_limit() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_with_note(&conn, coding(), "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z", None); // too old
        insert_with_note(&conn, coding(), "2026-08-22T09:00:00Z", "2026-08-22T10:00:00Z", Some("a"));
        insert_with_note(&conn, coding(), "2026-08-23T09:00:00Z", "2026-08-23T10:00:00Z", Some("b"));

        let combos = recent_combos(&conn, t("2026-08-10T00:00:00Z"), 1).unwrap();
        assert_eq!(combos.len(), 1);
        assert_eq!(combos[0].note.as_deref(), Some("b"));
    }
}
