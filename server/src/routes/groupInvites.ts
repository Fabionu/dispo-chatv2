import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { getIO, roomForUser, subscribeUserToGroup } from '../realtime.js'
import { asyncHandler, HttpError, withTransaction } from '../http.js'
import { insertSystemMessage, emitSystemMessage } from '../util/messages.js'

// Group invitations into permanent vehicle groups. Distinct from cross-company
// `connections`: invites are intra-workspace and only target vehicle groups.
//
// This router owns the invitee-facing surface (list my invites, accept,
// decline) plus an inviter/admin cancel. Creating invites is group-scoped and
// lives on the groups router (POST /api/groups/:id/invites), next to the
// membership it mutates.
export const groupInvitesRouter = Router()
groupInvitesRouter.use(requireAuth)

type InviteRow = {
  id: string
  group_id: string
  created_at: string
  group_name: string | null
  meta: Record<string, unknown> | null
  invited_by_id: string
  invited_by_name: string
}

// Shape a DB row into the client invite object. Vehicle registration numbers
// come out of the group's meta (legacy single `plate` maps to the tractor).
function mapInvite(r: InviteRow) {
  const meta = (r.meta ?? {}) as { tractorPlate?: string; trailerPlate?: string; plate?: string }
  return {
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_name,
    tractorPlate: meta.tractorPlate ?? meta.plate,
    trailerPlate: meta.trailerPlate,
    invitedByName: r.invited_by_name,
    invitedByUserId: r.invited_by_id,
    createdAt: r.created_at,
  }
}

// ── GET /api/group-invites ─────────────────────────────────────────────────
// The current user's PENDING invitations, newest first. Drives the sidebar
// "Group invites" section and the main-pane invite view.
groupInvitesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { rows } = await pool.query<InviteRow>(
      `select gi.id, gi.group_id, gi.created_at,
              g.name as group_name, g.meta,
              inv.id as invited_by_id, inv.display_name as invited_by_name
         from group_invitations gi
         join groups g on g.id = gi.group_id
         join users inv on inv.id = gi.invited_by_user_id
        where gi.invited_user_id = $1 and gi.status = 'pending'
        order by gi.created_at desc
        limit 200`,
      [userId],
    )
    res.json({ invites: rows.map(mapInvite) })
  }),
)

// ── POST /api/group-invites/:id/accept ───────────────────────────────────────
// The invited user accepts: they're added to group_members and the group
// appears in their sidebar. Idempotent — a second accept (or accepting an
// already-accepted invite) just re-affirms membership and succeeds.
groupInvitesRouter.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const inviteId = req.params.id

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        group_id: string
        invited_user_id: string
        invited_by_user_id: string
        status: string
      }>(
        `select group_id, invited_user_id, invited_by_user_id, status
           from group_invitations where id = $1 for update`,
        [inviteId],
      )
      const row = rows[0]
      if (!row) throw new HttpError(404, 'not_found')
      // Only the invited user may accept their own invite.
      if (row.invited_user_id !== userId) throw new HttpError(403, 'forbidden')

      if (row.status === 'accepted') {
        // Already accepted — make sure membership exists, then no-op succeed.
        // No system row here: re-accepting must not duplicate "X joined".
        await client.query(
          // Seed unread_count to the group's existing visible backlog (migration
          // 0020): a joiner with no last_read_at would otherwise show 0 unread
          // instead of the history the old subquery counted. No mentions yet (a
          // non-member can't have been mentioned), so unread_mention_count = 0.
          `insert into group_members (group_id, user_id, role, unread_count)
           select $1, $2, 'member',
                  (select count(*) from messages msg
                    where msg.group_id = $1 and msg.author_id <> $2
                      and msg.deleted_at is null and msg.kind = 'user')
           on conflict do nothing`,
          [row.group_id, userId],
        )
        return { groupId: row.group_id, invitedBy: row.invited_by_user_id, systemId: null }
      }
      if (row.status !== 'pending') throw new HttpError(409, 'not_pending', { status: row.status })

      await client.query(
        `update group_invitations set status = 'accepted', responded_at = now() where id = $1`,
        [inviteId],
      )
      await client.query(
        // Seed unread_count to the group's existing visible backlog (migration
        // 0020) — see the matching insert in the re-accept branch above.
        `insert into group_members (group_id, user_id, role, unread_count)
         select $1, $2, 'member',
                (select count(*) from messages msg
                  where msg.group_id = $1 and msg.author_id <> $2
                    and msg.deleted_at is null and msg.kind = 'user')
         on conflict do nothing`,
        [row.group_id, userId],
      )
      // Activity timeline: the invited user joined. Actor = the joiner, so the
      // renderer shows "X joined the group" from author_name (no payload needed).
      // Only on the real pending→accepted transition, so it never duplicates.
      const systemId = await insertSystemMessage(client, {
        groupId: row.group_id,
        actorId: userId,
        event: 'group_joined',
      })
      return { groupId: row.group_id, invitedBy: row.invited_by_user_id, systemId }
    })

    // Post-commit realtime: join the accepter's sockets to the group room so
    // live messages flow immediately, surface the group in their sidebar, and
    // tell the inviter (and the accepter's other tabs) the invite resolved.
    subscribeUserToGroup(userId, result.groupId)
    const io = getIO()
    io.to(roomForUser(userId)).emit('group:added', { groupId: result.groupId, type: 'vehicle' })
    io.to(roomForUser(userId)).emit('group_invite:accepted', { id: inviteId, groupId: result.groupId })
    io.to(roomForUser(result.invitedBy)).emit('group_invite:accepted', {
      id: inviteId,
      groupId: result.groupId,
    })
    // Broadcast the "X joined the group" activity row to the group room now that
    // the joiner is subscribed (so they and existing members see it live).
    if (result.systemId) await emitSystemMessage(result.systemId, result.groupId)
    res.json({ ok: true, groupId: result.groupId })
  }),
)

