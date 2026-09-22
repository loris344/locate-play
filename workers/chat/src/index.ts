import { DurableObject } from "cloudflare:workers";

interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  SUPABASE_URL: string;
  ADMIN_EMAIL: string;
}

const MAX_LENGTH = 500;
// How many past messages the room remembers the author of (not the text),
// so they can still be deleted by their author or the admin.
const SENT_LOG_LIMIT = 200;
// A bit under the client's own 2s cooldown, so network jitter between two
// sends the client allowed doesn't get one of them rejected here.
const MIN_GAP_MS = 1500;
// Close code the client treats as "token rejected": it refreshes its
// Supabase session once and reconnects (covers an expired token, and a
// username picked after the current token was issued).
const CLOSE_UNAUTHORIZED = 4001;
// The client pings every 30s (every 60s at worst in a throttled background
// tab); a socket silent for longer than this is a dropped connection that
// never sent a close, and is left out of the "who's here" list.
const STALE_MS = 120_000;
const AVATAR_VERSION = /^[0-9a-z]{1,20}$/;
const USER_ID = /^[0-9a-f-]{36}$/;

interface ChatUser {
  userId: string;
  username: string;
  // The ?v= cache-buster of the player's profile photo (see Account.tsx),
  // or null when they haven't uploaded one.
  avatarV: string | null;
  isAdmin: boolean;
  connectedAt: number;
}

interface ChatMessage {
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

// --- Supabase access token verification -----------------------------------
// The project signs access tokens with an asymmetric (ES256) key, so they can
// be checked here with its public key alone. The JWKS is fetched at most
// once per isolate, never per message.

interface Claims {
  sub?: string;
  exp?: number;
  iss?: string;
  role?: string;
  email?: string;
  is_anonymous?: boolean;
  user_metadata?: { username?: string };
}

const signingKeys = new Map<string, CryptoKey>();

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function getSigningKey(supabaseUrl: string, kid: string): Promise<CryptoKey | null> {
  const cached = signingKeys.get(kid);
  if (cached) return cached;

  const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) return null;
  const { keys } = await res.json<{ keys: (JsonWebKey & { kid: string })[] }>();
  for (const jwk of keys) {
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") continue;
    signingKeys.set(
      jwk.kid,
      await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
    );
  }
  return signingKeys.get(kid) ?? null;
}

async function verifyToken(token: string, env: Env): Promise<Omit<ChatUser, "avatarV" | "connectedAt"> | null> {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
    if (header.alg !== "ES256" || typeof header.kid !== "string") return null;

    const key = await getSigningKey(env.SUPABASE_URL, header.kid);
    if (!key) return null;

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return null;

    const claims: Claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (claims.iss !== `${env.SUPABASE_URL}/auth/v1`) return null;
    if (claims.role !== "authenticated" || claims.is_anonymous) return null;
    if (!claims.sub || !claims.exp || claims.exp * 1000 < Date.now()) return null;

    // Registered players always have one: set at email signup, or by the
    // username prompt for OAuth accounts (see UsernamePrompt.tsx).
    const username = claims.user_metadata?.username?.trim();
    if (!username) return null;

    return { userId: claims.sub, username, isAdmin: claims.email === env.ADMIN_EMAIL };
  } catch {
    return null;
  }
}

// --- Profile photos ---------------------------------------------------------
// Served from Cloudflare's cache in front of the Supabase avatars bucket, so
// each photo version is pulled from Supabase once per data center instead
// of once per viewer. The version is part of the URL, so a new upload is
// a new cache entry and old versions are cached forever.

