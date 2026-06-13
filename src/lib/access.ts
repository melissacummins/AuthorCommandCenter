// Access control: who can get into the app (app_members allowlist) and which
// feature areas they can see (each member's `modules` list). Payment happens
// outside the app (Skool); this layer only governs access.

export type MemberStatus = 'pending' | 'active' | 'blocked';
// 'alpha' and 'lifetime' are legacy values kept so older rows stay valid;
// new members use 'member'. Admin keeps its own value.
export type MemberPlan = 'alpha' | 'lifetime' | 'admin' | 'member';

export interface AppMember {
  id: string;
  email: string;
  status: MemberStatus;
  plan: MemberPlan;
  modules: string[];
  user_id: string | null;
  note: string;
  requested_at: string;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

// Kept so the older `app_modules` reads don't break; the per-tier flags are
// no longer consulted by the access logic.
export interface AppModule {
  key: string;
  label: string;
  alpha_enabled: boolean;
  lifetime_enabled: boolean;
  updated_at: string;
}

// The gateable feature areas. Home and Settings are always available and are
// intentionally not in this list. Keys match the database `app_modules.key`
// and each path matches the route registered in App.tsx.
export const GATED_MODULES: { key: string; path: string; label: string }[] = [
  { key: 'catalog', path: '/catalog', label: 'Catalog' },
  { key: 'timeline', path: '/timeline', label: 'Timeline' },
  { key: 'book-tracker', path: '/book-tracker', label: 'Book Tracker' },
  { key: 'profit-track', path: '/profit-track', label: 'Profit' },
  { key: 'finstream', path: '/finstream', label: 'Transactions' },
  { key: 'inventory', path: '/inventory', label: 'Inventory' },
  { key: 'cross-sell', path: '/cross-sell', label: 'Cross-Sell Analyzer' },
  { key: 'ad-alchemy', path: '/ad-alchemy', label: 'Ad Alchemy' },
  { key: 'marketing', path: '/marketing', label: 'Marketing' },
  { key: 'kdp-optimizer', path: '/kdp-optimizer', label: 'KDP Optimizer' },
  { key: 'links', path: '/links', label: 'Links' },
  { key: 'arcs', path: '/arcs', label: 'ARCs' },
  { key: 'bookfunnel', path: '/bookfunnel', label: 'BookFunnel' },
  { key: 'media', path: '/media', label: 'Media' },
  { key: 'social-media', path: '/social-media', label: 'Social Media' },
];

const PATH_TO_KEY = new Map(GATED_MODULES.map(m => [m.path, m.key]));
const ALL_KEYS = new Set(GATED_MODULES.map(m => m.key));

export function moduleKeyForPath(path: string): string | undefined {
  return PATH_TO_KEY.get(path);
}

// Which module keys this member is allowed to see. Admin sees everything;
// other members see exactly what's on their `modules` list (intersected with
// the live module catalogue so an unknown key can't sneak in). Inactive
// members see nothing.
export function visibleModuleKeys(
  member: AppMember | null,
  _modules: AppModule[],
): Set<string> {
  if (!member || member.status !== 'active') return new Set();
  if (member.plan === 'admin') return new Set(ALL_KEYS);
  const allowed = Array.isArray(member.modules) ? member.modules : [];
  return new Set(allowed.filter(k => ALL_KEYS.has(k)));
}
