import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

interface AuthApi {
  session: Session | null;
  user: User | null;
  loading: boolean;
  sendMagicLink(email: string): Promise<{ error: string | null }>;
  // Completes sign-in from the 6-digit code in the same email, without ever
  // leaving the app — needed because tapping the link opens Safari, which
  // is a separate, isolated storage container from an installed Home
  // Screen app on iOS, so the session never reaches the installed app.
  verifyCode(email: string, code: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Existing session on load (from localStorage / the magic-link URL).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    // Keep in sync for sign-in, sign-out, token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const api: AuthApi = {
    session,
    user: session?.user ?? null,
    loading,
    async sendMagicLink(email: string) {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      return { error: error?.message ?? null };
    },
    async verifyCode(email: string, code: string) {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      });
      return { error: error?.message ?? null };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