// ── POST /api/group-invites/:id/decline ──────────────────────────────────────
// The invited user declines. The inviter is notified so their picker state can
// update; the invited user's other tabs drop the invite.
groupInvitesRouter.post(
  '/:id/decline',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const inviteId = req.params.id

    const invitedBy = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        invited_user_id: string
        invited_by_user_id: string
        status: string
      }>(
        `select invited_user_id, invited_by_user_id, status
           from group_invitations where id = $1 for update`,
        [inviteId],
      )
      const row = rows[0]
      if (!row) throw new HttpError(404, 'not_found')
      if (row.invited_user_id !== userId) throw new HttpError(403, 'forbidden')
      if (row.status !== 'pending') throw new HttpError(409, 'not_pending', { status: row.status })
      await client.query(
        `update group_invitations set status = 'declined', responded_at = now() where id = $1`,
        [inviteId],
      )
      return row.invited_by_user_id
    })

    const io = getIO()
    io.to(roomForUser(userId)).emit('group_invite:declined', { id: inviteId })
    io.to(roomForUser(invitedBy)).emit('group_invite:declined', { id: inviteId })
    res.json({ ok: true })
  }),
)

// ── POST /api/group-invites/:id/cancel ───────────────────────────────────────
// The inviter — or a group admin / workspace admin|dispatcher — rescinds a
// still-pending invite. The invited user's pending list drops it live.
groupInvitesRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const inviteId = req.params.id

    const invitedUser = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        group_id: string
        invited_user_id: string
        invited_by_user_id: string
        status: string
      }>(
        `select group_id, invited_user_id, invited_by_user_id, status
           from group_invitations where id = $1 for update`,
        [inviteId],
      )
      const row = rows[0]
      if (!row) throw new HttpError(404, 'not_found')
      if (row.status !== 'pending') throw new HttpError(409, 'not_pending', { status: row.status })

      // Inviter can always cancel; otherwise the caller must be authorised to
      // manage this group's membership (group admin OR workspace admin/dispatcher).
      if (row.invited_by_user_id !== userId) {
        const { rows: perm } = await client.query<{ group_role: string; user_role: string }>(
          `select gm.role as group_role, u.role as user_role
             from group_members gm
             join users u on u.id = gm.user_id
            where gm.group_id = $1 and gm.user_id = $2`,
          [row.group_id, userId],
        )
        const p = perm[0]
        const allowed =
          p && (p.group_role === 'admin' || p.user_role === 'admin' || p.user_role === 'dispatcher')
        if (!allowed) throw new HttpError(403, 'forbidden')
      }

      await client.query(
        `update group_invitations set status = 'cancelled', responded_at = now() where id = $1`,
        [inviteId],
      )
      return row.invited_user_id
    })

    getIO().to(roomForUser(invitedUser)).emit('group_invite:cancelled', { id: inviteId })
    res.json({ ok: true })
  }),
)
