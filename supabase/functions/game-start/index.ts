// Issues a new 5-round game session: picks random videos (excluding ones
// the client says it has already seen) and returns them WITHOUT their
// answer coordinates.
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
// (no-verify-jwt because anonymous players — who get 1 free game before
// signing up — have no Supabase session at all)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TOTAL_ROUNDS = 5;
const MAX_DAILY_GAMES = 2;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const { seenVideoIds } = await req.json().catch(() => ({ seenVideoIds: [] }));
  const seen: string[] = Array.isArray(seenVideoIds) ? seenVideoIds : [];

  const user = await getUser(req.headers.get("Authorization"));

  if (user) {
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
        return new Response(JSON.stringify({ error: "Daily free game limit reached" }), { status: 403, headers: jsonHeaders });
      }
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

  const shuffled = [...available].sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS);

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("game_sessions")
    .insert({ user_id: user?.id ?? null, video_ids: shuffled.map((v) => v.id) })
    .select("id")
    .single();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: "Could not start game" }), { status: 500, headers: jsonHeaders });
  }

  const videos = shuffled.map(({ latitude: _lat, longitude: _lng, ...rest }) => rest);

  return new Response(JSON.stringify({ sessionId: session.id, videos }), { headers: jsonHeaders });
});
