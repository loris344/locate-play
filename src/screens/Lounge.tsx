"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Send, Trash2, MessagesSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';

// The lounge runs on a Cloudflare Worker + Durable Object (workers/chat),
// not Supabase, so it costs no Supabase database/Realtime quota. Profile
// photos are also served through that Worker's cache rather than straight
// from Supabase storage. The only Supabase calls here are reading the local
// session for its token, and this player's own photo version once per visit.
const CHAT_URL = process.env.NEXT_PUBLIC_CHAT_URL || 'wss://geogushing.com/api/chat';
const AVATAR_BASE = `${CHAT_URL.replace(/^ws/, 'http')}/avatar/`;
// Kept in sync with ADMIN_EMAIL in src/screens/Admin.tsx - this only shows
// the delete button on everyone's messages, the permission itself is
// enforced by the chat Worker.
const ADMIN_EMAIL = 'lorisjsd@gmail.com';
const HISTORY_LIMIT = 100;
const MAX_LENGTH = 500;
const MIN_GAP_MS = 2000;
const PING_INTERVAL_MS = 30_000;
// Sent by the Worker when it rejects the token (see workers/chat/src/index.ts).
const CLOSE_UNAUTHORIZED = 4001;

interface LoungeMessage {
  id: string;
  user_id: string;
  username: string;
  avatar_v: string | null;
  content: string;
  created_at: number;
}

