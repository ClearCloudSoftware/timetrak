use rusqlite::Connection;
use uuid::Uuid;

use crate::error::AppResult;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct WeeklyGoal {
    pub category_id: Uuid,
    pub target_minutes: u32,
}

pub fn set(conn: &Connection, category_id: Uuid, target_minutes: Option<u32>) -> AppResult<()> {
    match target_minutes {
        Some(m) => {
            conn.execute(
                "INSERT INTO weekly_goal (category_id, target_minutes) VALUES (?1, ?2)
                 ON CONFLICT(category_id) DO UPDATE SET target_minutes = excluded.target_minutes",
                rusqlite::params![category_id.to_string(), m],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM weekly_goal WHERE category_id = ?1",
                [category_id.to_string()],
            )?;
        }
    }
    Ok(())
}

pub fn all(conn: &Connection) -> AppResult<Vec<WeeklyGoal>> {
    let mut stmt = conn.prepare("SELECT category_id, target_minutes FROM weekly_goal")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        let (id, m) = r?;
        if let Ok(category_id) = Uuid::parse_str(&id) {
            out.push(WeeklyGoal { category_id, target_minutes: m });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn set_get_and_clear_goal() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        set(&conn, coding(), Some(1200)).unwrap();
        set(&conn, coding(), Some(900)).unwrap(); // upsert
        assert_eq!(all(&conn).unwrap(), vec![WeeklyGoal { category_id: coding(), target_minutes: 900 }]);
        set(&conn, coding(), None).unwrap(); // clear
        assert!(all(&conn).unwrap().is_empty());
    }
}
