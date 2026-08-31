declare global {
  interface Window {
    ttq?: { track: (event: string, params?: Record<string, unknown>) => void };
  }
}

export function trackTikTokEvent(event: string, params?: Record<string, unknown>) {
  window.ttq?.track(event, params);
}

// Shared dedupe guard: both the email/password flow (Auth.tsx, fires as soon
// as a just-submitted signup gets confirmed) and the OAuth flow (AuthContext,
// fires from a "was this session's user just created" timestamp check since
// the OAuth redirect wipes any in-memory state a ref could have held) call
// this for the same account - the localStorage key makes whichever fires
// first win instead of double-counting a registration.
export function trackCompleteRegistrationOnce(userId: string) {
  if (typeof window === "undefined") return;

  const key = `tiktok_cr_tracked_${userId}`;
  if (localStorage.getItem(key)) return;

  localStorage.setItem(key, "1");
  trackTikTokEvent("CompleteRegistration");
}
