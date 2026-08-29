"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ArrowRight, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase, Video } from "@/lib/supabase";
import { haversineDistance, calculateScore } from "@/lib/scoring";
import VideoPlayer from "@/components/VideoPlayer";
import GameMapErrorBoundary from "@/components/GameMapErrorBoundary";
import GameMap from "@/components/GameMap";

const ROUNDS = 5;

interface SeoGameWidgetProps {
  mode: "city" | "country" | "random";
  filter?: string;
}

export default function SeoGameWidget({ mode, filter }: SeoGameWidgetProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [guessMarker, setGuessMarker] = useState<[number, number] | null>(null);
  const [answerMarker, setAnswerMarker] = useState<[number, number] | null>(null);
  const [roundResult, setRoundResult] = useState<{ distance: number; score: number } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function fetchVideos() {
      setLoading(true);
      let query = supabase.from("videos").select("*").limit(50);
      if (mode === "city" && filter) query = query.eq("city", filter);
      if (mode === "country" && filter) query = query.eq("country", filter);

      const { data, error } = await query;
      if (error || !data || data.length < ROUNDS) {
        // Not enough matching clips (or a transient error) - fall back to a
        // random assortment so the widget is never empty.
        const fallback = await supabase.from("videos").select("*").limit(50);
        if (fallback.error || !fallback.data) {
          setError("Could not load the preview game right now.");
          setLoading(false);
          return;
        }
        setVideos(fallback.data.sort(() => Math.random() - 0.5).slice(0, ROUNDS));
      } else {
        setVideos(data.sort(() => Math.random() - 0.5).slice(0, ROUNDS));
      }
      setLoading(false);
    }
    fetchVideos();
  }, [mode, filter]);

  const currentVideo = videos[round];

  const handleGuess = useCallback((lat: number, lng: number) => {
    setGuessMarker([lat, lng]);
  }, []);

  const handleSubmit = () => {
    if (!guessMarker || !currentVideo || roundResult) return;
    const distance = haversineDistance(guessMarker[0], guessMarker[1], currentVideo.latitude, currentVideo.longitude);
    const score = calculateScore(distance);
    setAnswerMarker([currentVideo.latitude, currentVideo.longitude]);
    setRoundResult({ distance, score });
    setTotalScore((prev) => prev + score);
  };

  const handleNext = () => {
    if (round + 1 >= ROUNDS) {
      setDone(true);
      return;
    }
    setRound((r) => r + 1);
    setGuessMarker(null);
    setAnswerMarker(null);
    setRoundResult(null);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border-2 border-border bg-card">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !currentVideo) {
    return (
      <div className="rounded-xl border-2 border-border bg-card p-6 text-center text-muted-foreground">
        {error || "No preview available yet."}
      </div>
    );
  }

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border-2 border-primary/50 bg-card p-8 text-center space-y-4"
      >
        <Trophy className="mx-auto h-10 w-10 text-secondary" />
        <p className="text-2xl font-black text-gradient-hot">{totalScore.toLocaleString()} points</p>
        <p className="text-muted-foreground">That was a 5-round taste of the full game.</p>
        <Button asChild size="lg" className="bg-gradient-hot font-black">
          <a href="/play/">
            Play the full game <ArrowRight className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-border bg-card p-4">
      <div className="flex items-center justify-between text-sm font-bold text-muted-foreground">
        <span>Round {round + 1} / {ROUNDS}</span>
        <span>{totalScore.toLocaleString()} pts</span>
      </div>

      <VideoPlayer url={currentVideo.video_url} />

      <GameMapErrorBoundary>
        <div className="h-64 overflow-hidden rounded-lg border border-border">
          <GameMap onGuess={handleGuess} guessMarker={guessMarker} answerMarker={answerMarker} disabled={!!roundResult} />
        </div>
      </GameMapErrorBoundary>

      <AnimatePresence mode="wait">
        {roundResult ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between gap-3"
          >
            <p className="text-sm font-bold">
              {Math.round(roundResult.distance)} km away · +{roundResult.score.toLocaleString()} pts
            </p>
            <Button onClick={handleNext} className="bg-gradient-hot font-black">
              {round + 1 >= ROUNDS ? "See result" : "Next round"} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        ) : (
          <Button onClick={handleSubmit} disabled={!guessMarker} className="w-full bg-gradient-hot font-black">
            Guess this location
          </Button>
        )}
      </AnimatePresence>
    </div>
  );
}
