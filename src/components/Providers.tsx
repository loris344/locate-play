"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import UsernamePrompt from "@/components/UsernamePrompt";
import { supabase } from "@/lib/supabase";
import { notifyNewSignup } from "@/lib/notifySignup";

const POSTHOG_API_KEY = "phc_BCTmCtP8J4v5nPCefD33TskxTSGhFfiJHmwAvddPVbvK";

// @posthog/react's PostHogProvider is a thin context wrapper around
// posthog-js that nothing else in the app consumes (no usePostHog() calls
// anywhere) - it was only ever used to call posthog.init(). Importing the
// full SDK eagerly at the root put it on every page's critical rendering
// path. Loading posthog-js itself after mount keeps the exact same
// tracking behavior while moving that weight off the initial bundle.
function LazyPostHog() {
  useEffect(() => {
    import("posthog-js").then(({ default: posthog }) => {
      posthog.init(POSTHOG_API_KEY, {
        api_host: "https://eu.i.posthog.com",
        defaults: "2026-05-30",
      });
    });
  }, []);

  return null;
}

function GlobalNav() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === "/subscription" || pathname === "/play") return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => router.push(user ? "/subscription" : "/auth?redirect=/subscription")}
      className="fixed bottom-4 right-4 z-50 font-bold shadow-glow"
    >
      <Crown className="h-4 w-4 mr-1" /> {user ? "My Plan" : "Plans"}
    </Button>
  );
}

function RequireUsername({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // Defaults to false so static/first-paint content (and the prerendered
  // HTML crawlers see) always renders immediately - the prompt only ever
  // swaps in after the client confirms it's actually needed.
  const [needsUsername, setNeedsUsername] = useState(false);

  useEffect(() => {
    if (loading || !user) {
      setNeedsUsername(false);
      return;
    }

    let cancelled = false;
    const userId = user.id;
    const metadataUsername = user.user_metadata?.username?.trim();

    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (profile) {
        setNeedsUsername(false);
        return;
      }

      if (metadataUsername) {
        // Email signup already collected a username but the profiles row
        // never got created (that used to only happen from this prompt) -
        // self-heal instead of asking again.
        await supabase.from("profiles").upsert({ id: userId, username: metadataUsername });
        notifyNewSignup(userId, metadataUsername);
        if (!cancelled) setNeedsUsername(false);
      } else {
        setNeedsUsername(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  if (needsUsername) {
    return <UsernamePrompt onComplete={() => setNeedsUsername(false)} />;
  }

  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <LazyPostHog />
        <RequireUsername>
          <GlobalNav />
          {children}
        </RequireUsername>
      </TooltipProvider>
    </AuthProvider>
  );
}
