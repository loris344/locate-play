// Sends a Telegram notification whenever a new player account is created
// (first time a row lands in public.profiles - not on every login/update).
// Called directly from the client at the two places a profile first gets
// created (src/components/Providers.tsx's self-heal path, and
// src/components/UsernamePrompt.tsx), right after the upsert succeeds.
//
// Country is derived server-side from the caller's own IP (via a free
// geo-IP lookup), not trusted from the client, since this call happens
// directly from the new user's browser right after signup - the request's
// IP is genuinely theirs.
//
// Deploy: supabase functions deploy notify-signup
// (JWT verification stays ON - the caller just authenticated, so a valid
// Supabase session is expected; this isn't reachable by anonymous players)

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Two providers, tried in order: serverless egress IPs are shared across
// every customer of the platform, so a free tier's per-IP daily quota (e.g.
// ipapi.co's 1000/day) gets exhausted by everyone else's traffic on the
// same egress, not just this function's own calls - a single provider
// silently degrades to "Unknown" for good once that happens.
async function lookupCountry(ip: string | null): Promise<string> {
  if (!ip) return "Unknown";

  try {
    const res = await fetch(`https://ipwho.is/${ip}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.success !== false && data?.country) return data.country;
    }
  } catch {
    // fall through to the next provider
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country`);
    if (res.ok) {
      const data = await res.json();
      if (data?.status === "success" && data?.country) return data.country;
    }
  } catch {
    // both providers failed
  }

  return "Unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const body = await req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : "Unknown";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  const country = await lookupCountry(ip);

  const text = `🆕 New GeoGushing account\nUsername: ${username}\nCountry: ${country}`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  }).catch(() => null);

  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
});
