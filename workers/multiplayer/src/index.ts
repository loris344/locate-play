import { DurableObject } from "cloudflare:workers";

interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Test-only overrides (wrangler dev --var ...); never set in production.
  ROUND_SECONDS?: string;
  REVEAL_SECONDS?: string;
}

const TOTAL_ROUNDS = 5;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
// Free accounts get one multiplayer game per UTC day (on top of their solo
// one) - unless the room's host is Premium, in which case nobody in the
// room is limited. Enforced when a room is created, when a player joins,
// and again when the host presses start.
const MAX_DAILY_MULTI_GAMES = 1;
const ROUND_TIME = 120; // seconds, same as the solo game (RoundTimer.tsx)
const REVEAL_TIME = 20;
const INTRO_MS = 2500; // the "Find <actor>" splash before each round, as in solo
// Guesses are still accepted this long after the deadline, to absorb the
// network delay of one sent right as the client's timer hit zero.
const GRACE_MS = 3000;
// A host who drops out of the lobby (page refresh, mostly) gets this long
// to come back before hosting passes to the next player.
const HOST_HANDOVER_MS = 15_000;
const ROOM_IDLE_MS = 2 * 60 * 60_000;
const FINISHED_ROOM_MS = 30 * 60_000;
const MAX_SCORE_PER_ROUND = 5000;
const TIMEOUT_DISTANCE_KM = 20000;
const LIMIT_MESSAGE =
  "You've used today's free multiplayer game. Play in a room hosted by a Premium player, or go Premium for unlimited games.";
// Close codes the client tells apart from a dropped connection.
const CLOSE_UNAUTHORIZED = 4001; // refresh the Supabase session once, then retry
const CLOSE_REJECTED = 4003; // an {type:"error"} message explains why; don't retry
const CLOSE_ROOM_GONE = 4005;
// No I, O, 0, 1: codes get read out loud and typed on phones.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE = /^[A-Z2-9]{5}$/;
const AVATAR_VERSION = /^[0-9a-z]{1,20}$/;
const USER_ID = /^[0-9a-f-]{36}$/;

interface PlayerIdentity {
  userId: string;
  username: string;
  // The ?v= cache-buster of the player's profile photo (see Account.tsx),
  // or null when they haven't uploaded one.
  avatarV: string | null;
}

interface RoundResult {
  lat: number | null;
  lng: number | null;
  distance: number;
  score: number;
  baseScore: number;
  timeMultiplier: number;
  elapsed: number;
  timedOut: boolean;
}

interface Player extends PlayerIdentity {
  isPremium: boolean;
  joinedAt: number;
  // Part of the game being played (joined before it started and was
  // allowed to play). Others wait for the next one.
  inGame: boolean;
  sessionId: string | null; // this player's game_sessions row for the current game
  total: number;
  rounds: (RoundResult | null)[];
}

interface RoomVideo {
  id: string;
  video_url: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  actor_name?: string | null;
  actor_photo_url?: string | null;
  source_url?: string | null;
  clues?: unknown[] | null;
}

type RoomStatus = "lobby" | "guessing" | "reveal" | "finished";

interface Room {
  code: string;
  hostId: string;
  hostPremium: boolean;
  hostLeftAt: number | null;
  status: RoomStatus;
  players: Record<string, Player>;
  order: string[]; // join order
  videos: RoomVideo[];
  round: number;
  roundStartsAt: number;
  roundEndsAt: number;
  revealEndsAt: number;
  createdAt: number;
  updatedAt: number;
}

interface Attachment {
  userId: string;
  connId: string;
}

// --- Scoring (same rules as the solo game's submit-round) ------------------

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateScore(distance: number): number {
  if (distance < 25) return MAX_SCORE_PER_ROUND;
  return Math.max(0, Math.round(MAX_SCORE_PER_ROUND * Math.exp(-distance / 500)));
}

function getTimeMultiplier(elapsedSeconds: number, roundTime: number): number {
  if (elapsedSeconds >= roundTime) return 0;
  if (elapsedSeconds < 20) return 1.5;
  if (elapsedSeconds < 60) return 1.2;
  if (elapsedSeconds < 90) return 1.0;
  return 0.7;
}

