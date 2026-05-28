import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { getIO, roomForGroup, roomForUser, subscribeUserToGroup } from '../realtime.js'
import { groupCreateLimiter, messageLimiter } from '../middleware/rateLimit.js'
import {
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
  isImage,
  uploadSingle,
} from '../middleware/upload.js'
import { saveBuffer, readBuffer, deleteFile } from '../storage.js'
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

    const { rows } = await pool.query<{
      id: string
      author_id: string
      author_name: string
      body: string
      created_at: string
      edited_at: string | null
      deleted_at: string | null
      deleted_by: string | null
      forwarded: boolean
      attachments:
        | Array<{
            id: string
            original_name: string
            mime_type: string
            byte_size: number
          }>
        | null
      reply_to: {
        id: string
        author_name: string
        body: string
        has_attachments: boolean
        deleted: boolean
      } | null
    }>(
      `select m.id, m.author_id, u.display_name as author_name,
              m.body, m.created_at, m.edited_at,
              m.deleted_at, m.deleted_by, m.forwarded,
              -- aggregate attachments per message in a subquery so the message
              -- row stays unique even when a message has multiple files.
              (select coalesce(
                  jsonb_agg(jsonb_build_object(
                    'id',            a.id,
                    'original_name', a.original_name,
                    'mime_type',     a.mime_type,
                    'byte_size',     a.byte_size
                  ) order by a.created_at asc),
                  '[]'::jsonb)
                 from attachments a
                where a.message_id = m.id) as attachments,
              -- reply target snippet, joined from messages onto itself.
              (select jsonb_build_object(
                  'id',              rm.id,
                  'author_name',     ru.display_name,
                  'body',            case when rm.deleted_at is not null then '' else rm.body end,
                  'has_attachments', exists (select 1 from attachments ra where ra.message_id = rm.id),
                  'deleted',         rm.deleted_at is not null
                )
                 from messages rm
                 join users ru on ru.id = rm.author_id
                where rm.id = m.reply_to_message_id) as reply_to
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
        .map((m) => {
          const isDeleted = m.deleted_at !== null
          return {
            id: m.id,
            authorId: m.author_id,
            authorName: m.author_name,
            // Server clears the content of soft-deleted messages — even
            // admins shouldn't see the original text via the API.
            body: isDeleted ? '' : m.body,
            createdAt: m.created_at,
            editedAt: m.edited_at,
            deletedAt: m.deleted_at,
            deletedBy: m.deleted_by,
            forwarded: m.forwarded,
            attachments: isDeleted
              ? []
              : (m.attachments ?? []).map((a) => ({
                  id: a.id,
                  originalName: a.original_name,
                  mimeType: a.mime_type,
                  byteSize: Number(a.byte_size),
                  url: `/api/attachments/${a.id}`,
                })),
            replyTo: m.reply_to
              ? {
                  id: m.reply_to.id,
                  authorName: m.reply_to.author_name,
                  body: m.reply_to.body,
                  hasAttachments: m.reply_to.has_attachments,
                  deleted: m.reply_to.deleted,
                }
              : null,
          }
        })
        .reverse(), // client renders oldest-first
      nextCursor, // pass back as ?before= to load older
    })
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
      const saved = await saveBuffer(attachmentId, file.originalname, file.buffer, file.mimetype)
      storagePath = saved.storagePath
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
          limit 1`,
        [replyToMessageId, userId],
      )
      if (replyCheck.length === 0) {
        if (storagePath) await deleteFile(storagePath)
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
        // Caller isn't a member — clean up the orphaned file.
        if (storagePath) await deleteFile(storagePath)
        throw new HttpError(403, 'not_a_member')
      }

      const row = rows[0]
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
      }

      getIO().to(roomForGroup(groupId)).emit('message:new', payload)
      res.status(201).json({ message: payload })
    } catch (err) {
      if (storagePath) await deleteFile(storagePath)
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
      'select body, deleted_at from messages where id = $1 and group_id = $2',
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
      }
      getIO().to(roomForGroup(toGroupId)).emit('message:new', payload)
      res.status(201).json({ message: payload })
    } catch (err) {
      for (const a of copied) await deleteFile(a.storagePath)
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
