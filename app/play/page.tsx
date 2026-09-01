"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useGameAccess } from "@/hooks/useGameAccess";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import Game from "@/screens/Game";

export default function Page() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [ensuringSession, setEnsuringSession] = useState(true);
  const gameAccess = useGameAccess();

  // Gives game-start a stable, real user_id to key the free-game quota on
  // instead of IP - a per-IP cap 403'd real users who happened to share a
  // carrier-NAT IP with anyone else who'd already played. This session is
  // invisible everywhere else in the app (AuthContext filters it out of
  // `user`): no sign-in button changes, no username prompt, nothing.
  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      supabase.auth.signInAnonymously().finally(() => setEnsuringSession(false));
    } else {
      setEnsuringSession(false);
    }
  }, [authLoading, session]);

  useEffect(() => {
    if (ensuringSession || gameAccess.loading || gameAccess.canPlay) return;
    router.replace(gameAccess.reason === "paywall" ? "/subscription" : "/auth?redirect=%2Fplay");
  }, [ensuringSession, gameAccess.loading, gameAccess.canPlay, gameAccess.reason, router]);

  if (ensuringSession || gameAccess.loading || !gameAccess.canPlay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return <Game />;
}
