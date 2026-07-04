import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { asyncHandler, HttpError } from '../../http.js'
import { getIO, roomForGroup } from '../../realtime.js'
import { messageLimiter } from '../../middleware/rateLimit.js'
import { MAX_DOC_BYTES, MAX_IMAGE_BYTES, isImage, uploadAttachment } from '../../middleware/upload.js'
import { saveStream, deleteFile } from '../../storage.js'
import { enqueuePreviewJob } from '../../jobs/previewQueue.js'
import {
  MESSAGE_COLUMNS,
  MESSAGE_FROM,
  type MessageRow,
  mapMessageRow,
} from '../../util/messages.js'

export const messagesRouter = Router()

// ── GET /api/groups/:id/messages ─────────────────────────────────────────
// Cursor-based pagination. Default: latest 50. Pass ?before=<iso-timestamp>
// (the createdAt of the oldest message you currently have) to load older.
messagesRouter.get(
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
messagesRouter.get(
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

messagesRouter.post(
  '/:id/messages',
  messageLimiter,
  uploadAttachment,
  asyncHandler(async (req, res) => {
    const file = req.file
    // multer streamed this upload to a temp file on disk (never buffered in the
    // process heap — see uploadAttachment). The bytes we keep end up in storage,
    // so the temp file is removed once the response is done. Registered up front
    // so it fires on EVERY exit path — an early validation return, success, or a
    // thrown error. Best-effort: a failed unlink just leaves an OS-temp file.
    if (file?.path) {
      const tempPath = file.path
      res.on('close', () => void unlink(tempPath).catch(() => {}))
    }

    const parsed = postMessageSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

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
    // storage before the DB INSERT, and roll the file back on DB failure. This
    // keeps the storage layer ignorant of UUIDs handed out by Postgres.
    let storagePath: string | null = null
    let attachmentId: string | null = null
    if (file) {
      // Authorize BEFORE spending storage bandwidth on the upload: confirm the
      // sender belongs to the group. The message-insert CTE below still gates on
      // membership too (defense-in-depth, and it closes the tiny window between
      // this check and the insert), but pre-checking here avoids streaming a
      // whole file to storage only to delete it again for a non-member. The temp
      // file is still removed by the res.on('close') handler registered above.
      const { rows: membership } = await pool.query(
        'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
        [groupId, userId],
      )
      if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

      attachmentId = randomUUID()
      // Stream the temp file straight to storage — bytes flow disk→bucket in
      // chunks, so even a 25MB upload never lands in the heap. Only the ORIGINAL
      // is stored here; the (CPU-heavy) image preview is generated asynchronously
      // after the response (see the enqueuePreviewJob call once the message +
      // attachment row exist).
      storagePath = await saveStream(
        attachmentId,
        file.originalname,
        createReadStream(file.path),
        file.mimetype,
      )
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
         bump as (
           -- Denormalized unread counter (migration 0020): this new user message
           -- is unread for everyone EXCEPT the author. Mention counts are bumped
           -- separately, after mentions are validated against membership below.
           update group_members set unread_count = unread_count + 1
           where group_id = $1 and user_id <> $2 and exists (select 1 from ins)
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
            where gm.group_id = $1 and u.id = any($2::uuid[])
              and u.deleted_at is null`,
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

          // Denormalized mention counter (migration 0020): bump only for the
          // members we actually stored a mention for, excluding the author (a
          // self-mention is never unread for the sender — their last_read_at was
          // just advanced above). This runs after the unread_count bump in the
          // insert CTE, so a mentioned member's mention count stays a subset of
          // their unread count.
          const mentionedIds = validMembers.map((m) => m.id).filter((id) => id !== userId)
          if (mentionedIds.length > 0) {
            await pool.query(
              `update group_members set unread_mention_count = unread_mention_count + 1
                where group_id = $1 and user_id = any($2::uuid[])`,
              [groupId, mentionedIds],
            )
          }
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

      // Out of the request path: generate the image preview in the background,
      // then patch the attachment + notify the room. Non-blocking (enqueue
      // returns immediately); a failure here never affects the already-sent
      // message. The upload was STREAMED, so there's no in-memory buffer to
      // hand off — the worker re-fetches the original from storage by id (same
      // as the durable Redis queue path and the backfill script).
      if (file && attachmentId && isImage(file.mimetype)) {
        enqueuePreviewJob({ attachmentId })
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

messagesRouter.patch(
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
