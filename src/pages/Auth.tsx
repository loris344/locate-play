import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Auth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  // With HashRouter, query params are after the hash: /#/auth?redirect=/game
  const getRedirect = () => {
    const hash = window.location.hash; // e.g. #/auth?redirect=/game
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return '/';
    const params = new URLSearchParams(hash.slice(qIndex));
    return params.get('redirect') || '/';
  };

  if (user) {
    navigate(getRedirect());
    return null;
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        const redirectTo = new URLSearchParams(window.location.search).get('redirect') || '/';
        navigate(redirectTo);
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username }, emailRedirectTo: window.location.origin },
      });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Check your email", description: "We sent you a confirmation link." });
      }
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + (new URLSearchParams(window.location.search).get('redirect') || '/') },
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black text-gradient-hot">GEOGUSHING</h1>
          <p className="text-muted-foreground text-sm">{isLogin ? "Welcome back" : "Create your account"}</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <Button onClick={handleGoogleLogin} variant="outline" className="w-full font-bold">
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-3">
            {!isLogin && (
              <Input
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required={!isLogin}
                className="bg-muted border-border"
              />
            )}
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-muted border-border"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-muted border-border"
            />
            <Button type="submit" disabled={loading} className="w-full bg-gradient-hot font-black">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLogin ? "LOG IN" : "SIGN UP"}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <button onClick={() => setIsLogin(!isLogin)} className="text-primary font-bold hover:underline">
            {isLogin ? "Sign up" : "Log in"}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
