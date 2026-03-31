import { useState, useEffect, useCallback } from "react";
import { supabase, Video } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import GameMap from "@/components/GameMap";
import GameMapErrorBoundary from "@/components/GameMapErrorBoundary";
import VideoPlayer from "@/components/VideoPlayer";
import ScoreDisplay from "@/components/ScoreDisplay";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, MapPin, Trophy, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const TOTAL_ROUNDS = 5;
const MAX_SCORE_PER_ROUND = 5000;

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

export default function Game() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [guessMarker, setGuessMarker] = useState<[number, number] | null>(null);
  const [answerMarker, setAnswerMarker] = useState<[number, number] | null>(null);
  const [roundResult, setRoundResult] = useState<{ distance: number; score: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState(false);

  useEffect(() => {
    async function fetchVideos() {
      setLoading(true);
      console.log("[GEOGUSHING] Fetching videos from Supabase...");
      const { data, error } = await supabase.from("videos").select("*").limit(50);
      console.log("[GEOGUSHING] Result:", { data, error });

      if (error) {
        setError(`Failed to load videos: ${error.message}`);
        setLoading(false);
        return;
      }

      if (!data || data.length === 0) {
        setError("No videos found in the database.");
        setLoading(false);
        return;
      }

      const shuffled = data.sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS);
      setVideos(shuffled);
      setLoading(false);
    }

    fetchVideos();
  }, []);

  const currentVideo = videos[currentRound];

  const handleGuess = useCallback(
    (lat: number, lng: number) => {
      if (roundResult) return;
      setGuessMarker([lat, lng]);
    },
    [roundResult],
  );

  const handleSubmitGuess = () => {
    if (!guessMarker || !currentVideo) return;

    const distance = haversineDistance(guessMarker[0], guessMarker[1], currentVideo.latitude, currentVideo.longitude);
    const score = calculateScore(distance);

    setAnswerMarker([currentVideo.latitude, currentVideo.longitude]);
    setRoundResult({ distance, score });
    setTotalScore((prev) => prev + score);
  };

  const handleNextRound = () => {
    if (currentRound + 1 >= TOTAL_ROUNDS) {
      setGameOver(true);
      if (user) {
        supabase
          .from("game_scores")
          .insert({
            user_id: user.id,
            total_score: totalScore,
          })
          .then(({ error }) => {
            if (error) console.error("[GEOGUSHING] Failed to save score:", error);
          });
      }
      return;
    }
    setCurrentRound((prev) => prev + 1);
    setGuessMarker(null);
    setAnswerMarker(null);
    setRoundResult(null);
  };

  if (loading) {
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
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 150 }}
          className="bg-card border-2 border-primary rounded-lg p-8 text-center max-w-md space-y-6"
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
          <div className="flex gap-3 justify-center">
            <Button onClick={() => window.location.reload()} className="bg-gradient-hot font-bold">
              Play Again
            </Button>
            <Button onClick={() => navigate("/")} variant="outline">
              Home
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate("/")} className="text-xl font-black text-gradient-hot tracking-tight">
          GEOGUSHING
        </button>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground font-bold text-sm">
            Round <span className="text-foreground">{currentRound + 1}</span>/{TOTAL_ROUNDS}
          </span>
          <span className="text-secondary font-black text-lg">{totalScore.toLocaleString()} pts</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 p-4 h-[calc(100vh-57px)]">
        <div className="flex flex-col gap-4">
          {currentVideo && <VideoPlayer url={currentVideo.video_url} />}

          <AnimatePresence>
            {roundResult && (
              <ScoreDisplay
                distance={roundResult.distance}
                score={roundResult.score}
                city={currentVideo.city}
                country={currentVideo.country}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-4 min-h-0">
          <div className="flex-1 min-h-[300px]">
            <GameMapErrorBoundary>
              <GameMap
                onGuess={handleGuess}
                guessMarker={guessMarker}
                answerMarker={answerMarker}
                disabled={!!roundResult}
              />
            </GameMapErrorBoundary>
          </div>

          <div className="flex gap-3">
            {!roundResult ? (
              <Button
                onClick={handleSubmitGuess}
                disabled={!guessMarker}
                className="flex-1 bg-gradient-hot font-black text-lg h-12 shadow-glow animate-pulse-glow disabled:opacity-50 disabled:animate-none"
              >
                <MapPin className="mr-2 h-5 w-5" />
                GUESS!
              </Button>
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
    </div>
  );
}
