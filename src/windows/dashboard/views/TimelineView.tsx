import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TimeEntry } from '../../../types';
import * as api from '../../../lib/api';
import {
  durationSeconds, fmtDate, fmtDateLong, fmtDur, fmtTime, shiftRange, type DashViewProps,
} from './types';
import {
  minutesToDate, moveRange, resizeRange, yToMinutes, SNAP_MIN,
} from './timeline-math';

const HOUR_H = 48;
const GUTTER = 56; // px column for hour labels

export function TimelineView(p: DashViewProps) {
  const qc = useQueryClient();
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

  const [draft, setDraft] = useState<{ startMin: number; endMin: number } | null>(null);

  const [editDrag, setEditDrag] = useState<{
    entry: TimeEntry; kind: 'move' | 'resize-start' | 'resize-end';
    origStartMin: number; origEndMin: number; grabMin: number;
    startMin: number; endMin: number;
  } | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const movedRef = useRef(false);

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

      <main className="relative flex min-w-0 flex-1 flex-col">
        {dragError && (
          <div
            className="absolute inset-x-2 top-1 z-20 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
            onClick={() => setDragError(null)}
          >
            {dragError}
          </div>
        )}
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
          <div
            className="relative"
            style={{ height: 24 * HOUR_H }}
            onPointerDown={(e) => {
              if (e.target !== e.currentTarget || !selected) return; // blocks handle their own drags
              const rect = e.currentTarget.getBoundingClientRect();
              const m = yToMinutes(e.clientY - rect.top, HOUR_H);
              setDraft({ startMin: m, endMin: m });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!draft) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setDraft({ ...draft, endMin: yToMinutes(e.clientY - rect.top, HOUR_H) });
            }}
            onPointerUp={() => {
              if (!draft || !selected) return;
              const [a, b] = [Math.min(draft.startMin, draft.endMin), Math.max(draft.startMin, draft.endMin)];
              setDraft(null);
              if (b - a >= SNAP_MIN) p.onCreateRange(minutesToDate(selected, a), minutesToDate(selected, b));
            }}
          >
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

            {dayEntries.map((entry) => {
              const start = new Date(entry.started_at);
              const end = entry.ended_at ? new Date(entry.ended_at) : new Date();
              const dragging = editDrag?.entry.id === entry.id;
              const top = dragging
                ? (editDrag!.startMin / 60) * HOUR_H
                : (start.getHours() + start.getMinutes() / 60) * HOUR_H;
              const height = dragging
                ? Math.max(18, ((editDrag!.endMin - editDrag!.startMin) / 60) * HOUR_H)
                : Math.max(18, ((end.getTime() - start.getTime()) / 1000 / 3600) * HOUR_H);
              const cat = p.categories.find((c) => c.id === entry.category_id);
              const proj = p.projects.find((pr) => pr.id === entry.project_id);
              const color = cat?.color ?? '#8e8e93';
              // Drag/resize needs same-day, closed entries: a still-running block has no
              // ended_at, and a cross-midnight block's getHours()*60+getMinutes() pair
              // doesn't represent a real same-day range — both stay click-to-edit only.
              const draggable = !!entry.ended_at
                && new Date(entry.started_at).toDateString() === new Date(entry.ended_at).toDateString();
              return (
                <button
                  key={entry.id}
                  onClick={() => {
                    if (movedRef.current) { movedRef.current = false; return; }
                    p.onEdit(entry);
                  }}
                  onPointerDown={(e) => {
                    movedRef.current = false; // clear any stale flag from an interrupted prior drag
                    if (!draggable || !e.currentTarget.parentElement) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const zone = e.clientY - rect.top < 6 ? 'resize-start'
                      : rect.bottom - e.clientY < 6 ? 'resize-end' : 'move';
                    const container = e.currentTarget.parentElement.getBoundingClientRect();
                    const grabMin = yToMinutes(e.clientY - container.top, HOUR_H);
                    const s = new Date(entry.started_at); const en = new Date(entry.ended_at!);
                    const startMin = s.getHours() * 60 + s.getMinutes();
                    const endMin = en.getHours() * 60 + en.getMinutes();
                    setEditDrag({ entry, kind: zone, origStartMin: startMin, origEndMin: endMin, grabMin, startMin, endMin });
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.stopPropagation();
                  }}
                  onPointerMove={draggable ? (ev) => {
                    if (!editDrag) return;
                    const container = ev.currentTarget.parentElement!.getBoundingClientRect();
                    const cur = yToMinutes(ev.clientY - container.top, HOUR_H);
                    const delta = cur - editDrag.grabMin;
                    if (editDrag.kind === 'move') {
                      const [s2, e2] = moveRange(editDrag.origStartMin, editDrag.origEndMin, delta);
                      setEditDrag({ ...editDrag, startMin: s2, endMin: e2 });
                    } else if (editDrag.kind === 'resize-start') {
                      const [s2] = resizeRange(editDrag.origStartMin, editDrag.origEndMin, delta, 'start');
                      setEditDrag({ ...editDrag, startMin: s2 });
                    } else {
                      const [, e2] = resizeRange(editDrag.origStartMin, editDrag.origEndMin, delta, 'end');
                      setEditDrag({ ...editDrag, endMin: e2 });
                    }
                  } : undefined}
                  onPointerUp={draggable ? () => {
                    if (!editDrag || !selected) return;
                    const d = editDrag;
                    setEditDrag(null);
                    movedRef.current = d.startMin !== d.origStartMin || d.endMin !== d.origEndMin;
                    if (!movedRef.current) return; // click → onEdit fires normally
                    api.updateEntry(d.entry.id, {
                      category_id: d.entry.category_id,
                      project_id: d.entry.project_id,
                      started_at: minutesToDate(selected, d.startMin).toISOString(),
                      ended_at: minutesToDate(selected, d.endMin).toISOString(),
                      note: d.entry.note,
                    }).then(() => qc.invalidateQueries({ queryKey: ['entries'] }))
                      .catch((err) => setDragError(String(err)));
                  } : undefined}
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
                        {fmtTime(entry.started_at)} – {entry.ended_at ? fmtTime(entry.ended_at) : '…'} · {fmtDur(durationSeconds(entry))}
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

            {draft && (
              <div
                className="pointer-events-none absolute right-3 rounded-[5px] bg-accent/15 ring-1 ring-inset ring-accent/40"
                style={{
                  left: GUTTER + 8,
                  top: (Math.min(draft.startMin, draft.endMin) / 60) * HOUR_H,
                  height: (Math.abs(draft.endMin - draft.startMin) / 60) * HOUR_H,
                }}
              />
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
