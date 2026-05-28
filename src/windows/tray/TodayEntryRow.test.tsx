import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodayEntryRow } from './TodayEntryRow';
import type { Category, Project, TimeEntry } from '../../types';

const cat: Category = { id: 'c1', name: 'Coding', color: '#10b981' };
const proj: Project = { id: 'p1', name: 'ACME', color: '#3b82f6' };

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 'e1',
  category_id: 'c1',
  project_id: 'p1',
  started_at: new Date(2026, 4, 22, 11, 0).toISOString(),
  ended_at: new Date(2026, 4, 22, 12, 30).toISOString(),
  note: 'schema migration sketch',
  source: 'manual',
  source_event_id: null,
  source_calendar_id: null,
  source_edited_locally: false,
  ...over,
});

describe('TodayEntryRow', () => {
  it('renders meta line + description', () => {
    render(<TodayEntryRow entry={entry()} categories={[cat]} projects={[proj]} onResume={() => {}} />);
    expect(screen.queryByText('Coding')).not.toBeNull();
    expect(screen.queryByText(/ACME/)).not.toBeNull();
    expect(screen.queryByText('11:00')).not.toBeNull();
    expect(screen.queryByText('1h 30m')).not.toBeNull();
    expect(screen.queryByText('schema migration sketch')).not.toBeNull();
  });

  it('omits description line when note is null', () => {
    render(<TodayEntryRow entry={entry({ note: null })} categories={[cat]} projects={[proj]} onResume={() => {}} />);
    expect(screen.queryByText(/schema migration/)).toBeNull();
  });

  it('omits project segment when no project', () => {
    render(<TodayEntryRow entry={entry({ project_id: null })} categories={[cat]} projects={[proj]} onResume={() => {}} />);
    expect(screen.queryByText(/ACME/)).toBeNull();
  });

  it('fires onResume on click', () => {
    const onResume = vi.fn();
    const e = entry();
    render(<TodayEntryRow entry={e} categories={[cat]} projects={[proj]} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onResume).toHaveBeenCalledWith(e);
  });

  it('fires onResume on Enter keypress', () => {
    const onResume = vi.fn();
    const e = entry();
    render(<TodayEntryRow entry={e} categories={[cat]} projects={[proj]} onResume={onResume} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onResume).toHaveBeenCalledWith(e);
  });
});
