import { Router } from 'express'
import { z } from 'zod'
import { type DbClient } from '../../db/pool.js'
import { asyncHandler, withTransaction } from '../../http.js'
import { insertSystemMessage, emitSystemMessage } from '../../util/messages.js'
import { authorizeInviter } from './authz.js'
import { opsSchema, tripActivityEvents, assignedDriverDelta, type OpsLite } from './ops.js'

// Resolve user ids → display names for a driver-assignment activity row. Returns
// a map so the caller can preserve the original id order in the payload.
async function resolveUserNames(client: DbClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { rows } = await client.query<{ id: string; display_name: string }>(
    'select id, display_name from users where id = any($1::uuid[])',
    [ids],
  )
  return new Map(rows.map((r) => [r.id, r.display_name]))
}

export const updateRouter = Router()

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
  // Operational blob (vehicle/trip/stops) for the vehicle room's side panel.
  ops: opsSchema.optional(),
  // Set by the client only when this save is an explicit "Edit route" action
  // (never on the automatic background route recompute), so the server logs a
  // "Route was edited" activity row only for a deliberate edit — and even then
  // only when the route data actually changed (see the diff below).
  routeEdited: z.boolean().optional(),
})

updateRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateGroupSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const data = parsed.data

    const { group, systemIds } = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)

      // Snapshot the ops BEFORE the write (and lock the row) so a trip/route diff
      // against the incoming ops is consistent under concurrent saves. Only read
      // when the caller is actually changing ops — plate/name edits don't need it.
      let oldOps: OpsLite | null = null
      if (data.ops !== undefined) {
        const { rows: pre } = await client.query<{ meta: Record<string, unknown> | null }>(
          'select meta from groups where id = $1 for update',
          [groupId],
        )
        oldOps = (pre[0]?.meta?.ops as OpsLite | undefined) ?? null
      }

      // Driver assignment references real accounts, so it must be trustworthy:
      // the client owns the whole ops blob, so re-validate that every assigned id
      // is an ACTIVE member of THIS group and drop any that isn't before it's
      // persisted (the driver API trusts assignedDriverIds for access control).
      if (data.ops?.trip?.assignedDriverIds && data.ops.trip.assignedDriverIds.length > 0) {
        const ids = data.ops.trip.assignedDriverIds
        const { rows: memberRows } = await client.query<{ user_id: string }>(
          `select gm.user_id
             from group_members gm
             join users u on u.id = gm.user_id
            where gm.group_id = $1 and gm.user_id = any($2::uuid[]) and u.deleted_at is null`,
          [groupId, ids],
        )
        const memberIds = new Set(memberRows.map((r) => r.user_id))
        data.ops.trip.assignedDriverIds = ids.filter((id) => memberIds.has(id))
      }

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
      // Merge meta edits (plates + the ops blob). Keys in `metaSet` are
      // set/overwritten via jsonb `||`; keys in `metaStrip` are removed via `-`.
      // A null/empty plate strips its key; `ops` is always set wholesale.
      const metaSet: Record<string, unknown> = {}
      const metaStrip: string[] = []
      if (data.tractorPlate !== undefined) {
        const v = data.tractorPlate && data.tractorPlate.trim() ? data.tractorPlate : null
        if (v === null) metaStrip.push('tractorPlate')
        else metaSet.tractorPlate = v
      }
      if (data.trailerPlate !== undefined) {
        const v = data.trailerPlate && data.trailerPlate.trim() ? data.trailerPlate : null
        if (v === null) metaStrip.push('trailerPlate')
        else metaSet.trailerPlate = v
      }
      if (data.ops !== undefined) {
        metaSet.ops = data.ops
      }
      if (Object.keys(metaSet).length > 0 || metaStrip.length > 0) {
        values.push(JSON.stringify(metaSet))
        let metaExpr = `meta || $${values.length}::jsonb`
        for (const k of metaStrip) {
          values.push(k)
          metaExpr = `(${metaExpr}) - $${values.length}`
        }
        sets.push(`meta = ${metaExpr}`)
      }

      if (sets.length > 0) {
        values.push(groupId)
        await client.query(`update groups set ${sets.join(', ')} where id = $${values.length}`, values)
      }

      // Operational activity rows (vehicle rooms only — authorizeInviter already
      // rejected DMs). Derived from the old→new ops diff so the same save repeated
      // without real changes never duplicates a row. trip_added / status-change
      // are mutually exclusive; a route edit can accompany either.
      const systemIds: string[] = []
      if (data.ops !== undefined) {
        for (const ev of tripActivityEvents(oldOps, data.ops as OpsLite, data.routeEdited === true)) {
          systemIds.push(await insertSystemMessage(client, { groupId, actorId: userId, ...ev }))
        }

        // Driver-assignment activity — derived from the (already membership-
        // filtered) old→new diff, so re-saving the same assignment is silent.
        // Resolves ids → display names for a stable, human-readable row
        // ("Fabio assigned Claudiu Cojocar as driver for trip #123").
        const { added, removed } = assignedDriverDelta(oldOps, data.ops as OpsLite)
        if (added.length > 0 || removed.length > 0) {
          const names = await resolveUserNames(client, [...added, ...removed])
          const tripLabel = (data.ops as OpsLite)?.trip?.reference ?? null
          if (added.length > 0) {
            systemIds.push(
              await insertSystemMessage(client, {
                groupId,
                actorId: userId,
                event: 'trip_driver_assigned',
                payload: { driverIds: added, driverNames: added.map((id) => names.get(id) ?? 'Someone'), tripLabel },
              }),
            )
          }
          if (removed.length > 0) {
            systemIds.push(
              await insertSystemMessage(client, {
                groupId,
                actorId: userId,
                event: 'trip_driver_unassigned',
                payload: { driverIds: removed, driverNames: removed.map((id) => names.get(id) ?? 'Someone'), tripLabel },
              }),
            )
          }
        }
      }

      const { rows } = await client.query<{
        id: string
        name: string | null
        description: string | null
        meta: Record<string, unknown>
        avatar_path: string | null
      }>('select id, name, description, meta, avatar_path from groups where id = $1', [groupId])
      return { group: rows[0], systemIds }
    })

    // Broadcast any activity rows now that the transaction has committed.
    for (const id of systemIds) await emitSystemMessage(id, groupId)

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
