import type { Server as HttpServer } from 'node:http'
import { parse as parseCookie } from 'cookie'
import jwt from 'jsonwebtoken'
import { Server as IOServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { env, isProd } from './env.js'
import { pool } from './db/pool.js'
import { log } from './util/log.js'

const COOKIE = 'dispo_session'

type SessionPayload = { userId: string; workspaceId: string }

declare module 'socket.io' {
  interface SocketData {
    userId: string
    workspaceId: string
    // Resolved once on connect so typing relays can carry a name without a
    // per-keystroke DB lookup.
    displayName: string
  }
}

let io: IOServer | null = null

// ── Presence (online/offline) ──────────────────────────────────────────────
// In-memory online set: userId → number of live sockets (a user may have
// several tabs/devices). A user is "online" while the count is > 0. This is
// PER-INSTANCE — correct for the current single-instance deploy. For multi-
// instance, the online set would need to live in Redis (pub/sub the deltas);
// the broadcast below already fans out across instances via the Redis adapter,
// but the snapshot only knows locally-connected users. TODO(prod multi-instance).
const onlineCounts = new Map<string, number>()

function isOnline(userId: string): boolean {
  return (onlineCounts.get(userId) ?? 0) > 0
}

// Users who share at least one group (incl. DMs) with the given user — i.e.
// everyone who should see their presence.
async function coMemberIds(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `select distinct gm2.user_id
       from group_members gm1
       join group_members gm2 on gm2.group_id = gm1.group_id
      where gm1.user_id = $1 and gm2.user_id <> $1`,
    [userId],
  )
  return rows.map((r) => r.user_id)
}

// Tell a user's peers that their online state changed.
async function broadcastPresence(userId: string, online: boolean): Promise<void> {
  if (!io) return
  try {
    const peers = await coMemberIds(userId)
    for (const peerId of peers) {
      io.to(roomForUser(peerId)).emit('presence:update', { userId, online })
    }
  } catch (err) {
    log.error('presence_broadcast_failed', { userId, message: String((err as Error)?.message ?? err) })
  }
}

// Send a freshly-connected (or re-syncing) socket the current online state of
// its peers, so it doesn't have to wait for the next transition to learn who's
// online right now.
async function sendPresenceSnapshot(
  emit: (online: string[]) => void,
  userId: string,
): Promise<void> {
  try {
    const peers = await coMemberIds(userId)
    emit(peers.filter(isOnline))
  } catch (err) {
    log.error('presence_snapshot_failed', { userId, message: String((err as Error)?.message ?? err) })
  }
}

export function getIO(): IOServer {
  if (!io) throw new Error('Socket.IO not initialised')
  return io
}

// Like getIO but returns null instead of throwing when realtime isn't running
// (e.g. inside a one-off maintenance script such as the preview backfill, which
// imports the preview core but never starts the HTTP/Socket.IO server). Lets
// shared code emit "if a server is up" without crashing in script contexts.
export function getIOIfReady(): IOServer | null {
  return io
}

export function roomForGroup(groupId: string): string {
  return `group:${groupId}`
}

export function roomForUser(userId: string): string {
  return `user:${userId}`
}

