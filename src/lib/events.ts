import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { TimeEntry } from '../types';

export interface TimerChanged {
  running: TimeEntry | null;
}
export interface EntriesChanged {}
export interface CategoriesChanged {}
export interface ProjectsChanged {}

export const onTimerChanged = (cb: (e: TimerChanged) => void): Promise<UnlistenFn> =>
  listen<TimerChanged>('timer-changed', (evt) => cb(evt.payload));

export const onEntriesChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<EntriesChanged>('entries-changed', () => cb());

export const onCategoriesChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<CategoriesChanged>('categories-changed', () => cb());

export const onProjectsChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<ProjectsChanged>('projects-changed', () => cb());
