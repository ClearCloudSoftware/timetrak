import { useState } from 'react';
import { CategoriesPane, PreferencesPane, ProjectsPane } from './panes';

const FONT = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

type Section = 'categories' | 'projects' | 'preferences';
const SECTIONS: { id: Section; label: string; glyph: string }[] = [
  { id: 'categories', label: 'Categories', glyph: '◐' },
  { id: 'projects', label: 'Projects', glyph: '▣' },
  { id: 'preferences', label: 'General', glyph: '⚙' },
];

export function Settings() {
  const [section, setSection] = useState<Section>('categories');
  return (
    <div className="flex h-screen bg-white text-[#1d1d1f]" style={FONT}>
      <aside className="flex w-44 shrink-0 flex-col border-r border-black/5 bg-[#f5f5f7]">
        <div className="px-3 py-2 text-[12px] font-medium">Settings</div>
        <nav className="flex-1 px-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={
                'mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] ' +
                (section === s.id ? 'bg-[#0a84ff] text-white' : 'hover:bg-black/[0.04]')
              }
            >
              <span className={section === s.id ? 'opacity-80' : 'text-[#86868b]'}>{s.glyph}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 text-[12px] font-medium text-[#86868b]">
          {SECTIONS.find((s) => s.id === section)?.label}
        </div>
        {section === 'categories' && <CategoriesPane />}
        {section === 'projects' && <ProjectsPane />}
        {section === 'preferences' && <PreferencesPane />}
      </main>
    </div>
  );
}
