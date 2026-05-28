export type Id = string; // UUID v4

export interface Category {
  id: Id;
  name: string;
  color: string; // #RRGGBB
}

export interface Project {
  id: Id;
  name: string;
  color: string;
}

export interface TimeEntry {
  id: Id;
  category_id: Id;
  project_id: Id | null;
  started_at: string;   // ISO-8601 UTC
  ended_at: string | null;
  note: string | null;
  source: 'manual' | 'calendar';
  source_event_id: string | null;
  source_calendar_id: string | null;
  source_edited_locally: boolean;
}

export interface NewEntry {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  source?: 'manual' | 'calendar';
  source_event_id?: string | null;
  source_calendar_id?: string | null;
}

export interface CalendarStatus {
  connected: boolean;
  kind: 'oauth' | 'ics' | null;
  account_email: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  meeting_category_id: string | null;
  initial_backfill_days: number;
}

export interface EntryEdit {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}
