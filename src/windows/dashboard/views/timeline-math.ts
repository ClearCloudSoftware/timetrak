export const SNAP_MIN = 5;

export function yToMinutes(y: number, hourHeight: number): number {
  const raw = (y / hourHeight) * 60;
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(24 * 60, snapped));
}

export function minutesToDate(dayKey: string, minutes: number): Date {
  const d = new Date(dayKey); // toDateString() output parses to local midnight
  d.setHours(0, minutes, 0, 0);
  return d;
}

export function moveRange(startMin: number, endMin: number, deltaMin: number): [number, number] {
  const dur = endMin - startMin;
  let s = startMin + deltaMin;
  s = Math.max(0, Math.min(24 * 60 - dur, s));
  return [s, s + dur];
}
