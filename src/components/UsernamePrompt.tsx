import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface UsernamePromptProps {
  onComplete: () => void;
}

export default function UsernamePrompt({ onComplete }: UsernamePromptProps) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);

    const trimmed = username.trim();
    // Update auth metadata
    const { data, error } = await supabase.auth.updateUser({
      data: { username: trimmed },
    });

    // Also upsert into profiles table for leaderboard
    if (!error) {
      const userId = data.user?.id;
      if (userId) {
        await supabase.from('profiles').upsert({ id: userId, username: trimmed });
      }
      toast({ title: "Pseudo enregistré !" });
      onComplete();
    } else {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black text-gradient-hot">GEOGUSHING</h1>
          <p className="text-muted-foreground text-sm">Choisis ton pseudo pour le classement</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              placeholder="Ton pseudo"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={20}
              className="bg-muted border-border text-center text-lg font-bold"
              autoFocus
            />
            <Button type="submit" disabled={loading || !username.trim()} className="w-full bg-gradient-hot font-black">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              C'EST PARTI !
            </Button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
