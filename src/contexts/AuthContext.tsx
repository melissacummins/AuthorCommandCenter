import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  refreshAccess: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
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
  const [accessLoading, setAccessLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        loadAccess(session.user);
      } else {
        setAccessLoading(false);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        loadAccess(session.user);
      } else {
        setProfile(null);
        setMember(null);
        setModules([]);
        setAccessLoading(false);
      }
      setLoading(false);
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
    const [memberRes, modulesRes] = await Promise.all([
      supabase.from('app_members').select('*').eq('email', email).maybeSingle(),
      supabase.from('app_modules').select('*'),
    ]);
    setMember((memberRes.data as AppMember | null) ?? null);
    setModules((modulesRes.data as AppModule[] | null) ?? []);
    setAccessLoading(false);
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

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
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
