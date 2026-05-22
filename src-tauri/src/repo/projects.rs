use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::Project;
use crate::error::{AppError, AppResult};

pub fn list(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM project ORDER BY name")?;
    let rows = stmt.query_map([], row_to_project)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn find(conn: &Connection, id: Uuid) -> AppResult<Project> {
    let p = conn.query_row(
        "SELECT id, name, color FROM project WHERE id = ?1",
        [id.to_string()],
        row_to_project,
    ).optional()?;
    p.ok_or_else(|| AppError::NotFound(format!("project {}", id)))
}

pub fn create(conn: &Connection, name: &str, color: &str) -> AppResult<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO project (id, name, color) VALUES (?1, ?2, ?3)",
        rusqlite::params![id.to_string(), name, color],
    ).map_err(|e| match &e {
        rusqlite::Error::SqliteFailure(c, msg) if c.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
            AppError::Invalid(format!("unique constraint: {}", msg.as_deref().unwrap_or("project.name")))
        }
        _ => AppError::Db(e),
    })?;
    find(conn, id)
}

pub fn update(conn: &Connection, id: Uuid, name: &str, color: &str) -> AppResult<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let rows = conn.execute(
        "UPDATE project SET name = ?2, color = ?3 WHERE id = ?1",
        rusqlite::params![id.to_string(), name, color],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("project {}", id)));
    }
    find(conn, id)
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let rows = conn.execute("DELETE FROM project WHERE id = ?1", [id.to_string()])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("project {}", id)));
    }
    Ok(())
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let id: String = row.get(0)?;
    Ok(Project {
        id: Uuid::parse_str(&id).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?,
        name: row.get(1)?,
        color: row.get(2)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn create_and_list() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let p = create(&conn, "Acme", "#123456").unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, p.id);
    }

    #[test]
    fn delete_sets_project_id_null_on_entries() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let p = create(&conn, "Acme", "#123456").unwrap();
        // Insert entry referencing project
        let eid = Uuid::new_v4();
        conn.execute(
            "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at)
             VALUES (?1, ?2, ?3, '2026-05-22T10:00:00Z', '2026-05-22T11:00:00Z')",
            rusqlite::params![eid.to_string(), meeting().to_string(), p.id.to_string()],
        ).unwrap();
        delete(&conn, p.id).unwrap();
        let pid: Option<String> = conn.query_row(
            "SELECT project_id FROM time_entry WHERE id = ?1",
            [eid.to_string()], |r| r.get(0),
        ).unwrap();
        assert!(pid.is_none(), "project_id should be nulled by FK ON DELETE SET NULL");
    }

    #[test]
    fn duplicate_name_rejected() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        create(&conn, "Acme", "#123").unwrap();
        let err = create(&conn, "Acme", "#456").unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }
}
