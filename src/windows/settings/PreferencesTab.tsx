import { useEffect, useState } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

export function PreferencesTab() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => { isEnabled().then(setAutostart); }, []);

  const toggle = async () => {
    if (autostart) { await disable(); setAutostart(false); }
    else { await enable(); setAutostart(true); }
  };

  return (
    <div className="space-y-4 p-4 text-sm">
      <label
        className={[
          'flex items-center gap-2 cursor-pointer select-none',
          autostart == null ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ').trim()}
      >
        <input
          type="checkbox"
          className="rounded accent-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          checked={autostart ?? false}
          disabled={autostart == null}
          onChange={toggle}
        />
        Launch TimeTrak at login
      </label>
      <p className="text-xs text-gray-500 leading-relaxed">
        Daily summary time is set by editing <code>app_meta.daily_summary_time</code> in the database (UI TODO in plan 05).
      </p>
    </div>
  );
}
