import React, { createContext, useContext, useEffect, useState } from 'react';

// App-wide theme registry (redesign directive §5). Each theme is purely a
// CSS variable block (.theme-<id> in index.css) over the Phase-0 tokens;
// this context just applies the class to <html> and persists the choice.
// Classic (the default light look) is the :root baseline — no class needed.

export interface ThemeDef {
  id: string;
  label: string;
  dark: boolean;
  /** Swatch colors for the Settings picker preview. */
  swatch: { surface: string; accent: string; sidebar: string };
}

export const THEMES: ThemeDef[] = [
  { id: 'classic',       label: 'Classic',       dark: false, swatch: { surface: '#ffffff', accent: '#991b1b', sidebar: '#0f172a' } },
  { id: 'midnight',      label: 'Midnight',      dark: true,  swatch: { surface: '#171a21', accent: '#6366f1', sidebar: '#0b0d12' } },
  { id: 'forest',        label: 'Forest',        dark: false, swatch: { surface: '#fdfbf5', accent: '#40792f', sidebar: '#1e2b20' } },
  { id: 'ocean',         label: 'Ocean',         dark: false, swatch: { surface: '#ffffff', accent: '#0e7490', sidebar: '#0d2836' } },
  { id: 'autumn',        label: 'Autumn',        dark: false, swatch: { surface: '#fdf9f3', accent: '#b45309', sidebar: '#2a1c10' } },
  { id: 'winter',        label: 'Winter',        dark: false, swatch: { surface: '#ffffff', accent: '#3d7fae', sidebar: '#1b2530' } },
  { id: 'spring',        label: 'Spring',        dark: false, swatch: { surface: '#fdfdf9', accent: '#65a30d', sidebar: '#2c3b22' } },
  { id: 'sweet-treat',   label: 'Sweet Treat',   dark: false, swatch: { surface: '#fef7fa', accent: '#d13d84', sidebar: '#3b1425' } },
  { id: 'paper',         label: 'Paper',         dark: false, swatch: { surface: '#faf8f2', accent: '#6f6650', sidebar: '#262420' } },
  { id: 'dusk-gradient', label: 'Dusk Gradient', dark: true,  swatch: { surface: '#221b33', accent: '#a78bfa', sidebar: '#150f22' } },
];

export const DEFAULT_THEME = 'classic';

// Pre-redesign values stored under the same localStorage key mapped to their
// nearest new theme, so nobody lands on a broken class after upgrading.
const LEGACY_THEMES: Record<string, string> = {
  red: 'classic',
  blue: 'ocean',
  emerald: 'forest',
  indigo: 'winter',
  violet: 'dusk-gradient',
};

const themeById = new Map(THEMES.map(t => [t.id, t]));

function normalizeTheme(stored: string | null): string {
  if (!stored) return DEFAULT_THEME;
  if (themeById.has(stored)) return stored;
  return LEGACY_THEMES[stored] ?? DEFAULT_THEME;
}

interface ThemeContextType {
  theme: string;
  themes: ThemeDef[];
  setTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<string>(() => normalizeTheme(localStorage.getItem('app-theme')));

  useEffect(() => {
    localStorage.setItem('app-theme', theme);
    const root = document.documentElement;
    for (const t of THEMES) root.classList.remove(`theme-${t.id}`);
    for (const legacy of Object.keys(LEGACY_THEMES)) root.classList.remove(`theme-${legacy}`);
    if (theme !== DEFAULT_THEME) root.classList.add(`theme-${theme}`);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, themes: THEMES, setTheme: t => setTheme(normalizeTheme(t)) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
