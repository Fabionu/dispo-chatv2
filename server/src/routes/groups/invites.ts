import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, withTransaction } from '../../http.js'
import { getIO, roomForGroup, roomForUser } from '../../realtime.js'
import { authorizeInviter } from './authz.js'

export const invitesRouter = Router()

// ── GET /api/groups/:id/invites ──────────────────────────────────────────
// Pending invitees for a vehicle group, so the invite picker can show who's
// already been invited. Authorized to invite-capable members only.
invitesRouter.get(
  '/:id/invites',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows } = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)
      return client.query<{ id: string; invited_user_id: string; display_name: string }>(
        `select gi.id, gi.invited_user_id, u.display_name
           from group_invitations gi
           join users u on u.id = gi.invited_user_id
          where gi.group_id = $1 and gi.status = 'pending'
          order by gi.created_at desc`,
        [groupId],
      )
    })

    res.json({
      invites: rows.map((r) => ({
        id: r.id,
        userId: r.invited_user_id,
        displayName: r.display_name,
      })),
    })
  }),
)

// ── POST /api/groups/:id/invites ─────────────────────────────────────────
// Invite one or more workspace users into a vehicle group. Only invite-capable
// members may call. Invitees must share the group's workspace, must not already
// be members, and must not already have a pending invite (returned as a skip
// reason rather than an error so a bulk invite is partially-successful-safe).
const inviteSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
})

invitesRouter.post(
  '/:id/invites',
  asyncHandler(async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const requested = [...new Set(parsed.data.userIds)]

    const result = await withTransaction(async (client) => {
      const { workspaceId } = await authorizeInviter(client, groupId, userId)

      // Resolve which requested users are valid invitees. They must exist,
      // not be the caller, and EITHER share the group's workspace OR be an
      // accepted connection of the inviter (cross-company colleagues the caller
      // is already linked to). Connections use the canonical least/greatest
      // pair ordering, matching how they're stored.
      const { rows: candidates } = await client.query<{ id: string }>(
        `select u.id
           from users u
          where u.id = any($1::uuid[])
            and u.id <> $3
            and (
              u.workspace_id = $2
              or exists (
                select 1 from connections c
                 where c.status = 'accepted'
                   and c.user_a_id = least($3::uuid, u.id)
                   and c.user_b_id = greatest($3::uuid, u.id)
              )
            )`,
        [requested, workspaceId, userId],
      )
      const validIds = new Set(candidates.map((c) => c.id))

      // Already-members and already-pending are skipped (not errors).
      const { rows: members } = await client.query<{ user_id: string }>(
        `select user_id from group_members where group_id = $1 and user_id = any($2::uuid[])`,
        [groupId, requested],
      )
      const memberIds = new Set(members.map((m) => m.user_id))
      const { rows: pendings } = await client.query<{ invited_user_id: string }>(
        `select invited_user_id from group_invitations
          where group_id = $1 and status = 'pending' and invited_user_id = any($2::uuid[])`,
        [groupId, requested],
      )
      const pendingIds = new Set(pendings.map((p) => p.invited_user_id))

      const created: string[] = []
      const skipped: Array<{ userId: string; reason: string }> = []
      for (const uid of requested) {
        if (!validIds.has(uid)) {
          skipped.push({ userId: uid, reason: 'not_invitable' })
          continue
        }
        if (memberIds.has(uid)) {
          skipped.push({ userId: uid, reason: 'already_member' })
          continue
        }
        if (pendingIds.has(uid)) {
          skipped.push({ userId: uid, reason: 'already_invited' })
          continue
        }
        const { rows: ins } = await client.query<{ id: string }>(
          `insert into group_invitations (group_id, invited_user_id, invited_by_user_id)
           values ($1, $2, $3)
           on conflict (group_id, invited_user_id) where status = 'pending' do nothing
           returning id`,
          [groupId, uid, userId],
        )
        if (ins[0]) created.push(uid)
        else skipped.push({ userId: uid, reason: 'already_invited' })
      }
      return { created, skipped }
    })

    // Notify each freshly-invited user across their tabs/devices. The client
    // refetches its pending invites on this signal (same pattern as connections).
    const io = getIO()
    for (const uid of result.created) {
      io.to(roomForUser(uid)).emit('group_invite:created', { groupId })
    }
    // If anything was actually created, tell the GROUP room so invite-capable
    // members viewing Group Info / the invite picker refresh their pending list
    // live (the per-invitee event above only reaches the invited users).
    if (result.created.length > 0) {
      io.to(roomForGroup(groupId)).emit('group:invites_changed', { groupId })
    }

    res.status(201).json({ invited: result.created, skipped: result.skipped })
  }),
)
