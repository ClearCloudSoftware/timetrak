import type { Category, Id, Project } from '../../types';

interface Props {
  categories: Category[];
  projects: Project[];
  onStart: (categoryId: Id, projectId: Id | null) => void;
  pending: boolean;
  error: unknown;
}

/**
 * QuickStartCard — extracted from the prototype/ui-redesign tray popover.
 *
 * Shown only on a "fresh" day (no stopped entries yet). Each chip starts a
 * timer with a single click, no description. The parent wires `onStart` to
 * its `startOrSwitch` mutation, so clicking a chip while another timer is
 * running performs the atomic stop+start (context switch).
 */
export function QuickStartCard({ categories, projects, onStart, pending, error }: Props) {
  const firstCat = categories[0];
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

      {projects.length > 0 && firstCat && (
        <>
          <div className="px-1 pb-1 pt-2 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">
            By project
          </div>
          <div className="space-y-1">
            {projects.slice(0, 4).map((pr) => (
              <button
                key={pr.id}
                type="button"
                disabled={pending}
                onClick={() => onStart(firstCat.id, pr.id)}
                className="flex w-full items-center gap-1.5 rounded-md bg-white px-2 py-1 text-left text-[11px] text-[#1d1d1f] ring-1 ring-inset ring-black/5 transition-colors hover:bg-[#0a84ff]/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
              >
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: pr.color }}
                />
                <span className="truncate">{pr.name}</span>
                <span className="ml-auto text-[10px] text-[#86868b]">→ {firstCat.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {Boolean(error) && (
        <div className="mt-1.5 rounded-md bg-[#ff453a]/10 px-2 py-1 text-[10px] text-[#ff453a]">
          {String(error)}
        </div>
      )}
    </div>
  );
}
