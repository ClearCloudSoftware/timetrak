import { TrayPopover } from './windows/tray';
import { Dashboard } from './windows/dashboard';
import { Settings } from './windows/settings';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('window') ?? 'tray';

  if (w === 'tray') return <TrayPopover />;
  if (w === 'dashboard') return <Dashboard />;
  if (w === 'settings') return <Settings />;
  return <div className="p-4 text-sm text-gray-500">Unknown window: {w}</div>;
}
