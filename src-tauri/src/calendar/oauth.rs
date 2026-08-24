//! Google OAuth 2.0 device-code flow + Calendar API client.
//!
//! Reference docs:
//! - https://developers.google.com/identity/protocols/oauth2/limited-input-device
//! - https://developers.google.com/calendar/api/v3/reference
//!
//! Bundled client ID:
//! The TimeTrak OAuth client is registered as a "TVs and Limited Input
//! Devices" client in the TimeTrak Google Cloud project. Its client ID
//! is embedded below; this is **not** a secret per RFC 8252. If a
//! deployment cannot register its own client, `TIMETRAK_GOOGLE_CLIENT_ID`
//! env var overrides at build time.

use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::calendar::provider::CalendarProvider;
use crate::calendar::types::{CalendarEvent, DiscoveredCalendar};
use crate::error::{AppError, AppResult};

/// Bundled at build time from the `TIMETRAK_GOOGLE_CLIENT_ID` env var.
pub const GOOGLE_CLIENT_ID: &str = match option_env!("TIMETRAK_GOOGLE_CLIENT_ID") {
    Some(v) => v,
    None => "REPLACE_ME.apps.googleusercontent.com",
};

/// Bundled at build time from the `TIMETRAK_GOOGLE_CLIENT_SECRET` env var.
/// Google requires the client_secret on the /token endpoint even for
/// "TVs and Limited Input Devices" clients. Per Google's own guidance,
/// this value is not actually secret in a desktop installation.
pub const GOOGLE_CLIENT_SECRET: &str = match option_env!("TIMETRAK_GOOGLE_CLIENT_SECRET") {
    Some(v) => v,
    None => "REPLACE_ME_SECRET",
};

/// Scope: read-only calendar access.
pub const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";

const DEVICE_CODE_URL: &str = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const CAL_API_BASE: &str = "https://www.googleapis.com/calendar/v3";

// ---------- Device-code flow ----------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_at: DateTime<Utc>,
}

