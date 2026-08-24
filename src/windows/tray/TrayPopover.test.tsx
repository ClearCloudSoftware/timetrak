import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TimeEntry } from '../../types';

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const entry: TimeEntry = {
  id: 'e1',
  category_id: 'c1',
  project_id: null,
  started_at: at(9, 0),
  ended_at: at(10, 0),
  note: 'old note',
  source: 'manual',
} as TimeEntry;

vi.mock('../../lib/api', () => ({
  listCategories: vi.fn(async () => [{ id: 'c1', name: 'Coding', color: '#10b981' }]),
  listProjects: vi.fn(async () => []),
  getTimerState: vi.fn(async () => ({ running: null })),
  listEntries: vi.fn(async () => [entry]),
  updateEntry: vi.fn(async () => entry),
  deleteEntry: vi.fn(async () => {}),
  startTimer: vi.fn(),
  switchTimer: vi.fn(),
  stopTimer: vi.fn(),
  requestNewEntry: vi.fn(),
  openWindow: vi.fn(),
  calendarStatus: vi.fn(async () => ({ connected: false })),
  pendingConflictsList: vi.fn(async () => []),
}));
vi.mock('../../lib/events', () => ({
  onTimerChanged: vi.fn(async () => () => {}),
  onEntriesChanged: vi.fn(async () => () => {}),
  onCategoriesChanged: vi.fn(async () => () => {}),
  onProjectsChanged: vi.fn(async () => () => {}),
  onCalendarSwitched: vi.fn(async () => () => {}),
  onCalendarSynced: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {}, hide: async () => {} }),
}));

import * as api from '../../lib/api';
import { TrayPopover } from './TrayPopover';

async function openEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TrayPopover />
    </QueryClientProvider>
  );
  fireEvent.click(await screen.findByText('old note'));
  return screen.findByRole('button', { name: /^save$/i });
}

describe('TrayPopover entry click', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves an edit to the clicked entry instead of starting a new timer', async () => {
    fireEvent.click(await openEditor());

    await waitFor(() => expect(api.updateEntry).toHaveBeenCalled());
    const [id, edit] = vi.mocked(api.updateEntry).mock.calls[0];
    expect(id).toBe('e1');
    expect(edit).toMatchObject({
      category_id: 'c1',
      started_at: entry.started_at,
      ended_at: entry.ended_at,
      note: 'old note',
    });
    expect(api.startTimer).not.toHaveBeenCalled();
    expect(api.switchTimer).not.toHaveBeenCalled();
  });

  it('saves edited start/end times on the same day', async () => {
    const save = await openEditor();
    const [start, end] = screen.getAllByPlaceholderText('HH:MM');
    fireEvent.change(start, { target: { value: '08:15' } });
    fireEvent.blur(start);
    fireEvent.change(end, { target: { value: '11:45' } });
    fireEvent.blur(end);
    fireEvent.click(save);

    await waitFor(() => expect(api.updateEntry).toHaveBeenCalled());
    const edit = vi.mocked(api.updateEntry).mock.calls[0][1];
    expect(edit.started_at).toBe(at(8, 15));
    expect(edit.ended_at).toBe(at(11, 45));
  });

  it('rolls an end time earlier than the start into the next day', async () => {
    const save = await openEditor();
    const [, end] = screen.getAllByPlaceholderText('HH:MM');
    fireEvent.change(end, { target: { value: '00:30' } });
    fireEvent.blur(end);
    fireEvent.click(save);

    await waitFor(() => expect(api.updateEntry).toHaveBeenCalled());
    const edit = vi.mocked(api.updateEntry).mock.calls[0][1];
    const next = new Date(at(0, 30));
    next.setDate(next.getDate() + 1);
    expect(edit.ended_at).toBe(next.toISOString());
  });

  it('deletes the entry only after a confirming second click', async () => {
    await openEditor();
    const del = screen.getByRole('button', { name: /^delete$/i });
    fireEvent.click(del);
    expect(api.deleteEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /sure\?/i }));
    await waitFor(() => expect(api.deleteEntry).toHaveBeenCalledWith('e1'));
  });
});
