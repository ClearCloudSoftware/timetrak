import type { Category, Project, TimeEntry } from '../../../types';

export type DashView = 'table' | 'timeline' | 'heatmap';

export interface DashRange { startUtc: string; endUtc: string; }

export interface DashViewProps {
  entries: TimeEntry[];
  categories: Category[];
  projects: Project[];
  range: DashRange;
  onRangeChange: (r: DashRange) => void;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
  isLoading: boolean;
}

export function durationSeconds(e: TimeEntry): number {
  if (!e.ended_at) return Math.max(0, (Date.now() - new Date(e.started_at).getTime()) / 1000);
  return Math.max(0, (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000);
}
export function fmtDur(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
export function shiftRange(r: DashRange, days: number): DashRange {
  const s = new Date(r.startUtc); s.setDate(s.getDate() + days);
  const e = new Date(r.endUtc); e.setDate(e.getDate() + days);
  return { startUtc: s.toISOString(), endUtc: e.toISOString() };
}
