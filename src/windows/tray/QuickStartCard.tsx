import * as api from '../../lib/api';
import type { Category, Id } from '../../types';

interface Props {
  categories: Category[];
  onStart: (categoryId: Id, projectId: Id | null) => void;
  pending: boolean;
  error: unknown;
}

/**
 * QuickStartCard — one-click category bootstrap.
 *
 * 2-column chip grid of all categories. Click → start a timer with that
 * category, no project, no description. Performs an atomic stop+start when
 * another timer is already running (the parent wires `onStart` to the
 * `startOrSwitch` mutation).
 */
export function QuickStartCard({ categories, onStart, pending, error }: Props) {
  if (categories.length === 0) {
    return (
      <div className="rounded-xl bg-raised/80 p-3 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="text-[12px] font-medium text-label">No categories yet</div>
        <div className="mt-0.5 text-[11px] text-label-2">
          Create a few in Settings to start tracking with one click.
        </div>
        <button
          type="button"
          onClick={() => void api.openWindow('settings')}
          className="mt-2 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
        >
          Open Settings
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-raised/80 p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.08em] text-label-2">
        Quick start
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={pending}
            onClick={() => onStart(c.id, null)}
            className="flex items-center gap-1.5 rounded-md bg-raised px-2 py-1.5 text-left text-[12px] text-label ring-1 ring-inset ring-separator transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: c.color }}
            />
            <span className="truncate">{c.name}</span>
          </button>
        ))}
      </div>

      {Boolean(error) && (
        <div className="mt-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
          {String(error)}
        </div>
      )}
    </div>
  );
}
