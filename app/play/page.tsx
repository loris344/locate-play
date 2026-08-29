"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useGameAccess } from "@/hooks/useGameAccess";
import Game from "@/screens/Game";

export default function Page() {
  const router = useRouter();
  const gameAccess = useGameAccess();

  useEffect(() => {
    if (!gameAccess.loading && !gameAccess.canPlay) {
      router.replace(gameAccess.reason === "paywall" ? "/subscription" : "/auth?redirect=%2Fplay");
    }
  }, [gameAccess.loading, gameAccess.canPlay, gameAccess.reason, router]);

  if (gameAccess.loading || !gameAccess.canPlay) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return <Game />;
}
