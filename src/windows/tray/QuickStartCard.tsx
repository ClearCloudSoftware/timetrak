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
  return (
    <div className="rounded-xl bg-white/80 p-2 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">
        Quick start
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={pending}
            onClick={() => onStart(c.id, null)}
            className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-left text-[12px] text-[#1d1d1f] ring-1 ring-inset ring-black/5 transition-colors hover:bg-[#0a84ff]/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
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
        <div className="mt-1.5 rounded-md bg-[#ff453a]/10 px-2 py-1 text-[10px] text-[#ff453a]">
          {String(error)}
        </div>
      )}
    </div>
  );
}