/// Step 1: request a device + user code from Google.
pub async fn request_device_code(client: &reqwest::Client) -> AppResult<DeviceCodeResponse> {
    if GOOGLE_CLIENT_ID.starts_with("REPLACE_ME") {
        return Err(AppError::Invalid(
            "This build has no Google OAuth client baked in. Set TIMETRAK_GOOGLE_CLIENT_ID and \
             TIMETRAK_GOOGLE_CLIENT_SECRET in .env and rebuild (npm run tauri dev)."
                .into(),
        ));
    }
    let resp = client
        .post(DEVICE_CODE_URL)
        .form(&[("client_id", GOOGLE_CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| AppError::Other(format!("device code: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!("device code rejected: {body}")));
    }
    resp.json::<DeviceCodeResponse>()
        .await
        .map_err(|e| AppError::Other(format!("device code body: {e}")))
}

#[derive(Debug, Clone)]
pub enum PollOutcome {
    Pending,
    SlowDown,
    Approved(StoredTokens),
    Denied,
    Expired,
    Other(String),
}

/// Step 2 (called every `interval` seconds): exchange the device code for tokens.
pub async fn poll_token(
    client: &reqwest::Client,
    device_code: &str,
) -> AppResult<PollOutcome> {
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", GOOGLE_CLIENT_ID),
            ("client_secret", GOOGLE_CLIENT_SECRET),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Other(format!("token poll: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("token body: {e}")))?;

    if status.is_success() {
        let tok: TokenResponse = serde_json::from_value(body)
            .map_err(|e| AppError::Other(format!("token parse: {e}")))?;
        let refresh = tok
            .refresh_token
            .ok_or_else(|| AppError::Other("missing refresh_token from Google".into()))?;
        return Ok(PollOutcome::Approved(StoredTokens {
            access_token: tok.access_token,
            refresh_token: refresh,
            access_expires_at: Utc::now() + chrono::Duration::seconds(tok.expires_in as i64),
        }));
    }

    let err = body.get("error").and_then(|v| v.as_str()).unwrap_or("");
    let desc = body.get("error_description").and_then(|v| v.as_str()).unwrap_or("");
    Ok(match err {
        "authorization_pending" => PollOutcome::Pending,
        "slow_down" => PollOutcome::SlowDown,
        "access_denied" => PollOutcome::Denied,
        "expired_token" => PollOutcome::Expired,
        other => PollOutcome::Other(if desc.is_empty() {
            other.to_string()
        } else {
            format!("{other}: {desc}")
        }),
    })
}

/// Refresh an access token using its refresh token. Returns the new stored tokens
/// (refresh_token may be the same as before).
pub async fn refresh_access_token(
    client: &reqwest::Client,
    refresh_token: &str,
) -> AppResult<StoredTokens> {
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("client_id", GOOGLE_CLIENT_ID),
            ("client_secret", GOOGLE_CLIENT_SECRET),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Other(format!("refresh: {e}")))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Other(format!("refresh rejected: {body}")));
    }
    let tok: TokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("refresh body: {e}")))?;
    Ok(StoredTokens {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token.unwrap_or_else(|| refresh_token.to_string()),
        access_expires_at: Utc::now() + chrono::Duration::seconds(tok.expires_in as i64),
    })
}

/// Best-effort revocation. Errors are swallowed (per RFC the local
/// disconnect is still authoritative).
pub async fn revoke_token(client: &reqwest::Client, refresh_token: &str) {
    let _ = client
        .post(REVOKE_URL)
        .form(&[("token", refresh_token)])
        .send()
        .await;
}

// ---------- Calendar API ----------

#[derive(Debug, Deserialize)]
struct CalendarListResponse {
    items: Vec<CalendarListItem>,
}

#[derive(Debug, Deserialize)]
struct CalendarListItem {
    id: String,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default, rename = "summaryOverride")]
    summary_override: Option<String>,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct EventsResponse {
    items: Vec<EventItem>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EventItem {
    id: String,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    status: Option<String>, // "confirmed" | "tentative" | "cancelled"
    start: Option<EventTime>,
    end: Option<EventTime>,
    #[serde(default)]
    attendees: Vec<Attendee>,
    #[serde(default)]
    updated: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EventTime {
    #[serde(default, rename = "dateTime")]
    date_time: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Attendee {
    #[serde(default)]
    email: Option<String>,
    #[serde(default, rename = "responseStatus")]
    response_status: Option<String>, // accepted | declined | tentative | needsAction
    #[serde(default, rename = "self")]
    self_: bool,
}

pub struct OAuthProvider {
    client: reqwest::Client,
    access_token: String,
}

impl OAuthProvider {
    pub fn new(access_token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            access_token,
        }
    }
}

#[async_trait]
impl CalendarProvider for OAuthProvider {
    async fn list_calendars(&self) -> AppResult<Vec<DiscoveredCalendar>> {
        let resp = self
            .client
            .get(format!("{CAL_API_BASE}/users/me/calendarList"))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("calendarList: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Other(format!("calendarList: {}", resp.status())));
        }
        let parsed: CalendarListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Other(format!("calendarList body: {e}")))?;
        Ok(parsed
            .items
            .into_iter()
            .map(|c| DiscoveredCalendar {
                display_name: c.summary_override.or(c.summary).unwrap_or_else(|| c.id.clone()),
                primary: c.primary,
                id: c.id,
            })
            .collect())
    }

    async fn fetch_events(
        &self,
        calendar_id: &str,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> AppResult<Vec<CalendarEvent>> {
        let mut all: Vec<CalendarEvent> = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut query: Vec<(&str, String)> = vec![
                ("timeMin", since.to_rfc3339()),
                ("timeMax", until.to_rfc3339()),
                ("singleEvents", "true".into()),
                ("maxResults", "250".into()),
                ("orderBy", "startTime".into()),
            ];
            if let Some(tok) = &page_token {
                query.push(("pageToken", tok.clone()));
            }
            let resp = self
                .client
                .get(format!(
                    "{CAL_API_BASE}/calendars/{}/events",
                    urlencode(calendar_id)
                ))
                .bearer_auth(&self.access_token)
                .query(&query)
                .send()
                .await
                .map_err(|e| AppError::Other(format!("events: {e}")))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::Other(format!("events {status}: {body}")));
            }
            let parsed: EventsResponse = resp
                .json()
                .await
                .map_err(|e| AppError::Other(format!("events body: {e}")))?;
            for it in parsed.items {
                if let Some(e) = build_event(it, calendar_id) {
                    all.push(e);
                }
            }
            match parsed.next_page_token {
                Some(t) if !t.is_empty() => page_token = Some(t),
                _ => break,
            }
        }
        Ok(all)
    }

    fn kind(&self) -> &'static str {
        "oauth"
    }
}

