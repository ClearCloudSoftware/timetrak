use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::Category;
use crate::error::{AppError, AppResult};

pub fn list(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM category ORDER BY name")?;
    let rows = stmt.query_map([], row_to_category)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn find(conn: &Connection, id: Uuid) -> AppResult<Category> {
    let cat = conn.query_row(
        "SELECT id, name, color FROM category WHERE id = ?1",
        [id.to_string()],
        row_to_category,
    ).optional()?;
    cat.ok_or_else(|| AppError::NotFound(format!("category {}", id)))
}

pub fn create(conn: &Connection, name: &str, color: &str) -> AppResult<Category> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO category (id, name, color) VALUES (?1, ?2, ?3)",
        rusqlite::params![id.to_string(), name, color],
    ).map_err(map_unique_violation)?;
    find(conn, id)
}

pub fn update(conn: &Connection, id: Uuid, name: &str, color: &str) -> AppResult<Category> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("name is required".into()));
    }
    let rows = conn.execute(
        "UPDATE category SET name = ?2, color = ?3 WHERE id = ?1",
        rusqlite::params![id.to_string(), name, color],
    ).map_err(map_unique_violation)?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("category {}", id)));
    }
    find(conn, id)
}

pub fn delete(conn: &Connection, id: Uuid, cascade_entries: bool) -> AppResult<()> {
    let has_entries: i64 = conn.query_row(
        "SELECT COUNT(*) FROM time_entry WHERE category_id = ?1",
        [id.to_string()], |r| r.get(0),
    )?;
    if has_entries > 0 && !cascade_entries {
        return Err(AppError::Invalid(
            "category has entries; pass cascade_entries=true to delete them too".into(),
        ));
    }
    let tx = conn.unchecked_transaction()?;
    if cascade_entries {
        tx.execute("DELETE FROM time_entry WHERE category_id = ?1", [id.to_string()])?;
    }
    let rows = tx.execute("DELETE FROM category WHERE id = ?1", [id.to_string()])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("category {}", id)));
    }
    tx.commit()?;
    Ok(())
}

fn map_unique_violation(err: rusqlite::Error) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, msg) if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE => {
            AppError::Invalid(format!("unique constraint: {}", msg.as_deref().unwrap_or("category.name")))
        }
        _ => AppError::Db(err),
    }
}

fn row_to_category(row: &rusqlite::Row<'_>) -> rusqlite::Result<Category> {
    let id: String = row.get(0)?;
    Ok(Category {
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
    fn list_returns_seeded_categories_sorted_by_name() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cats = list(&conn).unwrap();
        let names: Vec<_> = cats.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["Break", "Coding", "Email", "Meeting"]);
    }

    #[test]
    fn find_returns_category() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cat = find(&conn, meeting()).unwrap();
        assert_eq!(cat.name, "Meeting");
    }

    #[test]
    fn find_unknown_returns_not_found() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let err = find(&conn, Uuid::new_v4()).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn create_inserts_category_and_returns_it() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cat = create(&conn, "Reading", "#ff0000").unwrap();
        assert_eq!(cat.name, "Reading");
        assert!(find(&conn, cat.id).is_ok());
    }

    #[test]
    fn create_rejects_duplicate_name() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let err = create(&conn, "Meeting", "#000000").unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn update_changes_name_and_color() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        let cat = update(&conn, meeting(), "Standup", "#abcdef").unwrap();
        assert_eq!(cat.name, "Standup");
        assert_eq!(cat.color, "#abcdef");
    }

    #[test]
    fn delete_without_entries_removes_row() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        delete(&conn, meeting(), false).unwrap();
        assert!(find(&conn, meeting()).is_err());
    }

    #[test]
    fn delete_with_referenced_entries_without_cascade_errors() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        let err = delete(&conn, meeting(), false).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn delete_with_referenced_entries_with_cascade_removes_entries_and_category() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T10:00:00Z", "2026-05-22T11:00:00Z");
        delete(&conn, meeting(), true).unwrap();
        assert!(find(&conn, meeting()).is_err());
        let cnt: i64 = conn.query_row(
            "SELECT COUNT(*) FROM time_entry WHERE category_id = ?1",
            [meeting().to_string()], |r| r.get(0)
        ).unwrap();
        assert_eq!(cnt, 0);
    }
}
