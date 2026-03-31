import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const ANON_GAME_KEY = 'geogushing_anon_games';
const USER_GAME_KEY_PREFIX = 'geogushing_user_games_';
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

function getUserGamesPlayed(userId: string): number {
  const key = `${USER_GAME_KEY_PREFIX}${userId}`;
  const stored = localStorage.getItem(key);
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

function incrementUserGames(userId: string) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${USER_GAME_KEY_PREFIX}${userId}`;
  const current = getUserGamesPlayed(userId);
  localStorage.setItem(key, JSON.stringify({ count: current + 1, date: today }));
}

function getUtcDayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
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
        setIsSubscribed(false);
        setLoading(false);
        return;
      }

      // Check subscription
      const { data: sub, error: subError } = await supabase
        .from('subscriptions')
        .select('status, expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (subError) {
        console.error('[GEOGUSHING] Subscription check failed:', subError);
      }

      const subscribed = !!(
        sub &&
        sub.status === 'active' &&
        (!sub.expires_at || new Date(sub.expires_at) > new Date())
      );

      setIsSubscribed(subscribed);
      if (subscribed) {
        setGamesPlayedToday(0);
        setLoading(false);
        return;
      }

      // Count today's games in UTC (hard limit source of truth)
      const { startIso, endIso } = getUtcDayRange();

      let { count, error } = await supabase
        .from('game_scores')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startIso)
        .lte('created_at', endIso);

      // Fallback for schemas using played_at instead of created_at
      if (error) {
        const fallback = await supabase
          .from('game_scores')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('played_at', startIso)
          .lte('played_at', endIso);
        count = fallback.count;
        error = fallback.error;
      }

      if (error) {
        console.error('[GEOGUSHING] Daily games count failed:', error);
        // Fail closed: if counting fails, do not allow extra free games
        setGamesPlayedToday(MAX_DAILY_GAMES);
      } else {
        setGamesPlayedToday(count || 0);
      }

      setLoading(false);
    }

    check();
  }, [user?.id]);

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
