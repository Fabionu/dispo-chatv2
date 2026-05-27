import multer, { type FileFilterCallback } from 'multer'
import type { Request } from 'express'

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

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_CAP, files: 1 },
  fileFilter,
}).single('file')

export function isImage(mime: string): boolean {
  return IMAGE_MIMES.has(mime)
}

export function isDoc(mime: string): boolean {
  return DOC_MIMES.has(mime)
}