export async function initRealtime(httpServer: HttpServer) {
  io = new IOServer(httpServer, {
    // In production the web bundle is served from the same origin as the API,
    // so no CORS is needed (and explicitly disabling it shrinks attack
    // surface). In dev the browser hits :5173 → API on :3001 and needs an
    // explicit allow with credentials so the cookie crosses.
    ...(env.NODE_ENV === 'production'
      ? {}
      : { cors: { origin: 'http://localhost:5173', credentials: true } }),
    // Sane defaults. ping interval keeps proxies happy; max payload guards
    // against accidental floods.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 256 * 1024, // 256 KB ceiling for any single ws frame
  })

  // ── Horizontal scaling ────────────────────────────────────────────────────
  // With more than one API instance behind a load balancer, a client's socket
  // lives on whichever instance it happened to connect to. The default in-
  // memory adapter only knows about sockets on the local process, so an event
  // emitted from instance A (e.g. message:new broadcast to a group room) would
  // never reach a member whose socket is on instance B. The Redis adapter fixes
  // this by pub/sub-ing every cross-room operation between instances, so
  // `io.to(room).emit(...)` AND `io.in(room).socketsJoin/Leave(...)` all behave
  // as if there were a single process. Opt-in via REDIS_URL; unset = single
  // -instance in-memory adapter (correct for local dev).
  await attachRedisAdapter(io)

  // ── Auth ────────────────────────────────────────────────────────────────
  // The handshake carries the same httpOnly JWT cookie that REST uses.
  // Verify it here; reject the connection cleanly if invalid. We attach
  // userId/workspaceId to socket.data so handlers don't re-decode the JWT.
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie
      if (!raw) return next(new Error('unauthenticated'))
      const cookies = parseCookie(raw)
      const token = cookies[COOKIE]
      if (!token) return next(new Error('unauthenticated'))
      const payload = jwt.verify(token, env.JWT_SECRET) as SessionPayload
      socket.data.userId = payload.userId
      socket.data.workspaceId = payload.workspaceId
      return next()
    } catch {
      return next(new Error('unauthenticated'))
    }
  })

  // ── Connection lifecycle ────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const { userId } = socket.data

    log.info('socket_connect', { userId, connections: io?.engine.clientsCount })

    // Every socket joins its user room. We use this for targeted events
    // like "you've been added to a group" (server emits to user room, all
    // open tabs/devices of that user receive it).
    socket.join(roomForUser(userId))

    // Pre-subscribe to every group the user is currently a member of, so
    // messages broadcast to group rooms reach them without an explicit join.
    // Resolve the display name in the same trip for typing relays.
    try {
      const [{ rows: groups }, { rows: users }] = await Promise.all([
        pool.query<{ group_id: string }>(
          'select group_id from group_members where user_id = $1',
          [userId],
        ),
        pool.query<{ display_name: string }>(
          'select display_name from users where id = $1',
          [userId],
        ),
      ])
      for (const r of groups) socket.join(roomForGroup(r.group_id))
      socket.data.displayName = users[0]?.display_name ?? 'Someone'
    } catch (err) {
      // Log but don't kill the socket — they can still send/receive on
      // group rooms they join later.
      console.error('failed to preload rooms for', userId, err)
      socket.data.displayName = 'Someone'
    }

    socket.emit('ready', { userId })

    // ── Presence ────────────────────────────────────────────────────────────
    // Bump this user's live-socket count. On the 0→1 transition they just came
    // online — tell their peers. Either way, send THIS socket a snapshot of who
    // among its peers is online right now.
    const prevCount = onlineCounts.get(userId) ?? 0
    onlineCounts.set(userId, prevCount + 1)
    if (prevCount === 0) void broadcastPresence(userId, true)
    void sendPresenceSnapshot((online) => socket.emit('presence:snapshot', { online }), userId)

    // Client asks for a fresh snapshot (on mount / after a reconnect) — the
    // snapshot it got on connect may have been missed if its listener wasn't
    // attached yet.
    socket.on('presence:sync', () => {
      void sendPresenceSnapshot((online) => socket.emit('presence:snapshot', { online }), userId)
    })

    // Heartbeat / liveness probe useful from the browser console.
    socket.on('ping:client', (cb?: (t: number) => void) => {
      if (typeof cb === 'function') cb(Date.now())
    })

    // ── Typing indicator ──────────────────────────────────────────────────
    // Relay typing state to the rest of the group room (never echoed back to
    // the sender). Gated on actual room membership so a client can't spam a
    // group it isn't in. `socket.to(room)` excludes this socket; ephemeral —
    // nothing is persisted.
    const relayTyping = (raw: unknown, typing: boolean) => {
      const groupId = (raw as { groupId?: unknown })?.groupId
      if (typeof groupId !== 'string') return
      const room = roomForGroup(groupId)
      if (!socket.rooms.has(room)) return
      socket.to(room).emit('typing', {
        groupId,
        userId,
        name: socket.data.displayName,
        typing,
      })
    }
    socket.on('typing:start', (p: unknown) => relayTyping(p, true))
    socket.on('typing:stop', (p: unknown) => relayTyping(p, false))

    socket.on('disconnect', () => {
      // Socket.IO leaves rooms automatically on disconnect. Decrement the
      // live-socket count; on the 1→0 transition the user went fully offline —
      // tell their peers.
      const prev = onlineCounts.get(userId) ?? 1
      const next = prev - 1
      if (next <= 0) {
        onlineCounts.delete(userId)
        void broadcastPresence(userId, false)
      } else {
        onlineCounts.set(userId, next)
      }
      log.info('socket_disconnect', { userId, connections: io?.engine.clientsCount })
    })
  })

  return io
}

