-- Schema v2: calendar integration.

ALTER TABLE time_entry ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE time_entry ADD COLUMN source_event_id TEXT;
ALTER TABLE time_entry ADD COLUMN source_calendar_id TEXT;
ALTER TABLE time_entry ADD COLUMN source_edited_locally INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_time_entry_source_event
  ON time_entry (source_calendar_id, source_event_id);

CREATE TABLE IF NOT EXISTS calendar_source (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,            -- 'oauth' | 'ics'
  account_email   TEXT,
  keychain_ref    TEXT NOT NULL,
  connected_at    TEXT NOT NULL,
  last_sync_at    TEXT,
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS calendar (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_calendar_import (
  id                  TEXT PRIMARY KEY,
  source_event_id     TEXT NOT NULL,
  source_calendar_id  TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  ended_at            TEXT NOT NULL,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL,
  detected_at         TEXT NOT NULL,
  resolved_action     TEXT,
  resolved_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_status
  ON pending_calendar_import (status);

INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('initial_backfill_days', '14');

INSERT OR IGNORE INTO app_meta (key, value)
  SELECT 'meeting_category_id', id FROM category WHERE name = 'Meeting' LIMIT 1;
