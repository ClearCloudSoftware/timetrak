import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayFooter } from './TodayFooter';
import type { TimeEntry } from '../../types';

const closed = (startH: number, durMin: number): TimeEntry => ({
  id: `${startH}`,
  category_id: 'c1',
  project_id: null,
  started_at: new Date(2026, 4, 22, startH, 0).toISOString(),
  ended_at: new Date(2026, 4, 22, startH, durMin).toISOString(),
  note: null,
});

describe('TodayFooter', () => {
  it('shows 0m when there are no entries', () => {
    render(<TodayFooter entries={[]} runningEntry={null} nowMs={Date.now()} />);
    expect(screen.queryByText('Today: 0m')).not.toBeNull();
  });
  it('sums multiple closed entries', () => {
    const entries = [closed(9, 30), closed(10, 45)];
    render(<TodayFooter entries={entries} runningEntry={null} nowMs={Date.now()} />);
    expect(screen.queryByText('Today: 1h 15m')).not.toBeNull();
  });
  it('adds the running entry duration based on nowMs', () => {
    const running: TimeEntry = {
      id: 'r',
      category_id: 'c1',
      project_id: null,
      started_at: new Date(2026, 4, 22, 14, 0).toISOString(),
      ended_at: null,
      note: null,
    };
    const nowMs = new Date(2026, 4, 22, 14, 30).getTime();
    render(<TodayFooter entries={[running]} runningEntry={running} nowMs={nowMs} />);
    expect(screen.queryByText('Today: 30m')).not.toBeNull();
  });
});
