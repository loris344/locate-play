declare global {
  interface Window {
    ttq?: { track: (event: string, params?: Record<string, unknown>) => void };
  }
}

const TTQ_READY_RETRY_MS = 200;
const TTQ_READY_TIMEOUT_MS = 5000;

// The pixel script (app/layout.tsx) loads as a separate <Script>, so on a
// slow connection or a very fast auth resolution, code here can run before
// window.ttq exists. A plain window.ttq?.track(...) would then just silently
// drop the event - this waits briefly instead of losing it.
export function trackTikTokEvent(event: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;

  if (window.ttq) {
    window.ttq.track(event, params);
    return;
  }

  let waited = 0;
  const interval = setInterval(() => {
    waited += TTQ_READY_RETRY_MS;

    if (window.ttq) {
      clearInterval(interval);
      window.ttq.track(event, params);
    } else if (waited >= TTQ_READY_TIMEOUT_MS) {
      clearInterval(interval);
      console.error(`[tiktok] ttq never became available, dropped event: ${event}`);
    }
  }, TTQ_READY_RETRY_MS);
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
