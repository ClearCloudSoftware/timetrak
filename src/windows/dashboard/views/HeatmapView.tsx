import { useMemo, useState } from 'react';
import {
  durationSeconds, fmtDate, fmtDur, fmtTime, shiftRange, type DashViewProps,
} from './types';

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
      <div className="flex items-center gap-3 border-b border-black/5 px-3 py-1.5">
        <div className="text-[10px] text-[#86868b]">
          {fmtDate(p.range.startUtc)} → {fmtDate(p.range.endUtc)}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="h-5 rounded-md border border-black/10 px-2 text-[11px] hover:bg-black/[0.04]"
            onClick={() => p.onRangeChange(shiftRange(p.range, -7))}
          >‹</button>
          <button
            className="h-5 rounded-md border border-black/10 px-2 text-[11px] hover:bg-black/[0.04]"
            onClick={() => p.onRangeChange(shiftRange(p.range, +7))}
          >›</button>
        </div>
      </div>

      <div className="border-b border-black/5 px-3 py-2">
        <div className="grid grid-cols-[44px_1fr] gap-1">
          <div />
          <div
            className="grid gap-[2px] text-[9px] text-[#86868b]"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center">{h % 3 === 0 ? h : ''}</div>
            ))}
          </div>
          {heatmap.days.map((d, di) => (
            <RowFragment key={di} dayLabel={d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}>
              {Array.from({ length: 24 }, (_, hi) => {
                const v = heatmap.grid[di][hi];
                const t = heatmap.max > 0 ? v / heatmap.max : 0;
                return (
                  <div
                    key={hi}
                    title={v ? `${fmtDur(v)} at ${hi}:00` : ''}
                    className="h-3 rounded-[2px]"
                    style={{
                      background: v ? `rgba(10, 132, 255, ${0.12 + t * 0.78})` : 'rgba(0,0,0,0.04)',
                    }}
                  />
                );
              })}
            </RowFragment>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-b border-black/5 px-3 py-1.5 text-[11px]">
        <span className="mr-1 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">Filter</span>
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
          <div className="py-10 text-center text-[12px] text-[#86868b]">Nothing here.</div>
        )}
        {filtered.map((e) => {
          const cat = p.categories.find((c) => c.id === e.category_id);
          const proj = p.projects.find((pr) => pr.id === e.project_id);
          return (
            <div
              key={e.id}
              className="group flex h-7 items-center gap-2 border-b border-black/5 px-3 text-[12px] hover:bg-[#f5f5f7]"
              style={{ borderLeft: `3px solid ${cat?.color ?? 'transparent'}` }}
            >
              <span className="w-16 text-[#86868b]">{fmtDate(e.started_at)}</span>
              <span className="w-24 tabular-nums">{fmtTime(e.started_at)} – {e.ended_at ? fmtTime(e.ended_at) : '…'}</span>
              <span className="w-12 tabular-nums">{fmtDur(durationSeconds(e))}</span>
              <span className="w-20 truncate">{cat?.name}</span>
              <span className="w-24 truncate text-[#86868b]">{proj?.name ?? ''}</span>
              <span className="flex-1 truncate text-[#86868b]">{e.note ?? ''}</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <button className="text-[#0a84ff] hover:underline" onClick={() => p.onEdit(e)}>Edit</button>
                <button className="ml-2 text-[#ff453a] hover:underline" onClick={() => p.onDelete(e)}>Delete</button>
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
          ? 'bg-[#0a84ff] text-white'
          : 'border border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]')
      }
    >
      {label}
    </button>
  );
}

function RowFragment({ dayLabel, children }: { dayLabel: string; children: React.ReactNode }) {
  return (
    <>
      <div className="text-[10px] text-[#86868b]">{dayLabel}</div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {children}
      </div>
    </>
  );
}
