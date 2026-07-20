import { Readable } from 'node:stream'
import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { createSignedUrl, getCachedSignedUrl, FileNotFound } from '../storage.js'

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
// Two serving strategies, chosen by sensitivity vs. traffic:
//
//   • PREVIEWS (?variant=preview — the hot path, requested for every image
//     bubble on every render): after the same membership check, the browser is
//     REDIRECTED to a short-lived signed URL and fetches the bytes straight
//     from Supabase Storage — they never transit this process. The signed URL
//     is minted once per object and reused for a window shorter than its
//     validity (see getCachedSignedUrl), so repeat requests within the window
//     redirect to the SAME URL and the browser serves the bytes from its own
//     cache. The 302 itself carries a private max-age covering the remainder
//     of that window, so most renders don't even hit the API.
//
//   • ORIGINALS (default — the lightbox + downloads): minted per request and
//     STREAMED through chunk-by-chunk (never buffered). Originals are the
//     sensitive full-resolution bytes; they stay behind this process so the
//     membership gate is re-checked on every fetch and the bucket is never
//     directly addressable from a long-lived URL held by the client.
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

    // Preview: hand the browser a redirect to the (cached) signed URL and let
    // it pull the bytes from storage directly. A vanished preview object is a
    // plain 404 (never flags the attachment missing — the original may be fine)
    // and is NOT cached negatively, matching the old proxy behaviour.
    if (usePreview) {
      try {
        const { url, maxAgeSec } = await getCachedSignedUrl(objectPath)
        res.setHeader('Cache-Control', `private, max-age=${maxAgeSec}`)
        return res.redirect(url)
      } catch (err) {
        if (err instanceof FileNotFound) return res.status(404).json({ error: 'file_missing' })
        throw err
      }
    }

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
