import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Request, Response } from 'express'
import { getCachedSignedUrl, openSignedUrl, FileNotFound } from '../storage.js'

// A stored image's version: a short hash of its storage path. Every upload of
// an avatar / group image / logo writes a NEW path (`avatar_<id>_<random>`) and
// the old object is deleted, so the path already IS the image's identity — the
// same path always means the same bytes. Hashed so the payloads that carry it
// (`avatarVersion` next to `hasAvatar`) never expose bucket keys. Null = no
// image stored.
export function imageVersion(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null
  return createHash('sha256').update(storagePath).digest('base64url').slice(0, 12)
}

// Stream a private storage object (avatar / company logo) to the client via a
// signed URL — the same proxy pattern the attachments route uses, so the
// bucket is never exposed. Returns false when the object is gone (the caller
// should 404); the frontend then falls back to initials / the default icon.
//
// Caching (user, 2026-09-23: the profile panels re-requested the photos every
// time they opened):
//  · `?v=<imageVersion>` matching the stored image → cached for a year,
//    immutable. The URL changes when the image does, so nothing can go stale;
//    a browser that has it never asks again.
//  · No `v`, or an old one → the previous 60 s, so a changed avatar still shows
//    within a minute at call sites that don't know the version.
//  · Either way the response carries the version as its ETag, so a revalidation
//    is answered 304 from one DB lookup — no signed URL, no Supabase fetch, no
//    bytes.
export async function serveImageObject(
  req: Request,
  res: Response,
  storagePath: string,
  contentType: string,
): Promise<boolean> {
  const version = imageVersion(storagePath)
  const cacheControl =
    req.query.v === version ? 'private, max-age=31536000, immutable' : 'private, max-age=60'
  res.setHeader('ETag', `"${version}"`)
  if (req.fresh) {
    res.setHeader('Cache-Control', cacheControl)
    res.status(304).end()
    return true
  }

  // The object at a path never changes (see imageVersion), so the signed URL
  // can be reused like an attachment's.
  let upstream: Awaited<ReturnType<typeof openSignedUrl>>
  try {
    upstream = await openSignedUrl((await getCachedSignedUrl(storagePath)).url)
  } catch (err) {
    if (!(err instanceof FileNotFound)) throw err
    upstream = null
  }
  if (!upstream?.ok || !upstream.body) {
    res.removeHeader('ETag')
    return false
  }

  res.setHeader('Content-Type', contentType)
  const len = upstream.headers.get('content-length')
  if (len) res.setHeader('Content-Length', len)
  res.setHeader('Cache-Control', cacheControl)
  Readable.fromWeb(upstream.body).pipe(res)
  return true
}
