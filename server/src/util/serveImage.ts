import { Readable } from 'node:stream'
import type { Response } from 'express'
import { createSignedUrl, FileNotFound } from '../storage.js'

// Stream a private storage object (avatar / company logo) to the client via a
// short-lived signed URL — the same proxy pattern the attachments route uses,
// so the bucket is never exposed. Returns false when the object is gone (the
// caller should 404); the frontend then falls back to initials / the default
// icon. Cached briefly so a freshly changed image propagates quickly.
export async function serveImageObject(
  res: Response,
  storagePath: string,
  contentType: string,
): Promise<boolean> {
  let signedUrl: string
  try {
    signedUrl = await createSignedUrl(storagePath)
  } catch (err) {
    if (err instanceof FileNotFound) return false
    throw err
  }

  const upstream = await fetch(signedUrl)
  if (!upstream.ok || !upstream.body) return false

  res.setHeader('Content-Type', contentType)
  const len = upstream.headers.get('content-length')
  if (len) res.setHeader('Content-Length', len)
  // Private (workspace-scoped) and short-lived: a changed avatar/logo should
  // show within a minute without a hard refresh.
  res.setHeader('Cache-Control', 'private, max-age=60')
  Readable.fromWeb(upstream.body).pipe(res)
  return true
}
