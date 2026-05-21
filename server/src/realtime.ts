import type { Server as HttpServer } from 'node:http'
import { parse as parseCookie } from 'cookie'
import jwt from 'jsonwebtoken'
import { Server as IOServer } from 'socket.io'
import { env } from './env.js'
import { pool } from './db/pool.js'

const COOKIE = 'dispo_session'

type SessionPayload = { userId: string; workspaceId: string }

declare module 'socket.io' {
  interface SocketData {
    userId: string
    workspaceId: string
  }
}

let io: IOServer | null = null

export function getIO(): IOServer {
  if (!io) throw new Error('Socket.IO not initialised')
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

    // Every socket joins its user room. We use this for targeted events
    // like "you've been added to a group" (server emits to user room, all
    // open tabs/devices of that user receive it).
    socket.join(roomForUser(userId))

    // Pre-subscribe to every group the user is currently a member of, so
    // messages broadcast to group rooms reach them without an explicit join.
    try {
      const { rows } = await pool.query<{ group_id: string }>(
        'select group_id from group_members where user_id = $1',
        [userId],
      )
      for (const r of rows) socket.join(roomForGroup(r.group_id))
    } catch (err) {
      // Log but don't kill the socket — they can still send/receive on
      // group rooms they join later.
      console.error('failed to preload rooms for', userId, err)
    }

    socket.emit('ready', { userId })

    // Heartbeat / liveness probe useful from the browser console.
    socket.on('ping:client', (cb?: (t: number) => void) => {
      if (typeof cb === 'function') cb(Date.now())
    })

    socket.on('disconnect', () => {
      // Socket.IO leaves rooms automatically on disconnect — nothing to do.
    })
  })

  return io
}

/**
 * Add a socket's user to a group room across all their open connections,
 * so live updates start reaching every tab/device. Call after a new
 * group_members row is inserted.
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
