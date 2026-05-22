import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { qk } from '../../lib/query';
import type { Project } from '../../types';

export function ProjectsTab() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#10b981');

  const create = useMutation({
    mutationFn: () => api.createProject(newName, newColor),
    onSuccess: () => {
      setNewName('');
      qc.invalidateQueries({ queryKey: qk.projects });
    },
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
    <div className="space-y-4 p-4 text-sm">
      {/* Add project row */}
      <div className="flex items-end gap-3 rounded border border-gray-200 bg-gray-50 p-3">
        <Field label="New project">
          <input
            className="rounded border border-gray-200 px-2 py-1 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newName.trim() && !create.isPending && create.mutate()}
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            className="h-8 w-12 cursor-pointer rounded border border-gray-200 p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
          />
        </Field>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          disabled={!newName.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {create.isError && (
        <p className="text-xs text-red-600">{String(create.error)}</p>
      )}

      {/* Projects table */}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Name
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Color
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {projects.isLoading && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {projects.isError && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-xs text-red-600">
                  {String(projects.error)}
                </td>
              </tr>
            )}
            {projects.data?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-gray-400">
                  No projects yet. Add one above.
                </td>
              </tr>
            )}
            {(projects.data ?? []).map((p) => (
              <Row key={p.id} project={p} onUpdate={update.mutate} onDelete={(id) => del.mutate(id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  project,
  onUpdate,
  onDelete,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const changed = name !== project.name || color !== project.color;

  return (
    <tr className="group bg-white transition-colors hover:bg-gray-50">
      <td className="px-3 py-2">
        <input
          className="w-full rounded border border-gray-200 px-2 py-1 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Project name for ${project.name}`}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="color"
          className="h-7 w-10 cursor-pointer rounded border border-gray-200 p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`Color for ${project.name}`}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          className="mr-3 text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
          disabled={!changed}
          onClick={() => onUpdate({ ...project, name, color })}
        >
          Save
        </button>
        <button
          className="text-red-600 hover:underline"
          onClick={() => onDelete(project.id)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}
