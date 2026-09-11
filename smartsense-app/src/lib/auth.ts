import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

// The app now requires a real account: nothing past Register/Sign-in is
// reachable without a genuine Supabase Auth session (see App.tsx). This
// module is the single source of truth for that session.

export type AuthStatus = "unconfigured" | "loading" | "signed-out" | "signed-in";

// A session whose user is anonymous doesn't count as "signed in" here — the
// app used to sign drivers in anonymously (before Register/Login existed),
// and a browser that was used during that period can still be holding one of
// those old anonymous sessions in local storage. Supabase itself will happily
// keep restoring and refreshing it forever, which — without this check —
// would let someone skip Login entirely and land straight on the dashboard
// under a "phantom" identity. Real accounts (email/password) always have
// is_anonymous === false.
function isRealSession(session: Session | null): boolean {
  return !!session && session.user.is_anonymous !== true;
}

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "unconfigured");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const client = supabase;
    let active = true;

    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session && !isRealSession(data.session)) {
        // Leftover anonymous session from before real accounts existed —
        // clear it out so it stops being restored on every future visit.
        client.auth.signOut();
        setSession(null);
        setStatus("signed-out");
        return;
      }
      setSession(data.session);
      setStatus(data.session ? "signed-in" : "signed-out");
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !isRealSession(newSession)) {
        setSession(null);
        setStatus("signed-out");
        return;
      }
      setSession(newSession);
      setStatus(newSession ? "signed-in" : "signed-out");
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { status, session };
}

export interface AuthResult {
  ok: boolean;
  /** Set when sign-up succeeded but Supabase requires email confirmation
   * before a session is issued — the caller should show a "check your
   * inbox" message rather than treating this as a failure. */
  needsEmailConfirmation?: boolean;
  error?: string;
}

export async function registerWithPassword(fullName: string, email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: "Database isn't configured." };
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: fullName } },
  });
  if (error) return { ok: false, error: error.message };
  if (!data.session) return { ok: true, needsEmailConfirmation: true };
  return { ok: true };
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, error: "Database isn't configured." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
