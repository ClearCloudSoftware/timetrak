// Settings panes — data wiring lives here.
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
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
    try {
      await del.mutateAsync({ id: c.id, cascade: false });
    } catch (err) {
      if (String(err).includes('category has entries')) {
        if (confirm(`"${c.name}" has time entries. Delete the category and its entries?`)) {
          del.mutate({ id: c.id, cascade: true });
        }
      } else {
        alert(String(err));
      }
    }
  };

  return (
    <div className="text-[12px]" style={FONT}>
      <div className="divide-y divide-black/5 rounded-md border border-black/10 bg-white">
        {(cats.data ?? []).map((c) => (
          <CatRow key={c.id} c={c} onSave={update.mutate} onDelete={handleDelete} />
        ))}
        {cats.data?.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-[#86868b]">No categories.</div>
        )}
      </div>

      {/* Inline add row */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          className="h-6 w-7 cursor-pointer rounded border border-black/10 bg-white p-0.5"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <input
          className="h-6 flex-1 rounded-md border border-black/10 bg-white px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/40"
          placeholder="New category…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && !create.isPending && create.mutate()}
        />
        <button
          className="h-6 rounded-md bg-[#0a84ff] px-2.5 text-[11px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >Add</button>
      </div>
      {create.isError && <div className="mt-1 text-[11px] text-[#ff453a]">{String(create.error)}</div>}
    </div>
  );
}

function CatRow({ c, onSave, onDelete }: { c: Category; onSave: (c: Category) => void; onDelete: (c: Category) => void }) {
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const changed = name !== c.name || color !== c.color;
  return (
    <div className="flex h-7 items-center gap-1.5 px-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-4 w-4 cursor-pointer rounded border border-black/10 p-0"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-5 flex-1 rounded-sm bg-transparent px-1 text-[12px] outline-none focus:bg-black/[0.04]"
      />
      <button
        className="text-[11px] text-[#0a84ff] hover:underline disabled:text-[#86868b]"
        disabled={!changed}
        onClick={() => onSave({ ...c, name, color })}
      >Save</button>
      <button
        className="text-[11px] text-[#ff453a] hover:underline"
        onClick={() => onDelete(c)}
      >Delete</button>
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
      <div className="divide-y divide-black/5 rounded-md border border-black/10 bg-white">
        {(projects.data ?? []).map((p) => (
          <ProjRow key={p.id} p={p} onSave={update.mutate} onDelete={() => del.mutate(p.id)} />
        ))}
        {projects.data?.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-[#86868b]">No projects.</div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          className="h-6 w-7 cursor-pointer rounded border border-black/10 bg-white p-0.5"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <input
          className="h-6 flex-1 rounded-md border border-black/10 bg-white px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/40"
          placeholder="New project…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && !create.isPending && create.mutate()}
        />
        <button
          className="h-6 rounded-md bg-[#0a84ff] px-2.5 text-[11px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >Add</button>
      </div>
      {create.isError && <div className="mt-1 text-[11px] text-[#ff453a]">{String(create.error)}</div>}
    </div>
  );
}

function ProjRow({ p, onSave, onDelete }: { p: Project; onSave: (p: Project) => void; onDelete: () => void }) {
  const [name, setName] = useState(p.name);
  const [color, setColor] = useState(p.color);
  const changed = name !== p.name || color !== p.color;
  return (
    <div className="flex h-7 items-center gap-1.5 px-2">
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-4 w-4 cursor-pointer rounded border border-black/10 p-0" />
      <input value={name} onChange={(e) => setName(e.target.value)} className="h-5 flex-1 rounded-sm bg-transparent px-1 text-[12px] outline-none focus:bg-black/[0.04]" />
      <button className="text-[11px] text-[#0a84ff] hover:underline disabled:text-[#86868b]" disabled={!changed} onClick={() => onSave({ ...p, name, color })}>Save</button>
      <button className="text-[11px] text-[#ff453a] hover:underline" onClick={onDelete}>Delete</button>
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
        <span className="text-[11px] text-[#86868b]">18:00 (edit DB to change)</span>
      </Row>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-black/10 bg-white px-3 py-2">
      <div>
        <div className="text-[12px] text-[#1d1d1f]">{label}</div>
        {hint && <div className="text-[11px] text-[#86868b]">{hint}</div>}
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
        (checked ? 'bg-[#34c759]' : 'bg-black/15')
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
