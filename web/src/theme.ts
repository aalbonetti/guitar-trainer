// Appearance: Light (Walnut & Cream, default), Dark, or match the phone. The choice lives in localStorage `gt_theme`;
// public/theme-init.js applies it before first paint, applyTheme() keeps it current.
export type ThemePref = 'light' | 'dark' | 'auto';
export const THEME_KEY = 'gt_theme';
export const THEME_COLORS = { light: '#F6EFE4', dark: '#14161a' } as const;

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  return pref === 'dark' || (pref === 'auto' && systemDark) ? 'dark' : 'light';
}

export function getThemePref(): ThemePref {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'dark' || v === 'auto' ? v : 'light'; } catch { return 'light'; }
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function applyTheme() {
  const t = resolveTheme(getThemePref(), systemDark());
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[t]);
}

export function setThemePref(p: ThemePref) {
  try { localStorage.setItem(THEME_KEY, p); } catch { /* storage blocked: applies for this visit only */ }
  applyTheme();
}

/** Call once at startup: applies the saved choice and follows the phone's setting while on "Match phone". */
export function initTheme() {
  applyTheme();
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getThemePref() === 'auto') applyTheme(); });
}