// Wire the Socket.IO Redis adapter when REDIS_URL is configured.
//
// Behaviour by environment:
//   • REDIS_URL unset, dev  → in-memory adapter (local dev needs no Redis).
//   • REDIS_URL unset, prod → in-memory adapter, but log a WARNING: this is
//     single-instance only; multi-instance realtime requires REDIS_URL.
//   • REDIS_URL set, connects → Redis adapter (multi-instance ready).
//   • REDIS_URL set, connect FAILS in prod → throw and abort startup. We never
//     silently degrade to in-memory in production: a partial fan-out is worse
//     than a hard failure the orchestrator can surface/restart.
//   • REDIS_URL set, connect FAILS in dev → warn and fall back (don't block
//     local work on a flaky local Redis).
//
// 'error' listeners are attached so a transient post-connect blip can't crash
// the process with an unhandled error event (node-redis reconnects on its own).
async function attachRedisAdapter(server: IOServer): Promise<void> {
  if (!env.REDIS_URL) {
    if (isProd) {
      log.warn('redis_adapter_disabled_prod', {
        note: 'REDIS_URL unset — single-instance only; set REDIS_URL for multi-instance realtime',
      })
    } else {
      log.info('redis_adapter_disabled_dev', {
        note: 'REDIS_URL unset — in-memory adapter (local dev)',
      })
    }
    return
  }
  try {
    const pubClient = createClient({ url: env.REDIS_URL })
    const subClient = pubClient.duplicate()
    pubClient.on('error', (err) =>
      log.error('redis_pub_error', { message: String((err as Error)?.message ?? err) }),
    )
    subClient.on('error', (err) =>
      log.error('redis_sub_error', { message: String((err as Error)?.message ?? err) }),
    )
    await Promise.all([pubClient.connect(), subClient.connect()])
    server.adapter(createAdapter(pubClient, subClient))
    log.info('redis_adapter_enabled', { multiInstance: true })
  } catch (err) {
    log.error('redis_adapter_connect_failed', {
      message: String((err as Error)?.message ?? err),
    })
    if (isProd) {
      // Fail loudly — do not run production realtime on a degraded adapter.
      throw new Error(
        'REDIS_URL is set but the Redis adapter failed to connect; aborting startup ' +
          '(refusing to fall back to the in-memory adapter in production).',
      )
    }
    log.warn('redis_adapter_fallback_dev', {
      note: 'continuing with in-memory adapter (dev only)',
    })
  }
}

/**
 * Add a socket's user to a group room across all their open connections,
 * so live updates start reaching every tab/device. Call after a new
 * group_members row is inserted.
 *
 * Multi-instance safe with the Redis adapter: socketsJoin is fanned out to
 * every node, so the user's sockets are joined wherever they're connected.
 */
export function subscribeUserToGroup(userId: string, groupId: string) {
  if (!io) return
  // io.in(userRoom) selects all sockets connected for this user across nodes.
  io.in(roomForUser(userId)).socketsJoin(roomForGroup(groupId))
}

/**
 * Inverse of subscribeUserToGroup — call when a user leaves/is removed.
 */
export function unsubscribeUserFromGroup(userId: string, groupId: string) {
  if (!io) return
  io.in(roomForUser(userId)).socketsLeave(roomForGroup(groupId))
}
