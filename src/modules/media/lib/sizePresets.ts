export interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'aspect' | 'social' | 'book';
}

// Aspect-ratio presets come first — that's how most image generators
// (and most users) think about output. Each pixel pair is chosen so
// both dimensions are divisible by 16 (an OpenAI gpt-image-2
// requirement; other models don't care but it doesn't hurt) and the
// resulting aspect exactly matches the ratio name.
//
// Platform presets keep their familiar pixel sizes — gpt-image-2's
// pre-send snap rounds them by a handful of pixels, which preserves
// the aspect ratio to within rounding. Labels lead with the aspect
// ratio so the dropdown reads as "the shape" first, "for what
// platform" second.
export const SIZE_PRESETS: SizePreset[] = [
  // Aspect ratios — what most image generators are tuned around.
  { id: 'aspect-1-1',  label: '1:1 Square',                width: 1024, height: 1024, group: 'aspect' },
  { id: 'aspect-4-5',  label: '4:5 Portrait',              width: 1088, height: 1360, group: 'aspect' },
  { id: 'aspect-2-3',  label: '2:3 Portrait (book / pin)', width: 1024, height: 1536, group: 'aspect' },
  { id: 'aspect-9-16', label: '9:16 Tall (Reels / Story)', width: 720,  height: 1280, group: 'aspect' },
  { id: 'aspect-3-2',  label: '3:2 Landscape',             width: 1536, height: 1024, group: 'aspect' },
  { id: 'aspect-16-9', label: '16:9 Landscape',            width: 1280, height: 720,  group: 'aspect' },
  { id: 'aspect-21-9', label: '21:9 Ultrawide',            width: 1344, height: 576,  group: 'aspect' },

  // Platform-specific presets — labels lead with the aspect ratio for
  // continuity with the section above.
  { id: 'pinterest',      label: 'Pinterest pin (2:3)',              width: 1000, height: 1500, group: 'social' },
  { id: 'ig-square',      label: 'Instagram square (1:1)',           width: 1080, height: 1080, group: 'social' },
  { id: 'ig-portrait',    label: 'Instagram portrait (4:5)',         width: 1080, height: 1350, group: 'social' },
  { id: 'ig-story',       label: 'Instagram story / Reel (9:16)',    width: 1080, height: 1920, group: 'social' },
  { id: 'fb-cover',       label: 'Facebook cover (16:9 ish)',        width: 1640, height: 924,  group: 'social' },
  { id: 'fb-post',        label: 'Facebook post (1.91:1)',           width: 1200, height: 630,  group: 'social' },
  { id: 'twitter-header', label: 'X / Twitter header (3:1)',         width: 1500, height: 500,  group: 'social' },
  { id: 'youtube-thumb',  label: 'YouTube thumbnail (16:9)',         width: 1280, height: 720,  group: 'social' },

  { id: 'new-release', label: 'New release banner (1:1)',     width: 1200, height: 1200, group: 'book' },
  { id: 'book-banner', label: 'Book promo banner (16:9)',     width: 1600, height: 900,  group: 'book' },
];
