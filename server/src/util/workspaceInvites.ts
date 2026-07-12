import { randomBytes, createHash } from 'node:crypto'
import type { Request } from 'express'
import { env } from '../env.js'

// Company invite links expire 15 minutes after creation.
export const INVITE_TTL_MS = 15 * 60 * 1000

// The workspace roles an invite may grant, mirroring users.role's check
// constraint (server/src/db/migrations/0001_init.sql) and workspace_invites.role
// (0024). The route validates the requested role against this list, and the
// accept handler stamps the stored role onto the new user. 'dispatcher' is the
// default (the role invites granted before the column existed).
export const COMPANY_ROLES = ['admin', 'dispatcher', 'driver', 'partner'] as const
export type CompanyRole = (typeof COMPANY_ROLES)[number]
export const DEFAULT_INVITE_ROLE: CompanyRole = 'dispatcher'

// A fresh, unguessable invite token: 32 random bytes (256 bits) as URL-safe
// base64. This raw value is handed to the invitee in the link and NEVER stored —
// only its hash goes to the DB.
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

// What we persist + look up by. SHA-256 is fine here: the token already has full
// entropy (so there's nothing to brute-force), the hash just means a DB leak
// can't be replayed as live links.
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Public status of an invite row, derived from used_at / expires_at.
export type InviteStatus = 'active' | 'used' | 'expired'

export function inviteStatus(row: { used_at: string | null; expires_at: string }): InviteStatus {
  if (row.used_at) return 'used'
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

// Absolute base origin for building the shareable link. Prefer the configured
// PUBLIC_ORIGIN (correct behind a proxy/CDN); otherwise reconstruct it from the
// forwarded request headers so local/dev still produces a working link.
export function requestOrigin(req: Request): string {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN.replace(/\/+$/, '')
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host')
  return `${proto}://${host}`
}

// The full invite URL the admin copies and shares.
export function inviteUrl(req: Request, token: string): string {
  return `${requestOrigin(req)}/invite/${token}`
}
