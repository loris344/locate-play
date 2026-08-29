"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Trophy, ArrowLeft, Loader2, Instagram, Facebook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface LeaderboardEntry {
  username: string;
  total_score: number;
  games_played: number;
  last_played_at: string;
  avatar_url: string | null;
  instagram_handle: string | null;
  facebook_handle: string | null;
}

export default function Leaderboard() {
  const router = useRouter();
  const navigate = router.push;
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAvatar, setExpandedAvatar] = useState<{ url: string; username: string } | null>(null);

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
            {entries.slice(0, 10).map((entry, i) => (
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
                <button
                  onClick={() => entry.avatar_url && setExpandedAvatar({ url: entry.avatar_url, username: entry.username })}
                  className={`shrink-0 rounded-full ${entry.avatar_url ? 'cursor-pointer hover:ring-2 hover:ring-primary transition-shadow' : 'cursor-default'}`}
                  disabled={!entry.avatar_url}
                >
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={entry.avatar_url || undefined} alt={entry.username} />
                    <AvatarFallback className="text-sm font-black">
                      {entry.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground truncate">{entry.username}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {entry.games_played} game{entry.games_played !== 1 ? 's' : ''} played
                    </span>
                    {entry.instagram_handle && (
                      <a
                        href={`https://instagram.com/${entry.instagram_handle.replace(/^@/, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary"
                      >
                        <Instagram className="h-5 w-5 sm:h-4 sm:w-4" />
                      </a>
                    )}
                    {entry.facebook_handle && (
                      <a
                        href={
                          entry.facebook_handle.startsWith('http')
                            ? entry.facebook_handle
                            : `https://facebook.com/${entry.facebook_handle}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary"
                      >
                        <Facebook className="h-5 w-5 sm:h-4 sm:w-4" />
                      </a>
                    )}
                  </div>
                </div>
                <span className="text-lg font-black text-secondary">
                  {entry.total_score.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!expandedAvatar} onOpenChange={(open) => !open && setExpandedAvatar(null)}>
        <DialogContent className="max-w-sm border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{expandedAvatar?.username}&apos;s photo</DialogTitle>
          {expandedAvatar && (
            <img
              src={expandedAvatar.url}
              alt={expandedAvatar.username}
              className="w-full aspect-square rounded-lg object-cover"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}