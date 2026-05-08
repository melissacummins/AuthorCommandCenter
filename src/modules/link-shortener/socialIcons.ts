// Shared platform detection + icon URL builder.
//
// Used both by the bio page editor (BioPagePanel) and by the public
// /api/bio renderer. Server-side keeps its own copy of the data inline
// because Vercel's bundler is flaky picking up imports from sibling
// directories — keep this file as the source of truth for the UI side
// and mirror updates over to api/bio.ts when adding new platforms.

export type SocialPlatform =
  | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'threads'
  | 'pinterest' | 'patreon' | 'substack' | 'spotify' | 'applemusic'
  | 'linkedin' | 'github' | 'tumblr' | 'bluesky' | 'kofi' | 'twitch'
  | 'discord' | 'goodreads' | 'amazon' | 'shopify' | 'website' | 'email';

export const SOCIAL_HEX: Record<SocialPlatform, string> = {
  instagram: 'E4405F',
  tiktok: '000000',
  youtube: 'FF0000',
  facebook: '1877F2',
  x: '000000',
  threads: '000000',
  pinterest: 'BD081C',
  patreon: 'FF424D',
  substack: 'FF6719',
  spotify: '1DB954',
  applemusic: 'FA243C',
  linkedin: '0A66C2',
  github: '181717',
  tumblr: '36465D',
  bluesky: '0085FF',
  kofi: 'FF5E5B',
  twitch: '9146FF',
  discord: '5865F2',
  goodreads: '372213',
  amazon: 'FF9900',
  shopify: '7AB55C',
  website: '64748B',
  email: '64748B',
};

export const SOCIAL_NAMES: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  threads: 'Threads',
  pinterest: 'Pinterest',
  patreon: 'Patreon',
  substack: 'Substack',
  spotify: 'Spotify',
  applemusic: 'Apple Music',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  tumblr: 'Tumblr',
  bluesky: 'Bluesky',
  kofi: 'Ko-fi',
  twitch: 'Twitch',
  discord: 'Discord',
  goodreads: 'Goodreads',
  amazon: 'Amazon',
  shopify: 'Shop',
  website: 'Website',
  email: 'Email',
};

// simpleicons.org slug for each platform (null = use inline fallback svg).
export const SIMPLEICONS_SLUG: Record<SocialPlatform, string | null> = {
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube',
  facebook: 'facebook',
  x: 'x',
  threads: 'threads',
  pinterest: 'pinterest',
  patreon: 'patreon',
  substack: 'substack',
  spotify: 'spotify',
  applemusic: 'applemusic',
  linkedin: 'linkedin',
  github: 'github',
  tumblr: 'tumblr',
  bluesky: 'bluesky',
  kofi: 'kofi',
  twitch: 'twitch',
  discord: 'discord',
  goodreads: 'goodreads',
  amazon: 'amazon',
  shopify: 'shopify',
  website: null,
  email: null,
};

export function detectSocialPlatform(url: string): SocialPlatform {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return 'email';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host.endsWith('instagram.com')) return 'instagram';
    if (host.endsWith('tiktok.com')) return 'tiktok';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.endsWith('facebook.com') || host === 'fb.me' || host === 'fb.com' || host === 'm.me') return 'facebook';
    if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x';
    if (host.endsWith('threads.net') || host.endsWith('threads.com')) return 'threads';
    if (host.endsWith('pinterest.com') || host === 'pin.it') return 'pinterest';
    if (host.endsWith('patreon.com')) return 'patreon';
    if (host.endsWith('substack.com') || host.endsWith('.substack.com')) return 'substack';
    if (host.endsWith('spotify.com') || host === 'open.spotify.com') return 'spotify';
    if (host === 'music.apple.com') return 'applemusic';
    if (host.endsWith('linkedin.com')) return 'linkedin';
    if (host.endsWith('github.com')) return 'github';
    if (host.endsWith('tumblr.com')) return 'tumblr';
    if (host.endsWith('bsky.app') || host.endsWith('bsky.social')) return 'bluesky';
    if (host.endsWith('ko-fi.com')) return 'kofi';
    if (host.endsWith('twitch.tv')) return 'twitch';
    if (host === 'discord.gg' || host.endsWith('discord.com')) return 'discord';
    if (host.endsWith('goodreads.com')) return 'goodreads';
    if (host.includes('amazon.')) return 'amazon';
    if (host.endsWith('myshopify.com') || host.startsWith('shop.')) return 'shopify';
    return 'website';
  } catch {
    return 'website';
  }
}

// CDN URL for a brand icon (white on transparent for use on colored backgrounds).
export function socialIconCdn(platform: SocialPlatform): string {
  const slug = SIMPLEICONS_SLUG[platform];
  if (!slug) return '';
  return `https://cdn.simpleicons.org/${slug}/white`;
}

export function socialColor(platform: SocialPlatform): string {
  return '#' + SOCIAL_HEX[platform];
}
