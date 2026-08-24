import { useEffect, useState } from 'react';
import { Table, ChartNoAxesGantt, LayoutGrid, Plus } from 'lucide-react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ask, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
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
import { ConflictsPanel } from './ConflictsPanel';
import { TableView } from './views/TableView';
import { TimelineView } from './views/TimelineView';
import { HeatmapView } from './views/HeatmapView';
import type { DashViewProps, DashView } from './views/types';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

const VIEWS: { id: DashView; label: string; icon: typeof Table }[] = [
  { id: 'table',    label: 'Table',    icon: Table },
  { id: 'timeline', label: 'Timeline', icon: ChartNoAxesGantt },
  { id: 'heatmap',  label: 'Heatmap',  icon: LayoutGrid },
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
    onCategoriesChanged(() => {
      qc.invalidateQueries({ queryKey: qk.categories });
      qc.invalidateQueries({ queryKey: ['goals'] });
    }).then((u) => unsubs.push(u));
    onProjectsChanged(() => qc.invalidateQueries({ queryKey: qk.projects })).then((u) => unsubs.push(u));
    return () => { unsubs.forEach((u) => u()); };
  }, [qc]);

  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [creating, setCreating] = useState<{ initialStart?: Date; initialEnd?: Date } | null>(null);

  // Honor the tray's "Add past entry…" request: a pending flag is set on the
  // Rust side before this window opens, and an event is emitted in case the
  // window was already open.
  useEffect(() => {
    let cancelled = false;
    api.consumePendingNewEntry().then((p) => { if (p && !cancelled) setCreating({}); });
    const unlistenPromise = listen('open-new-entry', () => setCreating({}));
    return () => { cancelled = true; unlistenPromise.then((u) => u()); };
  }, []);

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
    onDelete: (e) => {
      void ask('Delete this entry?', { title: 'Delete Entry', kind: 'warning', okLabel: 'Delete' })
        .then((ok) => { if (ok) deleteMut.mutate(e.id); });
    },
    onCreateRange: (start, end) => setCreating({ initialStart: start, initialEnd: end }),
    isLoading: entries.isLoading,
  };

  return (
    <div className="flex h-screen flex-col bg-surface text-label" style={FONT}>
      {/* Top bar — doubles as the macOS overlay title bar (drag region + traffic-light inset) */}
      <header data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-3 border-b border-separator pl-[84px] pr-3">
        <div className="pointer-events-none text-[13px] font-semibold">Dashboard</div>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            className="inline-flex h-6 items-center gap-1 rounded-md border border-separator bg-raised px-2.5 text-[11px] font-medium text-label hover:bg-fill-hover"
            onClick={() => setCreating({})}
          >
            <Plus className="h-3 w-3" aria-hidden /> New entry
          </button>
          <button
            className="h-6 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover"
            onClick={onExport}
          >
            Export CSV
          </button>
        </div>
      </header>

      <ConflictsPanel />

      <div className="flex-1 overflow-hidden">
        {view === 'table'    && <TableView {...props} />}
        {view === 'timeline' && <TimelineView {...props} />}
        {view === 'heatmap'  && <HeatmapView {...props} />}
      </div>

      {editing && (
        <EntryEditorSheet
          mode={{ kind: 'edit', entry: editing }}
          categories={categories.data ?? []}
          projects={projects.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['entries'] });
          }}
        />
      )}
      {creating && (
        <EntryEditorSheet
          mode={{ kind: 'create', ...creating }}
          categories={categories.data ?? []}
          projects={projects.data ?? []}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            qc.invalidateQueries({ queryKey: ['entries'] });
          }}
        />
      )}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: DashView; onChange: (v: DashView) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-fill p-0.5">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          className={
            'flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[11px] transition-colors ' +
            (value === v.id
              ? 'bg-raised text-label shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
              : 'text-label-2 hover:text-label')
          }
        >
          <v.icon className="h-3 w-3" aria-hidden />
          <span>{v.label}</span>
        </button>
      ))}
    </div>
  );
}
