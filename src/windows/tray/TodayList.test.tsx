import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayList } from './TodayList';
import type { Category, Project, TimeEntry } from '../../types';

const cat: Category = { id: 'c1', name: 'Coding', color: '#10b981' };
const proj: Project = { id: 'p1', name: 'ACME', color: '#3b82f6' };

const closed = (id: string, hour: number, minutes = 0): TimeEntry => ({
  id,
  category_id: 'c1',
  project_id: null,
  started_at: new Date(2026, 4, 22, hour, minutes).toISOString(),
  ended_at: new Date(2026, 4, 22, hour, minutes + 30).toISOString(),
  note: null,
});

describe('TodayList', () => {
  it('renders empty state when no entries', () => {
    render(<TodayList entries={[]} categories={[cat]} projects={[proj]} runningId={null} onResume={() => {}} />);
    expect(screen.queryByText(/No timers stopped/)).not.toBeNull();
  });

  it('sorts entries most-recent first', () => {
    const entries = [closed('a', 9), closed('b', 14), closed('c', 11)];
    render(<TodayList entries={entries} categories={[cat]} projects={[proj]} runningId={null} onResume={() => {}} />);
    const rows = screen.getAllByRole('button');
    expect(rows[0].textContent).toContain('14:00');
    expect(rows[1].textContent).toContain('11:00');
    expect(rows[2].textContent).toContain('09:00');
  });

  it('excludes the running entry by id', () => {
    const entries = [closed('a', 9), closed('b', 14), closed('c', 11)];
    render(<TodayList entries={entries} categories={[cat]} projects={[proj]} runningId={'b'} onResume={() => {}} />);
    const rows = screen.getAllByRole('button');
    expect(rows.length).toBe(2);
  });

  it('fires onResume with the right entry when a row is clicked', () => {
    const onResume = vi.fn();
    const entries = [closed('a', 9), closed('b', 14)];
    render(<TodayList entries={entries} categories={[cat]} projects={[proj]} runningId={null} onResume={onResume} />);
    screen.getAllByRole('button')[0].click(); // 14:00, the 'b' entry
    expect(onResume).toHaveBeenCalledWith(entries[1]);
  });
});
