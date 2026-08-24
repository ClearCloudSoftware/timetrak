import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import {
  durationSeconds, fmtDate, fmtDur, fmtTime, shiftRange, type DashViewProps,
} from './types';

// Single-hue sequential ramp: accent token over the surface, quantized to 4
// levels (plus empty) so neighboring intensities stay distinguishable.
function cellBg(level: number): string {
  return level > 0 ? `rgb(var(--accent) / ${0.12 + level * 0.19})` : 'var(--fill)';
}

export function HeatmapView(p: DashViewProps) {
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const days: Date[] = [];
    const start = new Date(p.range.startUtc);
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    let max = 0;
    for (const e of p.entries) {
      const s = new Date(e.started_at);
      const di = days.findIndex((d) => d.toDateString() === s.toDateString());
      if (di < 0) continue;
      const hi = s.getHours();
      grid[di][hi] += durationSeconds(e);
      if (grid[di][hi] > max) max = grid[di][hi];
    }
    return { grid, days, max };
  }, [p.entries, p.range.startUtc]);

  const filtered = filterCat ? p.entries.filter((e) => e.category_id === filterCat) : p.entries;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-separator px-3 py-1.5">
        <div className="text-[11px] text-label-2">
          {fmtDate(p.range.startUtc)} → {fmtDate(p.range.endUtc)}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            aria-label="Previous week"
            className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-separator text-label-2 hover:bg-fill-hover hover:text-label"
            onClick={() => p.onRangeChange(shiftRange(p.range, -7))}
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            aria-label="Next week"
            className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-separator text-label-2 hover:bg-fill-hover hover:text-label"
            onClick={() => p.onRangeChange(shiftRange(p.range, +7))}
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="border-b border-separator px-3 py-2.5">
        <div className="grid grid-cols-[56px_1fr] gap-y-[3px]">
          <div />
          <div
            className="mb-0.5 grid gap-[3px] text-[9px] tabular-nums text-label-2"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center">{h % 3 === 0 ? h : ''}</div>
            ))}
          </div>
          {heatmap.days.map((d, di) => (
            <RowFragment
              key={di}
              dayLabel={d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}
            >
              {Array.from({ length: 24 }, (_, hi) => {
                const v = heatmap.grid[di][hi];
                const t = heatmap.max > 0 ? v / heatmap.max : 0;
                const level = v > 0 ? Math.max(1, Math.ceil(t * 4)) : 0;
                const weekday = d.toLocaleDateString([], { weekday: 'short' });
                return (
                  <div
                    key={hi}
                    title={v ? `${weekday} ${hi}:00 — ${fmtDur(v)}` : ''}
                    className="h-5 rounded-[3px]"
                    style={{ background: cellBg(level) }}
                  />
                );
              })}
            </RowFragment>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-label-2">
          <span className="mr-0.5">Less</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span key={lvl} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: cellBg(lvl) }} />
          ))}
          <span className="ml-0.5">More</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-b border-separator px-3 py-1.5 text-[11px]">
        <span className="mr-1 text-[10px] uppercase tracking-[0.08em] text-label-2">Filter</span>
        <Chip active={filterCat === null} onClick={() => setFilterCat(null)} label="All" />
        {p.categories.map((c) => {
          const total = p.entries.filter((e) => e.category_id === c.id).reduce((s, e) => s + durationSeconds(e), 0);
          if (total === 0) return null;
          return (
            <Chip
              key={c.id}
              active={filterCat === c.id}
              onClick={() => setFilterCat(filterCat === c.id ? null : c.id)}
              label={
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                  <span>{c.name}</span>
                  <span className="tabular-nums opacity-60">{fmtDur(total)}</span>
                </span>
              }
            />
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 && (
          <div className="py-10 text-center text-[12px] text-label-2">Nothing here.</div>
        )}
        {filtered.map((e) => {
          const cat = p.categories.find((c) => c.id === e.category_id);
          const proj = p.projects.find((pr) => pr.id === e.project_id);
          return (
            <div
              key={e.id}
              className="group flex h-7 items-center gap-2 border-b border-separator px-3 text-[12px] hover:bg-fill-hover"
              style={{ borderLeft: `3px solid ${cat?.color ?? 'transparent'}` }}
            >
              <span className="w-16 text-label-2">{fmtDate(e.started_at)}</span>
              <span className="w-24 tabular-nums">{fmtTime(e.started_at)} – {e.ended_at ? fmtTime(e.ended_at) : '…'}</span>
              <span className="w-12 tabular-nums">{fmtDur(durationSeconds(e))}</span>
              <span className="w-20 truncate">{cat?.name}</span>
              <span className="w-24 truncate text-label-2">{proj?.name ?? ''}</span>
              <span className="flex-1 truncate text-label-2">{e.note ?? ''}</span>
              <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  aria-label="Edit entry"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-label-2 hover:text-label"
                  onClick={() => p.onEdit(e)}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  aria-label="Delete entry"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-label-2 hover:text-destructive"
                  onClick={() => p.onDelete(e)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'h-5 rounded-full px-2 text-[11px] transition-colors ' +
        (active
          ? 'bg-accent text-white'
          : 'border border-separator bg-raised text-label hover:bg-fill-hover')
      }
    >
      {label}
    </button>
  );
}

function RowFragment({ dayLabel, children }: { dayLabel: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center pr-2 text-[10px] text-label-2">{dayLabel}</div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {children}
      </div>
    </>
  );
}
