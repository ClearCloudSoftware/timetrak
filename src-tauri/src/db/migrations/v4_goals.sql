-- Weekly targets per category, in minutes.
CREATE TABLE IF NOT EXISTS weekly_goal (
  category_id    TEXT PRIMARY KEY REFERENCES category(id) ON DELETE CASCADE,
  target_minutes INTEGER NOT NULL CHECK (target_minutes > 0)
);
