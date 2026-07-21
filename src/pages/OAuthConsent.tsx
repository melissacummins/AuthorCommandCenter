import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import Login from './Login';

// OAuth 2.1 consent screen (MCP directive §1.1). Supabase Auth redirects
// clients here with ?authorization_id=…; we show who's asking, the user
// approves or denies, and Supabase handles the token exchange. This is how
// a customer connects their Command Center account to their Claude.
//
// The authorization_id is stashed in localStorage so a Google-login
// round-trip (full page redirect) can restore it.

const STASH_KEY = 'oauth-consent-authorization-id';

type AuthDetails = {
  client: { name?: string; client_id?: string };
  redirect_uri?: string;
  scope?: string;
};

export default function OAuthConsent() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'approve' | 'deny' | null>(null);
  const [denied, setDenied] = useState(false);

  // Prefer the URL param; fall back to the stash (post-Google-login).
  const authorizationId = searchParams.get('authorization_id') ?? localStorage.getItem(STASH_KEY);

  useEffect(() => {
    const fromUrl = searchParams.get('authorization_id');
    if (fromUrl) localStorage.setItem(STASH_KEY, fromUrl);
  }, [searchParams]);

  useEffect(() => {
    if (!user || !authorizationId) return;
    let cancelled = false;
    supabase.auth.oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setError(error?.message ?? 'Invalid or expired authorization request.');
          return;
        }
        // Already-consented clients skip straight through.
        if (!('authorization_id' in (data as Record<string, unknown>)) && (data as { redirect_url?: string }).redirect_url) {
          localStorage.removeItem(STASH_KEY);
          window.location.href = (data as { redirect_url: string }).redirect_url;
          return;
        }
        setDetails(data as unknown as AuthDetails);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.'); });
    return () => { cancelled = true; };
  }, [user, authorizationId]);

  async function decide(action: 'approve' | 'deny') {
    if (!authorizationId || deciding) return;
    setDeciding(action);
    setError(null);
    try {
      const { data, error } = action === 'approve'
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (error) throw error;
      localStorage.removeItem(STASH_KEY);
      const redirect = (data as { redirect_url?: string } | null)?.redirect_url;
      if (redirect) {
        window.location.href = redirect;
      } else if (action === 'deny') {
        setDenied(true);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setDeciding(null);
    }
  }

  // Not signed in: show the normal login inline. The session updates in
  // place for email login; Google round-trips back here via redirectTo.
  if (!authLoading && !user) {
    return <Login googleRedirectTo={window.location.href} />;
  }

  return (
    <div className="min-h-screen bg-surface-sunken flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface border border-edge rounded-card shadow-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center justify-center w-10 h-10 bg-brand-500 rounded-control shrink-0">
            <BookOpen className="w-5 h-5 text-brand-fg" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-content leading-tight">Author Command Center</h1>
            <p className="text-xs text-content-secondary">Connection request</p>
          </div>
        </div>

        {authLoading || (!details && !error && !denied) ? (
          <p className="flex items-center gap-2 text-sm text-content-secondary py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading the request…
          </p>
        ) : denied ? (
          <p className="text-sm text-content-secondary py-4">
            Access denied. You can close this window.
          </p>
        ) : error ? (
          <p className="text-sm text-rose-600 py-4">{error}</p>
        ) : details && (
          <>
            <p className="text-sm text-content mb-4">
              <span className="font-semibold">{details.client?.name || 'An application'}</span>
              {' '}wants to connect to your Command Center account.
            </p>

            <div className="bg-surface-hover border border-edge rounded-control p-4 mb-6">
              <p className="flex items-start gap-2 text-xs text-content-secondary">
                <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                <span>
                  It will be able to <span className="font-medium text-content">read your books,
                  inventory, tasks, and finances</span>, and <span className="font-medium text-content">add
                  tasks or log progress on your behalf</span>. It only ever sees your own data,
                  and you can revoke access at any time.
                </span>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => decide('approve')}
                disabled={!!deciding}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
              >
                {deciding === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Approve
              </button>
              <button
                onClick={() => decide('deny')}
                disabled={!!deciding}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-edge text-content-secondary text-sm font-medium rounded-control hover:bg-surface-hover disabled:opacity-50"
              >
                {deciding === 'deny' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
