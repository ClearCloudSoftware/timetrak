import { describe, it, expect } from 'vitest';
import {
  yToMinutes, minutesToDate, moveRange, resizeRange, SNAP_MIN,
} from './timeline-math';

describe('timeline math', () => {
  it('converts y to snapped minutes', () => {
    expect(yToMinutes(0, 48)).toBe(0);
    expect(yToMinutes(48, 48)).toBe(60);
    expect(yToMinutes(50, 48)).toBe(65);      // 62.5 → snap 65
    expect(yToMinutes(-10, 48)).toBe(0);      // clamp low
    expect(yToMinutes(48 * 25, 48)).toBe(1440); // clamp high
    expect(SNAP_MIN).toBe(5);
  });

  it('builds a local Date on the given day', () => {
    const d = minutesToDate(new Date(2026, 7, 24).toDateString(), 9 * 60 + 30);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('moves a range preserving duration and clamping to the day', () => {
    expect(moveRange(60, 120, 30)).toEqual([90, 150]);
    expect(moveRange(60, 120, -90)).toEqual([0, 60]);       // clamp at 0
    expect(moveRange(1380, 1440, 60)).toEqual([1380, 1440]); // clamp at end
  });

  it('resizes an edge, clamping to the day and the min-duration floor', () => {
    expect(resizeRange(60, 120, 15, 'start')).toEqual([75, 120]);
    expect(resizeRange(60, 120, 15, 'end')).toEqual([60, 135]);
    expect(resizeRange(5, 60, -20, 'start')).toEqual([0, 60]);       // clamp at 0
    expect(resizeRange(1380, 1435, 20, 'end')).toEqual([1380, 1440]); // clamp at 1440
    expect(resizeRange(60, 120, 100, 'start')).toEqual([115, 120]);  // min-duration floor
    expect(resizeRange(60, 120, -100, 'end')).toEqual([60, 65]);     // min-duration floor
  });
});
