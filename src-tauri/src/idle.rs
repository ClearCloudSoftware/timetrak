//! Idle-return detection. Pure state machine — the OS poll loop lives in main.rs.

use chrono::{DateTime, Duration, Utc};

pub enum IdleAction {
    None,
    Prompt { idle_started_at: DateTime<Utc> },
}

#[derive(Default)]
pub struct IdleWatcher {
    idle_since: Option<DateTime<Utc>>,
}

impl IdleWatcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one sample. threshold_secs <= 0 disables.
    pub fn observe(
        &mut self,
        now: DateTime<Utc>,
        idle_secs: f64,
        threshold_secs: f64,
        timer_running: bool,
    ) -> IdleAction {
        if threshold_secs <= 0.0 || !timer_running {
            self.idle_since = None;
            return IdleAction::None;
        }
        if idle_secs >= threshold_secs {
            // Anchor the idle start from the OS counter, not our poll time.
            self.idle_since = Some(now - Duration::milliseconds((idle_secs * 1000.0) as i64));
            return IdleAction::None;
        }
        // User is active again — prompt if we saw a full idle period.
        match self.idle_since.take() {
            Some(started) => IdleAction::Prompt { idle_started_at: started },
            None => IdleAction::None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn at(min: i64) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 24, 12, 0, 0).unwrap() + chrono::Duration::minutes(min)
    }

    #[test]
    fn prompts_once_when_user_returns_after_threshold() {
        let mut w = IdleWatcher::new();
        assert!(matches!(w.observe(at(0), 0.0, 600.0, true), IdleAction::None));
        assert!(matches!(w.observe(at(11), 660.0, 600.0, true), IdleAction::None)); // still away
        match w.observe(at(12), 2.0, 600.0, true) {
            // Anchored by the last away sample: at(11) minus 660s idle = at(0).
            IdleAction::Prompt { idle_started_at } => assert_eq!(idle_started_at, at(0)),
            IdleAction::None => panic!("expected prompt"),
        }
        // No duplicate prompt for the same period.
        assert!(matches!(w.observe(at(13), 5.0, 600.0, true), IdleAction::None));
    }

    #[test]
    fn no_prompt_below_threshold_or_without_timer_or_disabled() {
        let mut w = IdleWatcher::new();
        w.observe(at(0), 300.0, 600.0, true); // below threshold
        assert!(matches!(w.observe(at(1), 2.0, 600.0, true), IdleAction::None));
        let mut w2 = IdleWatcher::new();
        w2.observe(at(0), 900.0, 600.0, false); // no timer
        assert!(matches!(w2.observe(at(1), 2.0, 600.0, false), IdleAction::None));
        let mut w3 = IdleWatcher::new();
        w3.observe(at(0), 900.0, 0.0, true); // disabled
        assert!(matches!(w3.observe(at(1), 2.0, 0.0, true), IdleAction::None));
    }
}
