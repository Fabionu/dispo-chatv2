import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { pool, type DbClient } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import {
  getIO,
  roomForGroup,
  roomForUser,
  subscribeUserToGroup,
  unsubscribeUserFromGroup,
} from '../realtime.js'
import { groupCreateLimiter, messageLimiter } from '../middleware/rateLimit.js'
import {
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
  isImage,
  uploadSingle,
} from '../middleware/upload.js'
import { saveBuffer, readBuffer, deleteFile } from '../storage.js'
import { serveImageObject } from '../util/serveImage.js'
import { enqueuePreviewJob } from '../jobs/previewQueue.js'
import { directPairKey, sortPair } from '../util/pair.js'
import { asyncHandler, HttpError, withTransaction } from '../http.js'
import {
  MESSAGE_COLUMNS,
  MESSAGE_FROM,
  type MessageRow,
  mapMessageRow,
  loadMessage,
  insertSystemMessage,
  emitSystemMessage,
} from '../util/messages.js'

export const groupsRouter = Router()

// All routes require a valid session.
groupsRouter.use(requireAuth)

// ── GET /api/groups ──────────────────────────────────────────────────────
// Lists every group the current user belongs to, ordered by recent activity.
// Driven by the group_members(user_id, group_id) index seek; the result set
// (a single user's groups) is small enough that the final sort is free.
groupsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!

    // Membership is the authorization boundary — the join restricts to groups
    // the caller actually belongs to. We deliberately do NOT filter on
    // workspace_id: cross-workspace DMs carry a NULL workspace_id and must
    // still appear. The LATERAL pulls the "other person" for direct groups so
    // the client can label a DM without an extra round-trip.
    const { rows } = await pool.query<{
      id: string
      type: 'vehicle' | 'direct'
      name: string | null
      description: string | null
      meta: Record<string, unknown>
      avatar_path: string | null
      last_message_at: string | null
      created_at: string
      last_read_at: string | null
      member_count: number
      unread_count: number
      unread_mention_count: number
      peer_id: string | null
      peer_name: string | null
      peer_workspace: string | null
      peer_availability: string | null
    }>(
      `select g.id, g.type, g.name, g.description, g.meta, g.avatar_path,
              g.last_message_at, g.created_at,
              gm.last_read_at,
              (select count(*)::int from group_members where group_id = g.id) as member_count,
              -- unread = messages by others, not deleted, after my last read,
              -- excluding ones I've hidden ("delete for me").
              (select count(*)::int
                 from messages msg
                where msg.group_id = g.id
                  and msg.author_id <> $1
                  and msg.deleted_at is null
                  and msg.kind = 'user'
                  and msg.created_at > coalesce(gm.last_read_at, 'epoch'::timestamptz)
                  and not exists (
                    select 1 from message_deletions md
                     where md.message_id = msg.id and md.user_id = $1
                  )) as unread_count,
              -- unread mentions = the subset of unread messages that @-mention
              -- me. Same read boundary, so marking the group read clears it.
              (select count(*)::int
                 from message_mentions mm
                 join messages msg on msg.id = mm.message_id
                where mm.mentioned_user_id = $1
                  and msg.group_id = g.id
                  and msg.author_id <> $1
                  and msg.deleted_at is null
                  and msg.kind = 'user'
                  and msg.created_at > coalesce(gm.last_read_at, 'epoch'::timestamptz)
                  and not exists (
                    select 1 from message_deletions md
                     where md.message_id = msg.id and md.user_id = $1
                  )) as unread_mention_count,
              peer.peer_id, peer.peer_name, peer.peer_workspace, peer.peer_availability
         from groups g
         join group_members gm on gm.group_id = g.id and gm.user_id = $1
         left join lateral (
           select u.id as peer_id,
                  u.display_name as peer_name,
                  w.name as peer_workspace,
                  u.availability_status as peer_availability
             from group_members gm2
             join users u on u.id = gm2.user_id
             join workspaces w on w.id = u.workspace_id
            where gm2.group_id = g.id and gm2.user_id <> $1
            limit 1
         ) peer on g.type = 'direct'
        where g.archived_at is null
        order by g.last_message_at desc nulls last, g.created_at desc
        limit 200`,
      [userId],
    )

    res.json({
      groups: rows.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        description: r.description,
        meta: r.meta,
        hasAvatar: r.avatar_path !== null,
        lastMessageAt: r.last_message_at,
        lastReadAt: r.last_read_at,
        createdAt: r.created_at,
        memberCount: r.member_count,
        unreadCount: r.unread_count,
        unreadMentionCount: r.unread_mention_count,
        directPeer:
          r.type === 'direct' && r.peer_id
            ? {
                id: r.peer_id,
                name: r.peer_name,
                workspace: r.peer_workspace,
                availabilityStatus: r.peer_availability,
              }
            : null,
      })),
    })
  }),
)

// ── POST /api/groups ─────────────────────────────────────────────────────
// Creates a new group. For type='direct', expects a single other member's
// user_id and looks up any existing 1:1 between the pair before creating.
// For type='vehicle', meta carries the permanent vehicle's registration
// numbers (tractor + trailer). A vehicle group is a long-lived thread reused
// across many trips/loads — trips are not part of group creation.
const createSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('vehicle'),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(400).optional(),
    tractorPlate: z.string().trim().max(20).optional(),
    trailerPlate: z.string().trim().max(20).optional(),
    memberIds: z.array(z.string().uuid()).max(50).optional(),
  }),
  z.object({
    type: z.literal('direct'),
    otherUserId: z.string().uuid(),
  }),
])

