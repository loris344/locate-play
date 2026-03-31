import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LeaderboardEntry {
  username: string;
  total_score: number;
  games_played: number;
  last_played_at: string;
}

export default function Leaderboard() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchScores() {
      const { data } = await supabase.rpc('get_leaderboard');

      if (data) {
        setEntries(data as LeaderboardEntry[]);
      }
      setLoading(false);
    }
    fetchScores();
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-black text-gradient-hot">LEADERBOARD</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No scores yet. Be the first to play!
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-center gap-4 rounded-lg border p-3 ${
                  i === 0
                    ? 'border-secondary bg-secondary/10'
                    : i < 3
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-card'
                }`}
              >
                <span className={`text-2xl font-black w-8 text-center ${
                  i === 0 ? 'text-secondary' : i < 3 ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground truncate">{entry.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.games_played} game{entry.games_played !== 1 ? 's' : ''} played
                  </p>
                </div>
                <span className="text-lg font-black text-secondary">
                  {entry.total_score.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}