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
}
