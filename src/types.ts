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
}

export interface NewEntry {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}

export interface EntryEdit {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}
