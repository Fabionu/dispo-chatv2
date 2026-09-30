import { HttpError } from '../http.js'

// Pure decision half of POST /api/group-invites/:id/accept, split out (like
// driverAuthz.ts) so the permission rule is unit-testable without a database.

export type AcceptableInvite = {
  invited_user_id: string
  status: string
}

/**
 * What accepting this invite may do: `join` (a real pending→accepted
 * transition) or `already_member` (an idempotent repeat). Throws otherwise.
 *
 * An accepted invite is only ever a receipt for membership that ALREADY
 * exists — never a way to create it again. It used to re-insert the member
 * "to make sure membership exists", which let anyone removed from a room
 * replay their old invite id and walk straight back in with the full history.
 * Once the membership is gone, the invite is spent: rejoining takes a new one.
 */
export function acceptInviteOutcome(
  userId: string,
  invite: AcceptableInvite,
  isMember: boolean,
): 'join' | 'already_member' {
  // Only the invited user may accept their own invite.
  if (invite.invited_user_id !== userId) throw new HttpError(403, 'forbidden')
  if (invite.status === 'accepted') {
    if (isMember) return 'already_member'
    throw new HttpError(409, 'not_pending', { status: invite.status })
  }
  if (invite.status !== 'pending') {
    throw new HttpError(409, 'not_pending', { status: invite.status })
  }
  return 'join'
}
