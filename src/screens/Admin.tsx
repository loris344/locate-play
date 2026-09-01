"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  Users,
  Gamepad2,
  Trophy,
  Crown,
  UserPlus,
  Activity,
  Repeat,
  Film,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Client-side gating here is UX only (redirect a non-admin away); the real
// authorization lives in each admin_* SQL function, which re-checks the
// caller's own auth.users row before returning anything. See
// supabase/migration-admin-stats.sql.
const ADMIN_EMAIL = "lorisjsd@gmail.com";

interface Overview {
  total_players: number;
  total_games_completed: number;
  total_game_sessions: number;
  abandoned_sessions: number;
  total_points_scored: number;
  avg_score_per_game: number;
  active_subscribers: number;
  players_with_multiple_games: number;
  signups_last_7d: number;
  signups_last_30d: number;
  games_last_7d: number;
  games_last_30d: number;
  dau: number;
  wau: number;
  mau: number;
  total_videos: number;
}

interface DailyPoint {
  day: string;
  signups: number;
  games_started: number;
  games_completed: number;
}

interface TopPlayer {
  user_id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  games_played: number;
  total_score: number;
  avg_score: number;
  best_score: number;
  last_played_at: string | null;
  joined_at: string;
  is_premium: boolean;
}

type SortKey = "games_played" | "total_score" | "avg_score" | "last_played_at";

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <Icon className="h-4 w-4 text-primary mb-2" />
      <p className="text-2xl font-black text-foreground leading-none">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>}
    </div>
  );
}

