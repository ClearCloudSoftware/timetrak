import { LayoutDashboard, Download, Settings as SettingsIcon } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import * as api from '../../lib/api';
import { todayRangeUtc } from './format';

interface Props {
  onError?: (message: string) => void;
}

export function HeaderIcons({ onError }: Props) {
  const openDashboard = () => api.openWindow('dashboard').catch((e) => onError?.(String(e)));
  const openSettings = () => api.openWindow('settings').catch((e) => onError?.(String(e)));
  const exportToday = async () => {
    try {
      const { startUtc, endUtc } = todayRangeUtc();
      const csv = await api.exportCsv(startUtc, endUtc);
      const path = await save({
        defaultPath: 'timetrak-today.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (path) await writeTextFile(path, csv);
    } catch (e) {
      onError?.(String(e));
    }
  };

  const btn =
    'inline-flex h-5 w-5 items-center justify-center rounded text-[#86868b] transition-colors hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]';

  return (
    <div className="flex items-center gap-0.5">
      <button type="button" aria-label="Open Dashboard" className={btn} onClick={openDashboard}>
        <LayoutDashboard className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Export today's CSV" className={btn} onClick={exportToday}>
        <Download className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Open Settings" className={btn} onClick={openSettings}>
        <SettingsIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
