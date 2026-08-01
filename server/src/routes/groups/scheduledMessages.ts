import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { asyncHandler } from '../../http.js'
import { getIOIfReady, roomForUser } from '../../realtime.js'

export const scheduledMessagesRouter = Router()

const scheduleSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  scheduledFor: z.string().datetime({ offset: true }),
  replyToMessageId: z.string().uuid().optional(),
  mentionUserIds: z.array(z.string().uuid()).max(50).optional().default([]),
})

type ScheduledMessageRow = {
  id: string
  group_id: string
  body: string
  reply_to_message_id: string | null
  scheduled_for: string
  status: 'pending' | 'failed'
  last_error: string | null
  created_at: string
}

function mapScheduledMessage(row: ScheduledMessageRow) {
  return {
    id: row.id,
    groupId: row.group_id,
    body: row.body,
    replyToMessageId: row.reply_to_message_id,
    scheduledFor: row.scheduled_for,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

// Private list: a member sees only their own not-yet-delivered items.
scheduledMessagesRouter.get(
  '/:id/scheduled-messages',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows: membership } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    const { rows } = await pool.query<ScheduledMessageRow>(
      `select id, group_id, body, reply_to_message_id, scheduled_for,
              status, last_error, created_at
         from scheduled_messages
        where group_id = $1
          and author_id = $2
          and status in ('pending', 'failed')
        order by scheduled_for asc, id asc`,
      [groupId, userId],
    )

    res.json({ scheduledMessages: rows.map(mapScheduledMessage) })
  }),
)

scheduledMessagesRouter.post(
  '/:id/scheduled-messages',
  asyncHandler(async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const { userId } = req.session!
    const groupId = req.params.id
    const scheduledFor = new Date(parsed.data.scheduledFor)
    const now = Date.now()
    if (scheduledFor.getTime() < now + 10_000) {
      return res.status(400).json({ error: 'scheduled_time_not_future' })
    }
    if (scheduledFor.getTime() > now + 366 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'scheduled_time_too_far' })
    }

    const { rows: membership } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    const replyToMessageId = parsed.data.replyToMessageId ?? null
    if (replyToMessageId) {
      const { rows: replyAccess } = await pool.query(
        `select 1
           from messages m
           join group_members gm on gm.group_id = m.group_id and gm.user_id = $2
          where m.id = $1 and m.kind = 'user'
          limit 1`,
        [replyToMessageId, userId],
      )
      if (replyAccess.length === 0) {
        return res.status(400).json({ error: 'invalid_reply' })
      }
    }

    // Keep only current members, deduplicated. This is validated again at
    // dispatch because membership may change while the item is waiting.
    const requestedIds = [...new Set(parsed.data.mentionUserIds)]
    let mentionIds: string[] = []
    if (requestedIds.length > 0) {
      const { rows } = await pool.query<{ id: string }>(
        `select u.id
           from group_members gm
           join users u on u.id = gm.user_id
          where gm.group_id = $1
            and u.id = any($2::uuid[])
            and u.deleted_at is null`,
        [groupId, requestedIds],
      )
      mentionIds = rows.map((row) => row.id)
    }

    const { rows } = await pool.query<ScheduledMessageRow>(
      `insert into scheduled_messages
         (group_id, author_id, body, reply_to_message_id, mention_user_ids, scheduled_for)
       values ($1, $2, $3, $4::uuid, $5::uuid[], $6)
       returning id, group_id, body, reply_to_message_id, scheduled_for,
                 status, last_error, created_at`,
      [
        groupId,
        userId,
        parsed.data.body,
        replyToMessageId,
        mentionIds,
        scheduledFor.toISOString(),
      ],
    )

    const scheduledMessage = mapScheduledMessage(rows[0])
    getIOIfReady()?.to(roomForUser(userId)).emit('scheduled-message:changed', {
      id: scheduledMessage.id,
      groupId,
      status: 'pending',
    })
    res.status(201).json({ scheduledMessage })
  }),
)

scheduledMessagesRouter.delete(
  '/:id/scheduled-messages/:scheduledMessageId',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const { id: groupId, scheduledMessageId } = req.params
    if (!z.string().uuid().safeParse(scheduledMessageId).success) {
      return res.status(400).json({ error: 'invalid_input' })
    }

    const { rows } = await pool.query<{ id: string }>(
      `delete from scheduled_messages
        where id = $1
          and group_id = $2
          and author_id = $3
          and status in ('pending', 'failed')
       returning id`,
      [scheduledMessageId, groupId, userId],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'scheduled_message_not_found' })

    getIOIfReady()?.to(roomForUser(userId)).emit('scheduled-message:changed', {
      id: scheduledMessageId,
      groupId,
      status: 'deleted',
    })
    res.status(204).end()
  }),
)
