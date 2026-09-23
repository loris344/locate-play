"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Loader2,
  Lock,
  LogIn,
  MapPin,
  Play,
  Share2,
  Trophy,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import GameMap from '@/components/GameMap';
import GameMapErrorBoundary from '@/components/GameMapErrorBoundary';
import VideoPlayer from '@/components/VideoPlayer';
import RoundIntro from '@/components/RoundIntro';
import RoundTimer, { getTimeLabel } from '@/components/RoundTimer';
import StripePricingTable from '@/components/StripePricingTable';

// Rooms run on a Cloudflare Worker + Durable Object (workers/multiplayer),
// not Supabase Realtime. The Worker makes the same few database calls per
// game the solo edge functions do (quota, videos, sessions, scores); this
// page's only Supabase calls are reading the local session for its token
// and this player's own photo version, once per visit.
const WS_URL = process.env.NEXT_PUBLIC_MULTIPLAYER_URL || 'wss://geogushing.com/api/multiplayer';
const AVATAR_BASE = `${WS_URL.replace(/^ws/, 'http')}/avatar/`;
// Shared with the solo game, so a multiplayer game's videos don't come
// back in the next solo game either.
const SEEN_KEY = 'geogushing_seen_videos';
const PING_INTERVAL_MS = 30_000;
// Sent by the Worker (see workers/multiplayer/src/index.ts).
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_REJECTED = 4003;
const CLOSE_ROOM_GONE = 4005;
const ROOM_CODE = /^[A-Z2-9]{5}$/;

interface RoundResult {
  lat: number | null;
  lng: number | null;
  distance: number;
  score: number;
  baseScore: number;
  timeMultiplier: number;
  timedOut: boolean;
}

interface RoomPlayer {
  userId: string;
  username: string;
  avatarV: string | null;
  isPremium: boolean;
  isHost: boolean;
  connected: boolean;
  inGame: boolean;
  total: number;
  guessed: boolean;
  rounds: RoundResult[];
}

