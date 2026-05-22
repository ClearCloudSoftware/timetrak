#![cfg(test)]
#![allow(dead_code, unused_imports)]

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{Category, NewEntry};

pub const CAT_MEETING: &str = "00000000-0000-0000-0000-000000000001";
pub const CAT_CODING:  &str = "00000000-0000-0000-0000-000000000002";
pub const CAT_EMAIL:   &str = "00000000-0000-0000-0000-000000000003";
pub const CAT_BREAK:   &str = "00000000-0000-0000-0000-000000000004";

pub fn fresh_db() -> Database {
    Database::open_in_memory().expect("open_in_memory")
}

pub fn t(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}

pub fn cat_id(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

pub fn meeting() -> Uuid { cat_id(CAT_MEETING) }
pub fn coding() -> Uuid { cat_id(CAT_CODING) }

/// Insert a closed entry. Returns the inserted id.
pub fn insert_closed(
    conn: &Connection,
    category: Uuid,
    start: &str,
    end: &str,
) -> Uuid {
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note)
         VALUES (?1, ?2, NULL, ?3, ?4, NULL)",
        rusqlite::params![id.to_string(), category.to_string(), start, end],
    ).unwrap();
    id
}
