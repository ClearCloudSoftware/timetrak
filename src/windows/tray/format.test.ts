import { describe, it, expect } from 'vitest';
import { todayRangeUtc, formatDuration, formatStartTime } from './format';

describe('todayRangeUtc', () => {
  it('returns a 24-hour range straddling local midnight', () => {
    const { startUtc, endUtc } = todayRangeUtc();
    const start = new Date(startUtc);
    const end = new Date(endUtc);
    const ms = end.getTime() - start.getTime();
    expect(ms).toBe(24 * 60 * 60 * 1000);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats 0 seconds as 0m', () => {
    expect(formatDuration(0)).toBe('0m');
  });
  it('formats sub-minute as 0m', () => {
    expect(formatDuration(30)).toBe('0m');
  });
  it('formats minutes only', () => {
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(60 * 45)).toBe('45m');
  });
  it('formats hours + minutes', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3600 + 30 * 60)).toBe('1h 30m');
    expect(formatDuration(3600 * 4 + 23 * 60)).toBe('4h 23m');
  });
});

describe('formatStartTime', () => {
  it('formats an ISO instant as local HH:mm', () => {
    const iso = new Date(2026, 4, 22, 9, 30).toISOString();
    expect(formatStartTime(iso)).toBe('09:30');
  });
});
