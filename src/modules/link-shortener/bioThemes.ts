// Swatch data for the bio-page theme picker. The authoritative palettes
// that actually render live server-side in api/bio.ts THEMES — keep the
// ids and representative colors here in sync with that file.

export interface BioThemeSwatch {
  id: string;
  name: string;
  bg: string;       // representative background for the swatch preview
  surface: string;  // card color shown on the swatch
  accent: string;   // default accent (overridable per user)
  dark: boolean;
}

export const BIO_THEMES: BioThemeSwatch[] = [
  { id: 'classic',  name: 'Classic',  bg: 'linear-gradient(180deg, #fafafc, #eef2ff 60%, #f5f3ff)', surface: '#ffffff', accent: '#6366f1', dark: false },
  { id: 'midnight', name: 'Midnight', bg: 'linear-gradient(180deg, #0f172a, #1e1b4b)',               surface: '#1e293b', accent: '#818cf8', dark: true  },
  { id: 'blush',    name: 'Blush',    bg: 'linear-gradient(180deg, #fff5f7, #ffe9ef)',               surface: '#ffffff', accent: '#e85d75', dark: false },
  { id: 'cream',    name: 'Cream',    bg: 'linear-gradient(180deg, #fdf8f0, #f7ede0)',               surface: '#fffdf8', accent: '#b5793f', dark: false },
  { id: 'forest',   name: 'Forest',   bg: 'linear-gradient(180deg, #f3f7f3, #e4efe6)',               surface: '#ffffff', accent: '#2f7d4f', dark: false },
  { id: 'noir',     name: 'Noir',     bg: '#0a0a0a',                                                 surface: '#171717', accent: '#e5e5e5', dark: true  },
];

export const DEFAULT_BIO_THEME = 'classic';

export function bioThemeById(id: string | null | undefined): BioThemeSwatch {
  return BIO_THEMES.find((t) => t.id === id) ?? BIO_THEMES[0];
}
