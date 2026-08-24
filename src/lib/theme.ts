// Appearance preference. Applied via Tauri's app-wide setTheme, which flips
// NSAppearance — so CSS `prefers-color-scheme`, popover vibrancy, and native
// dialogs all follow together in every window. localStorage is shared across
// this app's webviews; each window re-applies on load (idempotent).
import { setTheme } from '@tauri-apps/api/app';

export type ThemePref = 'auto' | 'light' | 'dark';

const KEY = 'timetrak.theme';

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function applyThemePref(p: ThemePref): void {
  localStorage.setItem(KEY, p);
  void setTheme(p === 'auto' ? null : p).catch(() => {});
}

/** Re-apply the stored preference on window startup. */
export function initTheme(): void {
  const p = getThemePref();
  if (p !== 'auto') void setTheme(p).catch(() => {});
}
