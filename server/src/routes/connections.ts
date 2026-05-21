import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { sortPair } from '../util/pair.js'
import { getIO, roomForUser } from '../realtime.js'
import { asyncHandler, HttpError, withTransaction } from '../http.js'

export const connectionsRouter = Router()
connectionsRouter.use(requireAuth)

// ── GET /api/connections ─────────────────────────────────────────────────
// One round-trip returning all three slices the connections UI needs:
// accepted, pendingReceived, pendingSent. A CASE buckets rows server-side.
connectionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!

    const { rows } = await pool.query<{
      id: string
      status: 'pending' | 'accepted' | 'declined'
      requested_by: string
      message: string | null
      requested_at: string
      responded_at: string | null
      other_user_id: string
      other_display_name: string
      other_email: string
      other_workspace_id: string
      other_workspace_name: string
      bucket: 'accepted' | 'pending_received' | 'pending_sent'
    }>(
      `select c.id, c.status, c.requested_by, c.message,
              c.requested_at, c.responded_at,
              u.id  as other_user_id,
              u.display_name as other_display_name,
              u.email as other_email,
              w.id as other_workspace_id, w.name as other_workspace_name,
              case
                when c.status = 'accepted' then 'accepted'
                when c.status = 'pending' and c.requested_by = $1 then 'pending_sent'
                when c.status = 'pending' and c.requested_by <> $1 then 'pending_received'
              end as bucket
         from connections c
         join users u on u.id = case when c.user_a_id = $1 then c.user_b_id else c.user_a_id end
         join workspaces w on w.id = u.workspace_id
        where (c.user_a_id = $1 or c.user_b_id = $1)
          and c.status in ('accepted', 'pending')
        order by coalesce(c.responded_at, c.requested_at) desc
        limit 500`,
      [userId],
    )

    const accepted: unknown[] = []
    const pendingReceived: unknown[] = []
    const pendingSent: unknown[] = []
    for (const r of rows) {
      const item = {
        id: r.id,
        status: r.status,
        message: r.message,
        requestedAt: r.requested_at,
        respondedAt: r.responded_at,
        otherUser: {
          id: r.other_user_id,
          displayName: r.other_display_name,
          email: r.other_email,
          workspace: { id: r.other_workspace_id, name: r.other_workspace_name },
        },
      }
      if (r.bucket === 'accepted') accepted.push(item)
      else if (r.bucket === 'pending_received') pendingReceived.push(item)
      else pendingSent.push(item)
    }

    res.json({ accepted, pendingReceived, pendingSent })
  }),
)

// ── POST /api/connections/request ────────────────────────────────────────
// Idempotent against pending requests: if a pending row already exists for
// this pair, return it instead of creating a duplicate. Declined rows block
// re-requests for now.
const requestSchema = z.object({
  toUserId: z.string().uuid(),
  message: z.string().trim().max(500).optional(),
})

connectionsRouter.post(
  '/request',
  asyncHandler(async (req, res) => {
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId, workspaceId } = req.session!
    const { toUserId, message } = parsed.data
    if (toUserId === userId) throw new HttpError(400, 'self_request')

    const [a, b] = sortPair(userId, toUserId)

    const result = await withTransaction(async (client) => {
      // Connections only make sense across workspaces — same-workspace pairs
      // can DM directly.
      const { rows: target } = await client.query<{ workspace_id: string }>(
        'select workspace_id from users where id = $1',
        [toUserId],
      )
      if (target.length === 0) throw new HttpError(404, 'user_not_found')
      if (target[0].workspace_id === workspaceId) {
        throw new HttpError(400, 'same_workspace_no_connection_needed')
      }

      const { rows: existing } = await client.query<{
        id: string
        status: 'pending' | 'accepted' | 'declined'
      }>(`select id, status from connections where user_a_id = $1 and user_b_id = $2`, [a, b])

      if (existing[0]) {
        const e = existing[0]
        if (e.status === 'accepted') {
          throw new HttpError(409, 'already_connected', { connectionId: e.id })
        }
        if (e.status === 'declined') throw new HttpError(409, 'previously_declined')
        // pending — return existing, idempotent.
        return { kind: 'existing' as const, id: e.id, status: e.status }
      }

      const { rows: inserted } = await client.query<{ id: string; requested_at: string }>(
        `insert into connections (user_a_id, user_b_id, status, requested_by, message)
         values ($1, $2, 'pending', $3, $4)
         returning id, requested_at`,
        [a, b, userId, message ?? null],
      )
      return {
        kind: 'created' as const,
        id: inserted[0].id,
        requestedAt: inserted[0].requested_at,
      }
    })

    if (result.kind === 'existing') {
      return res
        .status(200)
        .json({ connection: { id: result.id, status: result.status, existed: true } })
    }

    // Notify the recipient across their open tabs/devices.
    getIO().to(roomForUser(toUserId)).emit('connection:requested', {
      id: result.id,
      from: { id: userId },
      message: message ?? null,
      requestedAt: result.requestedAt,
    })

    res.status(201).json({
      connection: {
        id: result.id,
        status: 'pending',
        existed: false,
        requestedAt: result.requestedAt,
      },
    })
  }),
)

// ── Helper for accept/decline ────────────────────────────────────────────
// Returns the requester's id on success; throws HttpError otherwise.
async function respondToConnection(
  connectionId: string,
  userId: string,
  newStatus: 'accepted' | 'declined',
): Promise<{ otherUserId: string }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      user_a_id: string
      user_b_id: string
      status: string
      requested_by: string
    }>(
      `select user_a_id, user_b_id, status, requested_by
         from connections where id = $1
         for update`,
      [connectionId],
    )
    const row = rows[0]
    if (!row) throw new HttpError(404, 'not_found')

    // Only the recipient (the one who didn't request) may accept/decline.
    if (row.requested_by === userId) throw new HttpError(403, 'forbidden')
    if (row.user_a_id !== userId && row.user_b_id !== userId) {
      throw new HttpError(403, 'forbidden')
    }
    if (row.status !== 'pending') {
      throw new HttpError(409, 'not_pending', { status: row.status })
    }

    await client.query(
      `update connections set status = $1, responded_at = now() where id = $2`,
      [newStatus, connectionId],
    )
    return { otherUserId: row.requested_by }
  })
}

// ── POST /api/connections/:id/accept ─────────────────────────────────────
connectionsRouter.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { otherUserId } = await respondToConnection(req.params.id, userId, 'accepted')
    // Tell both sides — the requester sees the acceptance, the accepter's
    // other tabs update their inbox.
    const io = getIO()
    io.to(roomForUser(userId)).emit('connection:accepted', { id: req.params.id })
    io.to(roomForUser(otherUserId)).emit('connection:accepted', { id: req.params.id })
    res.json({ ok: true })
  }),
)

// ── POST /api/connections/:id/decline ────────────────────────────────────
connectionsRouter.post(
  '/:id/decline',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { otherUserId } = await respondToConnection(req.params.id, userId, 'declined')
    // Only the requester needs to know.
    getIO().to(roomForUser(otherUserId)).emit('connection:declined', { id: req.params.id })
    res.json({ ok: true })
  }),
)
