"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useGameAccess } from "@/hooks/useGameAccess";
import { useAuth } from "@/contexts/AuthContext";
import Game from "@/screens/Game";

export default function Page() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const gameAccess = useGameAccess();

  // Playing requires a real account - no anonymous preview. Sign-in is
  // checked first and separately from the daily quota below, so a logged-
  // out visitor always lands on /auth, never on a paywall meant for
  // signed-in players who've used today's games.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/auth?redirect=%2Fplay");
      return;
    }
    if (!gameAccess.loading && !gameAccess.canPlay) {
      router.replace(gameAccess.reason === "paywall" ? "/subscription" : "/auth?redirect=%2Fplay");
    }
  }, [authLoading, user, gameAccess.loading, gameAccess.canPlay, gameAccess.reason, router]);

  if (authLoading || !user || gameAccess.loading || !gameAccess.canPlay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return <Game />;
}
