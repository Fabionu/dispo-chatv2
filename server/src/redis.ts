import { createClient } from 'redis'
import { env, isProd } from './env.js'
import { log } from './util/log.js'

// Shared Redis COMMAND client (distinct from the Socket.IO adapter's pub/sub
// clients in realtime.ts — a subscriber connection can't run normal commands).
// Used by the distributed rate-limit store and the durable preview queue.
//
// Lifecycle mirrors the realtime adapter's contract:
//   • REDIS_URL unset            → no client; callers fall back to in-memory.
//   • set, connects              → shared client ready.
//   • set, connect fails in prod → throw (abort startup; never pretend Redis
//                                  is active).
//   • set, connect fails in dev  → warn and return null (in-memory fallback,
//                                  so local dev never needs Redis).

// Derive the client type from a concrete factory call (node-redis's bare
// `ReturnType<typeof createClient>` widens to the generic constraint, which
// doesn't match the concrete RESP-2 client the call actually returns).
const makeClient = () => createClient({ url: env.REDIS_URL })
type CommandClient = ReturnType<typeof makeClient>

let client: CommandClient | null = null

export async function initRedis(): Promise<void> {
  if (!env.REDIS_URL) return
  try {
    const c = makeClient()
    c.on('error', (err) =>
      log.error('redis_command_error', { message: String((err as Error)?.message ?? err) }),
    )
    await c.connect()
    client = c
    log.info('redis_command_client_connected', {})
  } catch (err) {
    log.error('redis_command_connect_failed', {
      message: String((err as Error)?.message ?? err),
    })
    if (isProd) {
      throw new Error(
        'REDIS_URL is set but the Redis command client failed to connect; aborting startup ' +
          '(refusing to run distributed features on a degraded connection in production).',
      )
    }
    log.warn('redis_command_fallback_dev', {
      note: 'continuing without Redis — in-memory rate limits + preview queue (dev only)',
    })
  }
}

// The connected command client, or null when Redis isn't configured/available.
export function getRedisClient(): CommandClient | null {
  return client
}

// Whether REDIS_URL is configured (independent of connection success).
export function redisConfigured(): boolean {
  return Boolean(env.REDIS_URL)
}
