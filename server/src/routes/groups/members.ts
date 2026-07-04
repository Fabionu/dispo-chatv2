import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { asyncHandler, withTransaction, HttpError } from '../../http.js'
import {
  getIO,
  roomForGroup,
  roomForUser,
  unsubscribeUserFromGroup,
} from '../../realtime.js'
import { insertSystemMessage, emitSystemMessage } from '../../util/messages.js'
import { authorizeRoleManager } from './authz.js'

export const membersRouter = Router()

// Load + shape a group's members for the API. Enriched for the group-info
// panel: group role (admin/member), the user's workspace role (admin/dispatcher
// /driver/partner), availability and avatar flag. Admins first, then alphabetical.
// The @-mention picker only reads id + display_name, so the extra fields are
// harmless to existing callers. Shared by the members GET and the role PATCH so
// both return the exact same shape.
export async function fetchGroupMembers(groupId: string) {
  const { rows } = await pool.query<{
    id: string
    display_name: string
    workspace: string | null
    group_role: string
    user_role: string
    availability_status: string
    avatar_path: string | null
    last_read_at: string | null
  }>(
    `select u.id, u.display_name, w.name as workspace,
            gm.role as group_role, u.role as user_role,
            u.availability_status, u.avatar_path, gm.last_read_at
       from group_members gm
       join users u on u.id = gm.user_id
       left join workspaces w on w.id = u.workspace_id
      where gm.group_id = $1
        -- A deleted member's group_members row is kept (so DM peer joins still
        -- resolve), but they should not appear as an active member or in the
        -- @-mention picker, both of which read this list.
        and u.deleted_at is null
      order by (gm.role = 'admin') desc, u.display_name asc`,
    [groupId],
  )
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    workspace: r.workspace,
    role: r.group_role,
    userRole: r.user_role,
    availabilityStatus: r.availability_status,
    hasAvatar: r.avatar_path !== null,
    // "Read up to" marker. Per-message read receipts are DERIVED from this on
    // the client (a message is seen by this member iff lastReadAt >= its
    // createdAt) — no per-message rows, so it scales to large groups.
    lastReadAt: r.last_read_at,
  }))
}

// ── GET /api/groups/:id/members ──────────────────────────────────────────
// The members of one conversation — drives the @-mention picker AND the
// group-info members list. Restricted to members of the group (the caller must
// belong to it), so the picker only ever offers people actually in the chat.
membersRouter.get(
  '/:id/members',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows: membership } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    res.json({ members: await fetchGroupMembers(groupId) })
  }),
)

// ── PATCH /api/groups/:id/members/:userId ────────────────────────────────
// Change a member's GROUP role (admin | member). Authorised to group admins /
// workspace admins only. The target must already be a member of THIS group, and
// the last remaining admin can never be demoted (which would orphan the group's
// management). Group role is distinct from the user's workspace role and is the
// only thing this endpoint touches. Returns the refreshed member list.
const memberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
})

membersRouter.patch(
  '/:id/members/:userId',
  asyncHandler(async (req, res) => {
    const parsed = memberRoleSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const targetId = req.params.userId
    const nextRole = parsed.data.role

    await withTransaction(async (client) => {
      await authorizeRoleManager(client, groupId, userId)

      // Lock the target's membership row + read the current admin count in one
      // consistent snapshot so concurrent demotions can't both slip past the
      // last-admin guard.
      const { rows: target } = await client.query<{ role: string }>(
        `select role from group_members where group_id = $1 and user_id = $2 for update`,
        [groupId, targetId],
      )
      if (target.length === 0) throw new HttpError(404, 'not_a_member')
      const currentRole = target[0].role

      // No-op (already the requested role) — succeed without a write.
      if (currentRole === nextRole) return

      // Demotion: never drop below one admin.
      if (currentRole === 'admin' && nextRole === 'member') {
        const { rows: adminRows } = await client.query<{ count: string }>(
          `select count(*)::int as count from group_members
            where group_id = $1 and role = 'admin'`,
          [groupId],
        )
        if (Number(adminRows[0].count) <= 1) throw new HttpError(409, 'last_admin')
      }

      await client.query(
        `update group_members set role = $1 where group_id = $2 and user_id = $3`,
        [nextRole, groupId, targetId],
      )
    })

    // Tell every open client on this group to refresh its member list (badges,
    // action menus). No chat/system message — role changes aren't timeline events.
    getIO().to(roomForGroup(groupId)).emit('group:members_changed', { groupId })

    res.json({ members: await fetchGroupMembers(groupId) })
  }),
)

