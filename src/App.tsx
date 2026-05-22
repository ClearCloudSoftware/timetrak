export default function App() {
  const params = new URLSearchParams(window.location.search);
  const window_ = params.get('window') ?? 'tray';
  return (
    <div className="h-full w-full p-4 text-sm">
      <div className="text-gray-500">TimeTrak [{window_}] placeholder</div>
    </div>
  );
}
