export function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
  return `${m}m`;
}

export function startOfWeekUtc(): { startUtc: string; endUtc: string } {
  return rangeThisWeek();
}

/// Today: 00:00 local today → 00:00 local tomorrow.
export function rangeToday(): { startUtc: string; endUtc: string } {
  const start = startOfLocalDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/// This week: Monday 00:00 → next Monday 00:00 (local).
export function rangeThisWeek(): { startUtc: string; endUtc: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const monday = startOfLocalDay(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { startUtc: monday.toISOString(), endUtc: nextMonday.toISOString() };
}

/// This month: first day 00:00 → first day of next month 00:00 (local).
export function rangeThisMonth(): { startUtc: string; endUtc: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { startUtc: first.toISOString(), endUtc: nextFirst.toISOString() };
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export type RangePreset = 'today' | 'week' | 'month' | 'custom';

export function matchPreset(range: { startUtc: string; endUtc: string }): RangePreset {
  if (rangesEqual(range, rangeToday())) return 'today';
  if (rangesEqual(range, rangeThisWeek())) return 'week';
  if (rangesEqual(range, rangeThisMonth())) return 'month';
  return 'custom';
}

function rangesEqual(
  a: { startUtc: string; endUtc: string },
  b: { startUtc: string; endUtc: string },
): boolean {
  return a.startUtc === b.startUtc && a.endUtc === b.endUtc;
}
