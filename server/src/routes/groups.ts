import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { getIO, roomForGroup, subscribeUserToGroup } from '../realtime.js'
import { groupCreateLimiter, messageLimiter } from '../middleware/rateLimit.js'
import { directPairKey, sortPair } from '../util/pair.js'
import { asyncHandler, HttpError, withTransaction } from '../http.js'

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
      last_message_at: string | null
      created_at: string
      last_read_at: string | null
      member_count: number
      peer_id: string | null
      peer_name: string | null
      peer_workspace: string | null
    }>(
      `select g.id, g.type, g.name, g.description, g.meta,
              g.last_message_at, g.created_at,
              gm.last_read_at,
              (select count(*)::int from group_members where group_id = g.id) as member_count,
              peer.peer_id, peer.peer_name, peer.peer_workspace
         from groups g
         join group_members gm on gm.group_id = g.id and gm.user_id = $1
         left join lateral (
           select u.id as peer_id,
                  u.display_name as peer_name,
                  w.name as peer_workspace
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
        lastMessageAt: r.last_message_at,
        lastReadAt: r.last_read_at,
        createdAt: r.created_at,
        memberCount: r.member_count,
        directPeer:
          r.type === 'direct' && r.peer_id
            ? { id: r.peer_id, name: r.peer_name, workspace: r.peer_workspace }
            : null,
      })),
    })
  }),
)

// ── POST /api/groups ─────────────────────────────────────────────────────
// Creates a new group. For type='direct', expects a single other member's
// user_id and looks up any existing 1:1 between the pair before creating.
// For type='vehicle', uses meta to carry plate / trip details.
const createSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('vehicle'),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(400).optional(),
    plate: z.string().trim().max(20).optional(),
    trip: z.string().trim().max(120).optional(),
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
    const { name, description, plate, trip, memberIds = [] } = parsed.data

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

      const meta: Record<string, string> = {}
      if (plate) meta.plate = plate
      if (trip) meta.trip = trip

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
      return { groupId, allMembers }
    })

    for (const uid of result.allMembers) subscribeUserToGroup(uid, result.groupId)
    for (const uid of memberIds) {
      getIO().to(`user:${uid}`).emit('group:added', { groupId: result.groupId, type: 'vehicle' })
    }
    res.status(201).json({ group: { id: result.groupId, type: 'vehicle' } })
  }),
)

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

    const params: unknown[] = [groupId]
    let where = 'group_id = $1 and deleted_at is null'
    if (before) {
      params.push(before)
      where += ` and created_at < $${params.length}`
    }
    params.push(limit + 1) // +1 to detect a next page

    const { rows } = await pool.query<{
      id: string
      author_id: string
      author_name: string
      body: string
      created_at: string
      edited_at: string | null
    }>(
      `select m.id, m.author_id, u.display_name as author_name,
              m.body, m.created_at, m.edited_at
         from messages m
         join users u on u.id = m.author_id
        where ${where}
        order by m.created_at desc
        limit $${params.length}`,
      params,
    )

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? page[page.length - 1].created_at : null

    res.json({
      messages: page
        .map((m) => ({
          id: m.id,
          authorId: m.author_id,
          authorName: m.author_name,
          body: m.body,
          createdAt: m.created_at,
          editedAt: m.edited_at,
        }))
        .reverse(), // client renders oldest-first
      nextCursor, // pass back as ?before= to load older
    })
  }),
)

// ── POST /api/groups/:id/messages ────────────────────────────────────────
// Insert a message and broadcast to the group room. Updates last_message_at
// on the group in the same transaction so the sidebar re-sorts instantly.
const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
})

groupsRouter.post(
  '/:id/messages',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const parsed = postMessageSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id

    // Single round trip: gate on membership, insert the message, bump the
    // group's last_message_at + the author's last_read_at, and return the
    // author's display name for the broadcast payload. On Railway with a
    // separate DB instance this is the difference between ~250ms and ~2s.
    const { rows } = await pool.query<{
      id: string
      created_at: string
      display_name: string
    }>(
      `with member as (
         select 1 from group_members where group_id = $1 and user_id = $2
       ),
       ins as (
         insert into messages (group_id, author_id, body)
         select $1, $2, $3 from member
         returning id, created_at
       ),
       g as (
         update groups set last_message_at = (select created_at from ins)
         where id = $1 and exists (select 1 from ins)
       ),
       r as (
         update group_members set last_read_at = (select created_at from ins)
         where group_id = $1 and user_id = $2 and exists (select 1 from ins)
       )
       select ins.id, ins.created_at, u.display_name
       from ins, users u
       where u.id = $2`,
      [groupId, userId, parsed.data.body],
    )

    if (rows.length === 0) throw new HttpError(403, 'not_a_member')
    const row = rows[0]

    const payload = {
      id: row.id,
      groupId,
      authorId: userId,
      authorName: row.display_name,
      body: parsed.data.body,
      createdAt: row.created_at,
    }

    getIO().to(roomForGroup(groupId)).emit('message:new', payload)
    res.status(201).json({ message: payload })
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
