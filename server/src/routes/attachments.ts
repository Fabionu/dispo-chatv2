import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { getObject, FileNotFound } from '../storage.js'

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

    // Pull the bytes from object storage (private bucket) and proxy them
    // through this membership-gated route, so the bucket is never exposed
    // directly. A row whose object no longer exists (uploaded before the
    // storage migration, when files lived on a since-wiped ephemeral disk)
    // resolves to a clean 404 — the client renders an "unavailable" placeholder
    // rather than a broken image.
    let buffer: Buffer
    try {
      buffer = await getObject(a.storage_path)
    } catch (err) {
      if (err instanceof FileNotFound) {
        return res.status(404).json({ error: 'file_missing' })
      }
      throw err
    }

    res.setHeader('Content-Type', a.mime_type)
    res.setHeader('Content-Length', String(buffer.byteLength))
    // Inline so images render directly in <img>; the browser still respects
    // the filename on a manual save thanks to the attachment fallback.
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(a.original_name)}"`,
    )
    // Private (bytes are user-scoped) but immutable: an attachment id always
    // maps to the same bytes, so the browser can reuse them for a long time
    // instead of refetching on every render/reload.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.send(buffer)
  }),
)
