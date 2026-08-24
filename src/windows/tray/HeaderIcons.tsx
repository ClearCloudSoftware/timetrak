import { LayoutDashboard, Settings as SettingsIcon } from 'lucide-react';
import * as api from '../../lib/api';

interface Props {
  onError?: (message: string) => void;
}

export function HeaderIcons({ onError }: Props) {
  const openDashboard = () => api.openWindow('dashboard').catch((e) => onError?.(String(e)));
  const openSettings = () => api.openWindow('settings').catch((e) => onError?.(String(e)));

  const btn =
    'inline-flex h-5 w-5 items-center justify-center rounded text-label-2 transition-colors hover:text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div className="flex items-center gap-0.5">
      <button type="button" aria-label="Open Dashboard" className={btn} onClick={openDashboard}>
        <LayoutDashboard className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Open Settings" className={btn} onClick={openSettings}>
        <SettingsIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