groupsRouter.post(
  '/',
  groupCreateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    const { userId, workspaceId } = req.session!

    if (parsed.data.type === 'direct') {
      const { otherUserId } = parsed.data
      if (otherUserId === userId) throw new HttpError(400, 'self_direct_disallowed')

      const result = await withTransaction(async (client) => {
        // Resolve the peer's workspace: same workspace → DM allowed outright;
        // cross-workspace → requires an accepted connection.
        const { rows: peerRows } = await client.query<{ workspace_id: string }>(
          'select workspace_id from users where id = $1',
          [otherUserId],
        )
        if (peerRows.length === 0) throw new HttpError(404, 'peer_not_found')
        const isCrossWorkspace = peerRows[0].workspace_id !== workspaceId

        if (isCrossWorkspace) {
          const [a, b] = sortPair(userId, otherUserId)
          const { rows: conn } = await client.query<{ status: string }>(
            `select status from connections where user_a_id = $1 and user_b_id = $2`,
            [a, b],
          )
          if (conn.length === 0 || conn[0].status !== 'accepted') {
            throw new HttpError(403, 'connection_required')
          }
        }

        // Look up an existing DM via the canonical pair key — O(1) index seek.
        const pairKey = directPairKey(userId, otherUserId)
        const { rows: existing } = await client.query<{ id: string }>(
          `select id from groups
            where type = 'direct' and direct_pair_key = $1 and archived_at is null
            limit 1`,
          [pairKey],
        )
        if (existing[0]) {
          return { groupId: existing[0].id, isNew: false as const }
        }

        // Cross-workspace DMs don't "live" in any workspace — workspace_id NULL.
        const groupWorkspaceId = isCrossWorkspace ? null : workspaceId
        const { rows: created } = await client.query<{ id: string }>(
          `insert into groups (workspace_id, type, meta, created_by, direct_pair_key)
           values ($1, 'direct', '{}'::jsonb, $2, $3)
           returning id`,
          [groupWorkspaceId, userId, pairKey],
        )
        const groupId = created[0].id
        await client.query(
          `insert into group_members (group_id, user_id, role)
           values ($1, $2, 'admin'), ($1, $3, 'member')`,
          [groupId, userId, otherUserId],
        )
        return { groupId, isNew: true as const }
      })

      if (!result.isNew) {
        return res.json({ group: { id: result.groupId, type: 'direct', existed: true } })
      }
      // Post-commit side effects: room subscriptions + notify the peer.
      subscribeUserToGroup(userId, result.groupId)
      subscribeUserToGroup(otherUserId, result.groupId)
      getIO().to(`user:${otherUserId}`).emit('group:added', {
        groupId: result.groupId,
        type: 'direct',
      })
      return res.status(201).json({ group: { id: result.groupId, type: 'direct', existed: false } })
    }

    // vehicle
    const { name, description, tractorPlate, trailerPlate, memberIds = [] } = parsed.data

    const result = await withTransaction(async (client) => {
      // Validate that any extra members live in the same workspace.
      if (memberIds.length > 0) {
        const { rows: ok } = await client.query<{ id: string }>(
          `select id from users where workspace_id = $1 and id = any($2::uuid[])`,
          [workspaceId, memberIds],
        )
        if (ok.length !== memberIds.length) {
          throw new HttpError(400, 'member_outside_workspace')
        }
      }

      // Permanent vehicle registration numbers. Stored under the tractor/
      // trailer keys; the legacy single `plate` key is never written for new
      // groups (existing groups keep theirs and the client reads it as a
      // tractor-plate fallback).
      const meta: Record<string, string> = {}
      if (tractorPlate) meta.tractorPlate = tractorPlate
      if (trailerPlate) meta.trailerPlate = trailerPlate

      const { rows: created } = await client.query<{ id: string }>(
        `insert into groups (workspace_id, type, name, description, meta, created_by)
         values ($1, 'vehicle', $2, $3, $4::jsonb, $5)
         returning id`,
        [workspaceId, name, description ?? null, JSON.stringify(meta), userId],
      )
      const groupId = created[0].id

      // Creator joins as admin, additional members as 'member'.
      const allMembers = new Set([userId, ...memberIds])
      const memberRows = Array.from(allMembers).map((uid) => [
        groupId,
        uid,
        uid === userId ? 'admin' : 'member',
      ])
      // Bulk insert via unnest — single query regardless of member count.
      await client.query(
        `insert into group_members (group_id, user_id, role)
         select * from unnest($1::uuid[], $2::uuid[], $3::text[])`,
        [memberRows.map((r) => r[0]), memberRows.map((r) => r[1]), memberRows.map((r) => r[2])],
      )

      // Activity timeline: the creator directly added each extra member at
      // creation → a persisted "X added Y" system row per added member. The
      // creator's own membership isn't logged (they made the group).
      const systemIds: string[] = []
      if (memberIds.length > 0) {
        const { rows: added } = await client.query<{ id: string; display_name: string }>(
          `select id, display_name from users where id = any($1::uuid[])`,
          [memberIds],
        )
        for (const a of added) {
          systemIds.push(
            await insertSystemMessage(client, {
              groupId,
              actorId: userId,
              event: 'group_member_added',
              payload: { userId: a.id, userName: a.display_name },
            }),
          )
        }
      }
      return { groupId, allMembers, systemIds }
    })

    for (const uid of result.allMembers) subscribeUserToGroup(uid, result.groupId)
    for (const uid of memberIds) {
      getIO().to(`user:${uid}`).emit('group:added', { groupId: result.groupId, type: 'vehicle' })
    }
    // Broadcast the "added" activity rows now that members are subscribed.
    for (const id of result.systemIds) await emitSystemMessage(id, result.groupId)
    res.status(201).json({ group: { id: result.groupId, type: 'vehicle' } })
  }),
)

