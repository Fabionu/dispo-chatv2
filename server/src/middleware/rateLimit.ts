import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'
import { readSession } from '../auth.js'

// All limits below use in-memory storage. That's fine on a single Railway
// instance. Once we scale to multiple instances, swap in a Redis store
// (rate-limit-redis) to make limits consistent across processes — no API
// change needed in the handlers, just the `store` field here.

const keyByUserOrIp = (req: Request): string => {
  const session = readSession(req)
  if (session) return `u:${session.userId}`
  // ipKeyGenerator normalises IPv4-mapped IPv6 addresses ("::ffff:1.2.3.4")
  // and reduces full IPv6 to its /64 prefix so a single client can't bypass
  // limits by walking through addresses in a block.
  return ipKeyGenerator(req.ip ?? '')
}

// Aggressive on signin — brute-force is the main threat.
export const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
  message: { error: 'too_many_requests' },
})

// Signup is rarer — once per day per IP is plenty for a real human.
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
  message: { error: 'too_many_requests' },
})

// Message posting — generous for humans, blocks scripts.
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'too_many_requests' },
})

// Group creation — well-meaning users create a few; bots try thousands.
export const groupCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'too_many_requests' },
})