interface PresentUser {
  user_id: string;
  username: string;
  avatar_v: string | null;
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

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function PlayerAvatar({ userId, username, avatarV, className }: {
  userId: string;
  username: string;
  avatarV: string | null;
  className: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={avatarSrc(userId, avatarV)} alt={username} loading="lazy" className="object-cover" />
      <AvatarFallback className="bg-primary/20 text-primary text-xs font-black">
        {username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export default function Lounge() {
  const router = useRouter();
  const navigate = router.push;
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<LoungeMessage[]>([]);
  const [present, setPresent] = useState<PresentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const lastSentAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll on new messages while the reader is already at the
  // bottom, so scrolling up to read history isn't yanked back down.
  const stickToBottom = useRef(true);

  const userId = user?.id;
  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!userId) return;
    let unmounted = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryDelay = 1000;
    let refreshedAfterReject = false;
    let avatarV: string | null = null;

    const connect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (unmounted || !session) return;

      const params = new URLSearchParams({ token: session.access_token });
      if (avatarV) params.set('v', avatarV);
      socket = new WebSocket(`${CHAT_URL}?${params}`);
      socketRef.current = socket;

      socket.onopen = () => {
        retryDelay = 1000;
        setConnected(true);
        pingTimer = setInterval(() => socket?.send('ping'), PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (event.data === 'pong') return;
        const data = JSON.parse(event.data);
        if (data.type === 'history') {
          // Sent on every (re)connect: replaces the list, so anything
          // posted or deleted while disconnected is reflected.
          setMessages(data.messages);
          setLoading(false);
          setJoinFailed(false);
          refreshedAfterReject = false;
        } else if (data.type === 'presence') {
          setPresent(data.users);
        } else if (data.type === 'message') {
          setMessages((current) =>
            [...current.filter((m) => m.id !== data.message.id), data.message].slice(-HISTORY_LIMIT),
          );
        } else if (data.type === 'deleted') {
          setMessages((current) => current.filter((m) => m.id !== data.id));
        } else if (data.type === 'error') {
          toast({ title: data.error, variant: 'destructive' });
        }
      };

      socket.onclose = async (event) => {
        clearInterval(pingTimer);
        setConnected(false);
        if (unmounted) return;

        if (event.code === CLOSE_UNAUTHORIZED) {
          // Expired token, or a username picked after it was issued: one
          // refresh fixes both. A second rejection means it won't.
          if (refreshedAfterReject) {
            setJoinFailed(true);
            setLoading(false);
            return;
          }
          refreshedAfterReject = true;
          await supabase.auth.refreshSession();
          if (!unmounted) connect();
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
  }, [userId, toast]);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    const socket = socketRef.current;
    if (!content || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastSentAt.current < MIN_GAP_MS) {
      toast({ title: 'Slow down - wait a couple of seconds between messages' });
      return;
    }
    socket.send(JSON.stringify({ type: 'send', content }));
    lastSentAt.current = Date.now();
    setDraft('');
    stickToBottom.current = true;
  };

  const handleDelete = (id: string) => {
    socketRef.current?.send(JSON.stringify({ type: 'delete', id }));
  };

  const header = (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="min-w-0">
        <h1 className="text-3xl font-black text-gradient-hot leading-none">PLAYER LOUNGE</h1>
        <p className="text-xs text-muted-foreground mt-1">Hang out and talk live with other players</p>
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
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-lg mx-auto space-y-6">
          {header}
          <div className="bg-card border border-border rounded-lg p-8 text-center space-y-4">
            <MessagesSquare className="w-14 h-14 text-accent mx-auto" />
            <h2 className="text-2xl font-black text-foreground">JOIN THE LOUNGE</h2>
            <p className="text-muted-foreground">
              The lounge is where players hang out and talk live. It&apos;s for registered players only -
              create a free account to come in.
            </p>
            <Button
              onClick={() => navigate('/auth?redirect=%2Flounge')}
              className="bg-gradient-hot font-black text-lg px-8 py-3 h-auto"
            >
              SIGN UP / SIGN IN
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // You first, then everyone else alphabetically.
  const people = [...present].sort((a, b) =>
    a.user_id === userId ? -1 : b.user_id === userId ? 1 : a.username.localeCompare(b.username),
  );

  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <div className="max-w-lg w-full mx-auto p-4 pb-3 space-y-4">
        {header}

        {/* Who's here */}
        <div className="bg-card border border-border rounded-xl p-3">
          <div className="flex items-center gap-2 mb-3 text-xs font-bold text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            {connected ? (
              <span>
                <span className="text-foreground">{people.length}</span> in the lounge now
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {loading ? 'Joining...' : 'Reconnecting...'}
              </span>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto p-1">
            {people.map((p) => {
              const isYou = p.user_id === userId;
              return (
                <div key={p.user_id} className="flex flex-col items-center gap-1 w-14 shrink-0">
                  <div className="relative">
                    <PlayerAvatar
                      userId={p.user_id}
                      username={p.username}
                      avatarV={p.avatar_v}
                      className={`h-12 w-12 ring-2 ${isYou ? 'ring-primary' : 'ring-border'}`}
                    />
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 ring-2 ring-card" />
                  </div>
                  <span className={`text-[11px] font-bold truncate w-full text-center ${isYou ? 'text-primary' : 'text-foreground'}`}>
                    {isYou ? 'You' : p.username}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-2 space-y-4">
          {joinFailed ? (
            <div className="text-center py-12 text-muted-foreground">
              Couldn&apos;t join the lounge. Try signing out and back in.
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Nobody has said anything yet. Say hi! 👋
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.user_id === userId;
              return (
                <div key={m.id} className="group flex items-start gap-2.5">
                  <PlayerAvatar userId={m.user_id} username={m.username} avatarV={m.avatar_v} className="h-9 w-9 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-sm font-bold truncate ${mine ? 'text-primary' : 'text-foreground'}`}>
                        {m.username}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(m.created_at)}</span>
                      {(mine || isAdmin) && (
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="ml-auto self-center text-muted-foreground hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          aria-label="Delete message"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p
                      className={`mt-1 inline-block max-w-full rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words ${
                        mine ? 'bg-primary/15' : 'bg-muted'
                      }`}
                    >
                      {m.content}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <form onSubmit={handleSend} className="max-w-lg w-full mx-auto flex gap-2 p-4 pt-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something to the lounge..."
          maxLength={MAX_LENGTH}
          className="bg-muted border-border"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!connected || !draft.trim()}
          className="bg-gradient-hot shrink-0"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
