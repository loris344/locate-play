import { DurableObject } from "cloudflare:workers";

interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  SUPABASE_URL: string;
  ADMIN_EMAIL: string;
}

const HISTORY_LIMIT = 100;
const MAX_LENGTH = 500;
// A bit under the client's own 2s cooldown, so network jitter between two
// sends the client allowed doesn't get one of them rejected here.
const MIN_GAP_MS = 1500;
// Close code the client treats as "token rejected": it refreshes its
// Supabase session once and reconnects (covers an expired token, and a
// username picked after the current token was issued).
const CLOSE_UNAUTHORIZED = 4001;

interface ChatUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

// A type alias, not an interface: SqlStorage.exec<T> needs T to be
// assignable to a string-indexed record.
type ChatMessage = {
  id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: number;
};

// --- Supabase access token verification -----------------------------------
// The project signs access tokens with an asymmetric (ES256) key, so they can
// be checked here with its public key alone. The JWKS is fetched at most
// once per isolate (and edge-cached for an hour), never per message.

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

  const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
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

async function verifyToken(token: string, env: Env): Promise<ChatUser | null> {
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
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }

    const token = new URL(request.url).searchParams.get("token");
    const user = token ? await verifyToken(token, env) : null;
    if (!user) return rejectSocket();

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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const user: ChatUser = JSON.parse(request.headers.get("X-Chat-User") ?? "null");
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernatable: idle sockets don't keep the object (and its billing) awake.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(user);
    server.send(JSON.stringify({ type: "history", messages: this.history() }));
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
        .exec<{ last: number | null }>("SELECT MAX(created_at) AS last FROM messages WHERE user_id = ?", user.userId)
        .one().last;
      if (last && now - last < MIN_GAP_MS) {
        ws.send(JSON.stringify({ type: "error", error: "Slow down - wait a couple of seconds between messages" }));
        return;
      }

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        user_id: user.userId,
        username: user.username,
        content,
        created_at: now,
      };
      this.sql.exec(
        "INSERT INTO messages (id, user_id, username, content, created_at) VALUES (?, ?, ?, ?, ?)",
        message.id,
        message.user_id,
        message.username,
        message.content,
        message.created_at,
      );
      // Only the latest HISTORY_LIMIT messages are ever shown, so that's all we keep.
      this.sql.exec(
        "DELETE FROM messages WHERE created_at < (SELECT created_at FROM messages ORDER BY created_at DESC LIMIT 1 OFFSET ?)",
        HISTORY_LIMIT - 1,
      );
      this.broadcast({ type: "message", message });
      return;
    }

    if (msg.type === "delete" && typeof msg.id === "string") {
      const row = this.sql.exec<{ user_id: string }>("SELECT user_id FROM messages WHERE id = ?", msg.id).toArray()[0];
      if (!row || (row.user_id !== user.userId && !user.isAdmin)) return;
      this.sql.exec("DELETE FROM messages WHERE id = ?", msg.id);
      this.broadcast({ type: "deleted", id: msg.id });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed, or a reserved code (1005/1006) that can't be echoed.
    }
  }

  private history(): ChatMessage[] {
    return this.sql
      .exec<ChatMessage>(
        "SELECT id, user_id, username, content, created_at FROM messages ORDER BY created_at DESC LIMIT ?",
        HISTORY_LIMIT,
      )
      .toArray()
      .reverse();
  }

  private broadcast(payload: unknown) {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // Socket mid-close; its webSocketClose will clean it up.
      }
    }
  }
}
