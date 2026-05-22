import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../lib/api';
import { qk } from '../../lib/query';
import type { Category } from '../../types';

export function CategoriesTab() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

  const create = useMutation({
    mutationFn: () => api.createCategory(newName, newColor),
    onSuccess: () => {
      setNewName('');
      qc.invalidateQueries({ queryKey: qk.categories });
    },
  });

  const update = useMutation({
    mutationFn: (c: Category) => api.updateCategory(c.id, c.name, c.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });

  const del = useMutation({
    mutationFn: ({ id, cascadeEntries }: { id: string; cascadeEntries: boolean }) =>
      api.deleteCategory(id, cascadeEntries),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.categories }),
  });

  const handleDelete = async (c: Category) => {
    try {
      await del.mutateAsync({ id: c.id, cascadeEntries: false });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('category has entries')) {
        if (confirm(`"${c.name}" has time entries. Delete the category AND all its entries?`)) {
          del.mutate({ id: c.id, cascadeEntries: true });
        }
      } else {
        alert(msg);
      }
    }
  };

  return (
    <div className="space-y-4 p-4 text-sm">
      {/* Add category row */}
      <div className="flex items-end gap-3 rounded border border-gray-200 bg-gray-50 p-3">
        <Field label="New category">
          <input
            className="rounded border border-gray-200 px-2 py-1 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            placeholder="Category name"
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

      {/* Categories table */}
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
            {cats.isLoading && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {cats.isError && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-red-600 text-xs">
                  {String(cats.error)}
                </td>
              </tr>
            )}
            {cats.data?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-gray-400">
                  No categories yet. Add one above.
                </td>
              </tr>
            )}
            {(cats.data ?? []).map((c) => (
              <Row key={c.id} cat={c} onUpdate={update.mutate} onDelete={handleDelete} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  cat,
  onUpdate,
  onDelete,
}: {
  cat: Category;
  onUpdate: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);
  const changed = name !== cat.name || color !== cat.color;

  return (
    <tr className="group bg-white transition-colors hover:bg-gray-50">
      <td className="px-3 py-2">
        <input
          className="w-full rounded border border-gray-200 px-2 py-1 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Category name for ${cat.name}`}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="color"
          className="h-7 w-10 cursor-pointer rounded border border-gray-200 p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`Color for ${cat.name}`}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <button
          className="mr-3 text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
          disabled={!changed}
          onClick={() => onUpdate({ ...cat, name, color })}
        >
          Save
        </button>
        <button
          className="text-red-600 hover:underline"
          onClick={() => onDelete(cat)}
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
