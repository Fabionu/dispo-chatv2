import rateLimit, {
  ipKeyGenerator,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'
import { readSession } from '../auth.js'
import { env, isProd } from '../env.js'
import { getRedisClient } from '../redis.js'
import { log } from '../util/log.js'

// ── Distributed store ──────────────────────────────────────────────────────
// When the Redis command client is CONNECTED, counters live in Redis so the
// limit is shared across every API instance. Implemented directly on the
// existing `redis` client (one INCR + a TTL set per hit) to avoid pulling in
// `rate-limit-redis`. Each limiter passes its own key prefix so counters never
// collide.
//
// This store is only ever attached when the client is actually connected (see
// initRateLimiters), so `increment` always has a live client. The null guard is
// pure defence — it must NOT silently disable limiting, so it surfaces an error
// rather than pretending the request was the first hit.
class RedisRateLimitStore implements Store {
  private windowMs = 60_000
  prefix: string

  constructor(prefix: string) {
    this.prefix = `rl:${prefix}`
  }

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  private redisKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const client = getRedisClient()
    if (!client) {
      // Should be unreachable (the store is only attached when connected). Fail
      // rather than return totalHits:1, which would silently disable limiting.
      throw new Error('rate-limit Redis store has no connected client')
    }
    const k = this.redisKey(key)
    // INCR creates the key at 1 on first hit; PTTL tells us whether an expiry is
    // already set. On the first hit (ttl < 0) we set the window expiry.
    const replies = (await client.multi().incr(k).pTTL(k).exec()) as unknown as [number, number]
    const totalHits = Number(replies[0])
    let ttl = Number(replies[1])
    if (ttl < 0) {
      await client.pExpire(k, this.windowMs)
      ttl = this.windowMs
    }
    return { totalHits, resetTime: new Date(Date.now() + ttl) }
  }

  async decrement(key: string): Promise<void> {
    const client = getRedisClient()
    if (!client) return
    await client.decr(this.redisKey(key))
  }

  async resetKey(key: string): Promise<void> {
    const client = getRedisClient()
    if (!client) return
    await client.del(this.redisKey(key))
  }
}

// ── Key generators ───────────────────────────────────────────────────────────
const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? '')}`

const keyByUserOrIp = (req: Request): string => {
  const session = readSession(req)
  if (session) return `u:${session.userId}`
  // ipKeyGenerator normalises IPv4-mapped IPv6 addresses ("::ffff:1.2.3.4")
  // and reduces full IPv6 to its /64 prefix so a single client can't bypass
  // limits by walking through addresses in a block.
  return ipKeyGenerator(req.ip ?? '')
}

// ── Limiter specs ────────────────────────────────────────────────────────────
type Spec = { prefix: string; options: Partial<Options> }

const SPECS: Record<'signin' | 'signup' | 'message' | 'groupCreate', Spec> = {
  // Aggressive on signin — brute-force is the main threat.
  signin: {
    prefix: 'signin:',
    options: {
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: ipKey,
      message: { error: 'too_many_requests' },
    },
  },
  // Signup is rarer — a handful per hour per IP is plenty for a real human.
  signup: {
    prefix: 'signup:',
    options: {
      windowMs: 60 * 60 * 1000,
      limit: 5,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: ipKey,
      message: { error: 'too_many_requests' },
    },
  },
  // Message posting — generous for humans, blocks scripts.
  message: {
    prefix: 'message:',
    options: {
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: keyByUserOrIp,
      message: { error: 'too_many_requests' },
    },
  },
  // Group creation — well-meaning users create a few; bots try thousands.
  groupCreate: {
    prefix: 'groupcreate:',
    options: {
      windowMs: 60 * 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: keyByUserOrIp,
      message: { error: 'too_many_requests' },
    },
  },
}

function build(spec: Spec, useRedis: boolean): RequestHandler {
  return rateLimit({
    ...spec.options,
    ...(useRedis ? { store: new RedisRateLimitStore(spec.prefix) } : {}),
  })
}

// The real limiter per name. Seeded with in-memory limiters at module load so
// there's never an unlimited window before initRateLimiters() runs; swapped to
// Redis-backed ones once we know Redis is connected.
const impls: Record<string, RequestHandler> = {}
for (const [name, spec] of Object.entries(SPECS)) impls[name] = build(spec, false)

// Stable middleware references the routes import — they delegate to the current
// impl, so initRateLimiters() can swap the store in without re-registering.
function delegate(name: keyof typeof SPECS): RequestHandler {
  return (req, res, next) => impls[name](req, res, next)
}

export const signinLimiter = delegate('signin')
export const signupLimiter = delegate('signup')
export const messageLimiter = delegate('message')
export const groupCreateLimiter = delegate('groupCreate')

// Build the limiters with the correct store. Call AFTER initRedis(): Redis store
// only when the command client is actually connected, otherwise in-memory. Logs
// the EFFECTIVE store (not just whether REDIS_URL is set).
export function initRateLimiters(): void {
  const connected = getRedisClient() !== null
  for (const [name, spec] of Object.entries(SPECS)) impls[name] = build(spec, connected)

  if (connected) {
    log.info('rate_limit_mode', { store: 'redis', distributed: true })
  } else if (env.REDIS_URL) {
    // REDIS_URL set but not connected. Unreachable in prod (initRedis aborts
    // startup when REDIS_URL is set but fails); in dev we fell back to memory.
    log.warn('rate_limit_mode', {
      store: 'memory',
      distributed: false,
      note: 'REDIS_URL set but Redis unavailable — in-memory fallback (dev only)',
    })
  } else if (isProd) {
    log.warn('rate_limit_mode', {
      store: 'memory',
      distributed: false,
      note: 'REDIS_URL unset — rate limits are PER-INSTANCE only; set REDIS_URL for distributed limits',
    })
  } else {
    log.info('rate_limit_mode', { store: 'memory', distributed: false, note: 'local dev' })
  }
}
