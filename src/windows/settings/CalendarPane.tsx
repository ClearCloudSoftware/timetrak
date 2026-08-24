import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import * as api from '../../lib/api';
import { qk } from '../../lib/query';
import type { CalendarRow, ConnectPollResult, DeviceCodePayload, IcsInput, SyncReport } from '../../types';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

export function CalendarPane() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['calendar', 'status'], queryFn: api.calendarStatus });
  const cats = useQuery({ queryKey: qk.categories, queryFn: api.listCategories });
  const calendars = useQuery({
    queryKey: ['calendar', 'calendars'],
    queryFn: api.calendarListCalendars,
    enabled: !!status.data?.connected,
  });

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    listen('calendar-connected', () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
    }).then((u) => unsubs.push(u));
    listen('calendar-synced', () => {
      qc.invalidateQueries({ queryKey: ['calendar', 'status'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [qc]);

  return (
    <div className="space-y-4 text-[12px]" style={FONT}>
      <ConnectionPanel status={status.data} qc={qc} />
      <MeetingCategoryPanel
        categoryId={status.data?.meeting_category_id ?? null}
        categories={cats.data ?? []}
        onChange={(id) => api.setMeetingCategory(id).then(() => qc.invalidateQueries({ queryKey: ['calendar', 'status'] }))}
      />
      {status.data && (
        <SyncSettingsPanel status={status.data} qc={qc} />
      )}
      {status.data?.connected && (
        <>
          <CalendarsPanel calendars={calendars.data ?? []} qc={qc} />
          <SyncPanel status={status.data} />
        </>
      )}
    </div>
  );
}

function ConnectionPanel({ status, qc }: { status: ReturnType<typeof api.calendarStatus> extends Promise<infer T> ? T | undefined : never; qc: ReturnType<typeof useQueryClient> }) {
  const disconnect = useMutation({
    mutationFn: () => api.calendarDisconnect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  });

  if (status?.connected) {
    const authError = isAuthError(status.last_sync_error);
    return (
      <Section title="Connection">
        {authError && status.kind === 'oauth' && (
          <AuthExpiredBanner errorMsg={status.last_sync_error!} qc={qc} />
        )}
        <div className="rounded-md border border-black/10 bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[12px] text-[#1d1d1f]">
                Connected via <strong>{status.kind === 'oauth' ? 'Google' : 'ICS'}</strong>
                {status.account_email && <> as {status.account_email}</>}
              </div>
              {status.last_sync_at && (
                <div className="mt-0.5 text-[11px] text-[#86868b]">
                  Last sync {new Date(status.last_sync_at).toLocaleString()}
                </div>
              )}
              {status.last_sync_error && !authError && (
                <div className="mt-0.5 text-[11px] text-[#ff453a]">
                  Last error: {status.last_sync_error}
                </div>
              )}
            </div>
            <button
              className="h-6 rounded-md border border-black/10 px-2.5 text-[11px] text-[#ff453a] hover:bg-[#ff453a]/[0.06]"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Connection">
      <GoogleConnect />
      <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[#86868b]">
        <div className="flex-1 border-t border-black/5" />
        or
        <div className="flex-1 border-t border-black/5" />
      </div>
      <IcsConnect />
    </Section>
  );
}

function GoogleConnect() {
  const [device, setDevice] = useState<DeviceCodePayload | null>(null);
  const [poll, setPoll] = useState<ConnectPollResult | null>(null);
  const pollTimer = useRef<number | undefined>(undefined);

  const start = useMutation({
    mutationFn: () => api.calendarConnectStart(),
    onSuccess: (payload) => {
      setDevice(payload);
      setPoll({ kind: 'pending' });
      try { window.open(payload.verification_url, '_blank'); } catch {}
      pollLoop(payload.interval);
    },
  });

  const pollLoop = (intervalSec: number) => {
    clearTimeout(pollTimer.current);
    const tick = async () => {
      try {
        const r = await api.calendarConnectComplete();
        setPoll(r);
        if (r.kind === 'pending') {
          pollTimer.current = window.setTimeout(tick, intervalSec * 1000);
        } else if (r.kind === 'slow_down') {
          pollTimer.current = window.setTimeout(tick, (intervalSec + 5) * 1000);
        }
        // approved / denied / expired / error: stop.
      } catch (err) {
        setPoll({ kind: 'error', message: String(err) });
      }
    };
    pollTimer.current = window.setTimeout(tick, intervalSec * 1000);
  };

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  if (poll?.kind === 'approved') {
    return (
      <div className="rounded-md border border-[#34c759]/30 bg-[#34c759]/[0.06] p-3 text-[12px]">
        Connected{poll.account_email ? ` as ${poll.account_email}` : ''}.
      </div>
    );
  }

  if (device && (poll?.kind === 'pending' || poll?.kind === 'slow_down')) {
    return (
      <div className="rounded-md border border-black/10 bg-white p-3">
        <div className="text-[11px] text-[#86868b]">
          Open{' '}
          <button
            className="text-[#0a84ff] hover:underline"
            onClick={() => { try { window.open(device.verification_url, '_blank'); } catch {} }}
          >
            {device.verification_url}
          </button>
          {' '}and enter:
        </div>
        <div className="mt-1 select-all font-mono text-[18px] font-medium tracking-[0.15em] text-[#1d1d1f]">
          {device.user_code}
        </div>
        <div className="mt-1 text-[10px] text-[#86868b]">Waiting for confirmation…</div>
      </div>
    );
  }

  if (poll?.kind === 'denied' || poll?.kind === 'expired' || poll?.kind === 'error') {
    return (
      <div className="rounded-md border border-[#ff453a]/30 bg-[#ff453a]/[0.06] p-3 text-[12px] text-[#ff453a]">
        {poll.kind === 'denied' && 'You declined the request.'}
        {poll.kind === 'expired' && 'The code expired. Try again.'}
        {poll.kind === 'error' && `Error: ${poll.message}`}
        <button
          className="ml-2 underline"
          onClick={() => { setPoll(null); setDevice(null); }}
        >Retry</button>
      </div>
    );
  }

  return (
    <>
      <button
        className="h-7 w-full rounded-md bg-[#0a84ff] px-3 text-[12px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
        onClick={() => start.mutate()}
        disabled={start.isPending}
      >
        {start.isPending ? 'Starting…' : 'Connect Google Calendar'}
      </button>
      {start.isError && (
        <div className="mt-1.5 rounded-md bg-[#ff453a]/10 px-2 py-1 text-[11px] text-[#ff453a]">
          {String(start.error)}
        </div>
      )}
    </>
  );
}

function IcsConnect() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<IcsInput[]>([{ display_name: '', url: '' }]);

  const connect = useMutation({
    mutationFn: () => api.calendarConnectIcs(rows.filter((r) => r.url.trim())),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  });

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-[#86868b]">
        Or paste private ICS URLs (Google Calendar → Settings → Integrate calendar → Secret address in iCal format).
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            className="h-6 w-28 rounded-md border border-black/10 bg-white px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/40"
            placeholder="Name"
            value={r.display_name}
            onChange={(e) => updateRow(i, { ...r, display_name: e.target.value })}
          />
          <input
            className="h-6 flex-1 rounded-md border border-black/10 bg-white px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/40"
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            value={r.url}
            onChange={(e) => updateRow(i, { ...r, url: e.target.value })}
          />
          {rows.length > 1 && (
            <button
              className="h-6 rounded-md px-2 text-[11px] text-[#ff453a] hover:bg-[#ff453a]/[0.06]"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >−</button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          className="h-6 rounded-md border border-black/10 px-2 text-[11px] hover:bg-black/[0.04]"
          onClick={() => setRows([...rows, { display_name: '', url: '' }])}
        >＋ Add another</button>
        <button
          className="h-6 rounded-md bg-[#0a84ff] px-3 text-[11px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
          onClick={() => connect.mutate()}
          disabled={connect.isPending || !rows.some((r) => r.url.trim())}
        >
          {connect.isPending ? 'Connecting…' : 'Connect ICS'}
        </button>
      </div>
      {connect.isError && (
        <div className="text-[11px] text-[#ff453a]">{String(connect.error)}</div>
      )}
    </div>
  );

  function updateRow(i: number, next: IcsInput) {
    setRows(rows.map((r, j) => (j === i ? next : r)));
  }
}

function MeetingCategoryPanel({
  categoryId, categories, onChange,
}: {
  categoryId: string | null;
  categories: { id: string; name: string; color: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <Section title="Meeting category">
      <div className="flex items-center gap-2 rounded-md border border-black/10 bg-white p-2">
        <select
          className="h-6 flex-1 rounded-md border border-black/10 bg-white px-2 text-[12px]"
          value={categoryId ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {!categoryId && <option value="" disabled>Pick a category…</option>}
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="mt-1 text-[11px] text-[#86868b]">
        Imported calendar events will be created with this category.
      </div>
    </Section>
  );
}

function CalendarsPanel({ calendars, qc }: { calendars: CalendarRow[]; qc: ReturnType<typeof useQueryClient> }) {
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.calendarToggleCalendar(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar', 'calendars'] }),
  });

  return (
    <Section title="Calendars">
      <div className="divide-y divide-black/5 rounded-md border border-black/10 bg-white">
        {calendars.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-[#86868b]">
            No calendars discovered. Try Sync now.
          </div>
        )}
        {calendars.map((c) => (
          <label key={c.id} className="flex h-7 cursor-pointer items-center gap-2 px-2">
            <input
              type="checkbox"
              checked={c.enabled}
              onChange={(e) => toggle.mutate({ id: c.id, enabled: e.target.checked })}
            />
            <span className="text-[12px]">{c.display_name}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

function SyncPanel({ status }: { status: { meeting_category_id: string | null } }) {
  const [report, setReport] = useState<SyncReport | null>(null);
  const sync = useMutation({
    mutationFn: () => api.calendarSyncNow(),
    onSuccess: (r) => setReport(r),
  });
  const blocked = !status.meeting_category_id;
  return (
    <Section title="Sync">
      <div className="flex items-center gap-2">
        <button
          className="h-6 rounded-md bg-[#0a84ff] px-3 text-[11px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
          onClick={() => sync.mutate()}
          disabled={sync.isPending || blocked}
        >
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </button>
        {blocked && (
          <span className="text-[11px] text-[#ff453a]">Pick a meeting category first.</span>
        )}
      </div>
      {report && (
        <div className="mt-1.5 text-[11px] text-[#86868b]">
          {report.created} created · {report.updated} updated · {report.deleted} removed · {report.conflicts} conflicts
        </div>
      )}
      {sync.isError && (
        <div className="mt-1 text-[11px] text-[#ff453a]">{String(sync.error)}</div>
      )}
    </Section>
  );
}

function SyncSettingsPanel({
  status, qc,
}: {
  status: { initial_backfill_days: number; poll_interval_minutes: number; extend_meeting_minutes: number };
  qc: ReturnType<typeof useQueryClient>;
}) {
  return (
    <Section title="Sync settings">
      <div className="space-y-1.5 rounded-md border border-black/10 bg-white p-2.5">
        <NumberRow
          label="Background sync"
          suffix="min"
          min={5}
          max={60}
          value={status.poll_interval_minutes}
          help="How often TimeTrak polls the calendar in the background."
          onSave={(n) => api.setPollIntervalMinutes(n).then(() => qc.invalidateQueries({ queryKey: ['calendar', 'status'] }))}
        />
        <NumberRow
          label="Extend meeting by"
          suffix="min"
          min={5}
          max={60}
          value={status.extend_meeting_minutes}
          help="When you click Extend on the meeting-end prompt, the timer keeps running this many more minutes."
          onSave={(n) => api.setExtendMeetingMinutes(n).then(() => qc.invalidateQueries({ queryKey: ['calendar', 'status'] }))}
        />
        <NumberRow
          label="Initial backfill"
          suffix="days"
          min={1}
          max={90}
          value={status.initial_backfill_days}
          help="On first connect, how far back to import past events."
          onSave={(n) => api.setInitialBackfillDays(n).then(() => qc.invalidateQueries({ queryKey: ['calendar', 'status'] }))}
        />
      </div>
    </Section>
  );
}

function NumberRow({
  label, suffix, min, max, value, help, onSave,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  value: number;
  help?: string;
  onSave: (n: number) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep draft in sync if the upstream value changes (e.g. another window edits it).
  useEffect(() => { setDraft(String(value)); }, [value]);

  const dirty = draft !== String(value);
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max;

  const commit = async () => {
    if (!valid || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="flex-1 text-[12px] text-[#1d1d1f]">{label}</label>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          className="h-6 w-16 rounded-md border border-black/10 bg-white px-2 text-right text-[12px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/40"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        />
        <span className="w-8 text-[11px] text-[#86868b]">{suffix}</span>
      </div>
      {help && <div className="ml-[2px] mt-0.5 text-[11px] text-[#86868b]">{help}</div>}
      {dirty && !valid && (
        <div className="ml-[2px] mt-0.5 text-[11px] text-[#ff453a]">
          Must be a whole number between {min} and {max}.
        </div>
      )}
      {saving && <div className="ml-[2px] mt-0.5 text-[11px] text-[#86868b]">Saving…</div>}
      {error && <div className="ml-[2px] mt-0.5 text-[11px] text-[#ff453a]">{error}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#86868b]">{title}</div>
      {children}
    </section>
  );
}

/// Heuristic: refresh token revoked / expired / consent removed. Google's
/// canonical signal is `invalid_grant`; we also match a few looser strings
/// in case Google changes the wording.
function isAuthError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes('invalid_grant') ||
    m.includes('refresh rejected') ||
    m.includes('unauthorized') ||
    m.includes('token has been expired or revoked')
  );
}

function AuthExpiredBanner({
  errorMsg, qc,
}: { errorMsg: string; qc: ReturnType<typeof useQueryClient> }) {
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconnect = async () => {
    setReconnecting(true);
    setError(null);
    try {
      await api.calendarDisconnect();
      // Surface the connect form by invalidating status — UI re-renders to
      // the not-connected view, where the user clicks "Connect Google
      // Calendar" and goes through the device-code flow as normal.
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      setError(String(e));
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className="mb-1.5 rounded-md border border-[#ff9f0a]/40 bg-[#fff8e6] p-2.5">
      <div className="flex items-start gap-2">
        <span className="text-[#ff9f0a]">⚠</span>
        <div className="flex-1 text-[12px]">
          <div className="font-medium text-[#1d1d1f]">Authorization expired</div>
          <div className="mt-0.5 text-[11px] text-[#86868b]">
            Google revoked or expired the refresh token (apps in OAuth
            "testing" mode expire after 7 days). Sync will keep failing
            until you reconnect.
          </div>
          <div className="mt-0.5 text-[10px] text-[#86868b]">
            <span className="opacity-70">Details:</span> {errorMsg}
          </div>
        </div>
        <button
          className="h-7 rounded-md bg-[#0a84ff] px-3 text-[11px] font-medium text-white hover:bg-[#0a74e0] disabled:bg-[#d2d2d7]"
          onClick={reconnect}
          disabled={reconnecting}
        >
          {reconnecting ? 'Disconnecting…' : 'Reconnect'}
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-[#ff453a]">{error}</div>}
    </div>
  );
}