async function serveAvatar(request: Request, ctx: ExecutionContext, userId: string, env: Env): Promise<Response> {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const v = new URL(request.url).searchParams.get("v") ?? "";
  if (!AVATAR_VERSION.test(v)) return new Response("Not found", { status: 404 });

  const upstream = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/avatars/${userId}/avatar.jpg?v=${v}`);
  const response = upstream.ok
    ? new Response(upstream.body, {
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      })
    : // Cached too (briefly), so a missing photo doesn't hit Supabase on every view.
      new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });

  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

// --- Worker entry: /api/chat* ---------------------------------------------

function rejectSocket(): Response {
  // Rejecting with a plain HTTP 401 would reach the browser as an opaque
  // 1006 close; accepting then closing with our own code lets the client
  // tell "bad token" apart from "network dropped".
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(CLOSE_UNAUTHORIZED, "unauthorized");
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const avatarUserId = url.pathname.match(/^\/api\/chat\/avatar\/([^/]+)$/)?.[1];
    if (avatarUserId && request.method === "GET") {
      if (!USER_ID.test(avatarUserId)) return new Response("Not found", { status: 404 });
      return serveAvatar(request, ctx, avatarUserId, env);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }

    const token = url.searchParams.get("token");
    const verified = token ? await verifyToken(token, env) : null;
    if (!verified) return rejectSocket();

    // The photo version comes from the client (it reads its own profile).
    // It can only ever point at this user's own avatar path, so there's
    // nothing to spoof.
    const v = url.searchParams.get("v");
    const user: ChatUser = {
      ...verified,
      avatarV: v && AVATAR_VERSION.test(v) ? v : null,
      connectedAt: Date.now(),
    };

    // Verified here, in the Worker, so unauthenticated sockets never reach
    // (or wake) the Durable Object. It's only reachable through this
    // Worker, so it can trust these headers.
    const headers = new Headers(request.headers);
    headers.set("X-Chat-User", JSON.stringify(user));
    const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName("global"));
    return room.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;

// --- The room ---------------------------------------------------------------

export class ChatRoom extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Messages are relayed live and never shown to anyone who joins later,
    // so their text is never stored - only who sent which one and when, for
    // delete permission and the rate limit.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sent (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    // The room used to keep, and replay to newcomers, its last 100 messages.
    this.sql.exec("DROP TABLE IF EXISTS messages");

    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const user: ChatUser = JSON.parse(request.headers.get("X-Chat-User") ?? "null");
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernatable: idle sockets don't keep the object (and its billing) awake.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(user);
    // No history: a newcomer only sees what's said from now on.
    server.send(JSON.stringify({ type: "welcome" }));
    // Everyone (the newcomer included) gets the updated "who's here" list.
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const user = ws.deserializeAttachment() as ChatUser;
    let msg: { type?: string; content?: unknown; id?: unknown };
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    if (msg.type === "send") {
      const content = String(msg.content ?? "").trim().slice(0, MAX_LENGTH);
      if (!content) return;

      const now = Date.now();
      const last = this.sql
        .exec<{ last: number | null }>("SELECT MAX(created_at) AS last FROM sent WHERE user_id = ?", user.userId)
        .one().last;
      if (last && now - last < MIN_GAP_MS) {
        ws.send(JSON.stringify({ type: "error", error: "Slow down - wait a couple of seconds between messages" }));
        return;
      }

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        user_id: user.userId,
        username: user.username,
        avatar_v: user.avatarV,
        content,
        created_at: now,
      };
      this.sql.exec("INSERT INTO sent (id, user_id, created_at) VALUES (?, ?, ?)", message.id, message.user_id, now);
      this.sql.exec(
        "DELETE FROM sent WHERE created_at < (SELECT created_at FROM sent ORDER BY created_at DESC LIMIT 1 OFFSET ?)",
        SENT_LOG_LIMIT - 1,
      );
      this.broadcast({ type: "message", message });
      return;
    }

    if (msg.type === "delete" && typeof msg.id === "string") {
      const row = this.sql.exec<{ user_id: string }>("SELECT user_id FROM sent WHERE id = ?", msg.id).toArray()[0];
      if (!row || (row.user_id !== user.userId && !user.isAdmin)) return;
      this.sql.exec("DELETE FROM sent WHERE id = ?", msg.id);
      this.broadcast({ type: "deleted", id: msg.id });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed, or a reserved code (1005/1006) that can't be echoed.
    }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastPresence(ws);
  }

  // One entry per player, however many tabs they have open.
  private presence(leaving?: WebSocket): PresentUser[] {
    const now = Date.now();
    const users = new Map<string, PresentUser>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === leaving) continue;
      const user = ws.deserializeAttachment() as ChatUser | null;
      if (!user) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (Math.max(user.connectedAt, lastPing) < now - STALE_MS) continue;
      users.set(user.userId, { user_id: user.userId, username: user.username, avatar_v: user.avatarV });
    }
    return [...users.values()];
  }

  private broadcastPresence(leaving?: WebSocket) {
    this.broadcast({ type: "presence", users: this.presence(leaving) }, leaving);
  }

  private broadcast(payload: unknown, skip?: WebSocket) {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      try {
        ws.send(data);
      } catch {
        // Socket mid-close; its webSocketClose will clean it up.
      }
    }
  }
}