fn build_event(it: EventItem, calendar_id: &str) -> Option<CalendarEvent> {
    if it.status.as_deref() == Some("cancelled") {
        return None;
    }
    let start = it.start.as_ref()?;
    let end = it.end.as_ref()?;
    let is_all_day = start.date.is_some();
    let (started_at, ended_at) = if is_all_day {
        let s_date: chrono::NaiveDate = start.date.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())?;
        let e_date: chrono::NaiveDate = end.date.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())?;
        (
            Utc.from_utc_datetime(&s_date.and_hms_opt(0, 0, 0).unwrap()),
            Utc.from_utc_datetime(&e_date.and_hms_opt(0, 0, 0).unwrap()),
        )
    } else {
        let s = start.date_time.as_deref()?;
        let e = end.date_time.as_deref()?;
        (
            DateTime::parse_from_rfc3339(s).ok()?.with_timezone(&Utc),
            DateTime::parse_from_rfc3339(e).ok()?.with_timezone(&Utc),
        )
    };
    // RSVP: if `self` attendee exists, honor its responseStatus. Otherwise treat as accepted.
    let rsvp_accepted = match it.attendees.iter().find(|a| a.self_) {
        Some(a) => matches!(a.response_status.as_deref(), Some("accepted") | None),
        None => true,
    };
    let updated_at = it
        .updated
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    Some(CalendarEvent {
        source_event_id: it.id,
        source_calendar_id: calendar_id.to_string(),
        title: it.summary.unwrap_or_default(),
        started_at,
        ended_at,
        is_all_day,
        rsvp_accepted,
        updated_at,
    })
}

use chrono::TimeZone;

fn urlencode(s: &str) -> String {
    // Minimal percent-encoding for the calendar ID path segment.
    s.chars()
        .flat_map(|c| {
            if c.is_ascii_alphanumeric() || "-_.~@".contains(c) {
                vec![c]
            } else {
                let mut buf = [0u8; 4];
                let bytes = c.encode_utf8(&mut buf).as_bytes().to_vec();
                let mut out: Vec<char> = Vec::new();
                for b in bytes {
                    out.extend(format!("%{:02X}", b).chars());
                }
                out
            }
        })
        .collect()
}

// ---------- Backwards-compatible polling helpers ----------

/// Sleep with jitter — used by callers polling poll_token in a loop.
pub async fn sleep_interval(seconds: u64) {
    tokio::time::sleep(Duration::from_secs(seconds.max(1))).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_handles_calendar_ids() {
        assert_eq!(urlencode("primary"), "primary");
        assert_eq!(urlencode("user@example.com"), "user@example.com");
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("a/b"), "a%2Fb");
    }

    #[test]
    fn build_event_rejects_cancelled() {
        let it = EventItem {
            id: "x".into(),
            summary: Some("S".into()),
            status: Some("cancelled".into()),
            start: Some(EventTime { date_time: Some("2026-05-28T10:00:00Z".into()), date: None }),
            end: Some(EventTime { date_time: Some("2026-05-28T11:00:00Z".into()), date: None }),
            attendees: vec![],
            updated: None,
        };
        assert!(build_event(it, "cal").is_none());
    }

    #[test]
    fn build_event_marks_self_declined() {
        let it = EventItem {
            id: "x".into(),
            summary: Some("S".into()),
            status: Some("confirmed".into()),
            start: Some(EventTime { date_time: Some("2026-05-28T10:00:00Z".into()), date: None }),
            end: Some(EventTime { date_time: Some("2026-05-28T11:00:00Z".into()), date: None }),
            attendees: vec![Attendee {
                email: Some("me@x.com".into()),
                response_status: Some("declined".into()),
                self_: true,
            }],
            updated: None,
        };
        let ev = build_event(it, "cal").unwrap();
        assert!(!ev.rsvp_accepted);
    }

    #[test]
    fn build_event_no_self_treats_as_accepted() {
        let it = EventItem {
            id: "x".into(),
            summary: Some("S".into()),
            status: Some("confirmed".into()),
            start: Some(EventTime { date_time: Some("2026-05-28T10:00:00Z".into()), date: None }),
            end: Some(EventTime { date_time: Some("2026-05-28T11:00:00Z".into()), date: None }),
            attendees: vec![],
            updated: None,
        };
        let ev = build_event(it, "cal").unwrap();
        assert!(ev.rsvp_accepted);
    }

    #[test]
    fn build_event_handles_all_day() {
        let it = EventItem {
            id: "x".into(),
            summary: Some("Holiday".into()),
            status: Some("confirmed".into()),
            start: Some(EventTime { date_time: None, date: Some("2026-05-30".into()) }),
            end: Some(EventTime { date_time: None, date: Some("2026-05-31".into()) }),
            attendees: vec![],
            updated: None,
        };
        let ev = build_event(it, "cal").unwrap();
        assert!(ev.is_all_day);
    }
}
