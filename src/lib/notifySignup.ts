import { supabase } from "@/lib/supabase";

// AuthContext sets the user from both onAuthStateChange's first event and
// its own immediate getSession() call (see AuthContext.tsx) - two fresh,
// non-referentially-equal user objects land in quick succession right after
// signup, so RequireUsername's effect (which calls this) can run twice for
// the same account before either upsert is visible to the other's read.
// Same dedupe shape as trackCompleteRegistrationOnce in lib/tiktok.ts:
// localStorage key per user id makes whichever call fires first win.
export function notifyNewSignup(userId: string, username: string) {
  const key = `geogushing_signup_notified_${userId}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");

  supabase.functions.invoke("notify-signup", { body: { username } }).catch(() => {});
}
