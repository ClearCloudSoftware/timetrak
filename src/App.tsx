import { TrayPopover } from './windows/tray';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('window') ?? 'tray';

  if (w === 'tray') return <TrayPopover />;
  // other plans append cases below
  return <div className="p-4 text-sm text-gray-500">Unknown window: {w}</div>;
}