// Single-series bar chart: no legend needed, the heading above it names the
// series. Bars share one axis (a plain daily count), rounded data-ends,
// hover shows the exact date + value.
function DailyBarChart({
  points,
  color,
  format,
}: {
  points: number[];
  color: string;
  format: (i: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points);
  const width = 560;
  const height = 120;
  const gap = 2;
  const barWidth = points.length > 0 ? width / points.length - gap : 0;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28" preserveAspectRatio="none">
        {points.map((v, i) => {
          const h = Math.max(2, (v / max) * (height - 4));
          const x = i * (barWidth + gap);
          const y = height - h;
          const active = hover === i;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(1, barWidth)}
              height={h}
              rx={2}
              className={color}
              opacity={active ? 1 : 0.75}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          );
        })}
      </svg>
      {hover !== null && (
        <div className="absolute top-0 left-0 bg-popover border border-border rounded px-2 py-1 text-[11px] text-foreground pointer-events-none shadow-lg">
          {format(hover)}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [players, setPlayers] = useState<TopPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("games_played");

  const isAdmin = !!user && user.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!isAdmin) return;

    async function load() {
      const [overviewRes, dailyRes, playersRes] = await Promise.all([
        supabase.rpc("admin_get_overview"),
        supabase.rpc("admin_get_daily_activity", { days: 30 }),
        supabase.rpc("admin_get_top_players", { row_limit: 200 }),
      ]);

      const firstError = overviewRes.error || dailyRes.error || playersRes.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setOverview(overviewRes.data as Overview);
        setDaily((dailyRes.data as DailyPoint[]) ?? []);
        setPlayers((playersRes.data as TopPlayer[]) ?? []);
      }
      setLoading(false);
    }

    load();
  }, [isAdmin]);

  const sortedPlayers = useMemo(() => {
    const copy = [...players];
    copy.sort((a, b) => {
      if (sortKey === "last_played_at") {
        return new Date(b.last_played_at ?? 0).getTime() - new Date(a.last_played_at ?? 0).getTime();
      }
      return (b[sortKey] as number) - (a[sortKey] as number);
    });
    return copy;
  }, [players, sortKey]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-4">
          <ShieldAlert className="w-12 h-12 text-secondary mx-auto" />
          <h2 className="text-2xl font-black text-gradient-hot">SIGN IN REQUIRED</h2>
          <p className="text-muted-foreground">Sign in with the admin account to view this page.</p>
          <Button onClick={() => router.push("/auth?redirect=/admin")} className="bg-gradient-hot font-bold">
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-4">
          <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-2xl font-black text-foreground">ACCESS DENIED</h2>
          <p className="text-muted-foreground">This account isn&apos;t authorized to view the admin dashboard.</p>
          <Button onClick={() => router.push("/")} variant="outline">
            Home
          </Button>
        </div>
      </div>
    );
  }

  const completionRate = overview && overview.total_game_sessions > 0
    ? Math.round(((overview.total_game_sessions - overview.abandoned_sessions) / overview.total_game_sessions) * 100)
    : 0;
  const premiumRate = overview && overview.total_players > 0
    ? Math.round((overview.active_subscribers / overview.total_players) * 100)
    : 0;
  const retentionRate = overview && overview.total_players > 0
    ? Math.round((overview.players_with_multiple_games / overview.total_players) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto space-y-6 pb-12">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-black text-gradient-hot">ADMIN</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="bg-card border border-destructive/50 rounded-lg p-6 text-center text-destructive">
            {error}
          </div>
        ) : overview ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Headline tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatTile icon={Users} label="Players" value={overview.total_players.toLocaleString()} />
              <StatTile
                icon={Gamepad2}
                label="Games completed"
                value={overview.total_games_completed.toLocaleString()}
                sub={`${completionRate}% completion rate`}
              />
              <StatTile
                icon={Crown}
                label="Active subscribers"
                value={overview.active_subscribers.toLocaleString()}
                sub={`${premiumRate}% of players`}
              />
              <StatTile
                icon={Trophy}
                label="Avg score / game"
                value={overview.avg_score_per_game.toLocaleString()}
                sub={`${overview.total_points_scored.toLocaleString()} pts total`}
              />
              <StatTile
                icon={Repeat}
                label="Played 2+ games"
                value={overview.players_with_multiple_games.toLocaleString()}
                sub={`${retentionRate}% retention`}
              />
              <StatTile icon={Film} label="Videos in pool" value={overview.total_videos.toLocaleString()} />
            </div>

            {/* Active users */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-primary" />
                <p className="text-sm font-bold text-foreground">Active players</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-black text-foreground">{overview.dau}</p>
                  <p className="text-[11px] text-muted-foreground">DAU</p>
                </div>
                <div>
                  <p className="text-xl font-black text-foreground">{overview.wau}</p>
                  <p className="text-[11px] text-muted-foreground">WAU</p>
                </div>
                <div>
                  <p className="text-xl font-black text-foreground">{overview.mau}</p>
                  <p className="text-[11px] text-muted-foreground">MAU</p>
                </div>
              </div>
            </div>

            {/* Daily charts */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-primary" />
                    <p className="text-sm font-bold text-foreground">Signups / day</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {overview.signups_last_7d} in 7d · {overview.signups_last_30d} in 30d
                  </span>
                </div>
                <DailyBarChart
                  points={daily.map((d) => d.signups)}
                  color="fill-primary"
                  format={(i) => `${daily[i]?.day}: ${daily[i]?.signups} signup${daily[i]?.signups === 1 ? "" : "s"}`}
                />
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="h-4 w-4 text-secondary" />
                    <p className="text-sm font-bold text-foreground">Games started / day</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {overview.games_last_7d} in 7d · {overview.games_last_30d} in 30d
                  </span>
                </div>
                <DailyBarChart
                  points={daily.map((d) => d.games_started)}
                  color="fill-secondary"
                  format={(i) => `${daily[i]?.day}: ${daily[i]?.games_started} started`}
                />
              </div>
            </div>

            {/* Top players table */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-4 pb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">Players ({players.length})</p>
                <div className="flex gap-1">
                  {([
                    ["games_played", "Games"],
                    ["total_score", "Score"],
                    ["avg_score", "Avg"],
                    ["last_played_at", "Recent"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSortKey(key)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                        sortKey === key
                          ? "border-primary text-primary bg-primary/10"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-muted-foreground border-t border-border">
                      <th className="px-4 py-2 font-medium">Player</th>
                      <th className="px-2 py-2 font-medium text-right">Games</th>
                      <th className="px-2 py-2 font-medium text-right">Score</th>
                      <th className="px-2 py-2 font-medium text-right">Avg</th>
                      <th className="px-2 py-2 font-medium text-right">Best</th>
                      <th className="px-4 py-2 font-medium text-right">Last played</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((p) => (
                      <tr key={p.user_id} className="border-t border-border/60 hover:bg-muted/40">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={p.avatar_url || undefined} alt={p.username} />
                              <AvatarFallback className="text-[10px] font-black">
                                {p.username.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <p className="font-bold text-foreground truncate">{p.username}</p>
                                {p.is_premium && <Crown className="h-3 w-3 text-secondary shrink-0" />}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate">{p.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-foreground">{p.games_played}</td>
                        <td className="px-2 py-2 text-right text-muted-foreground">
                          {p.total_score.toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right text-muted-foreground">
                          {Math.round(p.avg_score).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right text-muted-foreground">
                          {p.best_score.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                          {p.last_played_at ? new Date(p.last_played_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedPlayers.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm py-8">No players yet.</p>
                )}
              </div>
            </div>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
