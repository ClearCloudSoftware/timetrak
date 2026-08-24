import { useEffect, useState } from 'react';
import { onIdleDetected } from '../../lib/events';
import * as api from '../../lib/api';

interface Pending { entryId: string; idleStartedAt: string }

export function IdleToast() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onIdleDetected((e) => setPending({ entryId: e.entry_id, idleStartedAt: e.idle_started_at }))
      .then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);

  if (!pending) return null;
  const since = new Date(pending.idleStartedAt);
  const hhmm = `${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}`;
  const resolve = (action: 'keep' | 'stop_at_idle' | 'resume') => {
    void api.idleResolve(pending.entryId, action, pending.idleStartedAt).finally(() => setPending(null));
  };

  return (
    <div className="rounded-md bg-warning/10 px-2 py-1.5 text-[11px]">
      <div className="text-label">Away since {hhmm} — timer kept running.</div>
      <div className="mt-1 flex gap-1.5">
        <button className="h-6 flex-1 rounded-md border border-separator text-[11px] hover:bg-fill-hover" onClick={() => resolve('keep')}>Keep</button>
        <button className="h-6 flex-1 rounded-md border border-separator text-[11px] hover:bg-fill-hover" onClick={() => resolve('stop_at_idle')}>Stop at {hhmm}</button>
        <button className="h-6 flex-1 rounded-md bg-accent text-[11px] font-medium text-white hover:bg-accent-hover" onClick={() => resolve('resume')}>Resume</button>
      </div>
    </div>
  );
}
