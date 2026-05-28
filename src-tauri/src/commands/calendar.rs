use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::calendar::ics::{IcsCalendarConfig, IcsProvider};
use crate::calendar::oauth::{self, PollOutcome};
use crate::calendar::secret_store;
use crate::calendar::provider::CalendarProvider;
use crate::calendar::sync::{self, StoredOAuth, SyncReport};
use crate::calendar::types::{CalendarRow, CalendarSource, DiscoveredCalendar, PendingImport, ResolutionAction};
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::repo;

const KEYCHAIN_REF_ICS: &str = "calendar.ics.v1";
const KEYCHAIN_REF_OAUTH: &str = "calendar.oauth.v1";

#[derive(Serialize)]
pub struct CalendarStatus {
    pub connected: bool,
    pub kind: Option<String>,
    pub account_email: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_sync_error: Option<String>,
    pub meeting_category_id: Option<String>,
    pub initial_backfill_days: i64,
    pub poll_interval_minutes: i64,
    pub extend_meeting_minutes: i64,
}

#[tauri::command]
pub fn calendar_status(db: State<'_, Database>) -> AppResult<CalendarStatus> {
    let conn = db.conn.lock().unwrap();
    let src = repo::calendar_source::get(&conn)?;
    let meeting: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'meeting_category_id'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let backfill = read_meta_i64(&conn, "initial_backfill_days", 14);
    let poll_interval = read_meta_i64(&conn, "poll_interval_minutes", 30);
    let extend = read_meta_i64(&conn, "extend_meeting_minutes", 15);
    Ok(CalendarStatus {
        connected: src.is_some(),
        kind: src.as_ref().map(|s| s.kind.clone()),
        account_email: src.as_ref().and_then(|s| s.account_email.clone()),
        last_sync_at: src.as_ref().and_then(|s| s.last_sync_at.map(|t| t.to_rfc3339())),
        last_sync_error: src.as_ref().and_then(|s| s.last_sync_error.clone()),
        meeting_category_id: meeting,
        initial_backfill_days: backfill,
        poll_interval_minutes: poll_interval,
        extend_meeting_minutes: extend,
    })
}

fn read_meta_i64(conn: &rusqlite::Connection, key: &str, default: i64) -> i64 {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(default)
}

fn write_meta_i64(conn: &rusqlite::Connection, key: &str, value: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, &value.to_string()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn set_initial_backfill_days(db: State<'_, Database>, days: i64) -> AppResult<()> {
    if !(1..=90).contains(&days) {
        return Err(AppError::Invalid("days must be between 1 and 90".into()));
    }
    let conn = db.conn.lock().unwrap();
    write_meta_i64(&conn, "initial_backfill_days", days)
}

#[tauri::command]
pub fn set_poll_interval_minutes(db: State<'_, Database>, minutes: i64) -> AppResult<()> {
    if !(5..=60).contains(&minutes) {
        return Err(AppError::Invalid("minutes must be between 5 and 60".into()));
    }
    let conn = db.conn.lock().unwrap();
    write_meta_i64(&conn, "poll_interval_minutes", minutes)
}

#[tauri::command]
pub fn set_extend_meeting_minutes(db: State<'_, Database>, minutes: i64) -> AppResult<()> {
    if !(5..=60).contains(&minutes) {
        return Err(AppError::Invalid("minutes must be between 5 and 60".into()));
    }
    let conn = db.conn.lock().unwrap();
    write_meta_i64(&conn, "extend_meeting_minutes", minutes)
}

#[tauri::command]
pub fn set_meeting_category(db: State<'_, Database>, id: Uuid) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM category WHERE id = ?1",
        [id.to_string()],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("category {}", id)));
    }
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('meeting_category_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [id.to_string()],
    )?;
    Ok(())
}

// ---------- ICS connect ----------

#[derive(Deserialize)]
pub struct IcsInput {
    pub display_name: String,
    pub url: String,
}

#[tauri::command]
pub async fn calendar_connect_ics(
    db: State<'_, Database>,
    app: AppHandle,
    sources: Vec<IcsInput>,
) -> AppResult<()> {
    if sources.is_empty() {
        return Err(AppError::Invalid("at least one ICS URL is required".into()));
    }
    let configs: Vec<IcsCalendarConfig> = sources
        .into_iter()
        .map(|s| IcsCalendarConfig {
            id: Uuid::new_v4().to_string(),
            display_name: s.display_name,
            url: s.url,
        })
        .collect();

    let provider = IcsProvider::new(configs.clone());
    let discovered = provider.list_calendars().await?;

    let configs_json = serde_json::to_string(&configs).unwrap();

    {
        let conn = db.conn.lock().unwrap();
        secret_store::put(&conn, KEYCHAIN_REF_ICS, &configs_json)?;
        repo::calendar_source::clear(&conn)?;
        repo::calendar_source::set(
            &conn,
            &CalendarSource {
                id: Uuid::new_v4(),
                kind: "ics".into(),
                account_email: None,
                keychain_ref: KEYCHAIN_REF_ICS.into(),
                connected_at: Utc::now(),
                last_sync_at: None,
                last_sync_error: None,
            },
        )?;
        repo::calendars::upsert_many(&conn, &discovered)?;
        for d in &discovered {
            repo::calendars::set_enabled(&conn, &d.id, true)?;
        }
    }

    let _ = app.emit_to_all("calendar-connected", ());
    Ok(())
}

