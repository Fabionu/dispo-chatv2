import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env, isProd } from './env.js'

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
    return jwt.verify(token, env.JWT_SECRET) as SessionPayload
  } catch {
    return null
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req)
  if (!session) return res.status(401).json({ error: 'unauthenticated' })
  req.session = session
  next()
}
