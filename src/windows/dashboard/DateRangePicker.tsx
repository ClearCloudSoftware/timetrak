interface Props {
  startUtc: string;
  endUtc: string;
  onChange: (next: { startUtc: string; endUtc: string }) => void;
}

export function DateRangePicker({ startUtc, endUtc, onChange }: Props) {
  const startLocal = toLocalInput(startUtc);
  const endLocal = toLocalInput(endUtc);

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <label htmlFor="range-from" className="text-xs font-medium uppercase tracking-wide text-gray-500">
        From
      </label>
      <input
        id="range-from"
        type="datetime-local"
        className="rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        value={startLocal}
        onChange={(e) => onChange({ startUtc: fromLocalInput(e.target.value), endUtc })}
      />
      <label htmlFor="range-to" className="text-xs font-medium uppercase tracking-wide text-gray-500">
        To
      </label>
      <input
        id="range-to"
        type="datetime-local"
        className="rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        value={endLocal}
        onChange={(e) => onChange({ startUtc, endUtc: fromLocalInput(e.target.value) })}
      />
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