function pickVideos(all: RoomVideo[], seen: string[]): RoomVideo[] | null {
  let available = all.filter((v) => !seen.includes(v.id));
  if (available.length < TOTAL_ROUNDS) available = all;
  if (available.length < TOTAL_ROUNDS) return null;
  return [...available].sort(() => Math.random() - 0.5).slice(0, TOTAL_ROUNDS);
}

// --- Supabase (REST, service role) ------------------------------------------

async function sb<T>(env: Env, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

function utcDayRange() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + 86_400_000).toISOString() };
}

async function premiumUsers(env: Env, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await sb<{ user_id: string; status: string; expires_at: string | null }[]>(
    env,
    `subscriptions?select=user_id,status,expires_at&user_id=in.(${userIds.join(",")})`,
  );
  return new Set(
    rows
      .filter((s) => s.status === "active" && (!s.expires_at || new Date(s.expires_at) > new Date()))
      .map((s) => s.user_id),
  );
}

// Multiplayer games each of these players has already started today that
// count toward the free quota (i.e. in rooms with a free host).
async function multiGamesToday(env: Env, userIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;
  const { startIso, endIso } = utcDayRange();
  const rows = await sb<{ user_id: string }[]>(
    env,
    `game_sessions?select=user_id&mode=eq.multi&quota_exempt=is.false` +
      `&created_at=gte.${encodeURIComponent(startIso)}&created_at=lt.${encodeURIComponent(endIso)}` +
      `&user_id=in.(${userIds.join(",")})`,
  );
  for (const row of rows) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  return counts;
}

async function overFreeLimit(env: Env, userId: string): Promise<boolean> {
  return ((await multiGamesToday(env, [userId])).get(userId) ?? 0) >= MAX_DAILY_MULTI_GAMES;
}

// --- Supabase access token verification -----------------------------------
// The project signs access tokens with an asymmetric (ES256) key, so they can
// be checked here with its public key alone. The JWKS is fetched at most
// once per isolate.

interface Claims {
  sub?: string;
  exp?: number;
  iss?: string;
  role?: string;
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

async function verifyToken(token: string, env: Env): Promise<Omit<PlayerIdentity, "avatarV"> | null> {
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

    return { userId: claims.sub, username };
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

// --- Worker entry: /api/multiplayer* ----------------------------------------

// Accepting then closing with our own code (and an error message first)
// lets the client tell "rejected, and why" apart from "network dropped",
// which a plain HTTP error would reach it as (an opaque 1006 close).
function rejectSocket(closeCode: number, errorCode: string, message?: string): Response {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  if (message) server.send(JSON.stringify({ type: "error", code: errorCode, message }));
  server.close(closeCode, errorCode);
  return new Response(null, { status: 101, webSocket: client });
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const avatarUserId = url.pathname.match(/^\/api\/multiplayer\/avatar\/([^/]+)$/)?.[1];
    if (avatarUserId && request.method === "GET") {
      if (!USER_ID.test(avatarUserId)) return new Response("Not found", { status: 404 });
      return serveAvatar(request, ctx, avatarUserId, env);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }

    const token = url.searchParams.get("token");
    const verified = token ? await verifyToken(token, env) : null;
    if (!verified) return rejectSocket(CLOSE_UNAUTHORIZED, "unauthorized");

    // The photo version comes from the client (it reads its own profile).
    // It can only ever point at this user's own avatar path, so there's
    // nothing to spoof.
    const v = url.searchParams.get("v");
    const player: PlayerIdentity = { ...verified, avatarV: v && AVATAR_VERSION.test(v) ? v : null };

    // Verified here, in the Worker, so unauthenticated sockets never reach
    // (or wake) a Durable Object. Rooms are only reachable through this
    // Worker, so they can trust these headers.
    const headers = new Headers(request.headers);
    headers.set("X-Player", JSON.stringify(player));

    if (url.searchParams.get("create") === "1") {
      // A fresh code, retried on the (very unlikely) collision with a live room.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        headers.set("X-Room-Action", "create");
        headers.set("X-Room-Code", code);
        const res = await env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code)).fetch(new Request(request, { headers }));
        if (res.status !== 409) return res;
      }
      return new Response("Could not allocate a room", { status: 503 });
    }

    const code = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM_CODE.test(code)) {
      return rejectSocket(CLOSE_REJECTED, "room_not_found", "That's not a valid room code.");
    }
    headers.set("X-Room-Action", "join");
    headers.set("X-Room-Code", code);
    return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code)).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;