// ── DELETE /api/groups/:id/members/:userId ───────────────────────────────
// Remove a member from a vehicle group, OR leave it yourself. Two cases share
// this endpoint:
//   • Removal (target ≠ caller): authorised to group admins / workspace admins
//     only (the same boundary as role changes — a privileged "manage membership"
//     action). Logs a "X was removed from the group" activity row.
//   • Leaving (target = caller): any member may remove THEMSELVES. Logs a
//     "X left the group" activity row.
// The last remaining admin can never be removed (or leave) — that would orphan
// the group's management. Returns the refreshed member list. Vehicle-only, so a
// DM (fixed pair) never produces a membership activity row.
membersRouter.delete(
  '/:id/members/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const targetId = req.params.userId
    const isSelf = targetId === userId

    const systemId = await withTransaction(async (client) => {
      if (isSelf) {
        // Leaving: the caller must be a member of a VEHICLE group (DMs have no
        // "leave"). No manager permission needed to remove yourself.
        const { rows } = await client.query<{ type: 'vehicle' | 'direct' }>(
          `select g.type
             from group_members gm
             join groups g on g.id = gm.group_id
            where gm.group_id = $1 and gm.user_id = $2`,
          [groupId, userId],
        )
        if (rows.length === 0) throw new HttpError(403, 'not_a_member')
        if (rows[0].type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
      } else {
        await authorizeRoleManager(client, groupId, userId)
      }

      // Lock the target's membership row + read their display name + count admins
      // in one snapshot so a concurrent removal/demotion can't slip the last
      // admin out, and so the activity row carries a stable name (safe even if
      // the user is later anonymized).
      const { rows: target } = await client.query<{ role: string; display_name: string }>(
        `select gm.role, u.display_name
           from group_members gm
           join users u on u.id = gm.user_id
          where gm.group_id = $1 and gm.user_id = $2
          for update of gm`,
        [groupId, targetId],
      )
      if (target.length === 0) throw new HttpError(404, 'not_a_member')

      // Never remove the last remaining admin (covers self-removal too).
      if (target[0].role === 'admin') {
        const { rows: adminRows } = await client.query<{ count: string }>(
          `select count(*)::int as count from group_members
            where group_id = $1 and role = 'admin'`,
          [groupId],
        )
        if (Number(adminRows[0].count) <= 1) throw new HttpError(409, 'last_admin')
      }

      await client.query(
        `delete from group_members where group_id = $1 and user_id = $2`,
        [groupId, targetId],
      )

      // Activity timeline. Leaving → actor is the leaver (renderer reads the name
      // from author_name → "X left the group"). Removal → actor is the manager,
      // but the row names the REMOVED person, so carry their (snapshotted) name
      // in the payload → "X was removed from the group".
      return insertSystemMessage(client, {
        groupId,
        actorId: userId,
        event: isSelf ? 'group_member_left' : 'group_member_removed',
        payload: isSelf ? null : { userId: targetId, userName: target[0].display_name },
      })
    })

    // Drop the removed user's live room subscription, tell remaining members to
    // refresh the roster (badges/menus), and notify the removed user's own tabs
    // so their group list/selection updates.
    unsubscribeUserFromGroup(targetId, groupId)
    getIO().to(roomForGroup(groupId)).emit('group:members_changed', { groupId })
    getIO().to(roomForUser(targetId)).emit('group:removed', { groupId })
    // Broadcast the activity row to the group room. The removed/left user is now
    // unsubscribed, so only the remaining members receive it live — it persists
    // for everyone either way.
    await emitSystemMessage(systemId, groupId)

    res.json({ members: await fetchGroupMembers(groupId) })
  }),
)
