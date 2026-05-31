import { getRedisClient } from './redis.js'

// ── Presence storage (memory | redis) ────────────────────────────────────────
//
// Tracks which users have at least one live socket, supporting multiple
// tabs/devices per user. The realtime layer asks this store to record a
// connect/disconnect and tells the caller whether that was a real transition
// (0→1 online, 1→0 offline) so presence:update is broadcast only on edges.
//
//   • MemoryPresence: per-user Set of socket ids. Correct for a single instance
//     (local dev / single-node deploy). Each instance only knows its own
//     sockets — wrong across instances, which is exactly why Redis exists below.
//   • RedisPresence: a per-user sorted set (member = socketId, score = last-seen
//     ms) shared by all instances. Online = the set has a member seen within the
//     stale window. Heartbeats refresh the score; a crashed instance stops
//     refreshing, so its sockets fall out of the window and the user becomes
//     offline to fresh snapshots (and the key TTL eventually removes it).
//
// Both expose the same async interface so realtime.ts doesn't care which is in
// use. Transition detection is done inside an atomic MULTI for Redis, so two
// instances racing on connect/disconnect still see consistent counts.

export interface PresenceStore {
  /** Record a socket as connected. Returns true if the user just came online (0→1). */
  connect(userId: string, socketId: string): Promise<boolean>
  /** Refresh liveness for a still-connected socket (Redis TTL/score). */
  heartbeat(userId: string, socketId: string): Promise<void>
  /** Record a socket as gone. Returns true if the user just went offline (1→0). */
  disconnect(userId: string, socketId: string): Promise<boolean>
  /** Of the given user ids, which are currently online (across all instances). */
  filterOnline(userIds: string[]): Promise<string[]>
}

// A socket is considered stale (its instance likely crashed) after this long
// without a heartbeat; the heartbeat runs comfortably more often than this.
const STALE_MS = 90_000
const KEY_TTL_SEC = 120
export const HEARTBEAT_MS = 30_000

class MemoryPresence implements PresenceStore {
  private sockets = new Map<string, Set<string>>()

  async connect(userId: string, socketId: string): Promise<boolean> {
    let set = this.sockets.get(userId)
    const was = set?.size ?? 0
    if (!set) {
      set = new Set()
      this.sockets.set(userId, set)
    }
    set.add(socketId)
    return was === 0
  }

  async heartbeat(): Promise<void> {
    // No TTL in memory — nothing to refresh.
  }

  async disconnect(userId: string, socketId: string): Promise<boolean> {
    const set = this.sockets.get(userId)
    if (!set) return false
    set.delete(socketId)
    if (set.size === 0) {
      this.sockets.delete(userId)
      return true
    }
    return false
  }

  async filterOnline(userIds: string[]): Promise<string[]> {
    return userIds.filter((id) => (this.sockets.get(id)?.size ?? 0) > 0)
  }
}

type RedisCmd = NonNullable<ReturnType<typeof getRedisClient>>

class RedisPresence implements PresenceStore {
  constructor(private client: RedisCmd) {}

  private key(userId: string): string {
    return `presence:user:${userId}`
  }

  async connect(userId: string, socketId: string): Promise<boolean> {
    const now = Date.now()
    const k = this.key(userId)
    // Atomic: drop stale members, read the live count BEFORE adding this socket,
    // add it, refresh the key TTL. reply[1] is the pre-add live count.
    const replies = (await this.client
      .multi()
      .zRemRangeByScore(k, 0, now - STALE_MS)
      .zCard(k)
      .zAdd(k, { score: now, value: socketId })
      .expire(k, KEY_TTL_SEC)
      .exec()) as unknown[]
    return Number(replies[1]) === 0
  }

  async heartbeat(userId: string, socketId: string): Promise<void> {
    const k = this.key(userId)
    await this.client
      .multi()
      .zAdd(k, { score: Date.now(), value: socketId })
      .expire(k, KEY_TTL_SEC)
      .exec()
  }

  async disconnect(userId: string, socketId: string): Promise<boolean> {
    const now = Date.now()
    const k = this.key(userId)
    // Atomic: remove this socket, drop stale members, read remaining count.
    const replies = (await this.client
      .multi()
      .zRem(k, socketId)
      .zRemRangeByScore(k, 0, now - STALE_MS)
      .zCard(k)
      .exec()) as unknown[]
    const remaining = Number(replies[2])
    if (remaining === 0) {
      await this.client.del(k).catch(() => {})
      return true
    }
    return false
  }

  async filterOnline(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return []
    const cutoff = Date.now() - STALE_MS
    // One round-trip: count each peer's members seen within the stale window.
    const multi = this.client.multi()
    for (const id of userIds) multi.zCount(this.key(id), cutoff, '+inf')
    const replies = (await multi.exec()) as unknown[]
    return userIds.filter((_, i) => Number(replies[i]) > 0)
  }
}

// Choose the backend based on whether the shared Redis command client is
// connected. Called once at realtime init (after initRedis()).
export function createPresenceStore(): { store: PresenceStore; backend: 'redis' | 'memory' } {
  const client = getRedisClient()
  if (client) return { store: new RedisPresence(client), backend: 'redis' }
  return { store: new MemoryPresence(), backend: 'memory' }
}
