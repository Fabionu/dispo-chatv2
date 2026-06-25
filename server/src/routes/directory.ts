import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'

export const directoryRouter = Router()
directoryRouter.use(requireAuth)

// ── GET /api/directory/users?q= ──────────────────────────────────────────
// Platform-wide people search — the entry point for starting a conversation
// with anyone, inside or outside the caller's company.
//
// For each match we also resolve the connection state relative to the caller
// (via the canonical least/greatest pair on `connections`) so the client can
// show the right action without a second round-trip:
//   - sameWorkspace            → message directly
//   - connection 'accepted'    → message directly
//   - connection 'pending'     → request in flight
//   - otherwise                → send a connection request
directoryRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { userId, workspaceId } = req.session!
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    // Require a couple of characters — a 1-char query matches half the table
    // and isn't useful.
    if (q.length < 2) return res.json({ users: [] })

    // Escape LIKE wildcards in the user's input so a literal '%' or '_' in a
    // name/email is matched literally, not as a pattern.
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

    const { rows } = await pool.query<{
      id: string
      display_name: string
      email: string
      workspace_id: string
      workspace_name: string
      same_workspace: boolean
      connection_status: 'pending' | 'accepted' | 'declined' | null
      connection_requested_by: string | null
    }>(
      `select u.id, u.display_name, u.email,
              w.id as workspace_id, w.name as workspace_name,
              (u.workspace_id = $2) as same_workspace,
              c.status as connection_status,
              c.requested_by as connection_requested_by
         from users u
         join workspaces w on w.id = u.workspace_id
         left join connections c
           on c.user_a_id = least($1::uuid, u.id)
          and c.user_b_id = greatest($1::uuid, u.id)
        where u.id <> $1
          and u.deleted_at is null
          and (u.display_name ilike $3 or u.email ilike $3 or w.name ilike $3)
        order by same_workspace desc, u.display_name asc
        limit 25`,
      [userId, workspaceId, like],
    )

    res.json({
      users: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        email: r.email,
        workspace: { id: r.workspace_id, name: r.workspace_name },
        sameWorkspace: r.same_workspace,
        connection: r.connection_status
          ? {
              status: r.connection_status,
              requestedByMe: r.connection_requested_by === userId,
            }
          : null,
      })),
    })
  }),
)
