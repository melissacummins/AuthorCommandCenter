export interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'social' | 'book' | 'general';
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'pinterest',      label: 'Pinterest pin (1000×1500)',  width: 1000, height: 1500, group: 'social' },
  { id: 'ig-square',      label: 'Instagram square (1080×1080)', width: 1080, height: 1080, group: 'social' },
  { id: 'ig-portrait',    label: 'Instagram portrait (1080×1350)', width: 1080, height: 1350, group: 'social' },
  { id: 'ig-story',       label: 'Instagram story / Reel (1080×1920)', width: 1080, height: 1920, group: 'social' },
  { id: 'fb-cover',       label: 'Facebook cover (1640×924)',  width: 1640, height: 924,  group: 'social' },
  { id: 'fb-post',        label: 'Facebook post (1200×630)',   width: 1200, height: 630,  group: 'social' },
  { id: 'twitter-header', label: 'X / Twitter header (1500×500)', width: 1500, height: 500, group: 'social' },
  { id: 'youtube-thumb',  label: 'YouTube thumbnail (1280×720)', width: 1280, height: 720, group: 'social' },
  { id: 'new-release',    label: 'New release banner (1200×1200)', width: 1200, height: 1200, group: 'book' },
  { id: 'book-banner',    label: 'Book promo banner (1600×900)', width: 1600, height: 900, group: 'book' },
  { id: 'square-1024',    label: 'Square (1024×1024)',         width: 1024, height: 1024, group: 'general' },
  { id: 'landscape-1024', label: 'Landscape 16:9 (1344×768)',  width: 1344, height: 768,  group: 'general' },
  { id: 'portrait-1024',  label: 'Portrait 9:16 (768×1344)',   width: 768,  height: 1344, group: 'general' },
];
