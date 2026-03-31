import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const ANON_GAME_KEY = 'geogushing_anon_games';
const MAX_ANON_GAMES = 1;
const MAX_DAILY_GAMES = 2;

interface GameAccess {
  canPlay: boolean;
  reason: 'allowed' | 'signin_required' | 'paywall';
  loading: boolean;
  gamesPlayedToday: number;
  isSubscribed: boolean;
  recordGamePlayed: () => void;
}

function getAnonGamesPlayed(): number {
  const stored = localStorage.getItem(ANON_GAME_KEY);
  if (!stored) return 0;
  try {
    const { count, date } = JSON.parse(stored);
    if (date !== new Date().toISOString().split('T')[0]) return 0;
    return count;
  } catch {
    return 0;
  }
}

function incrementAnonGames() {
  const today = new Date().toISOString().split('T')[0];
  const current = getAnonGamesPlayed();
  localStorage.setItem(ANON_GAME_KEY, JSON.stringify({ count: current + 1, date: today }));
}

export function useGameAccess(): GameAccess {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [gamesPlayedToday, setGamesPlayedToday] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    async function check() {
      if (!user) {
        const anonCount = getAnonGamesPlayed();
        setGamesPlayedToday(anonCount);
        setLoading(false);
        return;
      }

      // Check subscription
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (sub && sub.status === 'active') {
        const notExpired = !sub.expires_at || new Date(sub.expires_at) > new Date();
        setIsSubscribed(notExpired);
        if (notExpired) {
          setLoading(false);
          return;
        }
      }

      // Count today's games (use UTC to avoid timezone issues)
      const now = new Date();
      const todayUTC = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T00:00:00.000Z`;

      const { count } = await supabase
        .from('game_scores')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('played_at', todayUTC);

      setGamesPlayedToday(count || 0);
      setLoading(false);
    }

    check();
  }, [user]);

  const canPlay = (() => {
    if (loading) return true;
    if (!user) return getAnonGamesPlayed() < MAX_ANON_GAMES;
    if (isSubscribed) return true;
    return gamesPlayedToday < MAX_DAILY_GAMES;
  })();

  const reason = (() => {
    if (canPlay || loading) return 'allowed' as const;
    if (!user) return 'signin_required' as const;
    return 'paywall' as const;
  })();

  const recordGamePlayed = () => {
    if (!user) {
      incrementAnonGames();
      setGamesPlayedToday(getAnonGamesPlayed());
    } else {
      setGamesPlayedToday(prev => prev + 1);
    }
  };

  return { canPlay, reason, loading, gamesPlayedToday, isSubscribed, recordGamePlayed };
}
