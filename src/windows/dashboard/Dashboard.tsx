import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import * as api from '../../lib/api';
import {
  onEntriesChanged,
  onTimerChanged,
  onCategoriesChanged,
  onProjectsChanged,
} from '../../lib/events';
import { qk } from '../../lib/query';
import type { TimeEntry } from '../../types';
import { startOfWeekUtc } from './format';
import { EntryEditorSheet } from './EntryEditorSheet';
import { TableView } from './views/TableView';
import { TimelineView } from './views/TimelineView';
import { HeatmapView } from './views/HeatmapView';
import type { DashViewProps, DashView } from './views/types';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

const VIEWS: { id: DashView; label: string; glyph: string }[] = [
  { id: 'table',    label: 'Table',    glyph: '☰' },
  { id: 'timeline', label: 'Timeline', glyph: '⏱' },
  { id: 'heatmap',  label: 'Heatmap',  glyph: '▦' },
];

export function Dashboard() {
  const qc = useQueryClient();
  const [range, setRange] = useState(startOfWeekUtc());
  const [view, setView] = useState<DashView>('table');

  const entries = useQuery({
    queryKey: qk.entries(range.startUtc, range.endUtc),
    queryFn: () => api.listEntries(range.startUtc, range.endUtc),
  });
  const categories = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    onEntriesChanged(() => qc.invalidateQueries({ queryKey: ['entries'] })).then((u) => unsubs.push(u));
    onTimerChanged(() => qc.invalidateQueries({ queryKey: ['entries'] })).then((u) => unsubs.push(u));
    onCategoriesChanged(() => qc.invalidateQueries({ queryKey: qk.categories })).then((u) => unsubs.push(u));
    onProjectsChanged(() => qc.invalidateQueries({ queryKey: qk.projects })).then((u) => unsubs.push(u));
    return () => { unsubs.forEach((u) => u()); };
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

  const props: DashViewProps = {
    entries: entries.data ?? [],
    categories: categories.data ?? [],
    projects: projects.data ?? [],
    range,
    onRangeChange: setRange,
    onEdit: setEditing,
    onDelete: (e) => deleteMut.mutate(e.id),
    isLoading: entries.isLoading,
  };

  return (
    <div className="flex h-screen flex-col bg-white text-[#1d1d1f]" style={FONT}>
      {/* Top bar — title, view toggle, export */}
      <header className="flex shrink-0 items-center gap-3 border-b border-black/5 px-3 py-1.5">
        <div className="text-[13px] font-medium">Dashboard</div>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            className="h-6 rounded-md bg-[#0a84ff] px-2.5 text-[11px] font-medium text-white hover:bg-[#0a74e0]"
            onClick={onExport}
          >
            Export CSV
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {view === 'table'    && <TableView {...props} />}
        {view === 'timeline' && <TimelineView {...props} />}
        {view === 'heatmap'  && <HeatmapView {...props} />}
      </div>

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

function ViewToggle({ value, onChange }: { value: DashView; onChange: (v: DashView) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-black/[0.06] p-0.5">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          className={
            'flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11px] transition-colors ' +
            (value === v.id
              ? 'bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
              : 'text-[#86868b] hover:text-[#1d1d1f]')
          }
        >
          <span className="text-[12px] leading-none">{v.glyph}</span>
          <span>{v.label}</span>
        </button>
      ))}
    </div>
  );
}
