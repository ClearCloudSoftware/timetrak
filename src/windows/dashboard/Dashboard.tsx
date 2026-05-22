import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import * as api from '../../lib/api';
import { onEntriesChanged, onTimerChanged } from '../../lib/events';
import { qk } from '../../lib/query';
import type { TimeEntry } from '../../types';
import { DateRangePicker } from './DateRangePicker';
import { EntryRow } from './EntryRow';
import { startOfWeekUtc } from './format';
import { ChartsPanel } from './ChartsPanel';
import { EntryEditorSheet } from './EntryEditorSheet';

export function Dashboard() {
  const qc = useQueryClient();
  const [range, setRange] = useState(startOfWeekUtc());

  const entries = useQuery({
    queryKey: qk.entries(range.startUtc, range.endUtc),
    queryFn: () => api.listEntries(range.startUtc, range.endUtc),
  });
  const categories = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    onEntriesChanged(() => qc.invalidateQueries({ queryKey: ['entries'] })).then((u) =>
      unsubs.push(u),
    );
    onTimerChanged(() => qc.invalidateQueries({ queryKey: ['entries'] })).then((u) =>
      unsubs.push(u),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [qc]);

  const [editing, setEditing] = useState<TimeEntry | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });

  const onExport = async () => {
    const csv = await api.exportCsv(range.startUtc, range.endUtc);
    const path = await save({
      defaultPath: 'timetrak.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (path) await writeTextFile(path, csv);
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
        <h1 className="text-base font-semibold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-3">
          <DateRangePicker
            startUtc={range.startUtc}
            endUtc={range.endUtc}
            onChange={setRange}
          />
          <button
            className="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            onClick={onExport}
          >
            Export CSV
          </button>
        </div>
      </header>

      {/* Charts row — reserved space, real components land in Task 6 */}
      <ChartsPanel
        entries={entries.data ?? []}
        categories={categories.data ?? []}
        projects={projects.data ?? []}
      />

      {/* Entries table */}
      <main className="mt-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Started
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Ended
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Duration
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Category
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Project
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Note
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {entries.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                  No entries in this date range.
                </td>
              </tr>
            )}
            {(entries.data ?? []).map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                categories={categories.data ?? []}
                projects={projects.data ?? []}
                onEdit={setEditing}
                onDelete={(x) => deleteMut.mutate(x.id)}
              />
            ))}
          </tbody>
        </table>
      </main>

      {editing && (
        <EntryEditorSheet
          entry={editing}
          categories={categories.data ?? []}
          projects={projects.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['entries'] });
          }}
        />
      )}
    </div>
  );
}
