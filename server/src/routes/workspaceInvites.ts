import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { inviteCreateLimiter } from '../middleware/rateLimit.js'
import {
  generateInviteToken,
  hashInviteToken,
  inviteStatus,
  inviteUrl,
  INVITE_TTL_MS,
  COMPANY_ROLES,
  DEFAULT_INVITE_ROLE,
} from '../util/workspaceInvites.js'

// The role an invite grants. Constrained to the fixed company-role set; absent
// on create means the default ('dispatcher'), keeping older clients working.
const roleSchema = z.enum(COMPANY_ROLES)

// Admin-facing surface for COMPANY invite links: generate, list, revoke. The
// invitee-facing validate + register endpoints are public and live on the auth
// router (no session yet). Creating company members is an admin action, enforced
// here server-side (the UI also hides it, but the gate is here).
export const workspaceInvitesRouter = Router()
workspaceInvitesRouter.use(requireAuth)

// Only workspace admins may manage company invites. Mirrors companyProfile's
// requireAdmin so the authorization rule reads the same across the codebase.
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query<{ role: string }>('select role from users where id = $1', [
      req.session!.userId,
    ])
    if (rows[0]?.role !== 'admin') {
      res.status(403).json({ error: 'admin_only' })
      return
    }
    next()
  } catch (err) {
    next(err)
  }
}

type InviteRow = {
  id: string
  role: string
  created_at: string
  expires_at: string
  used_at: string | null
  created_by_name: string | null
  used_by_name: string | null
}

function mapInvite(r: InviteRow) {
  return {
    id: r.id,
    // Role the invitee will receive on registration. Older rows created before
    // the column default to 'dispatcher' at the DB level, so this is never null.
    role: r.role,
    status: inviteStatus(r),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    createdByName: r.created_by_name,
    usedByName: r.used_by_name,
  }
}

// ── GET /api/workspace-invites ───────────────────────────────────────────
// The workspace's recent invites with derived status (active/used/expired).
// Raw tokens are never returned here — only the hash is stored, so a link is
// shown exactly once, at creation time.
workspaceInvitesRouter.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.session!
    const { rows } = await pool.query<InviteRow>(
      `select wi.id, wi.role, wi.created_at, wi.expires_at, wi.used_at,
              cu.display_name as created_by_name,
              uu.display_name as used_by_name
         from workspace_invites wi
         left join users cu on cu.id = wi.created_by
         left join users uu on uu.id = wi.used_by
        where wi.workspace_id = $1
        order by wi.created_at desc
        limit 50`,
      [workspaceId],
    )
    res.json({ invites: rows.map(mapInvite) })
  }),
)

// ── POST /api/workspace-invites ──────────────────────────────────────────
// Generate a single-use link that expires in 15 minutes. Returns the raw token
// + ready-to-share URL ONCE; afterwards only status/expiry are visible. The
// admin picks the role the new member receives (validated against the fixed
// company-role set); an omitted role falls back to the default for older clients.
const createInviteSchema = z.object({ role: roleSchema.optional() })

workspaceInvitesRouter.post(
  '/',
  inviteCreateLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = createInviteSchema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_role' })
    const role = parsed.data.role ?? DEFAULT_INVITE_ROLE

    const { userId, workspaceId } = req.session!
    const token = generateInviteToken()
    const tokenHash = hashInviteToken(token)
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    const { rows } = await pool.query<{
      id: string
      role: string
      created_at: string
      expires_at: string
    }>(
      `insert into workspace_invites (workspace_id, token_hash, created_by, expires_at, role)
       values ($1, $2, $3, $4, $5)
       returning id, role, created_at, expires_at`,
      [workspaceId, tokenHash, userId, expiresAt, role],
    )

    const row = rows[0]
    res.status(201).json({
      invite: {
        id: row.id,
        role: row.role,
        token,
        url: inviteUrl(req, token),
        status: 'active' as const,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
    })
  }),
)

// ── PATCH /api/workspace-invites/:id ─────────────────────────────────────
// Change the role a still-pending (active) invite will grant, before anyone has
// accepted it. Used links are immutable (the member already exists with their
// role); expired ones can't be re-armed. Admin-only + workspace-scoped like the
// rest of this router, and the role is validated against the fixed set.
const updateInviteSchema = z.object({ role: roleSchema })

workspaceInvitesRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateInviteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_role' })
    const { workspaceId } = req.session!

    const { rows } = await pool.query<{ id: string; role: string }>(
      `update workspace_invites
          set role = $3
        where id = $1 and workspace_id = $2 and used_at is null and expires_at > now()
        returning id, role`,
      [req.params.id, workspaceId, parsed.data.role],
    )
    // No row updated → the invite is gone, used, or already expired (not editable).
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ invite: { id: rows[0].id, role: rows[0].role } })
  }),
)

// ── DELETE /api/workspace-invites/:id ────────────────────────────────────
// Revoke a still-active link (expire it now). Already-used links are unchanged.
workspaceInvitesRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.session!
    const { rowCount } = await pool.query(
      `update workspace_invites
          set expires_at = now()
        where id = $1 and workspace_id = $2 and used_at is null and expires_at > now()`,
      [req.params.id, workspaceId],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  }),
)
