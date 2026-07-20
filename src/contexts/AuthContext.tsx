import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '../lib/types';
import {
  GATED_MODULES,
  visibleModuleKeys,
  type AppMember,
  type AppModule,
} from '../lib/access';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  // Access control
  member: AppMember | null;
  accessLoading: boolean;
  isAdmin: boolean;
  hasAccess: boolean;
  visibleModules: Set<string>;
  // Personal sidebar prefs: module keys the user has hidden from their
  // own nav. Separate from access (visibleModules) — this is decluttering,
  // not permission. `sidebarModules` = visibleModules minus these.
  hiddenModules: Set<string>;
  sidebarModules: Set<string>;
  setModuleHidden: (key: string, hidden: boolean) => Promise<void>;
  refreshAccess: () => Promise<void>;
  signInWithGoogle: (redirectTo?: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState<AppMember | null>(null);
  const [modules, setModules] = useState<AppModule[]>([]);
  const [hiddenModuleKeys, setHiddenModuleKeys] = useState<string[]>([]);
  const [accessLoading, setAccessLoading] = useState(true);
  // Tracks the currently-loaded user id so token refreshes (which fire on
  // every tab refocus) don't re-create the user object or re-run access
  // loading — that churn unmounts in-progress editors and loses unsaved work.
  const loadedUserId = useRef<string | null>(null);

  useEffect(() => {
    function applySession(session: Session | null, force: boolean) {
      const nextUserId = session?.user?.id ?? null;
      setSession(session);
      // Same user as already loaded (e.g. TOKEN_REFRESHED on refocus): just
      // keep the refreshed session; don't touch user/profile/access state.
      if (!force && nextUserId === loadedUserId.current) {
        setLoading(false);
        return;
      }
      loadedUserId.current = nextUserId;
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        loadAccess(session.user);
      } else {
        setProfile(null);
        setMember(null);
        setModules([]);
        setHiddenModuleKeys([]);
        setAccessLoading(false);
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session, true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session, false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data);
  }

  async function loadAccess(u: User) {
    setAccessLoading(true);
    const email = (u.email ?? '').toLowerCase();
    const [memberRes, modulesRes, prefsRes] = await Promise.all([
      supabase.from('app_members').select('*').eq('email', email).maybeSingle(),
      supabase.from('app_modules').select('*'),
      supabase.from('user_ui_preferences').select('hidden_modules').eq('user_id', u.id).maybeSingle(),
    ]);
    setMember((memberRes.data as AppMember | null) ?? null);
    setModules((modulesRes.data as AppModule[] | null) ?? []);
    const hidden = (prefsRes.data as { hidden_modules?: unknown } | null)?.hidden_modules;
    setHiddenModuleKeys(Array.isArray(hidden) ? hidden.filter((k): k is string => typeof k === 'string') : []);
    setAccessLoading(false);
  }

  // Persist a single module's hidden flag. Upsert only the
  // hidden_modules column so we don't clobber hidden_profit_tabs on the
  // same row (Supabase upsert only writes the columns in the payload).
  async function setModuleHidden(key: string, hidden: boolean) {
    if (!user) return;
    const next = hidden
      ? Array.from(new Set([...hiddenModuleKeys, key]))
      : hiddenModuleKeys.filter(k => k !== key);
    setHiddenModuleKeys(next); // optimistic
    const { error } = await supabase
      .from('user_ui_preferences')
      .upsert({ user_id: user.id, hidden_modules: next, updated_at: new Date().toISOString() });
    if (error) {
      // Roll back on failure so the UI reflects reality.
      setHiddenModuleKeys(hiddenModuleKeys);
      throw error;
    }
  }

  async function refreshAccess() {
    if (user) await loadAccess(user);
  }

  const isAdmin = profile?.role === 'admin' || member?.plan === 'admin';
  const hasAccess = isAdmin || member?.status === 'active';
  const visibleModules = useMemo(() => {
    if (isAdmin) return new Set(GATED_MODULES.map(m => m.key));
    return visibleModuleKeys(member, modules);
  }, [isAdmin, member, modules]);

  const hiddenModules = useMemo(() => new Set(hiddenModuleKeys), [hiddenModuleKeys]);

  // What actually renders in the sidebar: modules you're allowed to see,
  // minus the ones you've personally hidden.
  const sidebarModules = useMemo(() => {
    const next = new Set(visibleModules);
    for (const k of hiddenModules) next.delete(k);
    return next;
  }, [visibleModules, hiddenModules]);

  async function signInWithGoogle(redirectTo?: string) {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo ?? window.location.origin,
      },
    });
  }

  async function signInWithEmail(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signUpWithEmail(email: string, password: string, fullName: string): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setMember(null);
    setModules([]);
    setHiddenModuleKeys([]);
  }

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      member,
      accessLoading,
      isAdmin,
      hasAccess,
      visibleModules,
      hiddenModules,
      sidebarModules,
      setModuleHidden,
      refreshAccess,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
