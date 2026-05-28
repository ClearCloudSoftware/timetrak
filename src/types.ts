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

export interface CalendarRow {
  id: string;
  display_name: string;
  enabled: boolean;
}

export interface IcsInput {
  display_name: string;
  url: string;
}

export interface DeviceCodePayload {
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export type ConnectPollResult =
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'approved'; account_email: string | null }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export interface SyncReport {
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
  skipped_filter: number;
  skipped_edited: number;
  error: string | null;
}

export interface PendingImport {
  id: string;
  source_event_id: string;
  source_calendar_id: string;
  started_at: string;
  ended_at: string;
  title: string;
  status: string;
  detected_at: string;
  resolved_action: string | null;
  resolved_at: string | null;
}

export type ResolutionAction = 'kept_mine' | 'used_calendar' | 'edited';

export interface EntryEdit {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}
