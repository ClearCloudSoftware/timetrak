import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TimeEntry } from '../../../types';
import {
  durationSeconds, fmtDate, fmtDateLong, fmtDur, fmtTime, shiftRange, type DashViewProps,
} from './types';

const HOUR_H = 48;
const GUTTER = 56; // px column for hour labels

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
  const isToday = selected === new Date().toDateString();

  // Current-time indicator, minute resolution.
  const [nowMin, setNowMin] = useState(() => minutesOfDay());
  useEffect(() => {
    const t = setInterval(() => setNowMin(minutesOfDay()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Scroll to the day's first entry (or 08:00) when the selected day changes.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstHour = dayEntries.length
      ? Math.min(...dayEntries.map((e) => new Date(e.started_at).getHours()))
      : 8;
    el.scrollTop = Math.max(0, firstHour * HOUR_H - 12);
  }, [selected]); // ponytail: not dayEntries — avoids scroll jumps on background refetch

  return (
    <div className="flex h-full">
      <aside className="flex w-44 shrink-0 flex-col border-r border-separator bg-surface-alt">
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
                  (selected === k ? 'bg-accent text-white' : 'hover:bg-fill-hover')
                }
              >
                <span className="flex-1 truncate">{fmtDateLong(new Date(k).toISOString())}</span>
                <span className={'text-[10px] tabular-nums ' + (selected === k ? 'opacity-90' : 'text-label-2')}>
                  {fmtDur(total)}
                </span>
              </button>
            );
          })}
          {days.length === 0 && (
            <div className="px-2 py-3 text-center text-[11px] text-label-2">No entries</div>
          )}
        </div>
        <div className="border-t border-separator px-3 py-1.5 text-[10px] text-label-2">
          {p.entries.length} entries · {fmtDate(p.range.startUtc)} → {fmtDate(p.range.endUtc)}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-separator px-3 py-1.5">
          <div className="text-[12px] font-medium">
            {selected ? fmtDateLong(new Date(selected).toISOString()) : '—'}
          </div>
          {isToday && (
            <span className="rounded-full bg-destructive/10 px-1.5 text-[10px] font-medium text-destructive">
              Today
            </span>
          )}
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

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="relative" style={{ height: 24 * HOUR_H }}>
            {/* Hour gridlines — clean gutter, Calendar-style */}
            {Array.from({ length: 23 }, (_, i) => {
              const h = i + 1;
              return (
                <div key={h}>
                  <div
                    className="absolute right-0 h-px bg-separator"
                    style={{ top: h * HOUR_H, left: GUTTER }}
                  />
                  <div
                    className="absolute -translate-y-1/2 pr-2 text-right text-[10px] tabular-nums text-label-2"
                    style={{ top: h * HOUR_H, width: GUTTER }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </div>
                </div>
              );
            })}

            {/* Current time */}
            {isToday && (
              <div
                className="pointer-events-none absolute right-0 z-10"
                style={{ top: (nowMin / 60) * HOUR_H, left: GUTTER }}
              >
                <div className="relative h-px bg-destructive">
                  <div className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-destructive" />
                </div>
              </div>
            )}

            {dayEntries.map((e) => {
              const start = new Date(e.started_at);
              const end = e.ended_at ? new Date(e.ended_at) : new Date();
              const top = (start.getHours() + start.getMinutes() / 60) * HOUR_H;
              const height = Math.max(18, ((end.getTime() - start.getTime()) / 1000 / 3600) * HOUR_H);
              const cat = p.categories.find((c) => c.id === e.category_id);
              const proj = p.projects.find((pr) => pr.id === e.project_id);
              const color = cat?.color ?? '#8e8e93';
              return (
                <button
                  key={e.id}
                  onClick={() => p.onEdit(e)}
                  className="absolute right-3 overflow-hidden rounded-[5px] text-left text-[11px] transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{
                    top,
                    height,
                    left: GUTTER + 8,
                    background: tint(color),
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div className="px-1.5 py-0.5">
                    <div className="truncate font-medium leading-tight" style={{ color }}>
                      {cat?.name}
                      {proj ? ` · ${proj.name}` : ''}
                    </div>
                    {height >= 32 && (
                      <div className="truncate text-[10px] tabular-nums leading-tight text-label-2">
                        {fmtTime(e.started_at)} – {e.ended_at ? fmtTime(e.ended_at) : '…'} · {fmtDur(durationSeconds(e))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            {!dayEntries.length && (
              <div className="absolute inset-x-0 top-20 text-center text-[12px] text-label-2">
                No entries for this day.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function minutesOfDay(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function tint(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.16)`;
}
