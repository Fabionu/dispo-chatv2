import { Readable } from 'node:stream'
import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { createSignedUrl, FileNotFound } from '../storage.js'

export const attachmentsRouter = Router()
attachmentsRouter.use(requireAuth)

// ── GET /api/attachments/:id ─────────────────────────────────────────────
// Streams an attachment's bytes to the caller, gated on membership of the
// group that owns the parent message. Uploads are NOT publicly served — this
// route is the only door in.
//
//   ?variant=preview → the small WebP preview for chat bubbles (falls back to
//                       the original when no preview exists, e.g. GIFs or
//                       images uploaded before previews existed).
//   (default)        → the full original, for the lightbox modal + downloads.
//
// We mint a short-lived signed URL to the private object and STREAM it through
// instead of downloading the whole object into Node memory: the membership
// check stays server-side and the bucket is never exposed, but a 25MB original
// flows chunk-by-chunk rather than being buffered. The proxy URL is stable per
// (id, variant), so the response stays immutably cacheable in the browser.
attachmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const id = req.params.id
    const wantsPreview = req.query.variant === 'preview'

    const { rows } = await pool.query<{
      original_name: string
      mime_type: string
      storage_path: string
      preview_path: string | null
      missing: boolean
    }>(
      `select a.original_name, a.mime_type, a.storage_path, a.preview_path, a.missing
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

    // Already known gone — don't re-attempt storage on every render. 404 fast.
    if (a.missing) return res.status(404).json({ error: 'file_missing' })

    // Serve the preview only when one was generated; otherwise fall back to the
    // original (the client requests ?variant=preview optimistically for images).
    const usePreview = wantsPreview && a.preview_path !== null
    const objectPath = usePreview ? a.preview_path! : a.storage_path
    const contentType = usePreview ? 'image/webp' : a.mime_type
    // Whether this request is for the canonical original (vs. a preview-only
    // object). Only an original going missing flags the whole attachment.
    const isOriginal = objectPath === a.storage_path

    // Persist a discovered-missing object so future requests / message loads
    // short-circuit instead of slowly rediscovering the 404. Best-effort.
    const flagMissing = () => {
      if (!isOriginal) return
      void pool
        .query('update attachments set missing = true where id = $1', [id])
        .catch(() => {})
    }

    // A row whose object no longer exists (uploaded before the storage
    // migration, when files lived on a since-wiped ephemeral disk) resolves to
    // a clean 404 — the client renders an "unavailable" placeholder rather than
    // a broken image. createSignedUrl fails fast for a missing object, so this
    // does not hang.
    let signedUrl: string
    try {
      signedUrl = await createSignedUrl(objectPath)
    } catch (err) {
      if (err instanceof FileNotFound) {
        flagMissing()
        return res.status(404).json({ error: 'file_missing' })
      }
      throw err
    }

    const upstream = await fetch(signedUrl)
    if (!upstream.ok || !upstream.body) {
      // Object vanished between signing and fetching, or storage hiccup.
      flagMissing()
      return res.status(404).json({ error: 'file_missing' })
    }

    res.setHeader('Content-Type', contentType)
    const len = upstream.headers.get('content-length')
    if (len) res.setHeader('Content-Length', len)
    // Inline so images/PDFs render directly; the browser still honours the
    // filename on a manual save thanks to the attachment fallback.
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(a.original_name)}"`,
    )
    // Private (bytes are user-scoped) but immutable: an (id, variant) pair
    // always maps to the same bytes, so the browser can reuse them for a long
    // time instead of refetching on every render/reload.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')

    // Stream the upstream body straight to the client. Aborting the response
    // (client navigated away) destroys the Node stream, which tears down the
    // upstream fetch.
    Readable.fromWeb(upstream.body).pipe(res)
  }),
)
