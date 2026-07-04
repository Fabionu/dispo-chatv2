import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { asyncHandler, withTransaction } from '../../http.js'
import { getIO, roomForGroup, roomForUser } from '../../realtime.js'
import { messageLimiter } from '../../middleware/rateLimit.js'
import { isImage } from '../../middleware/upload.js'
import { saveBuffer, readBuffer, deleteFile } from '../../storage.js'
import { enqueuePreviewJob } from '../../jobs/previewQueue.js'
import { insertSystemMessage, emitSystemMessage, loadMessage } from '../../util/messages.js'

export const messageActionsRouter = Router()

// ── POST /api/groups/:id/messages/:messageId/delete-for-everyone ─────────
// Soft-delete a message for the whole group. Authors only, and only for
// five minutes after sending. After that window the action is no longer
// allowed — the client hides the menu item to match.
const DELETE_WINDOW_MINUTES = 5

messageActionsRouter.post(
  '/:id/messages/:messageId/delete-for-everyone',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    // Soft-delete + adjust the denormalized unread counters of everyone who
    // still had this message unread, atomically. last_read_at is untouched, so
    // per-message read receipts are unaffected.
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        id: string
        deleted_at: string
        deleted_by: string
        created_at: string
      }>(
        `update messages
            set deleted_at = now(), deleted_by = $1
          where id = $2
            and group_id = $3
            and author_id = $1
            and deleted_at is null
            and kind = 'user'
            and created_at > now() - interval '${DELETE_WINDOW_MINUTES} minutes'
         returning id, deleted_at, deleted_by, created_at`,
        [userId, messageId, groupId],
      )
      if (rows.length === 0) return null
      const msg = rows[0]

      // Decrement unread_count for members for whom this message was still
      // UNREAD at deletion time: not the author, their last_read_at is before
      // the message, and they hadn't already hidden it (delete-for-me already
      // decremented those). Floored at 0. RETURNING gives us the authoritative
      // new counts to push to each affected member's sidebar.
      const { rows: affected } = await client.query<{
        user_id: string
        unread_count: number
        unread_mention_count: number
      }>(
        `update group_members gm
            set unread_count = greatest(gm.unread_count - 1, 0)
          where gm.group_id = $1
            and gm.user_id <> $2
            and coalesce(gm.last_read_at, 'epoch'::timestamptz) < $3
            and not exists (
              select 1 from message_deletions md
               where md.message_id = $4 and md.user_id = gm.user_id
            )
         returning gm.user_id, gm.unread_count, gm.unread_mention_count`,
        [groupId, userId, msg.created_at, messageId],
      )

      // Of those, also decrement unread_mention_count where this message
      // mentioned them (mention count is always a subset of unread count).
      if (affected.length > 0) {
        const { rows: mentionDec } = await client.query<{
          user_id: string
          unread_mention_count: number
        }>(
          `update group_members gm
              set unread_mention_count = greatest(gm.unread_mention_count - 1, 0)
            where gm.group_id = $1
              and gm.user_id = any($2::uuid[])
              and exists (
                select 1 from message_mentions mm
                 where mm.message_id = $3 and mm.mentioned_user_id = gm.user_id
              )
           returning gm.user_id, gm.unread_mention_count`,
          [groupId, affected.map((a) => a.user_id), messageId],
        )
        const updated = new Map(mentionDec.map((r) => [r.user_id, r.unread_mention_count]))
        for (const a of affected) {
          const v = updated.get(a.user_id)
          if (v !== undefined) a.unread_mention_count = v
        }
      }

      return { msg, affected }
    })

    if (!result) {
      return res.status(403).json({ error: 'cannot_delete' })
    }

    const payload = {
      id: result.msg.id,
      groupId,
      deletedAt: result.msg.deleted_at,
      deletedBy: result.msg.deleted_by,
    }
    const io = getIO()
    io.to(roomForGroup(groupId)).emit('message:deleted', payload)
    // Push the authoritative new sidebar counters to each member whose unread
    // dropped, so their rail badge updates live (the open conversation, if any,
    // already reflects the deletion via message:deleted).
    for (const a of result.affected) {
      io.to(roomForUser(a.user_id)).emit('group:unread', {
        groupId,
        unreadCount: a.unread_count,
        unreadMentionCount: a.unread_mention_count,
      })
    }
    res.json({ ok: true, message: payload })
  }),
)

