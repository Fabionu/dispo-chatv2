import { createHash, randomBytes } from 'node:crypto'
import type { DbClient } from '../db/pool.js'
import type { Request } from 'express'
import { requestOrigin } from './workspaceInvites.js'

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000

export function generateEmailVerificationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueEmailVerificationToken(client: DbClient, userId: string) {
  const token = generateEmailVerificationToken()
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)

  // A resend supersedes every older live link. Keeping the rows as consumed
  // preserves a small audit trail without leaving multiple usable credentials.
  await client.query(
    `update email_verification_tokens
        set consumed_at = now()
      where user_id = $1 and consumed_at is null`,
    [userId],
  )
  const { rows } = await client.query<{ id: string }>(
    `insert into email_verification_tokens (user_id, token_hash, expires_at)
     values ($1, $2, $3)
     returning id`,
    [userId, hashEmailVerificationToken(token), expiresAt],
  )
  return { id: rows[0].id, token, expiresAt }
}

export function emailVerificationUrl(req: Request, token: string): string {
  return `${requestOrigin(req)}/verify-email?token=${encodeURIComponent(token)}`
}

