import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env, isProd } from './env.js'
import { pool } from './db/pool.js'
import { TtlCache } from './util/ttlCache.js'

const COOKIE = 'dispo_session'
const SEVEN_DAYS = 7 * 24 * 60 * 60

export type SessionPayload = {
  userId: string
  workspaceId: string
}

// Make `req.session` visible to every handler without per-file casting.
// The `requireAuth` middleware populates it; routes mounted after that
// middleware can treat it as required (with non-null assertion or guard).
declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionPayload
  }
}

export function issueSession(res: Response, payload: SessionPayload) {
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' })
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SEVEN_DAYS * 1000,
    path: '/',
  })
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' })
}

export function readSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE]
  if (!token) return null
  try {
    // `algorithms` pinned: verify must accept only what issueSession signs
    // (HS256), never whatever the token's own header claims.
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as SessionPayload
  } catch {
    return null
  }
}

// A signed token outlives the account it was issued for (stateless 7-day JWT),
// so deletion has to be checked against the row. Only "still active" is cached,
// briefly: a hit costs nothing, and a deleted account loses access within the
// TTL on other instances (immediately on this one — see forgetActiveUser).
const ACTIVE_TTL_MS = 30_000
const activeUsers = new TtlCache<true>(5_000, ACTIVE_TTL_MS)

export async function isActiveUser(userId: string): Promise<boolean> {
  if (activeUsers.get(userId)) return true
  const { rowCount } = await pool.query(
    'select 1 from users where id = $1 and deleted_at is null',
    [userId],
  )
  if (!rowCount) return false
  activeUsers.set(userId, true)
  return true
}

export function forgetActiveUser(userId: string) {
  activeUsers.delete(userId)
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req)
  if (!session) return res.status(401).json({ error: 'unauthenticated' })
  isActiveUser(session.userId)
    .then((active) => {
      if (!active) {
        clearSession(res)
        return res.status(401).json({ error: 'unauthenticated' })
      }
      req.session = session
      next()
    })
    .catch(next)
}
