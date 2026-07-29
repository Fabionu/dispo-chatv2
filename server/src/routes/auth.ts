import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { pool, type DbClient } from '../db/pool.js'
import { clearSession, issueSession, readSession } from '../auth.js'
import {
  emailVerificationLimiter,
  signinLimiter,
  signupLimiter,
} from '../middleware/rateLimit.js'
import { asyncHandler, HttpError, withTransaction } from '../http.js'
import { hashInviteToken } from '../util/workspaceInvites.js'
import { getIOIfReady, roomForWorkspace } from '../realtime.js'
import {
  emailVerificationUrl,
  hashEmailVerificationToken,
  issueEmailVerificationToken,
} from '../util/emailVerification.js'
import { sendVerificationEmail } from '../email/resend.js'

export const authRouter = Router()

const emailSchema = z.string().trim().toLowerCase().email().max(254)

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
})

const signUpSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(100),
  companyName: z.string().trim().min(1).max(120),
})

async function lockAndAssertEmailAvailable(client: DbClient, email: string) {
  // Sign-in is global by email, so new accounts must be global too. The
  // transaction-scoped advisory lock closes the cross-workspace race that the
  // original workspace-scoped unique constraint cannot prevent.
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [email])
  const { rowCount } = await client.query(
    'select 1 from users where lower(email) = $1 and deleted_at is null limit 1',
    [email],
  )
  if (rowCount) throw new HttpError(409, 'email_taken')
}

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

    const { email: normEmail, password, displayName, companyName } = parsed.data
    const baseSlug = slugify(companyName)
    const hash = await bcrypt.hash(password, 10)

    const { verification } = await withTransaction(async (client) => {
      await lockAndAssertEmailAvailable(client, normEmail)
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
        const userId = userRow.rows[0].id
        const verification = await issueEmailVerificationToken(client, userId)
        return { userId, workspaceId, verification }
      } catch (err: unknown) {
        // 23505 = unique_violation on (workspace_id, email).
        if ((err as { code?: string }).code === '23505') {
          throw new HttpError(409, 'email_taken')
        }
        throw err
      }
    })

    const delivery = await sendVerificationEmail({
      to: normEmail,
      displayName,
      verificationUrl: emailVerificationUrl(req, verification.token),
      tokenId: verification.id,
    })
    res.status(201).json({
      verificationRequired: true,
      email: normEmail,
      emailSent: delivery.sent,
    })
  }),
)

