"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Send, Trash2, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';

// The room runs on a Cloudflare Worker + Durable Object (workers/chat), not
// Supabase, so chatting costs no Supabase database/Realtime/egress quota.
// The only Supabase call here is reading the local session for its token.
const CHAT_URL = process.env.NEXT_PUBLIC_CHAT_URL || 'wss://geogushing.com/api/chat';
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

interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: number;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export default function Chat() {
  const router = useRouter();
  const navigate = router.push;
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

    const connect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (unmounted || !session) return;

      socket = new WebSocket(`${CHAT_URL}?token=${encodeURIComponent(session.access_token)}`);
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

    connect();

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
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-3xl font-black text-gradient-hot">CHAT</h1>
          </div>
          <div className="bg-card border border-border rounded-lg p-8 text-center space-y-4">
            <MessageCircle className="w-14 h-14 text-primary mx-auto" />
            <h2 className="text-2xl font-black text-foreground">JOIN THE CHAT</h2>
            <p className="text-muted-foreground">
              The chat is for registered players only. Create a free account to talk with other players.
            </p>
            <Button
              onClick={() => navigate('/auth?redirect=%2Fchat')}
              className="bg-gradient-hot font-black text-lg px-8 py-3 h-auto"
            >
              SIGN UP / SIGN IN
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <div className="max-w-lg w-full mx-auto flex items-center gap-3 p-4 pb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-black text-gradient-hot">CHAT</h1>
        {!loading && !connected && !joinFailed && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting...
          </span>
        )}
      </div>

      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-2 space-y-3">
          {joinFailed ? (
            <div className="text-center py-12 text-muted-foreground">
              Couldn&apos;t join the chat. Try signing out and back in.
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No messages yet. Say hi! 👋
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.user_id === userId;
              return (
                <div key={m.id} className="group flex items-start gap-2.5">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-black">
                      {m.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
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
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{m.content}</p>
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
          placeholder="Say something..."
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
