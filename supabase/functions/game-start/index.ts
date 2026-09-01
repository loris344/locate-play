// Issues a new 5-round game session: picks videos (excluding ones the
// client says it has already seen) and returns them WITHOUT their answer
// coordinates. Playing requires a real, signed-in account - there is no
// anonymous preview - app/play/page.tsx redirects a logged-out visitor to
// /auth before this ever gets called, and the check below is the same
// rule enforced server-side in case that gate is ever bypassed.
//
// Previously the client fetched the entire `videos` table directly
// (RLS: "viewable by everyone"), coordinates included, before any paywall
// check ran — so the whole answer key was one curl call away regardless of
// login state, subscription, or the free-game counter. Coordinates are now
// only ever revealed per-round, after a guess, by submit-round.
//
// This is also the single point of truth for the signed-in daily quota: a
// session row is written here, at start, not when the player finishes — so
// quitting before the last round no longer lets a free account dodge the
// 2/day cap (the previous cap only counted completed games in game_scores).
//
// Deploy: supabase functions deploy game-start --no-verify-jwt
// (no-verify-jwt so the 401 that Supabase's own platform check would throw
// for a missing/expired session doesn't pre-empt the friendlier
// signin_required response below)
// Secrets: supabase secrets set IP_HASH_SALT=<random hex>
//          (salts the hashed IP kept in client_ip_hash - recorded for
//          visibility, not currently used to gate anything)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TOTAL_ROUNDS = 5;
const MAX_DAILY_GAMES = 2;

const ipHashSalt = Deno.env.get("IP_HASH_SALT") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function utcDayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function getUser(authHeader: string | null) {
  if (!authHeader) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`${ipHashSalt}:${ip}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const { seenVideoIds } = await req.json().catch(() => ({ seenVideoIds: [] }));
  const seen: string[] = Array.isArray(seenVideoIds) ? seenVideoIds : [];

  const user = await getUser(req.headers.get("Authorization"));
  const clientIp = getClientIp(req);
  const clientIpHash = clientIp ? await hashIp(clientIp) : null;

  if (!user || user.is_anonymous) {
    return new Response(
      JSON.stringify({ error: "Sign in to play", reason: "signin_required" }),
      { status: 403, headers: jsonHeaders },
    );
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("status, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const subscribed = !!(
    sub && sub.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date())
  );

  if (!subscribed) {
    const { startIso, endIso } = utcDayRange();
    const { count } = await supabaseAdmin
      .from("game_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", startIso)
      .lt("created_at", endIso);

    if ((count ?? 0) >= MAX_DAILY_GAMES) {
      return new Response(
        JSON.stringify({ error: "Daily free game limit reached", reason: "paywall" }),
        { status: 403, headers: jsonHeaders },
      );
    }
  }

  const { data: allVideos, error } = await supabaseAdmin.from("videos").select("*");
  if (error || !allVideos || allVideos.length === 0) {
    return new Response(JSON.stringify({ error: "No videos available" }), { status: 500, headers: jsonHeaders });
  }

  let available = allVideos.filter((v) => !seen.includes(v.id));
  if (available.length < TOTAL_ROUNDS) available = allVideos;
  if (available.length < TOTAL_ROUNDS) {
    return new Response(JSON.stringify({ error: "Not enough videos available" }), { status: 500, headers: jsonHeaders });
  }
  const selected = [...available].sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS);

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("game_sessions")
    .insert({ user_id: user.id, video_ids: selected.map((v) => v.id), client_ip_hash: clientIpHash })
    .select("id")
    .single();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: "Could not start game" }), { status: 500, headers: jsonHeaders });
  }

  const videos = selected.map(({ latitude: _lat, longitude: _lng, ...rest }) => rest);

  return new Response(JSON.stringify({ sessionId: session.id, videos }), { headers: jsonHeaders });
});
