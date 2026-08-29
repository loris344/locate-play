// Scores one round of a game-start session server-side: the client sends a
// guess (or a "timed out" flag) and this is the only place that ever reads
// a video's true coordinates and turns them into a score — the client
// never has the answer before this call returns it.
//
// On the final round it also writes the verified total to game_scores
// itself, so a signed-in player can no longer POST an arbitrary
// `total_score` straight to that table (previously the client computed the
// whole game's score locally and inserted it with no server-side check
// beyond "is this your own user_id").
//
// Deploy: supabase functions deploy submit-round --no-verify-jwt
// (anonymous players have no Supabase session; ownership of a round is
// established by knowing its sessionId, an unguessable uuid, not by auth)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TOTAL_ROUNDS = 5;
const MAX_SCORE_PER_ROUND = 5000;
const ROUND_TIME = 120;
const TIMEOUT_DISTANCE_KM = 20000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateScore(distance: number): number {
  if (distance < 25) return MAX_SCORE_PER_ROUND;
  return Math.max(0, Math.round(MAX_SCORE_PER_ROUND * Math.exp(-distance / 500)));
}

function getTimeMultiplier(elapsedSeconds: number): number {
  if (elapsedSeconds >= ROUND_TIME) return 0;
  if (elapsedSeconds < 20) return 1.5;
  if (elapsedSeconds < 60) return 1.2;
  if (elapsedSeconds < 90) return 1.0;
  return 0.7;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const body = await req.json().catch(() => null);
  const { sessionId, videoId, guessLat, guessLng, elapsedSeconds, timedOut } = body ?? {};

  if (typeof sessionId !== "string" || typeof videoId !== "string") {
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: jsonHeaders });
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("game_sessions")
    .select("id, video_ids, scored_video_ids, rounds_completed, total_score, finished, user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: jsonHeaders });
  }

  if (session.finished) {
    return new Response(JSON.stringify({ error: "Session already finished" }), { status: 400, headers: jsonHeaders });
  }

  if (!session.video_ids.includes(videoId)) {
    return new Response(JSON.stringify({ error: "Video not part of this session" }), { status: 400, headers: jsonHeaders });
  }

  if (session.scored_video_ids.includes(videoId)) {
    return new Response(JSON.stringify({ error: "Round already scored" }), { status: 400, headers: jsonHeaders });
  }

  const { data: video, error: videoError } = await supabaseAdmin
    .from("videos")
    .select("latitude, longitude")
    .eq("id", videoId)
    .maybeSingle();

  if (videoError || !video) {
    return new Response(JSON.stringify({ error: "Video not found" }), { status: 404, headers: jsonHeaders });
  }

  let distance: number;
  let baseScore = 0;
  let timeMultiplier = 0;
  let score: number;

  if (timedOut) {
    distance =
      typeof guessLat === "number" && typeof guessLng === "number"
        ? haversineDistance(guessLat, guessLng, video.latitude, video.longitude)
        : TIMEOUT_DISTANCE_KM;
    score = 0;
  } else {
    if (typeof guessLat !== "number" || typeof guessLng !== "number") {
      return new Response(JSON.stringify({ error: "Missing guess coordinates" }), { status: 400, headers: jsonHeaders });
    }
    distance = haversineDistance(guessLat, guessLng, video.latitude, video.longitude);
    baseScore = calculateScore(distance);
    timeMultiplier = getTimeMultiplier(typeof elapsedSeconds === "number" ? elapsedSeconds : ROUND_TIME);
    score = Math.round(baseScore * timeMultiplier);
  }

  const roundsCompleted = session.rounds_completed + 1;
  const totalScore = session.total_score + score;
  const finished = roundsCompleted >= TOTAL_ROUNDS;

  // Optimistic-concurrency guard: only applies if rounds_completed still
  // matches what we just read, so two parallel requests for the same
  // session can't both "win" and double-apply a round.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("game_sessions")
    .update({
      rounds_completed: roundsCompleted,
      total_score: totalScore,
      finished,
      scored_video_ids: [...session.scored_video_ids, videoId],
    })
    .eq("id", sessionId)
    .eq("rounds_completed", session.rounds_completed)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    return new Response(JSON.stringify({ error: "Could not submit round, please retry" }), { status: 409, headers: jsonHeaders });
  }

  if (finished && session.user_id) {
    await supabaseAdmin.from("game_scores").insert({ user_id: session.user_id, total_score: totalScore });
  }

  return new Response(
    JSON.stringify({
      distance,
      score,
      baseScore,
      timeMultiplier,
      correctLat: video.latitude,
      correctLng: video.longitude,
      roundsCompleted,
      totalScore,
      finished,
    }),
    { headers: jsonHeaders },
  );
});
