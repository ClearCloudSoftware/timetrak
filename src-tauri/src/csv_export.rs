use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use uuid::Uuid;

use crate::domain::{Category, Project, TimeEntry};

pub fn entries_to_csv(
    entries: &[TimeEntry],
    categories: &[Category],
    projects: &[Project],
    local_tz: Tz,
) -> String {
    let cat_by_id: HashMap<Uuid, &Category> = categories.iter().map(|c| (c.id, c)).collect();
    let proj_by_id: HashMap<Uuid, &Project> = projects.iter().map(|p| (p.id, p)).collect();

    let mut out = String::new();
    out.push_str("started_at,ended_at,duration_minutes,category,project,note\n");
    for e in entries {
        let started = local_iso(e.started_at, local_tz);
        let ended = e.ended_at.map(|t| local_iso(t, local_tz)).unwrap_or_default();
        let duration = e.ended_at
            .map(|end| (end - e.started_at).num_seconds() / 60)
            .map(|m| m.to_string())
            .unwrap_or_default();
        let cat_name = cat_by_id.get(&e.category_id).map(|c| c.name.as_str()).unwrap_or("");
        let proj_name = e.project_id
            .and_then(|p| proj_by_id.get(&p))
            .map(|p| p.name.as_str())
            .unwrap_or("");
        let note = e.note.as_deref().unwrap_or("");

        out.push_str(&csv_field(&started));
        out.push(',');
        out.push_str(&csv_field(&ended));
        out.push(',');
        out.push_str(&duration);
        out.push(',');
        out.push_str(&csv_field(cat_name));
        out.push(',');
        out.push_str(&csv_field(proj_name));
        out.push(',');
        out.push_str(&csv_field(note));
        out.push('\n');
    }
    out
}

fn local_iso(t: DateTime<Utc>, tz: Tz) -> String {
    t.with_timezone(&tz).to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;
    use crate::domain::{Category, TimeEntry};

    fn cat(name: &str) -> Category {
        Category { id: meeting(), name: name.into(), color: "#000000".into() }
    }

    #[test]
    fn header_and_one_row() {
        let entries = vec![TimeEntry {
            id: uuid::Uuid::new_v4(),
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T13:00:00Z"),
            ended_at: Some(t("2026-05-22T13:30:00Z")),
            note: Some("standup".into()),
        }];
        let csv = entries_to_csv(&entries, &[cat("Meeting")], &[], chrono_tz::UTC);
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(lines[0], "started_at,ended_at,duration_minutes,category,project,note");
        assert!(lines[1].contains(",30,"));
        assert!(lines[1].ends_with("standup"));
    }

    #[test]
    fn quotes_commas_and_newlines() {
        let entries = vec![TimeEntry {
            id: uuid::Uuid::new_v4(),
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T13:00:00Z"),
            ended_at: Some(t("2026-05-22T13:30:00Z")),
            note: Some("hello, \"world\"\nnewline".into()),
        }];
        let csv = entries_to_csv(&entries, &[cat("Meeting")], &[], chrono_tz::UTC);
        assert!(csv.contains("\"hello, \"\"world\"\"\nnewline\""));
    }

    #[test]
    fn running_entry_has_empty_end_and_duration() {
        let entries = vec![TimeEntry {
            id: uuid::Uuid::new_v4(),
            category_id: meeting(),
            project_id: None,
            started_at: t("2026-05-22T13:00:00Z"),
            ended_at: None,
            note: None,
        }];
        let csv = entries_to_csv(&entries, &[cat("Meeting")], &[], chrono_tz::UTC);
        let row = csv.lines().nth(1).unwrap();
        // started_at,ended_at(empty),duration(empty),category,project(empty),note(empty)
        assert!(row.contains(",,"));
        assert!(row.ends_with(",Meeting,,"));
    }
}
