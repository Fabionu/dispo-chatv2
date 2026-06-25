import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'

export const workspaceRouter = Router()
workspaceRouter.use(requireAuth)

// ── GET /api/workspace/members ───────────────────────────────────────────
// Lists everyone in the caller's workspace. Drives the internal DM picker
// and the optional member selector when creating a vehicle group. The caller
// themselves is excluded — you don't DM yourself or add yourself twice.
workspaceRouter.get(
  '/members',
  asyncHandler(async (req, res) => {
    const { userId, workspaceId } = req.session!

    const { rows } = await pool.query<{
      id: string
      display_name: string
      email: string
      role: string
    }>(
      `select id, display_name, email, role
         from users
        where workspace_id = $1
          and id <> $2
          and deleted_at is null
        order by display_name asc
        limit 500`,
      [workspaceId, userId],
    )

    res.json({
      members: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        email: r.email,
        role: r.role,
      })),
    })
  }),
)