authRouter.post(
  '/signin',
  signinLimiter,
  asyncHandler(async (req, res) => {
    const parsed = signInSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const email = parsed.data.email
    const { rows } = await pool.query<{
      id: string
      workspace_id: string
      email: string
      password_hash: string
      display_name: string
      role: string
      email_verified_at: string | null
    }>(
      `select id, workspace_id, email, password_hash, display_name, role, email_verified_at
         from users
        where lower(email) = $1 and deleted_at is null
        order by (email_verified_at is not null) desc, created_at asc
        limit 10`,
      [email],
    )

    // Legacy data can contain the same email in more than one workspace. Test
    // every candidate instead of authenticating an arbitrary first row.
    const dummy = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q5J5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z'
    const candidates = rows.length ? rows : [{ password_hash: dummy }]
    const matches = await Promise.all(
      candidates.map((candidate) => bcrypt.compare(parsed.data.password, candidate.password_hash)),
    )
    const matchedIndex = matches.findIndex(Boolean)
    const user = matchedIndex >= 0 ? rows[matchedIndex] : undefined
    if (!user) return res.status(401).json({ error: 'invalid_credentials' })
    if (!user.email_verified_at) {
      clearSession(res)
      return res.status(403).json({ error: 'email_not_verified', email: user.email })
    }

    await pool.query('update users set last_login_at = now() where id = $1', [user.id])
    issueSession(res, { userId: user.id, workspaceId: user.workspace_id })

    res.json({
      user: {
        id: user.id,
        email: user.email,
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

// ── GET /api/auth/invite/:token ──────────────────────────────────────────
// Public: validate a company invite link so the registration page can decide
// what to render. Always 200 with a discriminated `status` so the client shows
// a clean state without branching on HTTP codes. Returns the inviting company's
// name only when the token is still usable, for the read-only prefill.
authRouter.get(
  '/invite/:token',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{
      used_at: string | null
      expires_at: string
      company_name: string
      role: string
      recipient_email: string | null
    }>(
      `select wi.used_at, wi.expires_at, wi.role, wi.recipient_email,
              w.name as company_name
         from workspace_invites wi
         join workspaces w on w.id = wi.workspace_id
        where wi.token_hash = $1
        limit 1`,
      [hashInviteToken(req.params.token)],
    )
    const row = rows[0]
    if (!row) return res.json({ status: 'invalid' as const })
    if (row.used_at) return res.json({ status: 'used' as const })
    if (new Date(row.expires_at).getTime() <= Date.now())
      return res.json({ status: 'expired' as const })
    // `role` lets the registration page show the invitee which role they'll get.
    res.json({
      status: 'valid' as const,
      companyName: row.company_name,
      role: row.role,
      recipientEmail: row.recipient_email,
    })
  }),
)

const acceptInviteSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(100),
})

// ── POST /api/auth/invite/:token/accept ──────────────────────────────────
// Public: register a new account attached to the inviting workspace and consume
// the link. Rate-limited like signup. The whole thing runs in one transaction
// with the invite row locked FOR UPDATE, so the token is strictly single-use
// even under concurrent submits: the first commit sets used_at; the second sees
// it and fails with `invite_used`.
authRouter.post(
  '/invite/:token/accept',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const parsed = acceptInviteSchema.safeParse(req.body)
    if (!parsed.success) {
      const weak = parsed.error.issues.some(
        (i) => i.path[0] === 'password' && i.code === 'too_small',
      )
      return res.status(400).json({ error: weak ? 'weak_password' : 'invalid_input' })
    }

    const { email: normEmail, password, displayName } = parsed.data
    const tokenHash = hashInviteToken(req.params.token)
    const hash = await bcrypt.hash(password, 10)

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        id: string
        workspace_id: string
        used_at: string | null
        expires_at: string
        role: string
        recipient_email: string | null
        email_sent_at: string | null
      }>(
        `select id, workspace_id, used_at, expires_at, role, recipient_email, email_sent_at
           from workspace_invites
          where token_hash = $1
          for update`,
        [tokenHash],
      )
      const invite = rows[0]
      if (!invite) throw new HttpError(404, 'invite_invalid')
      if (invite.used_at) throw new HttpError(409, 'invite_used')
      if (new Date(invite.expires_at).getTime() <= Date.now())
        throw new HttpError(410, 'invite_expired')
      if (invite.recipient_email && invite.recipient_email !== normEmail)
        throw new HttpError(400, 'invite_email_mismatch')

      await lockAndAssertEmailAvailable(client, normEmail)
      const verifiedByDeliveredInvite = Boolean(invite.recipient_email && invite.email_sent_at)

      let userId: string
      try {
        // The new member joins with the role the admin chose when generating the
        // link (stored on the invite, validated there against the fixed role set
        // and re-checked by the users.role constraint). Invites created before the
        // role column default to 'dispatcher' — the previous hardcoded behaviour.
        const userRow = await client.query<{ id: string }>(
          `insert into users (
             workspace_id, email, password_hash, display_name, role, email_verified_at
           )
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            invite.workspace_id,
            normEmail,
            hash,
            displayName,
            invite.role,
            // Consuming a link delivered to this exact address proves ownership.
            // Legacy link-only invites still require a confirmation email.
            verifiedByDeliveredInvite ? new Date() : null,
          ],
        )
        userId = userRow.rows[0].id
      } catch (err: unknown) {
        // 23505 = unique_violation on (workspace_id, email): already a member.
        if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'email_taken')
        throw err
      }

      await client.query(
        `update workspace_invites set used_at = now(), used_by = $1 where id = $2`,
        [userId, invite.id],
      )
      const verification = verifiedByDeliveredInvite
        ? null
        : await issueEmailVerificationToken(client, userId)
      return { userId, workspaceId: invite.workspace_id, role: invite.role, verification }
    })

    let emailSent = true
    if (result.verification) {
      const delivery = await sendVerificationEmail({
        to: normEmail,
        displayName,
        verificationUrl: emailVerificationUrl(req, result.verification.token),
        tokenId: result.verification.id,
      })
      emailSent = delivery.sent
    } else {
      issueSession(res, { userId: result.userId, workspaceId: result.workspaceId })
    }

    // Tell existing members (already connected) that the company roster changed,
    // so their sidebar contact list picks up the new colleague without a reload.
    // The new user isn't connected yet — they fetch members fresh on first load.
    getIOIfReady()
      ?.to(roomForWorkspace(result.workspaceId))
      .emit('workspace:members_changed', { workspaceId: result.workspaceId })

    res.status(201).json(
      result.verification
        ? { verificationRequired: true, email: normEmail, emailSent }
        : {
            user: {
              id: result.userId,
              email: normEmail,
              displayName,
              role: result.role,
              workspaceId: result.workspaceId,
            },
          },
    )
  }),
)

const resendVerificationSchema = z.object({ email: emailSchema })
const confirmVerificationSchema = z.object({
  token: z.string().trim().min(32).max(200),
})

// Public and intentionally enumeration-safe: a syntactically valid address
// receives the same 202 whether it is unknown, already verified, or sent.
authRouter.post(
  '/email-verification/resend',
  emailVerificationLimiter,
  asyncHandler(async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_email' })

    const { rows } = await pool.query<{
      id: string
      email: string
      display_name: string
      email_verified_at: string | null
    }>(
      `select id, email, display_name, email_verified_at
         from users
        where lower(email) = $1 and deleted_at is null
        order by created_at desc
        limit 1`,
      [parsed.data.email],
    )
    const user = rows[0]
    if (!user || user.email_verified_at) return res.status(202).json({ ok: true })

    const verification = await withTransaction((client) =>
      issueEmailVerificationToken(client, user.id),
    )
    const delivery = await sendVerificationEmail({
      to: user.email,
      displayName: user.display_name,
      verificationUrl: emailVerificationUrl(req, verification.token),
      tokenId: verification.id,
    })
    if (!delivery.sent) {
      return res.status(502).json({
        error:
          delivery.reason === 'not_configured'
            ? 'email_not_configured'
            : 'email_delivery_failed',
      })
    }

    res.status(202).json({ ok: true })
  }),
)

authRouter.post(
  '/email-verification/confirm',
  emailVerificationLimiter,
  asyncHandler(async (req, res) => {
    const parsed = confirmVerificationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'verification_invalid' })

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{
        user_id: string
        workspace_id: string
        expires_at: string
        consumed_at: string | null
        email_verified_at: string | null
        deleted_at: string | null
      }>(
        `select evt.user_id, evt.expires_at, evt.consumed_at,
                u.workspace_id, u.email_verified_at, u.deleted_at
           from email_verification_tokens evt
           join users u on u.id = evt.user_id
          where evt.token_hash = $1
          for update of evt, u`,
        [hashEmailVerificationToken(parsed.data.token)],
      )
      const row = rows[0]
      if (!row || row.deleted_at) throw new HttpError(400, 'verification_invalid')
      // Confirmation is idempotent for an already-consumed link belonging to a
      // verified account, which makes browser refreshes harmless.
      if (row.consumed_at) {
        if (!row.email_verified_at) throw new HttpError(400, 'verification_invalid')
        return { userId: row.user_id, workspaceId: row.workspace_id }
      }
      if (new Date(row.expires_at).getTime() <= Date.now())
        throw new HttpError(410, 'verification_expired')

      await client.query(
        `update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1`,
        [row.user_id],
      )
      await client.query(
        `update email_verification_tokens
            set consumed_at = now()
          where user_id = $1 and consumed_at is null`,
        [row.user_id],
      )
      return { userId: row.user_id, workspaceId: row.workspace_id }
    })

    issueSession(res, result)
    res.json({ ok: true })
  }),
)

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
          and u.deleted_at is null
        limit 1`,
      [session.userId],
    )
    const u = rows[0]
    // No row (or a soft-deleted/anonymized account) → treat the stale JWT as
    // signed out so the client drops it on next load.
    if (!u) return res.status(401).json({ error: 'unauthenticated' })

    res.json({
      user: { id: u.id, email: u.email, displayName: u.display_name, role: u.role },
      workspace: { id: u.workspace_id, name: u.workspace_name, slug: u.workspace_slug },
    })
  }),
)
