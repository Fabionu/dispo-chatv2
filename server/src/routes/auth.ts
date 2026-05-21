import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { clearSession, issueSession, readSession } from '../auth.js'
import { signinLimiter, signupLimiter } from '../middleware/rateLimit.js'
import { asyncHandler, HttpError, withTransaction } from '../http.js'

export const authRouter = Router()

const signInSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
})

const signUpSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(100),
  companyName: z.string().trim().min(1).max(120),
})

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace'
}

authRouter.post(
  '/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const parsed = signUpSchema.safeParse(req.body)
    if (!parsed.success) {
      const weak = parsed.error.issues.some(
        (i) => i.path[0] === 'password' && i.code === 'too_small',
      )
      return res.status(400).json({ error: weak ? 'weak_password' : 'invalid_input' })
    }

    const { email, password, displayName, companyName } = parsed.data
    const normEmail = email.toLowerCase().trim()
    const baseSlug = slugify(companyName)
    const hash = await bcrypt.hash(password, 10)

    const { userId, workspaceId } = await withTransaction(async (client) => {
      // Pick a free slug. Two transport companies with the same name is
      // plausible, so we append a short random suffix on collision.
      let slug = baseSlug
      for (let attempt = 0; attempt < 5; attempt++) {
        const { rowCount } = await client.query('select 1 from workspaces where slug = $1', [slug])
        if (rowCount === 0) break
        slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
      }

      const ws = await client.query<{ id: string }>(
        `insert into workspaces (name, slug) values ($1, $2) returning id`,
        [companyName, slug],
      )
      const workspaceId = ws.rows[0].id

      try {
        const userRow = await client.query<{ id: string }>(
          `insert into users (workspace_id, email, password_hash, display_name, role)
           values ($1, $2, $3, $4, 'admin')
           returning id`,
          [workspaceId, normEmail, hash, displayName],
        )
        return { userId: userRow.rows[0].id, workspaceId }
      } catch (err: unknown) {
        // 23505 = unique_violation on (workspace_id, email).
        if ((err as { code?: string }).code === '23505') {
          throw new HttpError(409, 'email_taken')
        }
        throw err
      }
    })

    issueSession(res, { userId, workspaceId })
    res.status(201).json({
      user: { id: userId, email: normEmail, displayName, role: 'admin', workspaceId },
    })
  }),
)

authRouter.post(
  '/signin',
  signinLimiter,
  asyncHandler(async (req, res) => {
    const parsed = signInSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const email = parsed.data.email.toLowerCase().trim()
    const { rows } = await pool.query<{
      id: string
      workspace_id: string
      password_hash: string
      display_name: string
      role: string
    }>(
      `select id, workspace_id, password_hash, display_name, role
         from users where lower(email) = $1 limit 1`,
      [email],
    )

    const user = rows[0]
    // Constant-ish time: always run a bcrypt compare even when the user is
    // missing, so timing doesn't reveal whether the email exists.
    const dummy = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q5J5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z'
    const ok = await bcrypt.compare(parsed.data.password, user?.password_hash ?? dummy)
    if (!user || !ok) return res.status(401).json({ error: 'invalid_credentials' })

    await pool.query('update users set last_login_at = now() where id = $1', [user.id])
    issueSession(res, { userId: user.id, workspaceId: user.workspace_id })

    res.json({
      user: {
        id: user.id,
        email,
        displayName: user.display_name,
        role: user.role,
        workspaceId: user.workspace_id,
      },
    })
  }),
)

authRouter.post('/signout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const session = readSession(req)
    if (!session) return res.status(401).json({ error: 'unauthenticated' })

    const { rows } = await pool.query<{
      id: string
      email: string
      display_name: string
      role: string
      workspace_id: string
      workspace_name: string
      workspace_slug: string
    }>(
      `select u.id, u.email, u.display_name, u.role,
              u.workspace_id, w.name as workspace_name, w.slug as workspace_slug
         from users u
         join workspaces w on w.id = u.workspace_id
        where u.id = $1
        limit 1`,
      [session.userId],
    )
    const u = rows[0]
    if (!u) return res.status(401).json({ error: 'unauthenticated' })

    res.json({
      user: { id: u.id, email: u.email, displayName: u.display_name, role: u.role },
      workspace: { id: u.workspace_id, name: u.workspace_name, slug: u.workspace_slug },
    })
  }),
)