interface RoomVideo {
  id: string;
  video_url: string;
  actor_name: string | null;
  actor_photo_url: string | null;
  source_url: string | null;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

interface RoomState {
  now: number;
  code: string;
  hostId: string;
  hostPremium: boolean;
  status: 'lobby' | 'guessing' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  roundStartsAt: number;
  roundEndsAt: number;
  revealEndsAt: number;
  videoIds: string[];
  video: RoomVideo | null;
  players: RoomPlayer[];
}

type Target = { kind: 'create' } | { kind: 'join'; code: string };

interface Fatal {
  code: string;
  message: string;
}

function avatarSrc(userId: string, avatarV: string | null) {
  return avatarV ? `${AVATAR_BASE}${userId}?v=${avatarV}` : undefined;
}

// The ?v= cache-buster Account.tsx appends to the photo URL on every upload.
function avatarVersion(avatarUrl: string | null | undefined) {
  if (!avatarUrl) return null;
  try {
    return new URL(avatarUrl).searchParams.get('v') || '0';
  } catch {
    return null;
  }
}

function roomLink(code: string) {
  return `${window.location.origin}/multiplayer/?room=${code}`;
}

function PlayerAvatar({ player, className }: { player: RoomPlayer; className: string }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={avatarSrc(player.userId, player.avatarV)} alt={player.username} loading="lazy" className="object-cover" />
      <AvatarFallback className="bg-primary/20 text-primary text-xs font-black">
        {player.username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

// Seconds left until a server timestamp, ticking once a second.
function useCountdown(target: number, offset: number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((target - (Date.now() + offset)) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [target, offset]);
  return left;
}

export default function Multiplayer() {
  const router = useRouter();
  const navigate = router.push;
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [target, setTarget] = useState<Target | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [state, setState] = useState<RoomState | null>(null);
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [guessMarker, setGuessMarker] = useState<[number, number] | null>(null);
  const [sentGuess, setSentGuess] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  // Server clock minus ours, so deadlines the room sends line up with
  // the timer on screen whatever this device's clock says.
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  // Once a room is created the code is known, and any reconnect must join
  // it by code rather than create another.
  const codeRef = useRef<string | null>(null);
  const seenSavedFor = useRef<string | null>(null);

  const userId = user?.id;

  // ?room=CODE from a shared link.
  useEffect(() => {
    const code = (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase();
    if (ROOM_CODE.test(code)) setTarget({ kind: 'join', code });
  }, []);

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    if (!userId || !target) return;
    let unmounted = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryDelay = 1000;
    let refreshedAfterReject = false;
    let avatarV: string | null = null;
    let gotState = false;
    codeRef.current = target.kind === 'join' ? target.code : null;

    const connect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (unmounted || !session) return;

      const params = new URLSearchParams({ token: session.access_token });
      if (avatarV) params.set('v', avatarV);
      if (codeRef.current) params.set('room', codeRef.current);
      else params.set('create', '1');
      socket = new WebSocket(`${WS_URL}?${params}`);
      socketRef.current = socket;

      socket.onopen = () => {
        retryDelay = 1000;
        setConnected(true);
        pingTimer = setInterval(() => socket?.send('ping'), PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (event.data === 'pong') return;
        const data = JSON.parse(event.data);
        if (data.type === 'state') {
          const room = data as RoomState;
          gotState = true;
          refreshedAfterReject = false;
          setClockOffset(room.now - Date.now());
          setState(room);
          if (codeRef.current !== room.code) {
            codeRef.current = room.code;
            window.history.replaceState(null, '', `/multiplayer/?room=${room.code}`);
          }
        } else if (data.type === 'error') {
          if (data.code === 'multi_limit' || data.code === 'room_not_found' || data.code === 'room_full' || data.code === 'in_progress') {
            setFatal({ code: data.code, message: data.message });
          } else {
            toast({ title: data.message, variant: 'destructive' });
          }
        }
      };

      socket.onclose = async (event) => {
        clearInterval(pingTimer);
        setConnected(false);
        if (unmounted) return;

        if (event.code === CLOSE_REJECTED) {
          // The error message that came just before says why.
          setFatal((current) => current ?? { code: event.reason || 'rejected', message: "Couldn't join this room." });
          return;
        }
        if (event.code === CLOSE_ROOM_GONE) {
          setFatal({ code: 'room_gone', message: 'This room has closed.' });
          return;
        }
        if (event.code === CLOSE_UNAUTHORIZED) {
          // Expired token, or a username picked after it was issued: one
          // refresh fixes both. A second rejection means it won't.
          if (refreshedAfterReject) {
            setFatal({ code: 'unauthorized', message: "Couldn't sign you into the room. Try signing out and back in." });
            return;
          }
          refreshedAfterReject = true;
          await supabase.auth.refreshSession();
          if (!unmounted) connect();
          return;
        }
        // Creating a room that never answered: try once more, then give up
        // rather than creating rooms in a loop.
        if (!gotState && !codeRef.current && retryDelay > 2000) {
          setFatal({ code: 'unreachable', message: "Couldn't reach the multiplayer server. Please try again." });
          return;
        }
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    };

    supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        avatarV = avatarVersion(data?.avatar_url);
        if (!unmounted) connect();
      });

    return () => {
      unmounted = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, [userId, target, toast]);

  const status = state?.status;
  const round = state?.round ?? 0;
  const roundStartsAt = state?.roundStartsAt ?? 0;

  // A new round: clear the map and show the intro until the round's start
  // time (the same 2.5s splash as the solo game, on the server's clock).
  useEffect(() => {
    if (status !== 'guessing') return;
    setGuessMarker(null);
    setSentGuess(false);
    setIntroDone(false);
    const wait = roundStartsAt - (Date.now() + clockOffset);
    const timer = setTimeout(() => setIntroDone(true), Math.max(0, wait));
    return () => clearTimeout(timer);
    // clockOffset is refreshed on every message; only a new round should reset the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, round, roundStartsAt]);

  // Remember this game's videos as seen, like the solo game does.
  useEffect(() => {
    if (!state || state.videoIds.length === 0) return;
    const key = state.videoIds.join(',');
    if (seenSavedFor.current === key) return;
    seenSavedFor.current = key;
    try {
      const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
      const fresh = state.videoIds.every((id) => !seen.includes(id));
      localStorage.setItem(SEEN_KEY, JSON.stringify(fresh ? [...seen, ...state.videoIds] : state.videoIds));
    } catch {
      // localStorage unavailable; nothing to remember.
    }
  }, [state]);

  const me = state?.players.find((p) => p.userId === userId);
  const isHost = !!state && state.hostId === userId;
  const guessed = sentGuess || !!me?.guessed || (status === 'guessing' && !!me?.rounds[round]);
  const timerDeadline = state ? state.roundEndsAt - clockOffset : 0;

  const handleStart = () => {
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    } catch {
      seen = [];
    }
    send({ type: 'start', seenVideoIds: seen });
  };

  const handleGuess = useCallback(
    (lat: number, lng: number) => {
      if (guessed || status !== 'guessing') return;
      setGuessMarker([lat, lng]);
    },
    [guessed, status],
  );

  const submitGuess = useCallback(() => {
    if (!guessMarker || guessed) return;
    setSentGuess(true);
    send({ type: 'guess', lat: guessMarker[0], lng: guessMarker[1] });
  }, [guessMarker, guessed, send]);

  // Time's up with a pin placed but not confirmed: send it anyway so the
  // reveal shows how far off it was (it scores 0 either way, as in solo).
  const handleTimeUp = useCallback(() => {
    if (guessMarker && !guessed) submitGuess();
  }, [guessMarker, guessed, submitGuess]);

  const copyLink = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(roomLink(state.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Copy this link', description: roomLink(state.code) });
    }
  };

  const shareLink = async () => {
    if (!state) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Play GeoGushing with me', text: `Join my room: ${state.code}`, url: roomLink(state.code) });
      } catch {
        // Share sheet dismissed.
      }
    } else {
      copyLink();
    }
  };

  const leaveToLanding = () => {
    setTarget(null);
    setState(null);
    setFatal(null);
    codeRef.current = null;
    window.history.replaceState(null, '', '/multiplayer/');
  };

  const joinFromInput = (e: React.FormEvent) => {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (!ROOM_CODE.test(code)) {
      toast({ title: 'Room codes are 5 letters or digits', variant: 'destructive' });
      return;
    }
    setFatal(null);
    setState(null);
    setTarget({ kind: 'join', code });
  };

  const header = (title: string, subtitle?: string) => (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="min-w-0">
        <h1 className="text-3xl font-black text-gradient-hot leading-none">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    const back = target?.kind === 'join' ? `/multiplayer/?room=${target.code}` : '/multiplayer';
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-lg mx-auto space-y-6">
          {header('MULTIPLAYER', 'Play the same clips as your friends, live')}
          <div className="bg-card border border-border rounded-lg p-8 text-center space-y-4">
            <Users className="w-14 h-14 text-accent mx-auto" />
            <h2 className="text-2xl font-black text-foreground">
              {target?.kind === 'join' ? `JOIN ROOM ${target.code}` : 'PLAY WITH FRIENDS'}
            </h2>
            <p className="text-muted-foreground">
              Multiplayer is for registered players only. Create a free account to {target?.kind === 'join' ? 'join the room' : 'host or join a room'}.
            </p>
            <Button
              onClick={() => navigate(`/auth?redirect=${encodeURIComponent(back)}`)}
              className="bg-gradient-hot font-black text-lg px-8 py-3 h-auto"
            >
              <LogIn className="mr-2 h-5 w-5" /> SIGN UP / SIGN IN
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (fatal) {
    if (fatal.code === 'multi_limit') {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border rounded-lg p-8 text-center max-w-lg space-y-6"
          >
            <Lock className="w-16 h-16 text-secondary mx-auto" />
            <h2 className="text-3xl font-black text-gradient-hot">MULTIPLAYER GAME USED</h2>
            <p className="text-muted-foreground">{fatal.message}</p>
            <p className="text-sm font-bold text-foreground">
              👑 Premium hosts play unlimited multiplayer games - and so does everyone in their room.
            </p>
            <StripePricingTable />
            <div className="flex gap-3 justify-center">
              <Button onClick={leaveToLanding} variant="outline">
                Back
              </Button>
              <Button onClick={() => navigate('/')} variant="ghost">
                Home
              </Button>
            </div>
          </motion.div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-lg p-8 text-center max-w-md space-y-4">
          <p className="text-destructive text-lg font-bold">⚠️ {fatal.message}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={leaveToLanding} className="bg-gradient-hot font-bold">
              Back to multiplayer
            </Button>
            <Button onClick={() => navigate('/')} variant="outline">
              Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-lg mx-auto space-y-6">
          {header('MULTIPLAYER', 'Play the same clips as your friends, live')}

          <div className="bg-card border-2 border-accent/60 rounded-xl p-6 space-y-4 text-center">
            <Users className="w-12 h-12 text-accent mx-auto" />
            <h2 className="text-2xl font-black text-foreground">HOST A ROOM</h2>
            <p className="text-sm text-muted-foreground">
              Get a code, share the link, and everyone plays the same 5 rounds at the same time. Up to 8 players.
            </p>
            <Button
              onClick={() => {
                setState(null);
                setTarget({ kind: 'create' });
              }}
              size="lg"
              className="w-full bg-gradient-hot font-black text-xl py-6 h-auto shadow-glow hover:scale-105 transition-transform"
            >
              CREATE A ROOM 🎯
            </Button>
          </div>

          <form onSubmit={joinFromInput} className="bg-card border border-border rounded-xl p-6 space-y-3">
            <h2 className="text-xl font-black text-foreground text-center">JOIN A ROOM</h2>
            <div className="flex gap-2">
              <Input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                maxLength={5}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="bg-muted border-border text-center text-xl font-black tracking-[0.3em] uppercase"
              />
              <Button type="submit" disabled={codeInput.trim().length !== 5} className="bg-secondary text-secondary-foreground font-black px-6">
                JOIN
              </Button>
            </div>
          </form>

          <p className="text-xs text-muted-foreground text-center">
            Free accounts get 1 multiplayer game per day. In a room hosted by a{' '}
            <span className="text-secondary font-bold">👑 Premium</span> player, games are unlimited for everyone.
          </p>
        </div>
      </div>
    );
  }

  if (!state || !me) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {target.kind === 'create' ? 'Creating your room...' : `Joining room ${target.code}...`}
        </p>
      </div>
    );
  }

  const host = state.players.find((p) => p.isHost);
  const connectedCount = state.players.filter((p) => p.connected).length;

  if (state.status === 'lobby') {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-lg mx-auto space-y-5">
          {header('MULTIPLAYER', isHost ? 'Your room - share the code to invite players' : `${host?.username ?? 'Someone'}'s room`)}

          {/* Code + share */}
          <div className="bg-card border-2 border-accent/60 rounded-xl p-5 text-center space-y-3">
            <p className="text-xs font-bold text-muted-foreground tracking-widest uppercase">Room code</p>
            <p className="text-5xl font-black text-gradient-hot tracking-[0.25em]">{state.code}</p>
            <div className="flex gap-2 justify-center">
              <Button onClick={copyLink} variant="outline" className="font-bold">
                {copied ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
              <Button onClick={shareLink} variant="outline" className="font-bold">
                <Share2 className="h-4 w-4 mr-1.5" /> Share
              </Button>
            </div>
            {!connected && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting...
              </p>
            )}
          </div>

          {/* Players */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">
                <Users className="inline h-4 w-4 mr-1.5 text-accent" />
                {connectedCount} player{connectedCount !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground">up to 8</p>
            </div>
            <div className="space-y-2">
              {state.players.map((p) => (
                <div key={p.userId} className="flex items-center gap-3">
                  <PlayerAvatar player={p} className={`h-10 w-10 ring-2 ${p.userId === userId ? 'ring-primary' : 'ring-border'}`} />
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className={`font-bold truncate ${p.userId === userId ? 'text-primary' : 'text-foreground'}`}>
                      {p.username}
                      {p.userId === userId ? ' (you)' : ''}
                    </span>
                    {p.isPremium && <Crown className="h-4 w-4 text-secondary fill-secondary shrink-0" />}
                  </div>
                  {p.isHost && <span className="text-[10px] font-black uppercase tracking-wider text-accent">Host</span>}
                  {!p.connected && <span className="text-[10px] text-muted-foreground">away</span>}
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {state.hostPremium ? (
              <>
                <span className="text-secondary font-bold">👑 Premium host</span> - unlimited games for everyone in this room.
              </>
            ) : (
              <>
                Free room: 1 multiplayer game per day for free players.{' '}
                {isHost ? (
                  <button onClick={() => navigate('/subscription')} className="text-secondary font-bold underline-offset-2 hover:underline">
                    Go Premium
                  </button>
                ) : (
                  <span className="text-secondary font-bold">A Premium host</span>
                )}{' '}
                makes it unlimited for the whole room.
              </>
            )}
          </p>

          {isHost ? (
            <Button
              onClick={handleStart}
              disabled={!connected || connectedCount < 2}
              size="lg"
              className="w-full bg-gradient-hot font-black text-xl py-6 h-auto shadow-glow animate-pulse-glow disabled:animate-none hover:scale-105 transition-transform"
            >
              <Play className="mr-2 h-6 w-6" /> {connectedCount < 2 ? 'WAITING FOR PLAYERS...' : 'START GAME'}
            </Button>
          ) : (
            <p className="text-center text-sm font-bold text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for {host?.username ?? 'the host'} to start...
            </p>
          )}
        </div>
      </div>
    );
  }

  if (state.status === 'finished') {
    const ranking = [...state.players].filter((p) => p.inGame).sort((a, b) => b.total - a.total);
    const medals = ['🥇', '🥈', '🥉'];
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 150 }}
          className="bg-card border-2 border-primary rounded-lg p-6 text-center max-w-lg w-full space-y-5 max-h-[90vh] overflow-y-auto"
        >
          <Trophy className="w-14 h-14 text-secondary mx-auto" />
          <h2 className="text-4xl font-black text-gradient-hot">FINAL RESULTS</h2>
          <div className="space-y-2 text-left">
            {ranking.map((p, i) => (
              <div
                key={p.userId}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  i === 0 ? 'border-secondary bg-secondary/10' : p.userId === userId ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
              >
                <span className="text-2xl w-8 text-center shrink-0">{medals[i] ?? <span className="text-base font-black text-muted-foreground">{i + 1}</span>}</span>
                <PlayerAvatar player={p} className="h-10 w-10" />
                <div className="flex-1 min-w-0">
                  <p className={`font-bold truncate ${p.userId === userId ? 'text-primary' : 'text-foreground'}`}>
                    {p.username}
                    {p.userId === userId ? ' (you)' : ''}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.rounds.map((r) => (r.timedOut ? '⏰' : `${Math.round(r.distance)}km`)).join(' · ')}
                  </p>
                </div>
                <span className="text-lg font-black text-secondary">{p.total.toLocaleString()}</span>
              </div>
            ))}
          </div>
          {!me.inGame && <p className="text-sm text-muted-foreground">You&apos;ll be in the next game.</p>}
          {isHost ? (
            <div className="flex gap-3 justify-center">
              <Button onClick={() => send({ type: 'again' })} disabled={!connected} className="bg-gradient-hot font-black">
                PLAY AGAIN
              </Button>
              <Button onClick={() => navigate('/')} variant="outline">
                Home
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-bold text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for {host?.username ?? 'the host'} to play again...
              </p>
              <Button onClick={() => navigate('/')} variant="outline">
                Home
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // guessing / reveal
  const video = state.video;
  const revealing = state.status === 'reveal';
  const showIntro = state.status === 'guessing' && !introDone;
  const myRound = me.rounds[round];
  const answer: [number, number] | null = revealing && video?.lat !== undefined && video?.lng !== undefined ? [video.lat, video.lng] : null;
  const shownGuess: [number, number] | null =
    revealing && myRound && myRound.lat !== null && myRound.lng !== null ? [myRound.lat, myRound.lng] : guessMarker;
  const roundRanking = revealing
    ? [...state.players].filter((p) => p.inGame && p.rounds[round]).sort((a, b) => b.rounds[round].score - a.rounds[round].score)
    : [];

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence>
        {showIntro && video && (
          <RoundIntro
            actorName={video.actor_name ?? undefined}
            actorPhotoUrl={video.actor_photo_url ?? undefined}
            round={round + 1}
            totalRounds={state.totalRounds}
          />
        )}
      </AnimatePresence>

      <div className="border-b border-border px-2 lg:px-4 py-2 flex items-center justify-between overflow-hidden">
        <button onClick={() => navigate('/')} className="text-lg lg:text-xl font-black text-gradient-hot tracking-tight shrink-0">
          GEOGUSHING
        </button>
        <div className="flex items-center gap-1.5 lg:gap-3 min-w-0">
          {!connected && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {state.status === 'guessing' && (
            <RoundTimer roundId={round} deadline={timerDeadline} stopped={guessed} onTimeUp={handleTimeUp} />
          )}
          <span className="text-muted-foreground font-bold text-xs lg:text-sm">
            <span className="text-foreground">{round + 1}</span>/{state.totalRounds}
          </span>
          <span className="text-secondary font-black text-sm lg:text-lg">{me.total.toLocaleString()}</span>
        </div>
      </div>

      {/* Who's guessed / round scores */}
      <div className="flex gap-2 overflow-x-auto px-2 lg:px-4 py-1.5 border-b border-border">
        {state.players
          .filter((p) => p.inGame)
          .map((p) => {
            const r = p.rounds[round];
            const done = revealing ? !!r : p.guessed || (p.userId === userId && guessed);
            return (
              <div key={p.userId} className="flex items-center gap-1.5 shrink-0 rounded-full bg-muted/60 pl-0.5 pr-2 py-0.5">
                <div className="relative">
                  <PlayerAvatar player={p} className={`h-6 w-6 ${!p.connected ? 'opacity-40' : ''}`} />
                  {!revealing && done && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 ring-2 ring-background flex items-center justify-center">
                      <Check className="h-2 w-2 text-white" />
                    </span>
                  )}
                </div>
                <span className={`text-[11px] font-bold ${p.userId === userId ? 'text-primary' : 'text-foreground'}`}>{p.username}</span>
                {revealing && r && <span className="text-[11px] font-black text-secondary">+{r.score.toLocaleString()}</span>}
              </div>
            );
          })}
      </div>

      <div className="flex flex-col lg:grid lg:grid-rows-1 lg:grid-cols-2 gap-1 lg:gap-4 p-1 lg:p-4 h-[calc(100dvh-98px)] overflow-auto lg:overflow-hidden">
        <div className="min-h-0 flex flex-col">
          {video && <VideoPlayer url={video.video_url} />}

          <AnimatePresence>
            {revealing && video && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-card border-2 border-primary rounded-lg p-3 space-y-2"
              >
                <p className="text-center text-sm">
                  <MapPin className="inline h-4 w-4 text-primary mr-1" />
                  <span className="font-bold text-secondary">
                    {video.city}, {video.country}
                  </span>
                </p>
                <div className="space-y-1">
                  {roundRanking.map((p, i) => {
                    const r = p.rounds[round];
                    // "Lightning fast" next to +0 points reads as a joke at the player's expense.
                    const label = r.score > 0 ? getTimeLabel(r.timeMultiplier) : '';
                    return (
                      <div
                        key={p.userId}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${p.userId === userId ? 'bg-primary/10' : ''}`}
                      >
                        <span className="w-5 text-center font-black text-muted-foreground">{i + 1}</span>
                        <PlayerAvatar player={p} className="h-6 w-6" />
                        <span className={`flex-1 truncate font-bold ${p.userId === userId ? 'text-primary' : 'text-foreground'}`}>{p.username}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {r.timedOut && r.lat === null ? "⏰ no guess" : `${Math.round(r.distance)} km`}
                          {label && !r.timedOut ? ` ${label}` : ''}
                        </span>
                        <span className="font-black text-secondary shrink-0">+{r.score.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
                {video.source_url && (
                  <div className="text-center">
                    <a
                      href={video.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Watch Original
                    </a>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="h-[32vh] min-h-[180px] max-h-[260px] lg:min-h-0 lg:h-auto lg:max-h-none lg:flex-none">
          <GameMapErrorBoundary>
            <GameMap onGuess={handleGuess} guessMarker={shownGuess} answerMarker={answer} disabled={guessed || revealing} />
          </GameMapErrorBoundary>
        </div>

        <div className="sticky bottom-0 z-10 flex gap-2 pb-[max(env(safe-area-inset-bottom),4px)] bg-background pt-1 lg:col-span-1 lg:col-start-2">
          {!revealing ? (
            <>
              {video?.source_url && (
                <a
                  href={video.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary/10 px-3 h-12 text-xs font-bold text-primary hover:bg-primary/20 transition-colors shrink-0"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">Original</span>
                </a>
              )}
              <Button
                onClick={submitGuess}
                disabled={!guessMarker || guessed || !connected}
                className="flex-1 bg-gradient-hot font-black text-lg h-12 shadow-glow animate-pulse-glow disabled:opacity-50 disabled:animate-none"
              >
                {guessed ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> WAITING FOR OTHERS...
                  </>
                ) : (
                  <>
                    <MapPin className="mr-2 h-5 w-5" /> GUESS!
                  </>
                )}
              </Button>
            </>
          ) : (
            <RevealFooter
              isHost={isHost}
              connected={connected}
              last={round + 1 >= state.totalRounds}
              revealEndsAt={state.revealEndsAt}
              clockOffset={clockOffset}
              onNext={() => send({ type: 'next' })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RevealFooter({
  isHost,
  connected,
  last,
  revealEndsAt,
  clockOffset,
  onNext,
}: {
  isHost: boolean;
  connected: boolean;
  last: boolean;
  revealEndsAt: number;
  clockOffset: number;
  onNext: () => void;
}) {
  const left = useCountdown(revealEndsAt, clockOffset);
  const label = last ? 'SEE RESULTS' : 'NEXT ROUND';
  if (isHost) {
    return (
      <Button onClick={onNext} disabled={!connected} className="flex-1 bg-secondary text-secondary-foreground font-black text-lg h-12">
        {label} ({left}s)
        <ArrowRight className="ml-2 h-5 w-5" />
      </Button>
    );
  }
  return (
    <div className="flex-1 flex items-center justify-center h-12 rounded-md bg-muted text-sm font-bold text-muted-foreground">
      {label.charAt(0) + label.slice(1).toLowerCase()} in {left}s
    </div>
  );
}
