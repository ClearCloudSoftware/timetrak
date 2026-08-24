// Settings panes — data wiring lives here.
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { Trash2 } from 'lucide-react';
import * as api from '../../lib/api';
import { qk } from '../../lib/query';
import type { Category, Project } from '../../types';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

export function CategoriesPane() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#0a84ff');

  const create = useMutation({
    mutationFn: () => api.createCategory(newName, newColor),
    onSuccess: () => { setNewName(''); qc.invalidateQueries({ queryKey: qk.categories }); },
  });
  const update = useMutation({
    mutationFn: (c: Category) => api.updateCategory(c.id, c.name, c.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });
  const del = useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade: boolean }) => api.deleteCategory(id, cascade),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });

  const handleDelete = async (c: Category) => {
    const ok = await ask(`Delete “${c.name}”?`, {
      title: 'Delete Category',
      kind: 'warning',
      okLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await del.mutateAsync({ id: c.id, cascade: false });
    } catch (err) {
      if (String(err).includes('category has entries')) {
        const cascade = await ask(
          `“${c.name}” has time entries. Delete the category and all of its entries?`,
          { title: 'Delete Category', kind: 'warning', okLabel: 'Delete All' },
        );
        if (cascade) del.mutate({ id: c.id, cascade: true });
      } else {
        await message(String(err), { kind: 'error' });
      }
    }
  };

  return (
    <div className="text-[12px]" style={FONT}>
      <div className="divide-y divide-separator rounded-md border border-separator bg-raised">
        {(cats.data ?? []).map((c) => (
          <CatRow key={c.id} c={c} onSave={update.mutate} onDelete={handleDelete} />
        ))}
        {cats.data?.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-label-2">No categories.</div>
        )}
      </div>

      {/* Inline add row */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          className="h-6 w-7 cursor-pointer rounded border border-separator bg-raised p-0.5"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <input
          className="h-6 flex-1 rounded-md border border-separator bg-raised px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          placeholder="New category…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && !create.isPending && create.mutate()}
        />
        <button
          className="h-6 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:bg-label-2/30"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >Add</button>
      </div>
      {create.isError && <div className="mt-1 text-[11px] text-destructive">{String(create.error)}</div>}
    </div>
  );
}

function CatRow({ c, onSave, onDelete }: { c: Category; onSave: (c: Category) => void; onDelete: (c: Category) => void }) {
  const [name, setName] = useState(c.name);
  // macOS idiom: edits commit implicitly (blur / Enter / color pick), no Save button.
  const commit = (color?: string) => {
    const next = { ...c, name: name.trim() || c.name, color: color ?? c.color };
    if (next.name !== c.name || next.color !== c.color) onSave(next);
  };
  return (
    <div className="group flex h-7 items-center gap-1.5 px-2">
      <input
        type="color"
        defaultValue={c.color}
        onChange={(e) => commit(e.target.value)}
        className="h-4 w-4 cursor-pointer rounded border border-separator p-0"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-5 flex-1 rounded-sm bg-transparent px-1 text-[12px] outline-none focus:bg-fill-hover"
      />
      <button
        aria-label={`Delete ${c.name}`}
        className="text-label-2 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => onDelete(c)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function ProjectsPane() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#34c759');

  const create = useMutation({
    mutationFn: () => api.createProject(newName, newColor),
    onSuccess: () => { setNewName(''); qc.invalidateQueries({ queryKey: qk.projects }); },
  });
  const update = useMutation({
    mutationFn: (p: Project) => api.updateProject(p.id, p.name, p.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });

  return (
    <div className="text-[12px]" style={FONT}>
      <div className="divide-y divide-separator rounded-md border border-separator bg-raised">
        {(projects.data ?? []).map((p) => (
          <ProjRow
            key={p.id}
            p={p}
            onSave={update.mutate}
            onDelete={async () => {
              if (await ask(`Delete “${p.name}”?`, { title: 'Delete Project', kind: 'warning', okLabel: 'Delete' })) {
                del.mutate(p.id);
              }
            }}
          />
        ))}
        {projects.data?.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-label-2">No projects.</div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          className="h-6 w-7 cursor-pointer rounded border border-separator bg-raised p-0.5"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <input
          className="h-6 flex-1 rounded-md border border-separator bg-raised px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          placeholder="New project…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && !create.isPending && create.mutate()}
        />
        <button
          className="h-6 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:bg-label-2/30"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >Add</button>
      </div>
      {create.isError && <div className="mt-1 text-[11px] text-destructive">{String(create.error)}</div>}
    </div>
  );
}

function ProjRow({ p, onSave, onDelete }: { p: Project; onSave: (p: Project) => void; onDelete: () => void }) {
  const [name, setName] = useState(p.name);
  const commit = (color?: string) => {
    const next = { ...p, name: name.trim() || p.name, color: color ?? p.color };
    if (next.name !== p.name || next.color !== p.color) onSave(next);
  };
  return (
    <div className="group flex h-7 items-center gap-1.5 px-2">
      <input
        type="color"
        defaultValue={p.color}
        onChange={(e) => commit(e.target.value)}
        className="h-4 w-4 cursor-pointer rounded border border-separator p-0"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-5 flex-1 rounded-sm bg-transparent px-1 text-[12px] outline-none focus:bg-fill-hover"
      />
      <button
        aria-label={`Delete ${p.name}`}
        className="text-label-2 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function PreferencesPane() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => { isEnabled().then(setAutostart); }, []);
  const toggle = async () => {
    if (autostart) { await disable(); setAutostart(false); }
    else { await enable(); setAutostart(true); }
  };
  return (
    <div className="space-y-3 text-[12px]" style={FONT}>
      <Row label="Launch at login" hint="Start TimeTrak when you log into your Mac or PC.">
        <Switch checked={autostart ?? false} disabled={autostart == null} onChange={toggle} />
      </Row>
      <Row label="Daily summary" hint="A notification at end of day with totals.">
        <span className="text-[11px] text-label-2">18:00 (edit DB to change)</span>
      </Row>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-separator bg-raised px-3 py-2">
      <div>
        <div className="text-[12px] text-label">{label}</div>
        {hint && <div className="text-[11px] text-label-2">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={
        'relative h-5 w-8 rounded-full transition-colors disabled:opacity-50 ' +
        (checked ? 'bg-success' : 'bg-label-2/40')
      }
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ' +
          (checked ? 'translate-x-3.5' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
