import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import { trackCompleteRegistrationOnce } from '@/lib/tiktok';

// Email/password signups fire CompleteRegistration from Auth.tsx itself
// (it knows a submit just happened). OAuth providers redirect the whole page
// away and back, wiping any in-memory state Auth.tsx could have used the
// same way - so for OAuth, a just-created account is detected here instead,
// from the account's own timestamps. 30s comfortably covers the redirect
// round-trip while staying far short of "this is an existing user logging in
// again," whose created_at and last_sign_in_at are typically hours/days apart.
function isFreshAccount(user: User): boolean {
  if (!user.last_sign_in_at) return false;
  const createdAt = new Date(user.created_at).getTime();
  const lastSignInAt = new Date(user.last_sign_in_at).getTime();
  return Math.abs(lastSignInAt - createdAt) < 30_000;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const applySession = (session: Session | null) => {
      setSession(session);
      // An anonymous session (see app/play/page.tsx) exists purely to give
      // game-start a stable user_id to key the free-game quota on instead
      // of IP - it's not a real account, so `user` (what the rest of the
      // app treats as "signed in": the sign-in button, account popover,
      // username prompt, etc.) stays null for it. `session` above still
      // carries it, since that's what the ambient Supabase client uses to
      // authenticate the game-start call itself.
      setUser(session?.user && !session.user.is_anonymous ? session.user : null);
      setLoading(false);

      if (session?.user && !session.user.is_anonymous && isFreshAccount(session.user)) {
        trackCompleteRegistrationOnce(session.user.id);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    const refreshSession = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        applySession(session);
      });
    };

    refreshSession();

    // A tab left open on the signup/login form (e.g. while the user confirms
    // their email in a different tab or app) never reloads on its own, so it
    // never re-checks localStorage for the session that was just created
    // elsewhere. Re-check whenever the tab regains focus so it picks it up.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSession();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshSession);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshSession);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);