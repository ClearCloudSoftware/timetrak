import { useState } from 'react';
import { Tag, Folder, CalendarDays, SlidersHorizontal } from 'lucide-react';
import { CategoriesPane, PreferencesPane, ProjectsPane } from './panes';
import { CalendarPane } from './CalendarPane';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

type Section = 'categories' | 'projects' | 'calendar' | 'preferences';
const SECTIONS: { id: Section; label: string; icon: typeof Tag }[] = [
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'preferences', label: 'General', icon: SlidersHorizontal },
];

export function Settings() {
  const [section, setSection] = useState<Section>('categories');
  const active = SECTIONS.find((s) => s.id === section);
  return (
    <div className="flex h-screen bg-surface text-label" style={FONT}>
      <aside className="flex w-44 shrink-0 flex-col border-r border-separator bg-surface-alt">
        {/* Overlay title bar: traffic lights sit here; the strip is a drag region. */}
        <div data-tauri-drag-region className="h-10 shrink-0" />
        <nav className="flex-1 px-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={
                'mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] ' +
                (section === s.id ? 'bg-accent text-white' : 'hover:bg-fill-hover')
              }
            >
              <s.icon
                className={'h-3.5 w-3.5 shrink-0 ' + (section === s.id ? 'opacity-90' : 'text-label-2')}
                aria-hidden
              />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div
          data-tauri-drag-region
          className="flex h-10 shrink-0 items-center border-b border-separator px-4 text-[13px] font-semibold"
        >
          <span className="pointer-events-none">{active?.label}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {section === 'categories' && <CategoriesPane />}
          {section === 'projects' && <ProjectsPane />}
          {section === 'calendar' && <CalendarPane />}
          {section === 'preferences' && <PreferencesPane />}
        </div>
      </main>
    </div>
  );
}
