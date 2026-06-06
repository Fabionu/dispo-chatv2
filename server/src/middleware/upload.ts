import os from 'node:os'
import { unlink } from 'node:fs/promises'
import multer, { type FileFilterCallback } from 'multer'
import type { Request, Response, NextFunction } from 'express'

// Allowed attachment types. Mime is what the browser claims; we cross-check
// against the file extension in the route to make spoofing harder.
export const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export const DOC_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB
export const MAX_DOC_BYTES = 25 * 1024 * 1024 // 25MB

// multer's global cap is the larger of the two; the route enforces the per-
// mime cap once it knows what kind of file actually arrived.
const HARD_CAP = MAX_DOC_BYTES

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) {
  if (IMAGE_MIMES.has(file.mimetype) || DOC_MIMES.has(file.mimetype)) {
    cb(null, true)
  } else {
    // Reject without crashing the request — the route inspects req.file and
    // returns a friendly 415.
    cb(null, false)
  }
}

// ── Avatar uploads: in-memory (small images, processed as buffers) ──────────
// uploadSingle keeps multer.memoryStorage() ON PURPOSE. Its callers — the user
// avatar (routes/profile.ts), company logo (routes/companyProfile.ts) and group
// avatar (routes/groups.ts) — hand file.buffer straight to storage.saveBuffer
// (and may resize via Sharp, which works on a buffer). These are image-only and
// capped at MAX_IMAGE_BYTES (10MB), low-frequency, and need the bytes in hand,
// so buffering them is cheap and simplest. The HEAVY, high-frequency path —
// message attachments (up to 25MB docs, many concurrent senders) — uses the
// STREAMING engine below instead, so it never parks whole files in the heap.
export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_CAP, files: 1 },
  fileFilter,
}).single('file')

// ── Message attachments: streamed to a temp file (no heap buffering) ─────────
// Disk storage streams the incoming request to a temp file in the OS temp dir in
// chunks rather than accumulating the whole upload in memory. The route then
// streams that temp file straight to Supabase Storage (storage.saveStream) and
// removes it — so peak heap per upload is a few stream chunks, not the full file
// (the original memoryStorage cost up to 25MB of heap PER concurrent upload).
//
// Tradeoff vs. the old buffer path: the image-preview job can no longer reuse an
// in-memory buffer, so the route enqueues by attachmentId only and the worker
// re-fetches the original from storage — exactly what the durable Redis queue
// path already does. The temp file is transient (deleted per request), so the
// ephemeral container filesystem is a non-issue. Same fileFilter (MIME
// allowlist) and same HARD_CAP global limit as uploadSingle; the route still
// enforces the per-MIME caps (image 10MB / doc 25MB) and all membership /
// security checks.
const attachmentMulter = multer({
  dest: os.tmpdir(),
  limits: { fileSize: HARD_CAP, files: 1 },
  fileFilter,
}).single('file')

// Wrap the multer middleware so an upload that trips the global size limit can't
// (a) leave a half-written temp file behind, or (b) surface as an opaque 500.
// On LIMIT_FILE_SIZE we remove any partial temp file and return the same 413 +
// `file_too_large` code the client already handles for oversize documents; other
// multer errors propagate to the central error handler unchanged.
export function uploadAttachment(req: Request, res: Response, next: NextFunction): void {
  attachmentMulter(req, res, (err: unknown) => {
    if (err) {
      const partial = req.file?.path
      if (partial) void unlink(partial).catch(() => {})
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'file_too_large' })
        return
      }
      next(err)
      return
    }
    next()
  })
}

export function isImage(mime: string): boolean {
  return IMAGE_MIMES.has(mime)
}

export function isDoc(mime: string): boolean {
  return DOC_MIMES.has(mime)
}
