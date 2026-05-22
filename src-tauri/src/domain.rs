use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type Id = Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Category {
    pub id: Id,
    pub name: String,
    pub color: String, // #RRGGBB
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: Id,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeEntry {
    pub id: Id,
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

/// Input for creating a new entry. `id` and timestamps are assigned by the repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEntry {
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

/// Input for editing an entry. All fields replace existing values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryEdit {
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}
