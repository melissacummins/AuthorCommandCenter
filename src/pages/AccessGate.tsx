import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BookOpen, Clock, Lock, LogOut, ArrowRight, Loader2 } from 'lucide-react';

// Shown when someone is signed in but is not yet an active member. Lets them
// request access (which lands in the admin queue) or shows their pending state.
export default function AccessGate() {
  const { user, member, signOut, refreshAccess } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = member?.status === 'pending';
  const blocked = member?.status === 'blocked';

  async function requestAccess() {
    if (!user?.email) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from('app_members').insert({
      email: user.email.toLowerCase(),
      user_id: user.id,
      status: 'pending',
      plan: 'member',
    });
    if (error && !/duplicate|unique/i.test(error.message)) {
      setError(error.message);
    }
    await refreshAccess();
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl mb-4 shadow-lg shadow-amber-500/25">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Author Command Center</h1>
          <p className="text-slate-400 mt-2">Your publishing business, unified</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          {blocked ? (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 bg-rose-100 rounded-xl mb-4">
                <Lock className="w-6 h-6 text-rose-600" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Access unavailable</h2>
              <p className="text-sm text-slate-500">
                Your access to the Command Center is currently turned off. If you think this is a
                mistake, reach out and it can be restored.
              </p>
            </>
          ) : pending ? (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-xl mb-4">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Request received</h2>
              <p className="text-sm text-slate-500">
                You're on the list. You'll be able to sign in and start using the Command Center as
                soon as your access is approved.
              </p>
            </>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 bg-slate-100 rounded-xl mb-4">
                <Lock className="w-6 h-6 text-slate-500" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Members only</h2>
              <p className="text-sm text-slate-500 mb-6">
                The Command Center is invite-only right now. If you joined through the community,
                request access below and you'll be approved shortly.
              </p>
              {error && (
                <p className="text-red-600 text-sm bg-red-50 px-4 py-2 rounded-lg mb-4">{error}</p>
              )}
              <button
                onClick={requestAccess}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold rounded-xl hover:from-amber-600 hover:to-amber-700 transition-all disabled:opacity-50 shadow-lg shadow-amber-500/25"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {submitting ? 'Sending…' : 'Request access'}
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>
            </>
          )}

          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 mb-3">Signed in as {user?.email}</p>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
