use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::Connection;
use uuid::Uuid;

use crate::domain::Category;
use crate::error::AppResult;
use crate::repo;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DayTotal {
    pub date: NaiveDate,
    pub category_id: Uuid,
    pub project_id: Option<Uuid>,
    pub seconds: i64,
}

/// Bucket entries into per-local-day, per-category, per-project totals
/// within [start, end). Entries crossing local-midnight are split.
pub fn day_totals(
    conn: &Connection,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    local_tz: Tz,
) -> AppResult<Vec<DayTotal>> {
    let entries = repo::entries::list_in_range(conn, start, end)?;
    let mut buckets: std::collections::BTreeMap<(NaiveDate, Uuid, Option<Uuid>), i64> =
        std::collections::BTreeMap::new();

    for e in entries {
        let entry_end = e.ended_at.unwrap_or(end).min(end);
        let entry_start = e.started_at.max(start);
        if entry_end <= entry_start { continue; }

        // Walk by local days
        let mut cursor = entry_start;
        while cursor < entry_end {
            let local = cursor.with_timezone(&local_tz);
            let day = local.date_naive();
            let next_local_midnight = local_tz
                .from_local_datetime(&(day.succ_opt().unwrap()).and_hms_opt(0, 0, 0).unwrap())
                .single()
                .map(|t| t.with_timezone(&Utc))
                .unwrap_or(entry_end);
            let segment_end = entry_end.min(next_local_midnight);
            let seconds = (segment_end - cursor).num_seconds().max(0);
            *buckets.entry((day, e.category_id, e.project_id)).or_insert(0) += seconds;
            cursor = segment_end;
        }
    }

    Ok(buckets
        .into_iter()
        .map(|((date, category_id, project_id), seconds)| DayTotal {
            date, category_id, project_id, seconds,
        })
        .collect())
}

/// Totals for "today" in the user's local timezone, grouped by category.
pub fn today_totals(conn: &Connection, local_tz: Tz) -> AppResult<Vec<(Category, i64)>> {
    let now_local = Utc::now().with_timezone(&local_tz);
    let day = now_local.date_naive();
    let start_local = local_tz.from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap()).single().unwrap();
    let end_local = local_tz.from_local_datetime(&day.succ_opt().unwrap().and_hms_opt(0, 0, 0).unwrap()).single().unwrap();
    let start = start_local.with_timezone(&Utc);
    let end = end_local.with_timezone(&Utc);

    let totals = day_totals(conn, start, end, local_tz)?;
    let categories = repo::categories::list(conn)?;

    let mut by_cat: std::collections::BTreeMap<Uuid, i64> = Default::default();
    for d in totals {
        *by_cat.entry(d.category_id).or_insert(0) += d.seconds;
    }
    Ok(categories
        .into_iter()
        .filter_map(|c| by_cat.get(&c.id).copied().map(|s| (c, s)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn day_totals_single_entry_within_day() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_closed(&conn, meeting(), "2026-05-22T13:00:00Z", "2026-05-22T14:30:00Z");
        let res = day_totals(
            &conn,
            t("2026-05-22T00:00:00Z"),
            t("2026-05-23T00:00:00Z"),
            chrono_tz::UTC,
        ).unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].seconds, 90 * 60);
    }

    #[test]
    fn day_totals_splits_at_local_midnight() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        // 23:30Z to 01:30Z spans UTC midnight -> two days under UTC tz
        insert_closed(&conn, meeting(), "2026-05-22T23:30:00Z", "2026-05-23T01:30:00Z");
        let res = day_totals(
            &conn,
            t("2026-05-22T00:00:00Z"),
            t("2026-05-24T00:00:00Z"),
            chrono_tz::UTC,
        ).unwrap();
        assert_eq!(res.len(), 2);
        assert_eq!(res[0].seconds, 30 * 60);
        assert_eq!(res[1].seconds, 90 * 60);
    }
}
