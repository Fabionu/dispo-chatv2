import { Router, type Request, type Response, type NextFunction } from 'express'
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
} from '../util/workspaceInvites.js'

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
  created_at: string
  expires_at: string
  used_at: string | null
  created_by_name: string | null
  used_by_name: string | null
}

function mapInvite(r: InviteRow) {
  return {
    id: r.id,
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
      `select wi.id, wi.created_at, wi.expires_at, wi.used_at,
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
// + ready-to-share URL ONCE; afterwards only status/expiry are visible.
workspaceInvitesRouter.post(
  '/',
  inviteCreateLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId, workspaceId } = req.session!
    const token = generateInviteToken()
    const tokenHash = hashInviteToken(token)
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    const { rows } = await pool.query<{ id: string; created_at: string; expires_at: string }>(
      `insert into workspace_invites (workspace_id, token_hash, created_by, expires_at)
       values ($1, $2, $3, $4)
       returning id, created_at, expires_at`,
      [workspaceId, tokenHash, userId, expiresAt],
    )

    const row = rows[0]
    res.status(201).json({
      invite: {
        id: row.id,
        token,
        url: inviteUrl(req, token),
        status: 'active' as const,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
    })
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
