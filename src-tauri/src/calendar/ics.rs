//! ICS calendar source.
//!
//! Fetches a private ICS URL over HTTPS, parses VEVENTs into
//! [`CalendarEvent`]s, and filters to a `[since, until)` window.
//!
//! Limitations (v1):
//! - RRULE expansion is not yet implemented. Events with RRULE emit
//!   their master DTSTART instance only; subsequent occurrences are
//!   silently skipped. Tracked for follow-up.
//! - RSVP filtering is not enforced: the ICS URL is anonymous, so we
//!   cannot identify "the user" among ATTENDEEs. All non-declined
//!   events are treated as accepted.

use std::io::BufReader;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};
use ical::IcalParser;

use crate::calendar::provider::CalendarProvider;
use crate::calendar::types::{CalendarEvent, DiscoveredCalendar};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct IcsCalendarConfig {
    pub id: String,
    pub display_name: String,
    pub url: String,
}

pub struct IcsProvider {
    sources: Vec<IcsCalendarConfig>,
    client: reqwest::Client,
}

impl IcsProvider {
    pub fn new(sources: Vec<IcsCalendarConfig>) -> Self {
        Self {
            sources,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl CalendarProvider for IcsProvider {
    async fn list_calendars(&self) -> AppResult<Vec<DiscoveredCalendar>> {
        Ok(self
            .sources
            .iter()
            .map(|s| DiscoveredCalendar {
                id: s.id.clone(),
                display_name: s.display_name.clone(),
            })
            .collect())
    }

    async fn fetch_events(
        &self,
        calendar_id: &str,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> AppResult<Vec<CalendarEvent>> {
        let cfg = self
            .sources
            .iter()
            .find(|s| s.id == calendar_id)
            .ok_or_else(|| AppError::NotFound(format!("ics calendar {calendar_id}")))?;
        let text = self
            .client
            .get(&cfg.url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("ics fetch: {e}")))?
            .text()
            .await
            .map_err(|e| AppError::Other(format!("ics body: {e}")))?;
        parse_ics(&text, calendar_id, since, until)
    }

    fn kind(&self) -> &'static str {
        "ics"
    }
}

/// Parse ICS text into events filtered by `[since, until)`.
/// Exposed `pub(crate)` for tests.
pub(crate) fn parse_ics(
    text: &str,
    calendar_id: &str,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
) -> AppResult<Vec<CalendarEvent>> {
    let mut out = Vec::new();
    let parser = IcalParser::new(BufReader::new(text.as_bytes()));
    for cal in parser {
        let cal = cal.map_err(|e| AppError::Other(format!("ics parse: {e:?}")))?;
        for ev in cal.events {
            if let Some(parsed) = build_event(&ev, calendar_id) {
                // Window filter: parsed.started_at < until && parsed.ended_at > since
                if parsed.started_at < until && parsed.ended_at > since {
                    out.push(parsed);
                }
            }
        }
    }
    Ok(out)
}

fn build_event(ev: &ical::parser::ical::component::IcalEvent, calendar_id: &str) -> Option<CalendarEvent> {
    let mut uid: Option<String> = None;
    let mut summary: Option<String> = None;
    let mut dtstart: Option<DtValue> = None;
    let mut dtend: Option<DtValue> = None;
    let mut last_modified: Option<DateTime<Utc>> = None;
    let mut dtstamp: Option<DateTime<Utc>> = None;
    let mut any_declined = false;

    for p in &ev.properties {
        match p.name.as_str() {
            "UID" => uid = p.value.clone(),
            "SUMMARY" => summary = p.value.clone(),
            "DTSTART" => dtstart = parse_dt(p),
            "DTEND" => dtend = parse_dt(p),
            "LAST-MODIFIED" => last_modified = p.value.as_deref().and_then(parse_utc_string),
            "DTSTAMP" => dtstamp = p.value.as_deref().and_then(parse_utc_string),
            "ATTENDEE" => {
                if let Some(params) = &p.params {
                    for (k, vs) in params {
                        if k.eq_ignore_ascii_case("PARTSTAT") {
                            if vs.iter().any(|v| v.eq_ignore_ascii_case("DECLINED")) {
                                any_declined = true;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Permissive: only filter out clearly-declined events.
    let rsvp_accepted = !any_declined;

    let uid = uid?;
    let title = summary.unwrap_or_default();
    let dtstart = dtstart?;
    // DTEND is optional in ICS; default to start + 0 for all-day, otherwise +1 hour.
    let dtend = dtend.unwrap_or_else(|| match &dtstart {
        DtValue::Date(d) => DtValue::Date(d.succ_opt().unwrap_or(*d)),
        DtValue::DateTime(t) => DtValue::DateTime(*t + chrono::Duration::hours(1)),
    });

    let (started_at, ended_at, is_all_day) = match (dtstart, dtend) {
        (DtValue::Date(a), DtValue::Date(b)) => (
            Utc.from_utc_datetime(&a.and_hms_opt(0, 0, 0).unwrap()),
            Utc.from_utc_datetime(&b.and_hms_opt(0, 0, 0).unwrap()),
            true,
        ),
        (DtValue::DateTime(a), DtValue::DateTime(b)) => (a, b, false),
        // Mixed: coerce by treating as DATE → midnight UTC.
        (a, b) => {
            let s = match a {
                DtValue::DateTime(t) => t,
                DtValue::Date(d) => Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap()),
            };
            let e = match b {
                DtValue::DateTime(t) => t,
                DtValue::Date(d) => Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap()),
            };
            (s, e, false)
        }
    };

    Some(CalendarEvent {
        source_event_id: uid,
        source_calendar_id: calendar_id.to_string(),
        title,
        started_at,
        ended_at,
        is_all_day,
        rsvp_accepted,
        updated_at: last_modified.or(dtstamp).unwrap_or_else(Utc::now),
    })
}

#[derive(Debug, Clone, Copy)]
enum DtValue {
    Date(NaiveDate),
    DateTime(DateTime<Utc>),
}

fn parse_dt(p: &ical::property::Property) -> Option<DtValue> {
    let raw = p.value.as_deref()?;
    let is_date_only = p
        .params
        .as_ref()
        .map(|ps| {
            ps.iter().any(|(k, vs)| {
                k.eq_ignore_ascii_case("VALUE") && vs.iter().any(|v| v.eq_ignore_ascii_case("DATE"))
            })
        })
        .unwrap_or(false);
    if is_date_only {
        // YYYYMMDD
        if raw.len() == 8 {
            let y: i32 = raw[0..4].parse().ok()?;
            let m: u32 = raw[4..6].parse().ok()?;
            let d: u32 = raw[6..8].parse().ok()?;
            return NaiveDate::from_ymd_opt(y, m, d).map(DtValue::Date);
        }
        return None;
    }
    parse_utc_string(raw).map(DtValue::DateTime)
}

fn parse_utc_string(raw: &str) -> Option<DateTime<Utc>> {
    // Common ICS encodings: 20260528T130000Z (UTC) or 20260528T130000 (floating, treated as UTC).
    let trimmed = raw.trim_end_matches('Z');
    let dt = NaiveDateTime::parse_from_str(trimmed, "%Y%m%dT%H%M%S").ok()?;
    Some(Utc.from_utc_datetime(&dt))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ICS_SAMPLE: &str = "\
BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Test//EN\r
BEGIN:VEVENT\r
UID:evt-1@example.com\r
DTSTART:20260528T130000Z\r
DTEND:20260528T140000Z\r
SUMMARY:Standup\r
LAST-MODIFIED:20260528T100000Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:evt-allday\r
DTSTART;VALUE=DATE:20260529\r
DTEND;VALUE=DATE:20260530\r
SUMMARY:Holiday\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:evt-declined\r
DTSTART:20260528T150000Z\r
DTEND:20260528T160000Z\r
SUMMARY:Skip me\r
ATTENDEE;PARTSTAT=DECLINED:mailto:user@example.com\r
END:VEVENT\r
END:VCALENDAR\r
";

    fn iso(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn parses_non_recurring_event() {
        let events = parse_ics(
            ICS_SAMPLE,
            "cal-a",
            iso("2026-05-28T00:00:00Z"),
            iso("2026-05-31T00:00:00Z"),
        )
        .unwrap();
        let standup = events
            .iter()
            .find(|e| e.source_event_id == "evt-1@example.com")
            .unwrap();
        assert_eq!(standup.title, "Standup");
        assert_eq!(standup.started_at, iso("2026-05-28T13:00:00Z"));
        assert_eq!(standup.ended_at, iso("2026-05-28T14:00:00Z"));
        assert_eq!(standup.source_calendar_id, "cal-a");
        assert!(!standup.is_all_day);
        assert!(standup.rsvp_accepted);
    }

    #[test]
    fn flags_all_day_events() {
        let events = parse_ics(
            ICS_SAMPLE,
            "cal-a",
            iso("2026-05-28T00:00:00Z"),
            iso("2026-05-31T00:00:00Z"),
        )
        .unwrap();
        let holiday = events
            .iter()
            .find(|e| e.source_event_id == "evt-allday")
            .unwrap();
        assert!(holiday.is_all_day);
    }

    #[test]
    fn marks_declined_events() {
        let events = parse_ics(
            ICS_SAMPLE,
            "cal-a",
            iso("2026-05-28T00:00:00Z"),
            iso("2026-05-31T00:00:00Z"),
        )
        .unwrap();
        let declined = events
            .iter()
            .find(|e| e.source_event_id == "evt-declined")
            .unwrap();
        assert!(!declined.rsvp_accepted);
    }

    #[test]
    fn filters_outside_window() {
        let events = parse_ics(
            ICS_SAMPLE,
            "cal-a",
            iso("2026-06-01T00:00:00Z"),
            iso("2026-06-02T00:00:00Z"),
        )
        .unwrap();
        assert!(events.is_empty());
    }
}
