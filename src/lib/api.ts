import { invoke } from '@tauri-apps/api/core';
import type { Category, Project, TimeEntry, NewEntry, EntryEdit, Id } from '../types';

/**
 * Typed wrappers over Tauri invoke. Each follow-up plan implements
 * its block of functions; this file is the only place that touches
 * `@tauri-apps/api`.
 */

// --- Categories (plan 04) ---
export const listCategories = () => invoke<Category[]>('list_categories');
export const createCategory = (name: string, color: string) =>
  invoke<Category>('create_category', { name, color });
export const updateCategory = (id: Id, name: string, color: string) =>
  invoke<Category>('update_category', { id, name, color });
export const deleteCategory = (id: Id, cascadeEntries: boolean) =>
  invoke<void>('delete_category', { id, cascadeEntries });

// --- Projects (plan 04) ---
export const listProjects = () => invoke<Project[]>('list_projects');
export const createProject = (name: string, color: string) =>
  invoke<Project>('create_project', { name, color });
export const updateProject = (id: Id, name: string, color: string) =>
  invoke<Project>('update_project', { id, name, color });
export const deleteProject = (id: Id) =>
  invoke<void>('delete_project', { id });

// --- Entries (plan 03) ---
export const listEntries = (startUtc: string, endUtc: string) =>
  invoke<TimeEntry[]>('list_entries', { startUtc, endUtc });
export const createEntry = (entry: NewEntry) =>
  invoke<TimeEntry>('create_entry', { entry });
export const updateEntry = (id: Id, edit: EntryEdit) =>
  invoke<TimeEntry>('update_entry', { id, edit });
export const deleteEntry = (id: Id) =>
  invoke<void>('delete_entry', { id });

// --- Timer (plan 02) ---
export interface TimerState {
  running: TimeEntry | null;
}
export const getTimerState = () => invoke<TimerState>('get_timer_state');
export const startTimer = (categoryId: Id, projectId: Id | null, note: string | null) =>
  invoke<TimeEntry>('start_timer', { categoryId, projectId, note });
export const stopTimer = () => invoke<TimeEntry | null>('stop_timer');
export const switchTimer = (categoryId: Id, projectId: Id | null, note: string | null) =>
  invoke<TimeEntry>('switch_timer', { categoryId, projectId, note });

// --- Export (plan 03) ---
export const exportCsv = (startUtc: string, endUtc: string) =>
  invoke<string>('export_csv', { startUtc, endUtc });

// --- Windows (v0.2) ---
export const openWindow = (name: 'dashboard' | 'settings') =>
  invoke<void>('open_window', { name });
export const requestNewEntry = () => invoke<void>('request_new_entry');
export const consumePendingNewEntry = () => invoke<boolean>('consume_pending_new_entry');
