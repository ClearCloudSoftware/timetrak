import { useMemo } from 'react';
import { durationSeconds, fmtDate, fmtDur, fmtTime, type DashViewProps } from './types';
import { DateInput as MaskedDateInput } from '../EntryEditorSheet';
import { matchPreset, rangeThisMonth, rangeThisWeek, rangeToday, type RangePreset } from '../format';

export function TableView(p: DashViewProps) {
  const totals = useMemo(() => {
    let total = 0;
    const byCat = new Map<string, number>();
    for (const e of p.entries) {
      const s = durationSeconds(e);
      total += s;
      byCat.set(e.category_id, (byCat.get(e.category_id) ?? 0) + s);
    }
    const top = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, s]) => ({ cat: p.categories.find((c) => c.id === id), s }));
    return { total, top };
  }, [p.entries, p.categories]);

  return (
    <div className="flex h-full flex-col">
      {/* Stats + range strip */}
      <div className="flex items-center gap-4 border-b border-separator bg-surface-alt px-3 py-1.5 text-[11px]">
        <Stat label="Total" value={fmtDur(totals.total)} bold />
        <span className="text-separator">|</span>
        {totals.top.map((t) => (
          <div key={t.cat?.id} className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: t.cat?.color }} />
            <span className="text-label-2">{t.cat?.name}</span>
            <span className="tabular-nums">{fmtDur(t.s)}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <PresetButtons
            current={matchPreset(p.range)}
            onPick={(preset) => {
              const r = preset === 'today' ? rangeToday()
                : preset === 'week' ? rangeThisWeek()
                : rangeThisMonth();
              p.onRangeChange(r);
            }}
          />
          <span className="mx-1 h-3 w-px bg-separator" aria-hidden />
          <DateInput value={p.range.startUtc} onChange={(v) => p.onRangeChange({ ...p.range, startUtc: v })} />
          <span className="text-label-2">→</span>
          <DateInput value={p.range.endUtc} onChange={(v) => p.onRangeChange({ ...p.range, endUtc: v })} />
          <span className="ml-2 text-[10px] text-label-2">{p.entries.length} entries</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-label-2">
              <th className="border-b border-separator px-3 py-1.5 font-medium">Date</th>
              <th className="border-b border-separator px-3 py-1.5 font-medium">Time</th>
              <th className="border-b border-separator px-3 py-1.5 font-medium">Dur</th>
              <th className="border-b border-separator px-3 py-1.5 font-medium">Category</th>
              <th className="border-b border-separator px-3 py-1.5 font-medium">Project</th>
              <th className="border-b border-separator px-3 py-1.5 font-medium">Description</th>
              <th className="border-b border-separator px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {p.entries.length === 0 && !p.isLoading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[12px] text-label-2">
                  No entries in this range.
                </td>
              </tr>
            )}
            {p.entries.map((e) => {
              const cat = p.categories.find((c) => c.id === e.category_id);
              const proj = p.projects.find((pr) => pr.id === e.project_id);
              return (
                <tr key={e.id} className="group h-7 border-b border-separator hover:bg-fill-hover">
                  <td className="px-3 text-label-2">{fmtDate(e.started_at)}</td>
                  <td className="px-3 tabular-nums">{fmtTime(e.started_at)} – {e.ended_at ? fmtTime(e.ended_at) : '…'}</td>
                  <td className="px-3 tabular-nums">{fmtDur(durationSeconds(e))}</td>
                  <td className="px-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: cat?.color }} />
                      {cat?.name ?? '?'}
                    </span>
                  </td>
                  <td className="px-3 text-label-2">{proj?.name ?? ''}</td>
                  <td className="max-w-[260px] truncate px-3 text-label-2">{e.note ?? ''}</td>
                  <td className="px-3 text-right opacity-0 transition-opacity group-hover:opacity-100">
                    <button className="text-accent hover:underline" onClick={() => p.onEdit(e)}>Edit</button>
                    <button className="ml-2 text-destructive hover:underline" onClick={() => p.onDelete(e)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-[0.08em] text-label-2">{label}</span>
      <span className={'tabular-nums ' + (bold ? 'font-medium' : '')}>{value}</span>
    </div>
  );
}

const PRESETS: { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

function PresetButtons({
  current, onPick,
}: {
  current: RangePreset;
  onPick: (preset: Exclude<RangePreset, 'custom'>) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-fill p-0.5">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p.id)}
          className={
            'h-5 rounded-[5px] px-2 text-[11px] transition-colors ' +
            (current === p.id
              ? 'bg-raised text-label shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
              : 'text-label-2 hover:text-label')
          }
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // value is a full ISO timestamp; the shared masked input expects YYYY-MM-DD.
  const ymd = toYmd(value);
  return (
    <MaskedDateInput
      value={ymd}
      onChange={(next) => {
        if (!next) return;
        // Interpret the picked day in local time, convert back to ISO.
        const [y, m, d] = next.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        onChange(dt.toISOString());
      }}
      className="h-5 text-[11px]"
    />
  );
}
function toYmd(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
