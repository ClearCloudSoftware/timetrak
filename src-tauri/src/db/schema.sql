-- v1 schema for TimeTrak

CREATE TABLE IF NOT EXISTS category (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_entry (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  project_id  TEXT REFERENCES project(id) ON DELETE SET NULL,
  started_at  TEXT NOT NULL,                -- ISO-8601 UTC
  ended_at    TEXT,                         -- ISO-8601 UTC, NULL = running
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_time_entry_started_at ON time_entry (started_at);

-- Enforce at most one running entry at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_entry
  ON time_entry ((1)) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed default categories on first run; idempotent.
INSERT OR IGNORE INTO category (id, name, color) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Meeting', '#3b82f6'),
  ('00000000-0000-0000-0000-000000000002', 'Coding',  '#10b981'),
  ('00000000-0000-0000-0000-000000000003', 'Email',   '#f59e0b'),
  ('00000000-0000-0000-0000-000000000004', 'Break',   '#a855f7');

INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('schema_version', '1'),
  ('daily_summary_time', '18:00');
