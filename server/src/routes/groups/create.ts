import { Router } from 'express'
import { z } from 'zod'
import { withTransaction, HttpError } from '../../http.js'
import { asyncHandler } from '../../http.js'
import {
  getIO,
  subscribeUserToGroup,
} from '../../realtime.js'
import { groupCreateLimiter } from '../../middleware/rateLimit.js'
import { directPairKey, sortPair } from '../../util/pair.js'
import { insertSystemMessage, emitSystemMessage } from '../../util/messages.js'

export const createRouter = Router()

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

createRouter.post(
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
          'select workspace_id from users where id = $1 and deleted_at is null',
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
