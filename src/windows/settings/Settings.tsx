import { useState } from 'react';
import { CategoriesTab } from './CategoriesTab';
import { ProjectsTab } from './ProjectsTab';
import { PreferencesTab } from './PreferencesTab';

type Tab = 'categories' | 'projects' | 'preferences';

export function Settings() {
  const [tab, setTab] = useState<Tab>('categories');
  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-3 text-lg font-semibold">Settings</h1>
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        {(['categories', 'projects', 'preferences'] as Tab[]).map((t) => (
          <button
            key={t}
            className={
              'cursor-pointer capitalize px-3 py-1 text-sm transition-colors ' +
              (tab === t
                ? 'border-b-2 border-blue-600 font-medium -mb-px'
                : 'text-gray-500 hover:text-gray-900')
            }
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'preferences' && <PreferencesTab />}
      </div>
    </div>
  );
}
