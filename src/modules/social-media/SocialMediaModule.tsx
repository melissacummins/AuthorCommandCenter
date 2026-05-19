import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Share2, Plus, RefreshCw, ExternalLink, BookOpen, AlertCircle, Loader2, Trash2, X, Link as LinkIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { startPinterestOAuth, syncPinterest, disconnectAccount } from './lib/client';
import type { BookOption, SocialAccount, SocialPlatform, SocialPost } from './lib/types';

const PLATFORM_META: Record<SocialPlatform, { label: string; gradient: string; accent: string }> = {
  pinterest: { label: 'Pinterest', gradient: 'from-red-500 to-rose-600',     accent: 'text-red-500'    },
  instagram: { label: 'Instagram', gradient: 'from-fuchsia-500 to-orange-500', accent: 'text-fuchsia-500' },
  facebook:  { label: 'Facebook',  gradient: 'from-blue-500 to-blue-700',    accent: 'text-blue-500'   },
  threads:   { label: 'Threads',   gradient: 'from-slate-800 to-slate-950',  accent: 'text-slate-700'  },
  tiktok:    { label: 'TikTok',    gradient: 'from-slate-900 to-pink-500',   accent: 'text-pink-500'   },
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export default function SocialMediaModule() {
  const { user } = useAuth();
  const userId = user?.id;

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [platformFilter, setPlatformFilter] = useState<SocialPlatform | 'all'>('all');
  const [bookFilter, setBookFilter] = useState<string | 'all'>('all');

  const oauthWindowRef = useRef<Window | null>(null);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [accountsRes, postsRes, booksRes] = await Promise.all([
        supabase
          .from('social_accounts')
          .select('*')
          .eq('user_id', userId)
          .order('connected_at', { ascending: true }),
        supabase
          .from('social_posts')
          .select('*')
          .eq('user_id', userId)
          .order('posted_at', { ascending: false, nullsFirst: false })
          .limit(500),
        supabase
          .from('books')
          .select('id, title, series, cover_url')
          .eq('user_id', userId)
          .order('title', { ascending: true }),
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (postsRes.error) throw postsRes.error;
      if (booksRes.error) throw booksRes.error;

      setAccounts((accountsRes.data ?? []) as SocialAccount[]);
      setPosts((postsRes.data ?? []) as SocialPost[]);
      setBooks((booksRes.data ?? []) as BookOption[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Listen for the OAuth popup's postMessage on success/failure.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean; platform?: string; username?: string; error?: string };
      if (data?.type !== 'social-oauth') return;
      setConnecting(false);
      if (data.ok) {
        setNotice(`Connected ${data.platform ?? ''}${data.username ? ` as @${data.username}` : ''}. Syncing posts…`);
        loadAll().then(() => {
          if (data.platform === 'pinterest') {
            // Auto-trigger a first sync so the user sees their pins right away.
            syncPinterest()
              .then(() => loadAll())
              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
          }
        });
      } else if (data.error) {
        setError(`Connection failed: ${data.error}`);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [loadAll]);

  async function handleConnectPinterest() {
    setError(null);
    setNotice(null);
    setConnecting(true);
    try {
      const { authorize_url } = await startPinterestOAuth();
      const popup = window.open(authorize_url, 'pinterest-oauth', 'width=600,height=720,left=200,top=80');
      oauthWindowRef.current = popup;
      // If the popup is blocked or closed without a postMessage, reset state.
      const interval = window.setInterval(() => {
        if (popup && popup.closed) {
          window.clearInterval(interval);
          // Give postMessage a beat to land; if it never arrives, drop the spinner.
          window.setTimeout(() => setConnecting(false), 500);
        }
      }, 1000);
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSync(account: SocialAccount) {
    setError(null);
    setNotice(null);
    setSyncingAccountId(account.id);
    try {
      if (account.platform === 'pinterest') {
        const result = await syncPinterest(account.id);
        setNotice(`Synced ${result.pins_upserted} of ${result.pins_seen} pins from @${account.username ?? account.external_account_id}.`);
      } else {
        setNotice(`Sync for ${account.platform} isn't wired up yet.`);
      }
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingAccountId(null);
    }
  }

  async function handleDisconnect(account: SocialAccount) {
    const handle = account.username ? `@${account.username}` : account.external_account_id;
    if (!confirm(`Disconnect ${PLATFORM_META[account.platform].label} (${handle})? This deletes all stored posts for this account.`)) {
      return;
    }
    setError(null);
    try {
      await disconnectAccount(account.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLinkBook(post: SocialPost, bookId: string | null) {
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from('social_posts')
        .update({ book_id: bookId })
        .eq('id', post.id);
      if (upErr) throw upErr;
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, book_id: bookId } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const visiblePosts = useMemo(() => {
    return posts.filter((p) => {
      if (platformFilter !== 'all' && p.platform !== platformFilter) return false;
      if (bookFilter === 'unlinked' && p.book_id !== null) return false;
      if (bookFilter !== 'all' && bookFilter !== 'unlinked' && p.book_id !== bookFilter) return false;
      return true;
    });
  }, [posts, platformFilter, bookFilter]);

  const totals = useMemo(() => {
    return visiblePosts.reduce(
      (acc, p) => ({
        impressions: acc.impressions + (p.impressions ?? 0),
        saves: acc.saves + (p.saves ?? 0),
        outbound_clicks: acc.outbound_clicks + (p.outbound_clicks ?? 0),
        likes: acc.likes + (p.likes ?? 0),
        comments: acc.comments + (p.comments ?? 0),
        video_views: acc.video_views + (p.video_views ?? 0),
      }),
      { impressions: 0, saves: 0, outbound_clicks: 0, likes: 0, comments: 0, video_views: 0 },
    );
  }, [visiblePosts]);

  const booksById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">{error}</div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-start gap-3">
          <div className="flex-1 text-sm">{notice}</div>
          <button onClick={() => setNotice(null)} className="text-emerald-400 hover:text-emerald-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState onConnect={handleConnectPinterest} connecting={connecting} />
      ) : (
        <>
          {/* Connected accounts strip */}
          <section className="flex flex-wrap gap-3 items-center">
            {accounts.map((acct) => {
              const meta = PLATFORM_META[acct.platform];
              const syncing = syncingAccountId === acct.id;
              return (
                <div key={acct.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl pl-3 pr-2 py-2 shadow-sm">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center shrink-0`}>
                    <Share2 className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-sm leading-tight">
                    <div className="font-medium text-slate-800">{meta.label}</div>
                    <div className="text-slate-500 text-xs">
                      {acct.username ? `@${acct.username}` : acct.external_account_id}
                      <span className="mx-1.5 text-slate-300">•</span>
                      synced {relativeTime(acct.last_synced_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSync(acct)}
                    disabled={syncing}
                    className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    title="Pull latest stats"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Syncing' : 'Sync'}
                  </button>
                  <button
                    onClick={() => handleDisconnect(acct)}
                    className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg"
                    title="Disconnect this account"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
            <button
              onClick={handleConnectPinterest}
              disabled={connecting}
              className="inline-flex items-center gap-2 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3 py-2.5 rounded-xl transition-colors disabled:opacity-50"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Connect another
            </button>
          </section>

          {accounts.some((a) => a.last_sync_error) && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                {accounts.filter((a) => a.last_sync_error).map((a) => (
                  <div key={a.id}>
                    <span className="font-medium">{PLATFORM_META[a.platform].label}</span> ({a.username ?? a.external_account_id}): {a.last_sync_error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI strip */}
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Impressions" value={fmtNum(totals.impressions)} />
            <KpiCard label="Saves" value={fmtNum(totals.saves)} />
            <KpiCard label="Outbound clicks" value={fmtNum(totals.outbound_clicks)} />
            <KpiCard label="Likes" value={fmtNum(totals.likes)} />
            <KpiCard label="Comments" value={fmtNum(totals.comments)} />
            <KpiCard label="Video views" value={fmtNum(totals.video_views)} />
          </section>

          {/* Filters */}
          <section className="flex flex-wrap gap-2 items-center text-sm">
            <span className="text-slate-500 text-xs uppercase tracking-wider mr-1">Filter</span>
            <FilterPill active={platformFilter === 'all'} onClick={() => setPlatformFilter('all')}>All platforms</FilterPill>
            {(Array.from(new Set(accounts.map((a) => a.platform))) as SocialPlatform[]).map((p) => (
              <FilterPill key={p} active={platformFilter === p} onClick={() => setPlatformFilter(p)}>
                {PLATFORM_META[p].label}
              </FilterPill>
            ))}
            <span className="mx-2 h-4 w-px bg-slate-300" />
            <FilterPill active={bookFilter === 'all'} onClick={() => setBookFilter('all')}>All posts</FilterPill>
            <FilterPill active={bookFilter === 'unlinked'} onClick={() => setBookFilter('unlinked')}>Not linked to a book</FilterPill>
            {books.length > 0 && (
              <select
                value={bookFilter === 'all' || bookFilter === 'unlinked' ? '' : bookFilter}
                onChange={(e) => setBookFilter(e.target.value || 'all')}
                className="border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white"
              >
                <option value="">— filter by book —</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}{b.series ? ` (${b.series})` : ''}</option>
                ))}
              </select>
            )}
          </section>

          {/* Posts table */}
          <PostsTable
            posts={visiblePosts}
            books={books}
            booksById={booksById}
            onLinkBook={handleLinkBook}
          />
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-2xl shadow-lg shadow-violet-500/25 mb-6">
        <Share2 className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Social Media Stats</h2>
      <p className="text-slate-500 max-w-lg mx-auto mb-8">
        Connect your social accounts to pull per-post stats — impressions, saves, outbound clicks — and link each post to the book it's promoting. Free native APIs, no third-party fees.
      </p>
      <button
        onClick={onConnect}
        disabled={connecting}
        className="inline-flex items-center gap-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold px-5 py-3 rounded-xl shadow-lg shadow-rose-500/30 hover:shadow-rose-500/50 transition-shadow disabled:opacity-60"
      >
        {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Share2 className="w-5 h-5" />}
        Connect Pinterest
      </button>
      <p className="text-xs text-slate-400 mt-6 max-w-md mx-auto">
        Instagram, Facebook, Threads, and TikTok are next. Each needs a one-time Developer App registration on the platform's side — see the PR description for setup steps.
      </p>
    </div>
  );
}

function PostsTable({
  posts,
  books,
  booksById,
  onLinkBook,
}: {
  posts: SocialPost[];
  books: BookOption[];
  booksById: Record<string, BookOption>;
  onLinkBook: (post: SocialPost, bookId: string | null) => void;
}) {
  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500">
        No posts yet — hit Sync to pull them in.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left font-medium px-4 py-3">Post</th>
              <th className="text-left font-medium px-3 py-3">Posted</th>
              <th className="text-right font-medium px-3 py-3">Impressions</th>
              <th className="text-right font-medium px-3 py-3">Saves</th>
              <th className="text-right font-medium px-3 py-3">Clicks</th>
              <th className="text-left font-medium px-3 py-3">Linked book</th>
              <th className="text-right font-medium px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {posts.map((p) => {
              const meta = PLATFORM_META[p.platform];
              const linkedBook = p.book_id ? booksById[p.book_id] : null;
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      {p.thumbnail_url ? (
                        <img
                          src={p.thumbnail_url}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover bg-slate-100 shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-slate-100 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.accent}`}>{meta.label}</span>
                        </div>
                        <div className="text-slate-700 line-clamp-2 leading-snug">
                          {p.caption ?? <span className="italic text-slate-400">(no caption)</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                    {p.posted_at ? new Date(p.posted_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700">{fmtNum(p.impressions)}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700">{fmtNum(p.saves)}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700">{fmtNum(p.outbound_clicks)}</td>
                  <td className="px-3 py-3">
                    <BookPicker
                      value={p.book_id}
                      books={books}
                      linkedBook={linkedBook}
                      onChange={(bookId) => onLinkBook(p, bookId)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700 text-xs"
                        title="Open on Pinterest"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BookPicker({
  value,
  books,
  linkedBook,
  onChange,
}: {
  value: string | null;
  books: BookOption[];
  linkedBook: BookOption | null;
  onChange: (bookId: string | null) => void;
}) {
  if (books.length === 0) {
    return <span className="text-slate-400 text-xs italic">Add books in Catalog to link</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white hover:border-slate-300 max-w-[180px]"
      >
        <option value="">— not linked —</option>
        {books.map((b) => (
          <option key={b.id} value={b.id}>{b.title}</option>
        ))}
      </select>
      {linkedBook && (
        <span className="inline-flex items-center gap-1 text-xs text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">
          <BookOpen className="w-3 h-3" />
        </span>
      )}
      {!linkedBook && value === null && (
        <span title="Not linked"><LinkIcon className="w-3 h-3 text-slate-300" /></span>
      )}
    </div>
  );
}
