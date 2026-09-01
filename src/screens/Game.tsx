"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, Video } from "@/lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { useGameAccess } from "@/hooks/useGameAccess";
import GameMap from "@/components/GameMap";
import GameMapErrorBoundary from "@/components/GameMapErrorBoundary";
import VideoPlayer from "@/components/VideoPlayer";
import ScoreDisplay from "@/components/ScoreDisplay";
import StripePaywall from "@/components/StripePaywall";
import StripePricingTable from "@/components/StripePricingTable";
import RoundTimer, { getTimeLabel } from "@/components/RoundTimer";
import RoundIntro from "@/components/RoundIntro";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, MapPin, Trophy, Loader2, Crown, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

const TOTAL_ROUNDS = 5;
const SEEN_KEY = "geogushing_seen_videos";

type PlayableVideo = Omit<Video, "latitude" | "longitude">;

export default function Game() {
  const router = useRouter();
  const navigate = router.push;
  const { user } = useAuth();
  const gameAccess = useGameAccess();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [videos, setVideos] = useState<PlayableVideo[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [guessMarker, setGuessMarker] = useState<[number, number] | null>(null);
  const [answerMarker, setAnswerMarker] = useState<[number, number] | null>(null);
  const [roundResult, setRoundResult] = useState<{ distance: number; score: number; timeMultiplier: number; baseScore: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const elapsedRef = useRef(0);
  const [timerActive, setTimerActive] = useState(false);
  const [showIntro, setShowIntro] = useState(true);

  // Show intro for 2.5 seconds before each round
  useEffect(() => {
    if (videos.length > 0 && !gameOver) {
      setShowIntro(true);
      const timer = setTimeout(() => {
        setShowIntro(false);
        setTimerActive(true);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [videos, currentRound, gameOver]);
  useEffect(() => {
    async function startGame() {
      setLoading(true);

      let seen: string[] = [];
      try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { seen = []; }

      const { data, error } = await supabase.functions.invoke("game-start", { body: { seenVideoIds: seen } });

      if (error || !data?.videos || !data?.sessionId) {
        // The client SDK doesn't parse the body on a non-2xx response - the
        // "reason" game-start sends (why: no more free games today) only
        // ever reaches us this way, not through `data`.
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null);
          if (body?.reason === "signin_required") {
            navigate("/auth?redirect=%2Fplay");
            return;
          }
          if (body?.reason === "paywall") {
            navigate("/subscription");
            return;
          }
          setError(body?.error || "Could not start the game. Please try again.");
          setLoading(false);
          return;
        }
        setError("Could not start the game. Please try again.");
        setLoading(false);
        return;
      }

      const shuffled: PlayableVideo[] = data.videos;

      // If the server had to fall back to the full pool (not enough unseen
      // videos left), reset the local "seen" list so it doesn't grow forever.
      const newSeen = shuffled.every((v) => !seen.includes(v.id))
        ? [...seen, ...shuffled.map((v) => v.id)]
        : shuffled.map((v) => v.id);
      localStorage.setItem(SEEN_KEY, JSON.stringify(newSeen));

      setSessionId(data.sessionId);
      setVideos(shuffled);
      setLoading(false);
      // Counted at game-start, not completion, matching how the signed-in
      // daily quota is counted server-side - so quitting mid-game (or
      // clearing storage/going incognito) can't be used to dodge the free-
      // game cap. Server-side (game-start's per-IP check) is the real
      // enforcement; this just keeps the client's own optimistic counter
      // in sync with it instead of only updating on a full completion.
      gameAccess.recordGamePlayed();
    }

    startGame();
  }, []);

  const currentVideo = videos[currentRound];

  const handleGuess = useCallback(
    (lat: number, lng: number) => {
      if (roundResult) return;
      setGuessMarker([lat, lng]);
    },
    [roundResult],
  );

  const handleSubmitGuess = async () => {
    if (!guessMarker || !currentVideo || !sessionId || submitting) return;

    setTimerActive(false);
    setSubmitting(true);

    const { data, error } = await supabase.functions.invoke("submit-round", {
      body: {
        sessionId,
        videoId: currentVideo.id,
        guessLat: guessMarker[0],
        guessLng: guessMarker[1],
        elapsedSeconds: elapsedRef.current,
      },
    });

    setSubmitting(false);

    if (error || typeof data?.score !== "number") {
      setError(data?.error || "Could not submit your guess. Please try again.");
      return;
    }

    setAnswerMarker([data.correctLat, data.correctLng]);
    setRoundResult({ distance: data.distance, score: data.score, timeMultiplier: data.timeMultiplier, baseScore: data.baseScore });
    setTotalScore((prev) => prev + data.score);
  };

  const handleTimeUp = useCallback(async () => {
    if (!currentVideo || roundResult || !sessionId || submitting) return;
    setTimerActive(false);
    setSubmitting(true);

    const { data, error } = await supabase.functions.invoke("submit-round", {
      body: {
        sessionId,
        videoId: currentVideo.id,
        guessLat: guessMarker?.[0],
        guessLng: guessMarker?.[1],
        timedOut: true,
      },
    });

    setSubmitting(false);

    if (error || typeof data?.score !== "number") {
      setError(data?.error || "Could not submit your guess. Please try again.");
      return;
    }

    setAnswerMarker([data.correctLat, data.correctLng]);
    setRoundResult({ distance: data.distance, score: data.score, timeMultiplier: data.timeMultiplier, baseScore: data.baseScore });
  }, [currentVideo, guessMarker, roundResult, sessionId, submitting]);

  const handleNextRound = () => {
    if (currentRound + 1 >= TOTAL_ROUNDS) {
      setGameOver(true);
      return;
    }
    setCurrentRound((prev) => prev + 1);
    setGuessMarker(null);
    setAnswerMarker(null);
    setRoundResult(null);
    elapsedRef.current = 0;
  };

  // Access control check — block any new game start when limit is reached
  if (!gameAccess.loading && !gameAccess.canPlay && !gameOver && currentRound === 0 && !roundResult) {
    return <StripePaywall reason={gameAccess.reason as 'signin_required' | 'paywall'} />;
  }

  if (loading || gameAccess.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
          <Loader2 className="w-12 h-12 text-primary" />
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-4">
          <p className="text-destructive text-lg font-bold">⚠️ {error}</p>
          <Button onClick={() => navigate("/")} variant="outline">
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  if (gameOver) {
    const avgScore = Math.round(totalScore / TOTAL_ROUNDS);
    const canPlayNext = gameAccess.canPlay;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 150 }}
          className="bg-card border-2 border-primary rounded-lg p-8 text-center max-w-lg w-full space-y-6 max-h-[90vh] overflow-y-auto"
        >
          <Trophy className="w-16 h-16 text-secondary mx-auto" />
          <h2 className="text-4xl font-black text-gradient-hot">GAME OVER</h2>
          <div className="text-5xl font-black text-foreground">{totalScore.toLocaleString()}</div>
          <p className="text-muted-foreground">Total score across {TOTAL_ROUNDS} rounds</p>
          <p className="text-secondary font-bold">
            {avgScore >= 4000
              ? "🔥 You're a legend!"
              : avgScore >= 2000
                ? "😏 Not bad at all!"
                : "💀 Better luck next time!"}
          </p>

          {canPlayNext ? (
            <div className="flex gap-3 justify-center">
              <Button onClick={() => window.location.reload()} className="bg-gradient-hot font-bold">
                Next Party
              </Button>
              <Button onClick={() => navigate("/")} variant="outline">
                Home
              </Button>
            </div>
          ) : !user ? (
            <div className="space-y-4">
              <p className="text-muted-foreground">You've used your free game! Sign up to keep playing (2 free games per day).</p>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => navigate("/auth?redirect=/play")} className="bg-gradient-hot font-bold">
                  Sign Up
                </Button>
                <Button onClick={() => navigate("/")} variant="outline">
                  Home
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="font-bold text-primary">No games left today. Choose a plan to keep playing!</p>
              <StripePricingTable />
              <Button onClick={() => navigate("/")} variant="outline">
                Home
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence>
        {showIntro && currentVideo && (
          <RoundIntro
            actorName={currentVideo.actor_name}
            actorPhotoUrl={currentVideo.actor_photo_url}
            round={currentRound + 1}
            totalRounds={TOTAL_ROUNDS}
          />
        )}
      </AnimatePresence>

      <div className="border-b border-border px-2 lg:px-4 py-2 flex items-center justify-between overflow-hidden">
        <button onClick={() => navigate("/")} className="text-lg lg:text-xl font-black text-gradient-hot tracking-tight shrink-0">
          GEOGUSHING
        </button>
        <div className="flex items-center gap-1.5 lg:gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate(user ? '/subscription' : '/auth?redirect=/subscription')} className="text-muted-foreground hover:text-foreground px-1.5 lg:px-3 hidden lg:flex">
            <Crown className="h-4 w-4 mr-1" /> My Plan
          </Button>
          <RoundTimer
            roundId={currentRound}
            stopped={!!roundResult}
            onTimeUp={handleTimeUp}
            onElapsedChange={(e) => { elapsedRef.current = e; }}
          />
          <span className="text-muted-foreground font-bold text-xs lg:text-sm">
            <span className="text-foreground">{currentRound + 1}</span>/{TOTAL_ROUNDS}
          </span>
          <span className="text-secondary font-black text-sm lg:text-lg">{totalScore.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-rows-1 lg:grid-cols-2 gap-1 lg:gap-4 p-1 lg:p-4 h-[calc(100dvh-57px)] overflow-auto lg:overflow-hidden">
        <div className="min-h-0 flex flex-col">
          {currentVideo && <VideoPlayer url={currentVideo.video_url} />}


          <AnimatePresence>
            {roundResult && (
              <ScoreDisplay
                distance={roundResult.distance}
                score={roundResult.score}
                city={currentVideo.city}
                country={currentVideo.country}
                timeMultiplier={roundResult.timeMultiplier}
                baseScore={roundResult.baseScore}
                sourceUrl={currentVideo.source_url}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="h-[32vh] min-h-[180px] max-h-[260px] lg:min-h-0 lg:h-auto lg:max-h-none lg:flex-none">
          <GameMapErrorBoundary>
            <GameMap
              onGuess={handleGuess}
              guessMarker={guessMarker}
              answerMarker={answerMarker}
              disabled={!!roundResult}
            />
          </GameMapErrorBoundary>
        </div>

        <div className="sticky bottom-0 z-10 flex gap-2 pb-[max(env(safe-area-inset-bottom),4px)] bg-background pt-1 lg:col-span-1 lg:col-start-2">
          {!roundResult ? (
            <>
              {currentVideo?.source_url && (
                <a
                  href={currentVideo.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary/10 px-3 h-12 text-xs font-bold text-primary hover:bg-primary/20 transition-colors shrink-0"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">Original</span>
                </a>
              )}
              <Button
                onClick={handleSubmitGuess}
                disabled={!guessMarker || submitting}
                className="flex-1 bg-gradient-hot font-black text-lg h-12 shadow-glow animate-pulse-glow disabled:opacity-50 disabled:animate-none"
              >
                {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <MapPin className="mr-2 h-5 w-5" />}
                GUESS!
              </Button>
            </>
          ) : (
            <Button
              onClick={handleNextRound}
              className="flex-1 bg-secondary text-secondary-foreground font-black text-lg h-12"
            >
              {currentRound + 1 >= TOTAL_ROUNDS ? "SEE RESULTS" : "NEXT ROUND"}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