// --- A room -----------------------------------------------------------------
// One Durable Object per room code. The whole room is one JSON value in
// storage, reloaded when the object wakes up; sockets are hibernatable, so
// an idle lobby costs nothing. Alarms drive everything time-based: round
// deadlines, the pause between rounds, host handover and room expiry.

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  // Sockets on their way out: still listed by getWebSockets() while their
  // close is being handled, but nobody should count them as present.
  private gone = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>("room")) ?? null;
    });
  }

  private roundMs() {
    return (Number(this.env.ROUND_SECONDS) || ROUND_TIME) * 1000;
  }

  private revealMs() {
    return (Number(this.env.REVEAL_SECONDS) || REVEAL_TIME) * 1000;
  }

  async fetch(request: Request): Promise<Response> {
    const player = JSON.parse(request.headers.get("X-Player") ?? "null") as PlayerIdentity | null;
    const action = request.headers.get("X-Room-Action");
    const code = request.headers.get("X-Room-Code") ?? "";
    if (!player || !action) return new Response("Bad request", { status: 400 });

    if (this.room && this.expired(this.room)) await this.closeRoom();

    if (action === "create") {
      if (this.room) return new Response("taken", { status: 409 });

      const premium = (await premiumUsers(this.env, [player.userId])).has(player.userId);
      if (!premium && (await overFreeLimit(this.env, player.userId))) {
        return rejectSocket(CLOSE_REJECTED, "multi_limit", LIMIT_MESSAGE);
      }

      const now = Date.now();
      this.room = {
        code,
        hostId: player.userId,
        hostPremium: premium,
        hostLeftAt: null,
        status: "lobby",
        players: {},
        order: [],
        videos: [],
        round: 0,
        roundStartsAt: 0,
        roundEndsAt: 0,
        revealEndsAt: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.addPlayer(player, premium);
    } else {
      const room = this.room;
      if (!room) {
        return rejectSocket(CLOSE_REJECTED, "room_not_found", "This room doesn't exist, or has closed.");
      }
      const existing = room.players[player.userId];
      if (existing) {
        existing.username = player.username;
        existing.avatarV = player.avatarV;
        if (player.userId === room.hostId) room.hostLeftAt = null;
      } else {
        if (room.status !== "lobby" && room.status !== "finished") {
          return rejectSocket(
            CLOSE_REJECTED,
            "in_progress",
            "A game is in progress in this room. Ask the host to invite you again for the next one.",
          );
        }
        if (room.order.length >= MAX_PLAYERS) {
          return rejectSocket(CLOSE_REJECTED, "room_full", `This room is full (${MAX_PLAYERS} players max).`);
        }
        const premium = (await premiumUsers(this.env, [player.userId])).has(player.userId);
        if (!premium && !room.hostPremium && (await overFreeLimit(this.env, player.userId))) {
          return rejectSocket(CLOSE_REJECTED, "multi_limit", LIMIT_MESSAGE);
        }
        this.addPlayer(player, premium);
      }
    }

    // A second tab, or a reconnect after a refresh, replaces the old socket.
    for (const ws of this.socketsOf(player.userId)) {
      this.gone.add(ws);
      try {
        ws.close(1000, "replaced");
      } catch {
        // Already closing.
      }
    }

    const [client, server] = Object.values(new WebSocketPair());
    // Hibernatable: idle sockets don't keep the object (and its billing) awake.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: player.userId, connId: crypto.randomUUID() } satisfies Attachment);
    await this.commit();
    return new Response(null, { status: 101, webSocket: client });
  }

  private addPlayer(identity: PlayerIdentity, isPremium: boolean) {
    const room = this.room!;
    room.players[identity.userId] = {
      ...identity,
      isPremium,
      joinedAt: Date.now(),
      inGame: false,
      sessionId: null,
      total: 0,
      rounds: [],
    };
    room.order.push(identity.userId);
  }

  private removePlayer(userId: string) {
    const room = this.room!;
    delete room.players[userId];
    room.order = room.order.filter((id) => id !== userId);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const room = this.room;
    if (!room) return;
    const { userId } = ws.deserializeAttachment() as Attachment;
    const player = room.players[userId];
    if (!player) return;

    let msg: { type?: string; lat?: unknown; lng?: unknown; seenVideoIds?: unknown };
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    switch (msg.type) {
      case "start": {
        if (userId !== room.hostId) return this.sendError(ws, "not_host", "Only the host can start the game.");
        if (room.status !== "lobby" && room.status !== "finished") return;
        const seen = Array.isArray(msg.seenVideoIds) ? msg.seenVideoIds.filter((id) => typeof id === "string") : [];
        await this.startGame(ws, seen);
        return;
      }
      case "guess":
        await this.guess(player, msg.lat, msg.lng);
        return;
      case "next":
        if (userId !== room.hostId || room.status !== "reveal") return;
        await this.advance();
        return;
      case "again":
        if (userId !== room.hostId || room.status !== "finished") return;
        this.backToLobby();
        await this.commit();
        return;
    }
  }

  private async startGame(hostWs: WebSocket, seen: string[]) {
    const room = this.room!;
    const connected = room.order.filter((id) => this.isConnected(id));
    if (connected.length < MIN_PLAYERS) {
      return this.sendError(hostWs, "not_enough_players", "You need at least 2 players to start.");
    }

    // Re-checked at every start: subscriptions come and go while a room
    // is open, and the room may be on its second or third game.
    const premium = await premiumUsers(this.env, connected);
    room.hostPremium = premium.has(room.hostId);
    for (const id of connected) room.players[id].isPremium = premium.has(id);

    let eligible = connected;
    if (!room.hostPremium) {
      const free = connected.filter((id) => !premium.has(id));
      const used = await multiGamesToday(this.env, free);
      if ((used.get(room.hostId) ?? 0) >= MAX_DAILY_MULTI_GAMES) {
        return this.sendError(hostWs, "multi_limit", LIMIT_MESSAGE);
      }
      const blocked = free.filter((id) => (used.get(id) ?? 0) >= MAX_DAILY_MULTI_GAMES);
      eligible = connected.filter((id) => !blocked.includes(id));
      if (eligible.length < MIN_PLAYERS) {
        return this.sendError(
          hostWs,
          "not_enough_players",
          `${blocked.length === 1 ? "A player has" : `${blocked.length} players have`} used today's free multiplayer game, ` +
            "so there aren't enough players left to start. Go Premium to lift the limit for everyone in your room.",
        );
      }
      // They were let in before using up today's game elsewhere; out they go.
      for (const id of blocked) {
        for (const ws of this.socketsOf(id)) {
          this.sendError(ws, "multi_limit", LIMIT_MESSAGE);
          ws.close(CLOSE_REJECTED, "multi_limit");
        }
        this.removePlayer(id);
      }
    }

    const all = await sb<RoomVideo[]>(
      this.env,
      "videos?select=id,video_url,latitude,longitude,city,country,actor_name,actor_photo_url,source_url,clues",
    );
    const videos = pickVideos(all, seen);
    if (!videos) return this.sendError(hostWs, "no_videos", "Not enough videos available right now.");

    // One session per player, written at start (not at the end) so that
    // quitting mid-game still uses up the day's free multiplayer game -
    // the same rule game-start applies to solo games.
    const rows = await sb<{ id: string; user_id: string }[]>(this.env, "game_sessions", {
      method: "POST",
      prefer: "return=representation",
      body: eligible.map((id) => ({
        user_id: id,
        video_ids: videos.map((v) => v.id),
        mode: "multi",
        quota_exempt: room.hostPremium,
        room_code: room.code,
      })),
    });

    for (const id of room.order) {
      const p = room.players[id];
      const row = rows.find((r) => r.user_id === id);
      p.inGame = !!row;
      p.sessionId = row?.id ?? null;
      p.total = 0;
      p.rounds = Array(TOTAL_ROUNDS).fill(null);
    }
    room.videos = videos;
    room.round = 0;
    this.startRound();
    await this.commit();
  }

  private startRound() {
    const room = this.room!;
    const now = Date.now();
    room.status = "guessing";
    room.roundStartsAt = now + INTRO_MS;
    room.roundEndsAt = room.roundStartsAt + this.roundMs();
    room.revealEndsAt = 0;
  }

  private async guess(player: Player, lat: unknown, lng: unknown) {
    const room = this.room!;
    if (room.status !== "guessing" || !player.inGame || player.rounds[room.round]) return;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const now = Date.now();
    if (now > room.roundEndsAt + GRACE_MS) return; // the alarm is about to time this round out

    const video = room.videos[room.round];
    const elapsed = Math.max(0, (now - room.roundStartsAt) / 1000);
    const distance = haversineDistance(lat, lng, video.latitude, video.longitude);
    const baseScore = calculateScore(distance);
    const timeMultiplier = getTimeMultiplier(elapsed, this.roundMs() / 1000);
    const score = Math.round(baseScore * timeMultiplier);
    player.rounds[room.round] = { lat, lng, distance, score, baseScore, timeMultiplier, elapsed, timedOut: timeMultiplier === 0 };
    player.total += score;

    if (this.everyoneGuessed()) this.reveal();
    await this.commit();
  }

  // Everyone still connected has answered; the disconnected are timed out.
  private everyoneGuessed(): boolean {
    const room = this.room!;
    return room.order
      .filter((id) => room.players[id].inGame && this.isConnected(id))
      .every((id) => room.players[id].rounds[room.round]);
  }

  private reveal() {
    const room = this.room!;
    for (const id of room.order) {
      const p = room.players[id];
      if (p.inGame && !p.rounds[room.round]) {
        p.rounds[room.round] = {
          lat: null,
          lng: null,
          distance: TIMEOUT_DISTANCE_KM,
          score: 0,
          baseScore: 0,
          timeMultiplier: 0,
          elapsed: this.roundMs() / 1000,
          timedOut: true,
        };
      }
    }
    room.status = "reveal";
    room.revealEndsAt = Date.now() + this.revealMs();
  }

  private async advance() {
    const room = this.room!;
    if (room.round + 1 >= TOTAL_ROUNDS) {
      await this.finishGame();
      return;
    }
    room.round += 1;
    this.startRound();
    await this.commit();
  }

  private async finishGame() {
    const room = this.room!;
    room.status = "finished";
    // Players see the podium right away; the database catches up after.
    await this.commit();

    const played = room.order.map((id) => room.players[id]).filter((p) => p.inGame && p.sessionId);
    const videoIds = room.videos.map((v) => v.id);
    try {
      await Promise.all(
        played.map((p) =>
          sb(this.env, `game_sessions?id=eq.${p.sessionId}`, {
            method: "PATCH",
            prefer: "return=minimal",
            body: { rounds_completed: TOTAL_ROUNDS, total_score: p.total, finished: true, scored_video_ids: videoIds },
          }),
        ),
      );
      if (played.length > 0) {
        await sb(this.env, "game_scores", {
          method: "POST",
          prefer: "return=minimal",
          body: played.map((p) => ({ user_id: p.userId, total_score: p.total })),
        });
      }
    } catch (err) {
      console.error(`Room ${room.code}: could not save results`, err);
    }
  }

  private backToLobby() {
    const room = this.room!;
    room.status = "lobby";
    room.videos = [];
    room.round = 0;
    room.roundStartsAt = 0;
    room.roundEndsAt = 0;
    room.revealEndsAt = 0;
    for (const id of [...room.order]) {
      if (!this.isConnected(id)) {
        this.removePlayer(id);
        continue;
      }
      const p = room.players[id];
      p.inGame = false;
      p.sessionId = null;
      p.total = 0;
      p.rounds = [];
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed, or a reserved code (1005/1006) that can't be echoed.
    }
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.socketGone(ws);
  }

  private async socketGone(ws: WebSocket) {
    this.gone.add(ws);
    const room = this.room;
    if (!room) return;
    const { userId } = ws.deserializeAttachment() as Attachment;
    if (!room.players[userId] || this.isConnected(userId)) return; // another tab of theirs is still open

    if (userId === room.hostId) {
      if (room.status === "lobby" || room.status === "finished") room.hostLeftAt = Date.now();
    } else if (room.status === "lobby") {
      this.removePlayer(userId);
    }
    // Mid-game, a player who drops out stays in the game (timing out each
    // round) and can come back with the room code.
    if (room.status === "guessing" && this.everyoneGuessed()) this.reveal();
    await this.commit();
  }

  async alarm() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();

    if (this.expired(room)) {
      await this.closeRoom();
      return;
    }
    if (room.status === "guessing" && now >= room.roundEndsAt + GRACE_MS) {
      this.reveal();
    } else if (room.status === "reveal" && now >= room.revealEndsAt) {
      await this.advance();
      return;
    } else if (
      (room.status === "lobby" || room.status === "finished") &&
      room.hostLeftAt !== null &&
      now - room.hostLeftAt >= HOST_HANDOVER_MS &&
      !this.isConnected(room.hostId)
    ) {
      const next = room.order.find((id) => this.isConnected(id));
      if (!next) {
        await this.closeRoom();
        return;
      }
      this.removePlayer(room.hostId);
      room.hostId = next;
      room.hostPremium = room.players[next].isPremium;
      room.hostLeftAt = null;
    }
    await this.commit();
  }

  private expired(room: Room): boolean {
    const idle = room.status === "finished" ? FINISHED_ROOM_MS : ROOM_IDLE_MS;
    return Date.now() >= room.updatedAt + idle;
  }

  private async closeRoom() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_ROOM_GONE, "room_closed");
      } catch {
        // Already closing.
      }
    }
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // Saves, re-arms the alarm for whatever comes next, and tells everyone.
  private async commit() {
    const room = this.room;
    if (!room) return;
    room.updatedAt = Date.now();
    await this.ctx.storage.put("room", room);

    const wakeups = [room.updatedAt + (room.status === "finished" ? FINISHED_ROOM_MS : ROOM_IDLE_MS)];
    if (room.status === "guessing") wakeups.push(room.roundEndsAt + GRACE_MS);
    if (room.status === "reveal") wakeups.push(room.revealEndsAt);
    if ((room.status === "lobby" || room.status === "finished") && room.hostLeftAt !== null) {
      wakeups.push(room.hostLeftAt + HOST_HANDOVER_MS);
    }
    await this.ctx.storage.setAlarm(Math.min(...wakeups));

    this.broadcast(this.snapshot());
  }

  // What every client sees. Answers (coordinates, city) only go out once
  // the round is revealed; before that, only who has already guessed.
  private snapshot() {
    const room = this.room!;
    const video = room.videos[room.round];
    const revealedRounds = room.status === "lobby" ? 0 : room.status === "guessing" ? room.round : room.round + 1;
    return {
      type: "state",
      now: Date.now(),
      code: room.code,
      hostId: room.hostId,
      hostPremium: room.hostPremium,
      status: room.status,
      round: room.round,
      totalRounds: TOTAL_ROUNDS,
      roundStartsAt: room.roundStartsAt,
      roundEndsAt: room.roundEndsAt,
      revealEndsAt: room.revealEndsAt,
      videoIds: room.videos.map((v) => v.id),
      video:
        room.status === "lobby" || !video
          ? null
          : {
              id: video.id,
              video_url: video.video_url,
              actor_name: video.actor_name ?? null,
              actor_photo_url: video.actor_photo_url ?? null,
              source_url: video.source_url ?? null,
              ...(room.status !== "guessing"
                ? { city: video.city, country: video.country, lat: video.latitude, lng: video.longitude, clues: video.clues ?? [] }
                : {}),
            },
      players: room.order.map((id) => {
        const p = room.players[id];
        return {
          userId: id,
          username: p.username,
          avatarV: p.avatarV,
          isPremium: p.isPremium,
          isHost: id === room.hostId,
          connected: this.isConnected(id),
          inGame: p.inGame,
          total: p.total,
          guessed: room.status === "guessing" && !!p.rounds[room.round],
          rounds: p.rounds.slice(0, revealedRounds),
        };
      }),
    };
  }

  private liveSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !this.gone.has(ws));
  }

  private socketsOf(userId: string): WebSocket[] {
    return this.liveSockets().filter((ws) => (ws.deserializeAttachment() as Attachment).userId === userId);
  }

  private isConnected(userId: string): boolean {
    return this.socketsOf(userId).length > 0;
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    try {
      ws.send(JSON.stringify({ type: "error", code, message }));
    } catch {
      // Socket mid-close.
    }
  }

  private broadcast(payload: unknown) {
    const data = JSON.stringify(payload);
    for (const ws of this.liveSockets()) {
      try {
        ws.send(data);
      } catch {
        // Socket mid-close; its webSocketClose will clean it up.
      }
    }
  }
}
