"use client";

import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { PostHogProvider } from "@posthog/react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import UsernamePrompt from "@/components/UsernamePrompt";

const posthogOptions = {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  defaults: "2026-05-30",
} as const;

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
    if (!loading && user) {
      const username = user.user_metadata?.username;
      setNeedsUsername(!username || username.trim() === "");
    } else {
      setNeedsUsername(false);
    }
  }, [user, loading]);

  if (needsUsername) {
    return <UsernamePrompt onComplete={() => setNeedsUsername(false)} />;
  }

  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!} options={posthogOptions}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <RequireUsername>
              <GlobalNav />
              {children}
            </RequireUsername>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </PostHogProvider>
  );
}