// ---------- OAuth connect (device-code) ----------

pub struct DeviceCodeState(pub std::sync::Mutex<Option<DeviceCodeSession>>);

#[derive(Clone)]
pub struct DeviceCodeSession {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_at: chrono::DateTime<Utc>,
    pub interval: u64,
}

#[derive(Serialize)]
pub struct DeviceCodePayload {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: i64,
    pub interval: u64,
}

#[tauri::command]
pub async fn calendar_connect_start(
    state: State<'_, DeviceCodeState>,
) -> AppResult<DeviceCodePayload> {
    let client = reqwest::Client::new();
    let resp = oauth::request_device_code(&client).await?;
    let session = DeviceCodeSession {
        device_code: resp.device_code.clone(),
        user_code: resp.user_code.clone(),
        verification_url: resp.verification_url.clone(),
        expires_at: Utc::now() + chrono::Duration::seconds(resp.expires_in as i64),
        interval: resp.interval.max(1),
    };
    *state.0.lock().unwrap() = Some(session.clone());
    Ok(DeviceCodePayload {
        user_code: session.user_code,
        verification_url: session.verification_url,
        expires_in: resp.expires_in as i64,
        interval: session.interval,
    })
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectPollResult {
    Pending,
    SlowDown,
    Approved { account_email: Option<String> },
    Denied,
    Expired,
    Error { message: String },
}

#[tauri::command]
pub async fn calendar_connect_complete(
    db: State<'_, Database>,
    state: State<'_, DeviceCodeState>,
    app: AppHandle,
) -> AppResult<ConnectPollResult> {
    let session = state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| AppError::Invalid("no pending device-code session".into()))?;
    if Utc::now() > session.expires_at {
        *state.0.lock().unwrap() = None;
        return Ok(ConnectPollResult::Expired);
    }
    let client = reqwest::Client::new();
    let outcome = oauth::poll_token(&client, &session.device_code).await?;
    Ok(match outcome {
        PollOutcome::Pending => ConnectPollResult::Pending,
        PollOutcome::SlowDown => ConnectPollResult::SlowDown,
        PollOutcome::Denied => {
            *state.0.lock().unwrap() = None;
            ConnectPollResult::Denied
        }
        PollOutcome::Expired => {
            *state.0.lock().unwrap() = None;
            ConnectPollResult::Expired
        }
        PollOutcome::Other(m) => ConnectPollResult::Error { message: m },
        PollOutcome::Approved(tokens) => {
            let email = fetch_userinfo_email(&client, &tokens.access_token).await.ok();
            let stored = StoredOAuth {
                access_token: tokens.access_token.clone(),
                refresh_token: tokens.refresh_token,
                access_expires_at: tokens.access_expires_at,
                account_email: email.clone(),
            };
            let stored_json = serde_json::to_string(&stored).unwrap();

            {
                let conn = db.conn.lock().unwrap();
                secret_store::put(&conn, KEYCHAIN_REF_OAUTH, &stored_json)?;
                repo::calendar_source::clear(&conn)?;
                repo::calendar_source::set(
                    &conn,
                    &CalendarSource {
                        id: Uuid::new_v4(),
                        kind: "oauth".into(),
                        account_email: email.clone(),
                        keychain_ref: KEYCHAIN_REF_OAUTH.into(),
                        connected_at: Utc::now(),
                        last_sync_at: None,
                        last_sync_error: None,
                    },
                )?;
            }

            let provider = crate::calendar::oauth::OAuthProvider::new(tokens.access_token);
            let discovered = provider.list_calendars().await.ok();
            if let Some(d) = discovered {
                let conn = db.conn.lock().unwrap();
                let _ = repo::calendars::upsert_many(&conn, &d);
            }

            *state.0.lock().unwrap() = None;
            let _ = app.emit_to_all("calendar-connected", ());
            ConnectPollResult::Approved { account_email: email }
        }
    })
}