// ── POST /api/groups/:id/messages/:messageId/pin ─────────────────────────
// Pin a message for the whole group. Any member may pin a real (user) message.
// Idempotent — re-pinning an already-pinned message just refreshes the stamp
// and does NOT add a duplicate activity row (only an unpinned→pinned transition
// logs one). Broadcasts message:pinned (pinned-bar/bubble state) and, on a real
// transition, message:system (the persisted "X pinned a message" row).
messageActionsRouter.post(
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
messageActionsRouter.post(
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

messageActionsRouter.post(
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
           ),
           bump as (
             -- Denormalized unread counter (migration 0020): a forward is a new
             -- user message, unread for every member except the author. Forwards
             -- never carry mentions, so only unread_count moves.
             update group_members set unread_count = unread_count + 1
              where group_id = $1 and user_id <> $2
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
messageActionsRouter.post(
  '/:id/messages/:messageId/delete-for-me',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id
    const messageId = req.params.messageId

    // Hide the message and adjust ONLY my own denormalized counters, atomically.
    // The membership join also enforces that the caller belongs to the group (so
    // a non-member can't probe for message existence). last_read_at is untouched.
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        was_unread: boolean
        mentioned: boolean
        already_hidden: boolean
      }>(
        `select
            (m.author_id <> $1 and m.deleted_at is null and m.kind = 'user'
             and coalesce(gm.last_read_at, 'epoch'::timestamptz) < m.created_at) as was_unread,
            exists (select 1 from message_mentions mm
                     where mm.message_id = m.id and mm.mentioned_user_id = $1) as mentioned,
            exists (select 1 from message_deletions md
                     where md.message_id = m.id and md.user_id = $1) as already_hidden
           from messages m
           join group_members gm on gm.group_id = m.group_id and gm.user_id = $1
          where m.id = $2 and m.group_id = $3
          limit 1`,
        [userId, messageId, groupId],
      )
      if (rows.length === 0) return { ok: false as const }
      const f = rows[0]

      await client.query(
        `insert into message_deletions (message_id, user_id)
         values ($1, $2) on conflict do nothing`,
        [messageId, userId],
      )

      // Decrement my counters only if this message was still counting as unread
      // for me AND it wasn't already hidden (an already-hidden message was
      // decremented when first hidden — never double-count). Floored at 0.
      let counts: { unread_count: number; unread_mention_count: number } | null = null
      if (f.was_unread && !f.already_hidden) {
        const { rows: dec } = await client.query<{
          unread_count: number
          unread_mention_count: number
        }>(
          `update group_members
              set unread_count = greatest(unread_count - 1, 0),
                  unread_mention_count = case when $3
                                              then greatest(unread_mention_count - 1, 0)
                                              else unread_mention_count end
            where group_id = $1 and user_id = $2
            returning unread_count, unread_mention_count`,
          [groupId, userId, f.mentioned],
        )
        counts = dec[0] ?? null
      }
      return { ok: true as const, counts }
    })

    if (!result.ok) return res.status(403).json({ error: 'cannot_delete' })

    const io = getIO()
    io.to(roomForUser(userId)).emit('message:hidden', { groupId, id: messageId })
    // Push my authoritative new sidebar counters to my other tabs/devices.
    if (result.counts) {
      io.to(roomForUser(userId)).emit('group:unread', {
        groupId,
        unreadCount: result.counts.unread_count,
        unreadMentionCount: result.counts.unread_mention_count,
      })
    }
    res.json({ ok: true })
  }),
)
