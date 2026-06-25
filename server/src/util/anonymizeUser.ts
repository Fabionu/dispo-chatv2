import { randomInt } from 'node:crypto'
import type { DbClient } from '../db/pool.js'

// A non-bcrypt sentinel written into password_hash on deletion. bcryptjs.compare
// returns false outright for any hash that isn't 60 chars, so the account can
// never authenticate again (login also can't find the row — the email is
// replaced with an unguessable, non-routable placeholder below).
const DELETED_PASSWORD = 'account_deleted'

// "user_deleted_48291" — a short numeric suffix. display_name is not unique, so
// a collision is purely cosmetic; 5 digits (10k–99999) keeps it short while
// making accidental clashes unlikely. The user's id already guarantees the row
// itself is distinct.
function deletedDisplayName(): string {
  return `user_deleted_${randomInt(10000, 100000)}`
}

export type AnonymizeResult = {
  // Storage key of the avatar that was detached, or null. The CALLER deletes the
  // object AFTER the transaction commits, so a storage failure never rolls back
  // (or is rolled back by) the DB scrub.
  oldAvatarPath: string | null
  // true on the real active→deleted transition; false if the user was already
  // anonymized (idempotent — nothing was changed this call).
  anonymized: boolean
}

// Soft-deletes a user in place: scrubs every personal field, disables the login,
// flags deleted_at, and tears down still-pending relationships so the account
// vanishes from other people's "active" surfaces immediately. The row is kept on
// purpose — messages.author_id and DM/group joins reference it and must keep
// resolving (now to the anonymized identity). Run inside withTransaction.
//
// Idempotent: a second call on an already-deleted user is a no-op.
export async function anonymizeUser(
  client: DbClient,
  userId: string,
): Promise<AnonymizeResult> {
  // Lock the row so concurrent deletes (e.g. self-delete racing an admin action)
  // serialize and only the first does the scrub.
  const { rows } = await client.query<{ avatar_path: string | null; deleted_at: string | null }>(
    'select avatar_path, deleted_at from users where id = $1 for update',
    [userId],
  )
  const existing = rows[0]
  if (!existing) return { oldAvatarPath: null, anonymized: false }
  if (existing.deleted_at) return { oldAvatarPath: null, anonymized: false }

  const oldAvatarPath = existing.avatar_path

  // Email is NOT NULL + unique(workspace_id, email), so it can't be blanked —
  // replace it with a per-id, non-routable placeholder (.invalid never resolves,
  // and the id is unguessable) that no one can use to sign in.
  const placeholderEmail = `deleted+${userId}@deleted.invalid`

  await client.query(
    `update users set
        display_name        = $2,
        email               = $3,
        password_hash       = $4,
        avatar_path         = null,
        job_title           = null,
        work_phone          = null,
        native_language     = null,
        other_languages     = '{}',
        availability_status = 'off_duty',
        deleted_at          = now()
      where id = $1`,
    [userId, deletedDisplayName(), placeholderEmail, DELETED_PASSWORD],
  )

  // Pending cross-company connection requests: decline so they leave the other
  // party's inbox (accepted rows are simply filtered out of lists by deleted_at).
  await client.query(
    `update connections set status = 'declined', responded_at = now()
      where status = 'pending' and (user_a_id = $1 or user_b_id = $1)`,
    [userId],
  )

  // Pending vehicle-group invites in either direction: cancel so they disappear
  // from the inviter's/invitee's pending lists.
  await client.query(
    `update group_invitations set status = 'cancelled', responded_at = now()
      where status = 'pending' and (invited_user_id = $1 or invited_by_user_id = $1)`,
    [userId],
  )

  // Company invite links this user generated but that are still open: expire them
  // (a dead account shouldn't keep handing out a usable onboarding link).
  await client.query(
    `update workspace_invites set expires_at = now()
      where created_by = $1 and used_at is null and expires_at > now()`,
    [userId],
  )

  return { oldAvatarPath, anonymized: true }
}
