import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { openStream } from '../storage.js'

export const attachmentsRouter = Router()
attachmentsRouter.use(requireAuth)

// ── GET /api/attachments/:id ─────────────────────────────────────────────
// Streams an attachment's bytes to the caller, gated on membership of the
// group that owns the parent message. Uploads are NOT publicly served — this
// route is the only door in.
attachmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const id = req.params.id

    const { rows } = await pool.query<{
      original_name: string
      mime_type: string
      byte_size: string
      storage_path: string
    }>(
      `select a.original_name, a.mime_type, a.byte_size, a.storage_path
         from attachments a
         join messages m on m.id = a.message_id
         join group_members gm on gm.group_id = m.group_id
        where a.id = $1
          and gm.user_id = $2
        limit 1`,
      [id, userId],
    )

    if (rows.length === 0) return res.status(404).json({ error: 'not_found' })
    const a = rows[0]

    res.setHeader('Content-Type', a.mime_type)
    res.setHeader('Content-Length', a.byte_size)
    // Inline so images render directly in <img>; the browser still respects
    // the filename on a manual save thanks to the attachment fallback.
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(a.original_name)}"`,
    )
    // Private cache only — bytes are user-scoped.
    res.setHeader('Cache-Control', 'private, max-age=3600')

    const stream = openStream(a.storage_path)
    stream.on('error', (err) => {
      // If the file's missing on disk (orphan row, manual cleanup, etc.),
      // close the response with a 500 unless headers have already gone out.
      if (!res.headersSent) res.status(500).json({ error: 'read_failed' })
      else res.destroy(err)
    })
    stream.pipe(res)
  }),
)
