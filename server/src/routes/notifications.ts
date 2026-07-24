import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../http.js'
import { env } from '../env.js'
import { pushIsConfigured } from '../push.js'

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

notificationsRouter.get('/vapid-public-key', (_req, res) => {
  if (!pushIsConfigured()) {
    return res.status(503).json({ error: 'push_not_configured' })
  }
  res.json({ publicKey: env.VAPID_PUBLIC_KEY })
})

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024),
  }),
})

notificationsRouter.post(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    if (!pushIsConfigured()) {
      return res.status(503).json({ error: 'push_not_configured' })
    }
    const parsed = subscriptionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_subscription' })

    const { endpoint, keys } = parsed.data
    await pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update
         set user_id = excluded.user_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             user_agent = excluded.user_agent,
             updated_at = now()`,
      [req.session!.userId, endpoint, keys.p256dh, keys.auth, req.get('user-agent') ?? null],
    )
    res.status(201).json({ ok: true })
  }),
)

const deleteSchema = z.object({ endpoint: z.string().url().max(4096) })

notificationsRouter.delete(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const parsed = deleteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_subscription' })
    await pool.query(
      'delete from push_subscriptions where user_id = $1 and endpoint = $2',
      [req.session!.userId, parsed.data.endpoint],
    )
    res.json({ ok: true })
  }),
)
