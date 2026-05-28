use async_trait::async_trait;
use chrono::{DateTime, Utc};

use crate::calendar::types::{CalendarEvent, DiscoveredCalendar};
use crate::error::AppResult;

#[async_trait]
pub trait CalendarProvider: Send + Sync {
    async fn list_calendars(&self) -> AppResult<Vec<DiscoveredCalendar>>;
    async fn fetch_events(
        &self,
        calendar_id: &str,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> AppResult<Vec<CalendarEvent>>;
    fn kind(&self) -> &'static str;
}
