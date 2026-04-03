import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Crown, Loader2 } from "lucide-react";
import Index from "./pages/Index.tsx";
import Game from "./pages/Game.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import Leaderboard from "./pages/Leaderboard.tsx";
import Subscription from "./pages/Subscription.tsx";
import { AuthProvider, useAuth } from "./contexts/AuthContext.tsx";
import { useGameAccess } from "./hooks/useGameAccess";
import UsernamePrompt from "./components/UsernamePrompt.tsx";

const queryClient = new QueryClient();

function GameRoute() {
  const gameAccess = useGameAccess();

  if (gameAccess.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!gameAccess.canPlay) {
    return <Navigate to={gameAccess.reason === "paywall" ? "/subscription" : "/auth?redirect=%2Fgame"} replace />;
  }

  return <Game />;
}

function GlobalNav() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname === '/subscription' || location.pathname === '/game') return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate(user ? '/subscription' : '/auth?redirect=/subscription')}
      className="fixed bottom-4 right-4 z-50 font-bold shadow-glow"
    >
      <Crown className="h-4 w-4 mr-1" /> {user ? 'My Plan' : 'Plans'}
    </Button>
  );
}

function RequireUsername({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [needsUsername, setNeedsUsername] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loading && user) {
      const username = user.user_metadata?.username;
      setNeedsUsername(!username || username.trim() === '');
    } else {
      setNeedsUsername(false);
    }
  }, [user, loading]);

  if (loading || needsUsername === null) return null;

  if (needsUsername) {
    return <UsernamePrompt onComplete={() => setNeedsUsername(false)} />;
  }

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter>
          <RequireUsername>
            <GlobalNav />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/game" element={<GameRoute />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/subscription" element={<Subscription />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </RequireUsername>
        </HashRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
