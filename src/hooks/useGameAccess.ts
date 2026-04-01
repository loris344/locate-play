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
  subscriptionEnd: string | null;
  planLabel: string | null;
  recordGamePlayed: () => void;
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function getAnonGamesPlayed(): number {
  const stored = localStorage.getItem(ANON_GAME_KEY);
  if (!stored) return 0;
  try {
    const { count, date } = JSON.parse(stored);
    if (date !== getTodayKey()) return 0;
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
    if (date !== getTodayKey()) return 0;
    return count;
  } catch {
    return 0;
  }
}

function incrementAnonGames() {
  const current = getAnonGamesPlayed();
  localStorage.setItem(ANON_GAME_KEY, JSON.stringify({ count: current + 1, date: getTodayKey() }));
}

function incrementUserGames(userId: string) {
  const key = `${USER_GAME_KEY_PREFIX}${userId}`;
  const current = getUserGamesPlayed(userId);
  localStorage.setItem(key, JSON.stringify({ count: current + 1, date: getTodayKey() }));
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
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [planLabel, setPlanLabel] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (!user) {
        const anonCount = getAnonGamesPlayed();
        setGamesPlayedToday(anonCount);
        setIsSubscribed(false);
        setLoading(false);
        return;
      }

      const localUserCount = getUserGamesPlayed(user.id);

      const { data: sub, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
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
      setSubscriptionEnd(sub?.expires_at || null);

      // Detect plan label from column or deduce from created_at/expires_at
      if (subscribed && sub) {
        const rawPlan = sub.plan || sub.plan_type || sub.interval || null;
        if (rawPlan) {
          const labels: Record<string, string> = { month: 'Monthly', monthly: 'Monthly', quarter: 'Quarterly', quarterly: 'Quarterly', year: 'Yearly', yearly: 'Yearly', annual: 'Yearly' };
          setPlanLabel(labels[rawPlan.toLowerCase()] || rawPlan);
        } else if (sub.expires_at && sub.created_at) {
          const diffDays = Math.round((new Date(sub.expires_at).getTime() - new Date(sub.created_at).getTime()) / 86400000);
          if (diffDays <= 35) setPlanLabel('Monthly');
          else if (diffDays <= 100) setPlanLabel('Quarterly');
          else setPlanLabel('Yearly');
        } else {
          setPlanLabel('Premium');
        }
      } else {
        setPlanLabel(null);
      }

      if (subscribed) {
        setGamesPlayedToday(0);
        setLoading(false);
        return;
      }

      const { startIso, endIso } = getUtcDayRange();

      let { count, error } = await supabase
        .from('game_scores')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startIso)
        .lte('created_at', endIso);

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
        // Fail-closed: block extra free games if DB counting is unavailable
        setGamesPlayedToday(Math.max(localUserCount, MAX_DAILY_GAMES));
      } else {
        const dbCount = count || 0;
        const safeCount = Math.max(dbCount, localUserCount);
        setGamesPlayedToday(safeCount);
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
      return;
    }

    incrementUserGames(user.id);
    const localCount = getUserGamesPlayed(user.id);
    setGamesPlayedToday(prev => Math.max(prev + 1, localCount));
  };

  return { canPlay, reason, loading, gamesPlayedToday, isSubscribed, subscriptionEnd, recordGamePlayed };
}