// Load + shape a group's members for the API. Enriched for the group-info
// panel: group role (admin/member), the user's workspace role (admin/dispatcher
// /driver/partner), availability and avatar flag. Admins first, then alphabetical.
// The @-mention picker only reads id + display_name, so the extra fields are
// harmless to existing callers. Shared by the members GET and the role PATCH so
// both return the exact same shape.
async function fetchGroupMembers(groupId: string) {
  const { rows } = await pool.query<{
    id: string
    display_name: string
    workspace: string | null
    group_role: string
    user_role: string
    availability_status: string
    avatar_path: string | null
  }>(
    `select u.id, u.display_name, w.name as workspace,
            gm.role as group_role, u.role as user_role,
            u.availability_status, u.avatar_path
       from group_members gm
       join users u on u.id = gm.user_id
       left join workspaces w on w.id = u.workspace_id
      where gm.group_id = $1
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
  }))
}

// ── GET /api/groups/:id/members ──────────────────────────────────────────
// The members of one conversation — drives the @-mention picker AND the
// group-info members list. Restricted to members of the group (the caller must
// belong to it), so the picker only ever offers people actually in the chat.
groupsRouter.get(
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

// ── Invite authorization ─────────────────────────────────────────────────
// Who may invite into a vehicle group: a member who is either a group admin OR
// a workspace admin/dispatcher. Returns the group's workspace_id (for the
// same-workspace check on invitees) or throws the right HttpError.
async function authorizeInviter(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<{ workspaceId: string | null }> {
  const { rows } = await client.query<{
    group_role: string
    user_role: string
    workspace_id: string | null
    type: 'vehicle' | 'direct'
  }>(
    `select gm.role as group_role, u.role as user_role, g.workspace_id, g.type
       from group_members gm
       join users u on u.id = gm.user_id
       join groups g on g.id = gm.group_id
      where gm.group_id = $1 and gm.user_id = $2`,
    [groupId, userId],
  )
  const row = rows[0]
  if (!row) throw new HttpError(403, 'not_a_member')
  // Invitations are a vehicle-group concept — DMs are a fixed pair.
  if (row.type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
  const allowed =
    row.group_role === 'admin' || row.user_role === 'admin' || row.user_role === 'dispatcher'
  if (!allowed) throw new HttpError(403, 'forbidden')
  return { workspaceId: row.workspace_id }
}

// ── GET /api/groups/:id/invites ──────────────────────────────────────────
// Pending invitees for a vehicle group, so the invite picker can show who's
// already been invited. Authorized to invite-capable members only.
groupsRouter.get(
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

groupsRouter.post(
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

    res.status(201).json({ invited: result.created, skipped: result.skipped })
  }),
)

// ── Role-management authorization ─────────────────────────────────────────
// Who may change a vehicle group's member roles: a GROUP admin OR a WORKSPACE
// admin. Note this is STRICTER than inviting (which also allows dispatchers) —
// promoting/demoting admins is a privileged action. Throws the right HttpError;
// returns nothing on success.
async function authorizeRoleManager(
  client: DbClient,
  groupId: string,
  userId: string,
): Promise<void> {
  const { rows } = await client.query<{
    group_role: string
    user_role: string
    type: 'vehicle' | 'direct'
  }>(
    `select gm.role as group_role, u.role as user_role, g.type
       from group_members gm
       join users u on u.id = gm.user_id
       join groups g on g.id = gm.group_id
      where gm.group_id = $1 and gm.user_id = $2`,
    [groupId, userId],
  )
  const row = rows[0]
  if (!row) throw new HttpError(403, 'not_a_member')
  // Group roles are a vehicle-group concept — DMs are a fixed pair.
  if (row.type !== 'vehicle') throw new HttpError(400, 'not_a_vehicle_group')
  if (row.group_role !== 'admin' && row.user_role !== 'admin') {
    throw new HttpError(403, 'forbidden')
  }
}

// ── PATCH /api/groups/:id/members/:userId ────────────────────────────────
// Change a member's GROUP role (admin | member). Authorised to group admins /
// workspace admins only. The target must already be a member of THIS group, and
// the last remaining admin can never be demoted (which would orphan the group's
// management). Group role is distinct from the user's workspace role and is the
// only thing this endpoint touches. Returns the refreshed member list.
const memberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
})

groupsRouter.patch(
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
// Remove a member from a vehicle group. Authorised to group admins / workspace
// admins only (the same boundary as role changes — both are privileged "manage
// membership" actions). The last remaining admin can never be removed — this
// also blocks a sole admin from removing themselves, which would orphan the
// group's management. Returns the refreshed member list.
groupsRouter.delete(
  '/:id/members/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const targetId = req.params.userId

    await withTransaction(async (client) => {
      await authorizeRoleManager(client, groupId, userId)

      // Lock the target's membership row + count admins in one snapshot so a
      // concurrent removal/demotion can't slip the last admin out.
      const { rows: target } = await client.query<{ role: string }>(
        `select role from group_members where group_id = $1 and user_id = $2 for update`,
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
    })

    // Drop the removed user's live room subscription, tell remaining members to
    // refresh the roster (badges/menus), and notify the removed user's own tabs
    // so their group list/selection updates.
    unsubscribeUserFromGroup(targetId, groupId)
    getIO().to(roomForGroup(groupId)).emit('group:members_changed', { groupId })
    getIO().to(roomForUser(targetId)).emit('group:removed', { groupId })

    res.json({ members: await fetchGroupMembers(groupId) })
  }),
)

// ── PATCH /api/groups/:id ────────────────────────────────────────────────
// Edit a vehicle group's operational details (name, description, tractor /
// trailer registration). Authorised to invite-capable members only (group
// admin OR workspace admin/dispatcher) — the same boundary as inviting, since
// both are "manage this group" actions. Plates live in `meta`; we merge rather
// than replace so unrelated legacy keys (e.g. an old `trip`) are preserved.
const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  tractorPlate: z.string().trim().max(20).nullable().optional(),
  trailerPlate: z.string().trim().max(20).nullable().optional(),
})

groupsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateGroupSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const data = parsed.data

    const group = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)

      const sets: string[] = []
      const values: unknown[] = []
      if (data.name !== undefined) {
        values.push(data.name)
        sets.push(`name = $${values.length}`)
      }
      if (data.description !== undefined) {
        // Empty string clears the field.
        values.push(data.description && data.description.trim() ? data.description : null)
        sets.push(`description = $${values.length}`)
      }
      // Merge plate edits into meta. A null/empty plate removes its key.
      if (data.tractorPlate !== undefined || data.trailerPlate !== undefined) {
        const patch: Record<string, string | null> = {}
        if (data.tractorPlate !== undefined) {
          patch.tractorPlate = data.tractorPlate && data.tractorPlate.trim() ? data.tractorPlate : null
        }
        if (data.trailerPlate !== undefined) {
          patch.trailerPlate = data.trailerPlate && data.trailerPlate.trim() ? data.trailerPlate : null
        }
        // jsonb || sets/overwrites keys; '- key' strips keys we cleared.
        const stripKeys = Object.entries(patch)
          .filter(([, v]) => v === null)
          .map(([k]) => k)
        const setObj = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null))
        values.push(JSON.stringify(setObj))
        let metaExpr = `meta || $${values.length}::jsonb`
        for (const k of stripKeys) {
          values.push(k)
          metaExpr = `(${metaExpr}) - $${values.length}`
        }
        sets.push(`meta = ${metaExpr}`)
      }

      if (sets.length > 0) {
        values.push(groupId)
        await client.query(`update groups set ${sets.join(', ')} where id = $${values.length}`, values)
      }

      const { rows } = await client.query<{
        id: string
        name: string | null
        description: string | null
        meta: Record<string, unknown>
        avatar_path: string | null
      }>('select id, name, description, meta, avatar_path from groups where id = $1', [groupId])
      return rows[0]
    })

    res.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        meta: group.meta,
        hasAvatar: group.avatar_path !== null,
      },
    })
  }),
)

// ── GET /api/groups/:id/avatar ───────────────────────────────────────────
// Streams a vehicle group's image, any member may read it. 404 → the client
// renders the themed multi-user fallback icon. Mirrors the user-avatar serve.
groupsRouter.get(
  '/:id/avatar',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows: membership } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    const { rows } = await pool.query<{ avatar_path: string | null }>(
      'select avatar_path from groups where id = $1 limit 1',
      [groupId],
    )
    const path = rows[0]?.avatar_path
    if (!path) return res.status(404).json({ error: 'no_avatar' })
    const ok = await serveImageObject(res, path, guessImageType(path))
    if (!ok) return res.status(404).json({ error: 'no_avatar' })
  }),
)

// ── POST /api/groups/:id/avatar ──────────────────────────────────────────
// Upload / replace a vehicle group's image. Image-only, size-capped (same caps
// as profile avatars). Authorised to invite-capable members only. The old
// object is deleted after the new path commits so a failure never strands the
// group without an image.
groupsRouter.post(
  '/:id/avatar',
  uploadSingle,
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'no_file' })
    if (!isImage(file.mimetype)) return res.status(415).json({ error: 'not_an_image' })
    if (file.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'image_too_large' })

    const { userId } = req.session!
    const groupId = req.params.id

    const oldPath = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)
      const { rows } = await client.query<{ avatar_path: string | null }>(
        'select avatar_path from groups where id = $1',
        [groupId],
      )
      return rows[0]?.avatar_path ?? null
    })

    const id = `group_${groupId}_${randomUUID().slice(0, 8)}`
    const saved = await saveBuffer(id, file.originalname, file.buffer, file.mimetype)
    await pool.query('update groups set avatar_path = $1 where id = $2', [saved.storagePath, groupId])
    if (oldPath && oldPath !== saved.storagePath) await deleteFile(oldPath)

    res.json({ ok: true, hasAvatar: true })
  }),
)

// ── DELETE /api/groups/:id/avatar ────────────────────────────────────────
// Remove a vehicle group's image. Authorised to invite-capable members only.
groupsRouter.delete(
  '/:id/avatar',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const oldPath = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)
      const { rows } = await client.query<{ avatar_path: string | null }>(
        'select avatar_path from groups where id = $1',
        [groupId],
      )
      const prev = rows[0]?.avatar_path ?? null
      await client.query('update groups set avatar_path = null where id = $1', [groupId])
      return prev
    })

    if (oldPath) await deleteFile(oldPath)
    res.json({ ok: true, hasAvatar: false })
  }),
)

// Storage keeps the original extension; infer a content type for the response.
function guessImageType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

// ── GET /api/groups/:id/messages ─────────────────────────────────────────
// Cursor-based pagination. Default: latest 50. Pass ?before=<iso-timestamp>
// (the createdAt of the oldest message you currently have) to load older.
groupsRouter.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const before = typeof req.query.before === 'string' ? req.query.before : null
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)

    // Authorize: must be a member of the group.
    const { rows: membership } = await pool.query<{ group_id: string }>(
      'select group_id from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    // Deleted messages are kept in the page so the client can render the
    // "this message was deleted" placeholder (otherwise replies-to-deleted
    // would render gaps); the server clears the body / attachments in the
    // mapping step below.
    // $2 is the caller — used to hide messages they've "deleted for me".
    const params: unknown[] = [groupId, userId]
    let where = `m.group_id = $1
        and not exists (
          select 1 from message_deletions md
           where md.message_id = m.id and md.user_id = $2
        )`
    if (before) {
      params.push(before)
      where += ` and m.created_at < $${params.length}`
    }
    params.push(limit + 1) // +1 to detect a next page

    const { rows } = await pool.query<MessageRow>(
      `select ${MESSAGE_COLUMNS}
         ${MESSAGE_FROM}
        where ${where}
        order by m.created_at desc
        limit $${params.length}`,
      params,
    )

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? page[page.length - 1].created_at : null

    res.json({
      messages: page.map(mapMessageRow).reverse(), // client renders oldest-first
      nextCursor, // pass back as ?before= to load older
    })
  }),
)

// ── GET /api/groups/:id/pins ─────────────────────────────────────────────
// The group's pinned messages, newest pin first. Drives the "Pinned" bar, so
// it returns pins regardless of the thread page currently loaded. Excludes
// deleted messages and ones the caller has hidden ("delete for me").
groupsRouter.get(
  '/:id/pins',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows: membership } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    const { rows } = await pool.query<MessageRow>(
      `select ${MESSAGE_COLUMNS}
         ${MESSAGE_FROM}
        where m.group_id = $1
          and m.pinned_at is not null
          and m.deleted_at is null
          and not exists (
            select 1 from message_deletions md
             where md.message_id = m.id and md.user_id = $2
          )
        order by m.pinned_at desc`,
      [groupId, userId],
    )

    res.json({ messages: rows.map(mapMessageRow) })
  }),
)

// ── POST /api/groups/:id/messages ────────────────────────────────────────
// Insert a message and broadcast to the group room. Supports two content
// types:
//   - application/json                 → text-only message
//   - multipart/form-data (file=…)     → text + one attachment
// Multer parses multipart into req.body (text fields) + req.file (binary).
// JSON requests skip multer's processing untouched.
const postMessageSchema = z.object({
  // Empty body is OK when an attachment is present — we enforce the
  // "something must be sent" rule explicitly below.
  body: z.string().trim().max(8000).optional().default(''),
  replyToMessageId: z.string().uuid().optional(),
  // Users @-mentioned in this message. JSON requests send a real array;
  // multipart (attachment + caption) sends it as a JSON string field, so we
  // coerce a string back into an array before validating. Invalid shapes
  // degrade to "no mentions" rather than failing the whole send.
  mentionUserIds: z
    .preprocess((v) => {
      if (typeof v !== 'string') return v
      try {
        return JSON.parse(v)
      } catch {
        return []
      }
    }, z.array(z.string().uuid()).max(50))
    .optional()
    .default([]),
})

groupsRouter.post(
  '/:id/messages',
  messageLimiter,
  uploadSingle,
  asyncHandler(async (req, res) => {
    const parsed = postMessageSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const file = req.file
    const body = parsed.data.body
    const replyToMessageId = parsed.data.replyToMessageId ?? null
    // Dedupe requested mention ids up front; membership is validated against
    // the DB after the message row exists (so we only store mentions for users
    // who actually belong to this conversation).
    const requestedMentionIds = [...new Set(parsed.data.mentionUserIds)]

    if (!body && !file) return res.status(400).json({ error: 'empty_message' })

    // Per-mime size cap. multer has already enforced the global 25MB ceiling;
    // we tighten it for images so a 24MB GIF can't sneak through.
    if (file && isImage(file.mimetype) && file.size > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'image_too_large' })
    }
    if (file && !isImage(file.mimetype) && file.size > MAX_DOC_BYTES) {
      return res.status(413).json({ error: 'file_too_large' })
    }

    const { userId } = req.session!
    const groupId = req.params.id

    // We commit to the attachment id up front so we can persist the file to
    // disk before the DB INSERT, and roll the file back on DB failure. This
    // keeps the storage layer ignorant of UUIDs handed out by Postgres.
    let storagePath: string | null = null
    let attachmentId: string | null = null
    if (file) {
      attachmentId = randomUUID()
      // Store only the ORIGINAL in the request path. The (CPU-heavy) image
      // preview is generated asynchronously after the response — see the
      // enqueuePreviewJob call once the message + attachment row exist.
      const saved = await saveBuffer(attachmentId, file.originalname, file.buffer, file.mimetype)
      storagePath = saved.storagePath
    }

    // Roll back the stored original on any early-exit / failure below. (No
    // preview exists yet at this point — it's produced post-response.)
    const cleanupFiles = async () => {
      if (storagePath) await deleteFile(storagePath)
    }

    // If the caller specified a reply target, verify it exists and that the
    // sender is allowed to quote it — i.e. they're a member of the target
    // message's group. Usually that's this same group, but "reply privately"
    // quotes a group message into a DM, so we authorize by access (membership
    // of the target's group) rather than by an exact group match.
    if (replyToMessageId) {
      const { rows: replyCheck } = await pool.query(
        `select 1
           from messages m
           join group_members gm on gm.group_id = m.group_id and gm.user_id = $2
          where m.id = $1
            and m.kind = 'user'
          limit 1`,
        [replyToMessageId, userId],
      )
      if (replyCheck.length === 0) {
        await cleanupFiles()
        return res.status(400).json({ error: 'invalid_reply' })
      }
    }

    try {
      const { rows } = await pool.query<{
        id: string
        created_at: string
        display_name: string
        reply_id: string | null
        reply_author: string | null
        reply_body: string | null
        reply_has_attachments: boolean | null
        reply_is_deleted: boolean | null
      }>(
        `with member as (
           select 1 from group_members where group_id = $1 and user_id = $2
         ),
         ins as (
           insert into messages (group_id, author_id, body, reply_to_message_id)
           select $1, $2, $3, $9::uuid from member
           returning id, created_at, reply_to_message_id
         ),
         g as (
           update groups set last_message_at = (select created_at from ins)
           where id = $1 and exists (select 1 from ins)
         ),
         r as (
           update group_members set last_read_at = (select created_at from ins)
           where group_id = $1 and user_id = $2 and exists (select 1 from ins)
         ),
         att as (
           insert into attachments (id, message_id, original_name, mime_type, byte_size, storage_path)
           select $4::uuid, ins.id, $5, $6, $7::bigint, $8
           from ins
           where $4::uuid is not null
         )
         select ins.id, ins.created_at, u.display_name,
                rm.id as reply_id,
                ru.display_name as reply_author,
                case when rm.deleted_at is not null then '' else rm.body end as reply_body,
                exists (select 1 from attachments ra where ra.message_id = rm.id) as reply_has_attachments,
                (rm.deleted_at is not null) as reply_is_deleted
         from ins
         join users u on u.id = $2
         left join messages rm on rm.id = ins.reply_to_message_id
         left join users ru    on ru.id = rm.author_id`,
        [
          groupId,
          userId,
          body,
          attachmentId,
          file?.originalname ?? null,
          file?.mimetype ?? null,
          file?.size ?? null,
          storagePath,
          replyToMessageId,
        ],
      )

      if (rows.length === 0) {
        // Caller isn't a member — clean up the orphaned file(s).
        await cleanupFiles()
        throw new HttpError(403, 'not_a_member')
      }

      const row = rows[0]

      // Persist mentions. Only ids that are real members of this group are
      // stored (a non-member id is silently dropped — safe, no error). We pull
      // display names in the same validation query so the broadcast payload can
      // carry them without a second round-trip.
      let mentions: Array<{ userId: string; displayName: string }> = []
      if (requestedMentionIds.length > 0) {
        const { rows: validMembers } = await pool.query<{ id: string; display_name: string }>(
          `select u.id, u.display_name
             from group_members gm
             join users u on u.id = gm.user_id
            where gm.group_id = $1 and u.id = any($2::uuid[])`,
          [groupId, requestedMentionIds],
        )
        if (validMembers.length > 0) {
          await pool.query(
            `insert into message_mentions (message_id, mentioned_user_id)
             select $1, * from unnest($2::uuid[])
             on conflict do nothing`,
            [row.id, validMembers.map((m) => m.id)],
          )
          mentions = validMembers.map((m) => ({ userId: m.id, displayName: m.display_name }))
        }
      }

      // No previewUrl/width/height yet — the preview is generated after we
      // respond (see enqueuePreviewJob below) and delivered via the
      // `attachment:preview` socket event. Until then the bubble uses `url`.
      const attachment =
        file && attachmentId
          ? {
              id: attachmentId,
              originalName: file.originalname,
              mimeType: file.mimetype,
              byteSize: file.size,
              url: `/api/attachments/${attachmentId}`,
            }
          : null

      const payload = {
        id: row.id,
        groupId,
        authorId: userId,
        authorName: row.display_name,
        body,
        createdAt: row.created_at,
        editedAt: null as string | null,
        deletedAt: null as string | null,
        deletedBy: null as string | null,
        forwarded: false,
        attachments: attachment ? [attachment] : [],
        replyTo:
          row.reply_id && row.reply_author !== null
            ? {
                id: row.reply_id,
                authorName: row.reply_author,
                body: row.reply_body ?? '',
                hasAttachments: row.reply_has_attachments ?? false,
                deleted: row.reply_is_deleted ?? false,
              }
            : null,
        mentions,
      }

      getIO().to(roomForGroup(groupId)).emit('message:new', payload)
      res.status(201).json({ message: payload })

      // Out of the request path: generate the image preview in the background
      // from the buffer we already have in memory, then patch the attachment +
      // notify the room. Non-blocking (enqueue returns immediately); a failure
      // here never affects the already-sent message.
      if (file && attachmentId && isImage(file.mimetype)) {
        enqueuePreviewJob({ attachmentId, buffer: file.buffer })
      }
    } catch (err) {
      await cleanupFiles()
      throw err
    }
  }),
)

// ── PATCH /api/groups/:id/messages/:messageId ────────────────────────────
// Edit a message. Authors may edit their own non-deleted messages. We don't
// support editing attachments here — only the text body. The client uses
// this to repair typos; for richer history we'd add an edits table.
const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
})

groupsRouter.patch(
  '/:id/messages/:messageId',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const parsed = editMessageSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    const { rows } = await pool.query<{
      id: string
      body: string
      edited_at: string
    }>(
      `update messages
          set body = $1, edited_at = now()
        where id = $2
          and group_id = $3
          and author_id = $4
          and deleted_at is null
          and kind = 'user'
       returning id, body, edited_at`,
      [parsed.data.body, messageId, groupId, userId],
    )

    if (rows.length === 0) {
      // Either not the author, not a real message in this group, or already
      // deleted. We can't tell exactly without another query; one error
      // code keeps the API surface small.
      return res.status(403).json({ error: 'cannot_edit' })
    }

    const row = rows[0]
    const payload = {
      id: row.id,
      groupId,
      body: row.body,
      editedAt: row.edited_at,
    }
    getIO().to(roomForGroup(groupId)).emit('message:edited', payload)
    res.json({ message: payload })
  }),
)

// ── POST /api/groups/:id/messages/:messageId/delete-for-everyone ─────────
// Soft-delete a message for the whole group. Authors only, and only for
// five minutes after sending. After that window the action is no longer
// allowed — the client hides the menu item to match.
const DELETE_WINDOW_MINUTES = 5

groupsRouter.post(
  '/:id/messages/:messageId/delete-for-everyone',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    const { rows } = await pool.query<{
      id: string
      deleted_at: string
      deleted_by: string
    }>(
      `update messages
          set deleted_at = now(), deleted_by = $1
        where id = $2
          and group_id = $3
          and author_id = $1
          and deleted_at is null
          and kind = 'user'
          and created_at > now() - interval '${DELETE_WINDOW_MINUTES} minutes'
       returning id, deleted_at, deleted_by`,
      [userId, messageId, groupId],
    )

    if (rows.length === 0) {
      return res.status(403).json({ error: 'cannot_delete' })
    }

    const row = rows[0]
    const payload = {
      id: row.id,
      groupId,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
    }
    getIO().to(roomForGroup(groupId)).emit('message:deleted', payload)
    res.json({ ok: true, message: payload })
  }),
)

// ── POST /api/groups/:id/messages/:messageId/pin ─────────────────────────
// Pin a message for the whole group. Any member may pin a real (user) message.
// Idempotent — re-pinning an already-pinned message just refreshes the stamp
// and does NOT add a duplicate activity row (only an unpinned→pinned transition
// logs one). Broadcasts message:pinned (pinned-bar/bubble state) and, on a real
// transition, message:system (the persisted "X pinned a message" row).
groupsRouter.post(
  '/:id/messages/:messageId/pin',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    const result = await withTransaction(async (client) => {
      // `before` captures the pre-update pinned_at so we can tell a genuine
      // transition from an idempotent re-pin. Gated on membership + a real,
      // non-deleted user message in this group.
      const { rows } = await client.query<{ was_pinned_at: string | null }>(
        `with before as (select id, pinned_at as was from messages where id = $2)
         update messages m
            set pinned_at = now(), pinned_by = $1
           from before
          where m.id = before.id
            and m.group_id = $3
            and m.deleted_at is null
            and m.kind = 'user'
            and exists (
              select 1 from group_members gm
               where gm.group_id = m.group_id and gm.user_id = $1
            )
         returning before.was as was_pinned_at`,
        [userId, messageId, groupId],
      )
      if (rows.length === 0) return { ok: false as const }
      const transitioned = rows[0].was_pinned_at === null
      const systemId = transitioned
        ? await insertSystemMessage(client, {
            groupId,
            actorId: userId,
            event: 'message_pinned',
            targetMessageId: messageId,
          })
        : null
      return { ok: true as const, systemId }
    })
    if (!result.ok) return res.status(403).json({ error: 'cannot_pin' })

    const message = await loadMessage(messageId)
    if (!message) return res.status(404).json({ error: 'not_found' })
    getIO().to(roomForGroup(groupId)).emit('message:pinned', { groupId, message })
    if (result.systemId) await emitSystemMessage(result.systemId, groupId)
    res.json({ message })
  }),
)

// ── POST /api/groups/:id/messages/:messageId/unpin ───────────────────────
// Remove a group-wide pin. Any member may unpin. Logs a "X unpinned a message"
// activity row only on a real pinned→unpinned transition.
groupsRouter.post(
  '/:id/messages/:messageId/unpin',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{ was_pinned_at: string | null }>(
        `with before as (select id, pinned_at as was from messages where id = $2)
         update messages m
            set pinned_at = null, pinned_by = null
           from before
          where m.id = before.id
            and m.group_id = $3
            and m.kind = 'user'
            and exists (
              select 1 from group_members gm
               where gm.group_id = m.group_id and gm.user_id = $1
            )
         returning before.was as was_pinned_at`,
        [userId, messageId, groupId],
      )
      if (rows.length === 0) return { ok: false as const }
      const transitioned = rows[0].was_pinned_at !== null
      const systemId = transitioned
        ? await insertSystemMessage(client, {
            groupId,
            actorId: userId,
            event: 'message_unpinned',
            targetMessageId: messageId,
          })
        : null
      return { ok: true as const, systemId }
    })
    if (!result.ok) return res.status(403).json({ error: 'cannot_unpin' })

    getIO().to(roomForGroup(groupId)).emit('message:unpinned', { groupId, id: messageId })
    if (result.systemId) await emitSystemMessage(result.systemId, groupId)
    res.json({ ok: true, id: messageId })
  }),
)

// ── POST /api/groups/:id/messages/:messageId/forward ─────────────────────
// Forward a message into another group the caller also belongs to. A forward
// is a fresh, standalone message: it copies the source body and duplicates
// each attachment's bytes into new stored files, so deleting the original
// never affects the forward. The `forwarded` flag drives the client label.
const forwardSchema = z.object({
  toGroupId: z.string().uuid(),
})

groupsRouter.post(
  '/:id/messages/:messageId/forward',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const parsed = forwardSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const fromGroupId = req.params.id
    const messageId = req.params.messageId
    const { toGroupId } = parsed.data

    // The caller must belong to BOTH ends: the source (to read it) and the
    // target (to post into it).
    const { rows: membership } = await pool.query<{ group_id: string }>(
      `select group_id from group_members
        where user_id = $1 and group_id = any($2::uuid[])`,
      [userId, [fromGroupId, toGroupId]],
    )
    const memberOf = new Set(membership.map((r) => r.group_id))
    if (!memberOf.has(fromGroupId) || !memberOf.has(toGroupId)) {
      return res.status(403).json({ error: 'not_a_member' })
    }

    // Load the source. Forwarding a deleted message is meaningless.
    const { rows: srcRows } = await pool.query<{ body: string; deleted_at: string | null }>(
      "select body, deleted_at from messages where id = $1 and group_id = $2 and kind = 'user'",
      [messageId, fromGroupId],
    )
    if (srcRows.length === 0) return res.status(404).json({ error: 'message_not_found' })
    if (srcRows[0].deleted_at !== null) return res.status(400).json({ error: 'message_deleted' })
    const srcBody = srcRows[0].body

    const { rows: srcAtts } = await pool.query<{
      original_name: string
      mime_type: string
      byte_size: string
      storage_path: string
    }>(
      `select original_name, mime_type, byte_size, storage_path
         from attachments where message_id = $1 order by created_at asc`,
      [messageId],
    )

    // Copy attachment bytes into fresh stored files up front so the forward
    // owns an independent copy. Track new paths to roll them back on failure.
    const copied: Array<{
      id: string
      originalName: string
      mimeType: string
      byteSize: number
      storagePath: string
      // Original bytes retained (images only) so the preview can be generated
      // in the background after we respond — mirrors the upload path.
      buffer: Buffer | null
    }> = []
    try {
      for (const a of srcAtts) {
        const buf = await readBuffer(a.storage_path)
        const newId = randomUUID()
        const saved = await saveBuffer(newId, a.original_name, buf, a.mime_type)
        copied.push({
          id: newId,
          originalName: a.original_name,
          mimeType: a.mime_type,
          byteSize: Number(a.byte_size),
          storagePath: saved.storagePath,
          buffer: isImage(a.mime_type) ? buf : null,
        })
      }

      const result = await withTransaction(async (client) => {
        const { rows: ins } = await client.query<{
          id: string
          created_at: string
          display_name: string
        }>(
          `with ins as (
             insert into messages (group_id, author_id, body, forwarded)
             values ($1, $2, $3, true)
             returning id, created_at
           ),
           g as (
             update groups set last_message_at = (select created_at from ins)
              where id = $1
           ),
           r as (
             update group_members set last_read_at = (select created_at from ins)
              where group_id = $1 and user_id = $2
           )
           select ins.id, ins.created_at, u.display_name
             from ins join users u on u.id = $2`,
          [toGroupId, userId, srcBody],
        )
        const msg = ins[0]
        for (const a of copied) {
          await client.query(
            `insert into attachments (id, message_id, original_name, mime_type, byte_size, storage_path)
             values ($1, $2, $3, $4, $5::bigint, $6)`,
            [a.id, msg.id, a.originalName, a.mimeType, a.byteSize, a.storagePath],
          )
        }
        return msg
      })

      const payload = {
        id: result.id,
        groupId: toGroupId,
        authorId: userId,
        authorName: result.display_name,
        body: srcBody,
        createdAt: result.created_at,
        editedAt: null as string | null,
        deletedAt: null as string | null,
        deletedBy: null as string | null,
        forwarded: true,
        attachments: copied.map((a) => ({
          id: a.id,
          originalName: a.originalName,
          mimeType: a.mimeType,
          byteSize: a.byteSize,
          url: `/api/attachments/${a.id}`,
        })),
        replyTo: null,
        // Forwarding never copies mentions — it must not re-notify the people
        // mentioned in the original message.
        mentions: [],
      }
      getIO().to(roomForGroup(toGroupId)).emit('message:new', payload)
      res.status(201).json({ message: payload })

      // Generate previews for the copied images in the background (same pattern
      // as the upload path), reusing the bytes we already read into memory.
      for (const a of copied) {
        if (a.buffer) {
          enqueuePreviewJob({ attachmentId: a.id, buffer: a.buffer })
        }
      }
    } catch (err) {
      for (const a of copied) {
        await deleteFile(a.storagePath)
      }
      throw err
    }
  }),
)

// ── POST /api/groups/:id/messages/:messageId/delete-for-me ───────────────
// Hide a single message for the calling user only. Records a per-user row;
// the message stays fully intact for everyone else. We emit to the user's
// room so their other open tabs/devices hide it too.
groupsRouter.post(
  '/:id/messages/:messageId/delete-for-me',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    // Verify membership AND that the message belongs to this group in one go,
    // so a non-member can't probe for message existence.
    const { rows: check } = await pool.query(
      `select 1
         from messages m
         join group_members gm on gm.group_id = m.group_id and gm.user_id = $1
        where m.id = $2 and m.group_id = $3
        limit 1`,
      [userId, messageId, groupId],
    )
    if (check.length === 0) return res.status(403).json({ error: 'cannot_delete' })

    await pool.query(
      `insert into message_deletions (message_id, user_id)
       values ($1, $2) on conflict do nothing`,
      [messageId, userId],
    )

    getIO().to(roomForUser(userId)).emit('message:hidden', { groupId, id: messageId })
    res.json({ ok: true })
  }),
)

// ── POST /api/groups/:id/read ────────────────────────────────────────────
// Mark the group read up to a given message timestamp (or now). Lightweight.
const readSchema = z.object({
  upTo: z.string().datetime().optional(),
})

groupsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const parsed = readSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const at = parsed.data.upTo ?? new Date().toISOString()

    const { rowCount } = await pool.query(
      `update group_members
          set last_read_at = greatest(coalesce(last_read_at, 'epoch'::timestamptz), $1)
        where group_id = $2 and user_id = $3`,
      [at, req.params.id, userId],
    )
    if (rowCount === 0) return res.status(403).json({ error: 'not_a_member' })
    res.json({ ok: true, lastReadAt: at })
  }),
)
