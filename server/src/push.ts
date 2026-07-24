import webpush from 'web-push'
import { pool } from './db/pool.js'
import { env } from './env.js'
import { log } from './util/log.js'

const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)

if (configured) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
} else {
  log.warn('web_push_disabled', { reason: 'missing_vapid_keys' })
}

export function pushIsConfigured() {
  return configured
}

type MessagePush = {
  id: string
  groupId: string
  authorId: string
  authorName: string
  body: string
  hasAttachment: boolean
}

type Recipient = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  group_name: string | null
  group_type: string
}

export async function sendMessagePush(message: MessagePush): Promise<void> {
  if (!configured) return

  const { rows } = await pool.query<Recipient>(
    `select ps.id, ps.endpoint, ps.p256dh, ps.auth,
            g.name as group_name, g.type as group_type
       from group_members gm
       join push_subscriptions ps on ps.user_id = gm.user_id
       join groups g on g.id = gm.group_id
       join users u on u.id = gm.user_id
      where gm.group_id = $1
        and gm.user_id <> $2
        and gm.muted = false
        and u.deleted_at is null`,
    [message.groupId, message.authorId],
  )
  if (rows.length === 0) return

  const body =
    message.body.trim().slice(0, 180) ||
    (message.hasAttachment ? 'Sent an attachment' : 'New message')

  await Promise.allSettled(
    rows.map(async (recipient) => {
      const title =
        recipient.group_type === 'vehicle' && recipient.group_name
          ? `${message.authorName} · ${recipient.group_name}`
          : message.authorName || 'New message'
      try {
        await webpush.sendNotification(
          {
            endpoint: recipient.endpoint,
            keys: { p256dh: recipient.p256dh, auth: recipient.auth },
          },
          JSON.stringify({
            title,
            body,
            groupId: message.groupId,
            messageId: message.id,
          }),
          { TTL: 60 * 60, urgency: 'high' },
        )
      } catch (error) {
        const statusCode =
          typeof error === 'object' && error && 'statusCode' in error
            ? Number(error.statusCode)
            : 0
        if (statusCode === 404 || statusCode === 410) {
          await pool.query('delete from push_subscriptions where id = $1', [recipient.id])
          return
        }
        log.warn('push_send_failed', {
          subscriptionId: recipient.id,
          statusCode: statusCode || undefined,
        })
      }
    }),
  )
}
