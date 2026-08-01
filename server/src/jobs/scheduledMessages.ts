import { pool, type DbClient } from '../db/pool.js'
import { getIOIfReady, roomForGroup, roomForUser } from '../realtime.js'
import { sendMessagePush } from '../push.js'
import { loadMessage } from '../util/messages.js'
import { log } from '../util/log.js'

const POLL_INTERVAL_MS = 2_000
const MAX_PER_TICK = 25

type ScheduledRow = {
  id: string
  group_id: string
  author_id: string
  body: string
  reply_to_message_id: string | null
  mention_user_ids: string[]
}

type DispatchResult =
  | { processed: false }
  | {
      processed: true
      scheduledId: string
      authorId: string
      groupId: string
      failed: true
    }
  | {
      processed: true
      scheduledId: string
      authorId: string
      failed: false
      groupId: string
      messageId: string
    }

async function failJob(client: DbClient, id: string, error: string): Promise<void> {
  await client.query(
    `update scheduled_messages
        set status = 'failed', last_error = $2, updated_at = now()
      where id = $1`,
    [id, error],
  )
}

// Claim and deliver one due item in one short transaction. The row lock is
// held only while touching Postgres; realtime and Web Push happen after commit.
// SKIP LOCKED makes this safe when several API instances poll simultaneously.
async function dispatchOne(): Promise<DispatchResult> {
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows } = await client.query<ScheduledRow>(
      `select sm.id, sm.group_id, sm.author_id, sm.body,
              sm.reply_to_message_id, sm.mention_user_ids
         from scheduled_messages sm
        where sm.id = (
          select candidate.id
            from scheduled_messages candidate
           where candidate.status = 'pending'
             and candidate.scheduled_for <= now()
           order by candidate.scheduled_for asc, candidate.id asc
           for update skip locked
           limit 1
        )
        for update`,
    )

    if (rows.length === 0) {
      await client.query('commit')
      return { processed: false }
    }

    const scheduled = rows[0]

    // Membership and account state are evaluated at delivery time too. A user
    // removed from a room after scheduling must not retain delayed send access.
    const { rows: membership } = await client.query(
      `select 1
         from group_members gm
         join users u on u.id = gm.user_id and u.deleted_at is null
        where gm.group_id = $1 and gm.user_id = $2
        limit 1`,
      [scheduled.group_id, scheduled.author_id],
    )
    if (membership.length === 0) {
      await failJob(client, scheduled.id, 'Sender is no longer a member of this conversation.')
      await client.query('commit')
      return {
        processed: true,
        scheduledId: scheduled.id,
        authorId: scheduled.author_id,
        groupId: scheduled.group_id,
        failed: true,
      }
    }

    if (scheduled.reply_to_message_id) {
      const { rows: replyAccess } = await client.query(
        `select 1
           from messages m
           join group_members gm
             on gm.group_id = m.group_id and gm.user_id = $2
          where m.id = $1 and m.kind = 'user'
          limit 1`,
        [scheduled.reply_to_message_id, scheduled.author_id],
      )
      if (replyAccess.length === 0) {
        await failJob(client, scheduled.id, 'The replied-to message is no longer available.')
        await client.query('commit')
        return {
          processed: true,
          scheduledId: scheduled.id,
          authorId: scheduled.author_id,
          groupId: scheduled.group_id,
          failed: true,
        }
      }
    }

    const { rows: inserted } = await client.query<{ id: string; created_at: string }>(
      `insert into messages (group_id, author_id, body, reply_to_message_id)
       values ($1, $2, $3, $4::uuid)
       returning id, created_at`,
      [
        scheduled.group_id,
        scheduled.author_id,
        scheduled.body,
        scheduled.reply_to_message_id,
      ],
    )
    const message = inserted[0]

    await client.query('update groups set last_message_at = $2 where id = $1', [
      scheduled.group_id,
      message.created_at,
    ])
    await client.query(
      `update group_members
          set unread_count = unread_count + 1
        where group_id = $1 and user_id <> $2`,
      [scheduled.group_id, scheduled.author_id],
    )

    // Revalidate mentions against current room membership. Removed users are
    // silently dropped, matching the immediate-send path.
    const requestedMentions = [...new Set(scheduled.mention_user_ids)]
    if (requestedMentions.length > 0) {
      const { rows: validMentions } = await client.query<{ id: string }>(
        `select u.id
           from group_members gm
           join users u on u.id = gm.user_id
          where gm.group_id = $1
            and u.id = any($2::uuid[])
            and u.deleted_at is null`,
        [scheduled.group_id, requestedMentions],
      )
      const ids = validMentions.map((row) => row.id)
      if (ids.length > 0) {
        await client.query(
          `insert into message_mentions (message_id, mentioned_user_id)
           select $1, * from unnest($2::uuid[])
           on conflict do nothing`,
          [message.id, ids],
        )
        const unreadMentionIds = ids.filter((id) => id !== scheduled.author_id)
        if (unreadMentionIds.length > 0) {
          await client.query(
            `update group_members
                set unread_mention_count = unread_mention_count + 1
              where group_id = $1 and user_id = any($2::uuid[])`,
            [scheduled.group_id, unreadMentionIds],
          )
        }
      }
    }

    await client.query(
      `update scheduled_messages
          set status = 'sent', sent_message_id = $2, last_error = null, updated_at = now()
        where id = $1`,
      [scheduled.id, message.id],
    )
    await client.query('commit')

    return {
      processed: true,
      scheduledId: scheduled.id,
      authorId: scheduled.author_id,
      failed: false,
      groupId: scheduled.group_id,
      messageId: message.id,
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function dispatchDueMessages(): Promise<void> {
  for (let i = 0; i < MAX_PER_TICK; i++) {
    const result = await dispatchOne()
    if (!result.processed) return

    const io = getIOIfReady()
    if (result.failed) {
      io?.to(roomForUser(result.authorId)).emit('scheduled-message:changed', {
        id: result.scheduledId,
        groupId: result.groupId,
        status: 'failed',
      })
      continue
    }

    const message = await loadMessage(result.messageId)
    if (!message) {
      log.error('scheduled_message_load_failed', {
        scheduledMessageId: result.scheduledId,
        messageId: result.messageId,
      })
      continue
    }

    const payload = { ...message, groupId: result.groupId }
    io?.to(roomForGroup(result.groupId)).emit('message:new', payload)
    io?.to(roomForUser(result.authorId)).emit('scheduled-message:changed', {
      id: result.scheduledId,
      groupId: result.groupId,
      status: 'sent',
    })

    void sendMessagePush({
      id: result.messageId,
      groupId: result.groupId,
      authorId: result.authorId,
      authorName: message.authorName,
      body: message.body,
      hasAttachment: false,
    }).catch(() => {
      log.warn('push_dispatch_failed', {
        groupId: result.groupId,
        messageId: result.messageId,
      })
    })
  }
}

let running = false

export function initScheduledMessageWorker(): void {
  const tick = async () => {
    if (running) return
    running = true
    try {
      await dispatchDueMessages()
    } catch (error) {
      log.error('scheduled_message_worker_failed', {
        message: String((error as Error)?.message ?? error),
      })
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  timer.unref()
  setTimeout(() => void tick(), 250).unref()
  log.info('scheduled_message_worker_started', { pollIntervalMs: POLL_INTERVAL_MS })
}
