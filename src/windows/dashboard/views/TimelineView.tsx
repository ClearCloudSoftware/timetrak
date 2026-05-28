import { useMemo, useState } from 'react';
import type { TimeEntry } from '../../../types';
import {
  durationSeconds, fmtDate, fmtDateLong, fmtDur, fmtTime, shiftRange, type DashViewProps,
} from './types';

export function TimelineView(p: DashViewProps) {
  const days = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of p.entries) {
      const k = new Date(e.started_at).toDateString();
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => +new Date(b[0]) - +new Date(a[0]));
  }, [p.entries]);

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const selected = activeDay ?? days[0]?.[0] ?? null;
  const dayEntries = selected ? (days.find((d) => d[0] === selected)?.[1] ?? []) : [];

  return (
    <div className="flex h-full">
      <aside className="flex w-44 shrink-0 flex-col border-r border-black/5 bg-[#f5f5f7]">
        <div className="flex h-8 items-center px-3 text-[12px] font-medium">Days</div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2">
          {days.map(([k, list]) => {
            const total = list.reduce((s, e) => s + durationSeconds(e), 0);
            return (
              <button
                key={k}
                onClick={() => setActiveDay(k)}
                className={
                  'mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] ' +
                  (selected === k ? 'bg-[#0a84ff] text-white' : 'hover:bg-black/[0.04]')
                }
              >
                <span className="flex-1 truncate">{fmtDateLong(new Date(k).toISOString())}</span>
                <span className={'text-[10px] tabular-nums ' + (selected === k ? 'opacity-90' : 'text-[#86868b]')}>
                  {fmtDur(total)}
                </span>
              </button>
            );
          })}
          {days.length === 0 && (
            <div className="px-2 py-3 text-center text-[11px] text-[#86868b]">No entries</div>
          )}
        </div>
        <div className="border-t border-black/5 px-3 py-1.5 text-[10px] text-[#86868b]">
          {p.entries.length} entries · {fmtDate(p.range.startUtc)} → {fmtDate(p.range.endUtc)}
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-black/5 px-3 py-1.5">
          <div className="text-[12px] font-medium">{selected ? fmtDateLong(new Date(selected).toISOString()) : '—'}</div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="h-5 rounded-md border border-black/10 px-2 text-[11px] hover:bg-black/[0.04]"
              onClick={() => p.onRangeChange(shiftRange(p.range, -7))}
            >← Week</button>
            <button
              className="h-5 rounded-md border border-black/10 px-2 text-[11px] hover:bg-black/[0.04]"
              onClick={() => p.onRangeChange(shiftRange(p.range, +7))}
            >Week →</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-[64px_1fr]" style={{ height: 24 * 40 }}>
            <HourScale />
            <TimelinePane entries={dayEntries} categories={p.categories} projects={p.projects} onEdit={p.onEdit} />
          </div>
        </div>
      </main>
    </div>
  );
}

function HourScale() {
  return (
    <div className="relative border-r border-black/5 bg-[#fafafa] text-[10px] text-[#86868b]">
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="relative h-10 border-b border-black/[0.04] px-1.5 pt-0.5">
          {String(h).padStart(2, '0')}:00
        </div>
      ))}
    </div>
  );
}

function TimelinePane({
  entries, categories, projects, onEdit,
}: {
  entries: TimeEntry[];
  categories: DashViewProps['categories'];
  projects: DashViewProps['projects'];
  onEdit: (e: TimeEntry) => void;
}) {
  return (
    <div className="relative h-full">
      <div className="relative h-full">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute left-0 right-0 h-px bg-black/[0.04]" style={{ top: h * 40 }} />
        ))}
        {entries.map((e) => {
          const start = new Date(e.started_at);
          const end = e.ended_at ? new Date(e.ended_at) : new Date();
          const top = (start.getHours() + start.getMinutes() / 60) * 40;
          const height = Math.max(14, ((end.getTime() - start.getTime()) / 1000 / 3600) * 40);
          const cat = categories.find((c) => c.id === e.category_id);
          const proj = projects.find((pr) => pr.id === e.project_id);
          return (
            <button
              key={e.id}
              onClick={() => onEdit(e)}
              className="absolute left-2 right-3 overflow-hidden rounded-md text-left text-[11px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-inset ring-black/5 hover:brightness-95"
              style={{
                top,
                height,
                background: hexToBg(cat?.color ?? '#0a84ff'),
                borderLeft: `3px solid ${cat?.color ?? '#0a84ff'}`,
              }}
            >
              <div className="px-2 py-0.5">
                <div className="truncate font-medium text-[#1d1d1f]">
                  {cat?.name}{proj ? ` · ${proj.name}` : ''}
                </div>
                <div className="text-[10px] tabular-nums text-[#1d1d1f]/70">
                  {fmtTime(e.started_at)} – {e.ended_at ? fmtTime(e.ended_at) : '…'}  ({fmtDur(durationSeconds(e))})
                </div>
              </div>
            </button>
          );
        })}
        {!entries.length && (
          <div className="absolute inset-x-0 top-20 text-center text-[12px] text-[#86868b]">
            No entries for this day.
          </div>
        )}
      </div>
    </div>
  );
}

function hexToBg(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}