#[tauri::command]
pub async fn calendar_disconnect(db: State<'_, Database>, app: AppHandle) -> AppResult<()> {
    let src = {
        let conn = db.conn.lock().unwrap();
        repo::calendar_source::get(&conn)?
    };

    let oauth_json = if let Some(s) = &src {
        if s.kind == "oauth" {
            let conn = db.conn.lock().unwrap();
            secret_store::get(&conn, &s.keychain_ref)?
        } else {
            None
        }
    } else {
        None
    };

    if let Some(json) = oauth_json {
        if let Ok(stored) = serde_json::from_str::<StoredOAuth>(&json) {
            oauth::revoke_token(&reqwest::Client::new(), &stored.refresh_token).await;
        }
    }

    {
        let conn = db.conn.lock().unwrap();
        if let Some(s) = &src {
            let _ = secret_store::delete(&conn, &s.keychain_ref);
        }
        repo::calendar_source::clear(&conn)?;
        conn.execute("DELETE FROM calendar", [])?;
        conn.execute("DELETE FROM pending_calendar_import WHERE status = 'pending_conflict'", [])?;
        conn.execute(
            "UPDATE time_entry SET source = 'manual', source_event_id = NULL, source_calendar_id = NULL, source_edited_locally = 0
             WHERE source = 'calendar'",
            [],
        )?;
    }

    let _ = app.emit_to_all("calendar-connected", ());
    Ok(())
}

#[tauri::command]
pub fn calendar_list_calendars(db: State<'_, Database>) -> AppResult<Vec<CalendarRow>> {
    let conn = db.conn.lock().unwrap();
    repo::calendars::list(&conn)
}

#[tauri::command]
pub fn calendar_toggle_calendar(
    db: State<'_, Database>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    repo::calendars::set_enabled(&conn, &id, enabled)
}

#[tauri::command]
pub async fn calendar_sync_now(app: AppHandle) -> AppResult<SyncReport> {
    let db = app.state::<Database>();
    sync::sync_now(&db, &app).await
}

async fn fetch_userinfo_email(client: &reqwest::Client, access_token: &str) -> AppResult<String> {
    let resp = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("userinfo: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("userinfo: {}", resp.status())));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("userinfo body: {e}")))?;
    Ok(v.get("email")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string())
}

// ---------- Pending conflicts ----------

#[tauri::command]
pub fn pending_conflicts_list(db: State<'_, Database>) -> AppResult<Vec<PendingImport>> {
    let conn = db.conn.lock().unwrap();
    repo::pending_imports::list_pending(&conn)
}

#[tauri::command]
pub fn pending_conflict_resolve(
    db: State<'_, Database>,
    app: AppHandle,
    id: Uuid,
    action: ResolutionAction,
) -> AppResult<()> {
    {
        let conn = db.conn.lock().unwrap();
        let pending = repo::pending_imports::list_pending(&conn)?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("pending {id}")))?;

        match action {
            ResolutionAction::KeptMine | ResolutionAction::Edited => {
                repo::pending_imports::resolve(&conn, id, action)?;
            }
            ResolutionAction::UsedCalendar => {
                // In one transaction: delete overlapping non-edited entries,
                // create the calendar entry, mark resolved.
                let tx = conn.unchecked_transaction()?;
                let overlapping = repo::entries::list_in_range(
                    &tx,
                    pending.started_at,
                    pending.ended_at,
                )?;
                for e in overlapping {
                    // Don't touch other source-linked entries that the user has edited.
                    if e.source_edited_locally {
                        continue;
                    }
                    repo::entries::delete(&tx, e.id)?;
                }
                let meeting_cat: String = tx.query_row(
                    "SELECT value FROM app_meta WHERE key = 'meeting_category_id'",
                    [],
                    |r| r.get(0),
                ).map_err(|_| AppError::Invalid("meeting_category_id not set".into()))?;
                let meeting_cat = Uuid::parse_str(&meeting_cat)
                    .map_err(|e| AppError::Other(e.to_string()))?;
                repo::entries::create(&tx, &crate::domain::NewEntry {
                    category_id: meeting_cat,
                    project_id: None,
                    started_at: pending.started_at,
                    ended_at: Some(pending.ended_at),
                    note: Some(pending.title.clone()),
                    source: "calendar".into(),
                    source_event_id: Some(pending.source_event_id.clone()),
                    source_calendar_id: Some(pending.source_calendar_id.clone()),
                })?;
                repo::pending_imports::resolve(&tx, id, action)?;
                tx.commit()?;
            }
        }
    }
    let _ = app.emit_to_all("calendar-conflicts-changed", ());
    let _ = app.emit_to_all(crate::events::ENTRIES_CHANGED, ());
    Ok(())
}

// ---------- tauri emit helper ----------
trait EmitToAll {
    fn emit_to_all<S: Serialize + Clone>(&self, event: &str, payload: S) -> tauri::Result<()>;
}
impl EmitToAll for AppHandle {
    fn emit_to_all<S: Serialize + Clone>(&self, event: &str, payload: S) -> tauri::Result<()> {
        use tauri::Emitter;
        self.emit(event, payload)
    }
}
