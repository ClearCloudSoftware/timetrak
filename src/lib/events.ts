import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { TimeEntry } from '../types';
import {
  EVENT_TIMER_CHANGED,
  EVENT_ENTRIES_CHANGED,
  EVENT_CATEGORIES_CHANGED,
  EVENT_PROJECTS_CHANGED,
} from './event-names';

export interface TimerChanged {
  running: TimeEntry | null;
}
export interface EntriesChanged {}
export interface CategoriesChanged {}
export interface ProjectsChanged {}

export const onTimerChanged = (cb: (e: TimerChanged) => void): Promise<UnlistenFn> =>
  listen<TimerChanged>(EVENT_TIMER_CHANGED, (evt) => cb(evt.payload));

export const onEntriesChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<EntriesChanged>(EVENT_ENTRIES_CHANGED, () => cb());

export const onCategoriesChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<CategoriesChanged>(EVENT_CATEGORIES_CHANGED, () => cb());

export const onProjectsChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<ProjectsChanged>(EVENT_PROJECTS_CHANGED, () => cb());
