use chrono::Utc;
use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::{NewEntry, TimeEntry};
use crate::error::AppResult;
use crate::repo;

#[derive(Debug, Clone, Serialize)]
pub struct TimerState {
    pub running: Option<TimeEntry>,
}

pub fn state(conn: &Connection) -> AppResult<TimerState> {
    Ok(TimerState { running: repo::entries::running(conn)? })
}

/// Atomically: stop any running entry, then start a new one.
pub fn start(
    conn: &mut Connection,
    category_id: Uuid,
    project_id: Option<Uuid>,
    note: Option<String>,
) -> AppResult<TimeEntry> {
    let tx = conn.transaction()?;
    let now = Utc::now();
    repo::entries::stop_running_now(&tx, now)?;
    let entry = repo::entries::create(&tx, &NewEntry {
        category_id,
        project_id,
        started_at: now,
        ended_at: None,
        note,
    })?;
    tx.commit()?;
    Ok(entry)
}

pub fn stop(conn: &Connection) -> AppResult<Option<TimeEntry>> {
    repo::entries::stop_running_now(conn, Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn start_with_nothing_running_creates_running_entry() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let e = start(&mut conn, meeting(), None, None).unwrap();
        assert!(e.ended_at.is_none());
        assert_eq!(state(&conn).unwrap().running.unwrap().id, e.id);
    }

    #[test]
    fn start_when_already_running_stops_previous_in_same_transaction() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let first = start(&mut conn, meeting(), None, None).unwrap();
        let second = start(&mut conn, coding(), None, None).unwrap();
        assert_ne!(first.id, second.id);
        let prev = repo::entries::find(&conn, first.id).unwrap();
        assert!(prev.ended_at.is_some());
        assert_eq!(state(&conn).unwrap().running.unwrap().id, second.id);
    }

    #[test]
    fn stop_without_running_returns_none() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(stop(&conn).unwrap().is_none());
    }
}
