import { extname } from 'node:path'
import type { Readable } from 'node:stream'
import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'
import { TtlCache, cachedAsync } from './util/ttlCache.js'

// Attachment storage backed by Supabase Storage (object storage). This keeps
// the surface narrow (save / read / get / delete) so the rest of the app is
// ignorant of where bytes actually live.
//
// Why object storage instead of local disk: Railway (and most PaaS) give each
// container an EPHEMERAL filesystem that is wiped on every redeploy/restart.
// The previous local-disk store therefore lost uploads on each deploy and was
// never shared between environments (local dev vs prod), even though both
// share one database. Supabase Storage survives deploys and is shared.

// Service-role client: full access, server-only. The bucket is private; the
// authenticated /api/attachments/:id route is the only way to read bytes out.
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const BUCKET = env.SUPABASE_STORAGE_BUCKET

// Thrown when an object referenced by a DB row no longer exists in the bucket
// (e.g. an attachment uploaded before this migration, whose bytes lived on a
// since-wiped ephemeral disk). The serve route turns this into a clean 404.
export class FileNotFound extends Error {
  constructor(public readonly storagePath: string) {
    super(`object not found: ${storagePath}`)
    this.name = 'FileNotFound'
  }
}

export type StoredFile = {
  /** Object key persisted in the DB (attachments.storage_path). */
  storagePath: string
  byteSize: number
}

// Upload bytes under a key derived from the attachment id. `upsert: true`
// makes retries idempotent. contentType is stored on the object, though the
// serve route always sets the response type from the DB to stay authoritative.
export async function saveBuffer(
  id: string,
  originalName: string,
  buffer: Buffer,
  contentType?: string,
): Promise<StoredFile> {
  const key = `${id}${safeExt(originalName)}`
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  })
  if (error) throw error
  return { storagePath: key, byteSize: buffer.byteLength }
}

// Stream bytes to storage WITHOUT buffering the whole object in the process
// heap. Used by the message-attachment upload path: multer streams the incoming
// request to a temp file on disk, then we stream that file straight to the
// bucket. The storage-js SDK accepts a Node Readable and switches fetch into
// half-duplex streaming automatically, so peak memory stays at a few stream
// chunks rather than the full (up to 25MB) file. Returns the object key; the
// caller already knows the byte size (from multer's on-disk size) so we don't
// re-derive it here. `upsert: true` keeps retries idempotent, matching saveBuffer.
export async function saveStream(
  id: string,
  originalName: string,
  body: Readable,
  contentType?: string,
): Promise<string> {
  const key = `${id}${safeExt(originalName)}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, body as NodeJS.ReadableStream, {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    })
  if (error) throw error
  return key
}

// Store a generated WebP preview under a key derived from the attachment id.
// Kept separate from the original object so either can be served/deleted
// independently. `upsert: true` keeps re-uploads idempotent.
export async function savePreview(id: string, buffer: Buffer): Promise<StoredFile> {
  const key = `${id}_preview.webp`
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType: 'image/webp',
    upsert: true,
  })
  if (error) throw error
  return { storagePath: key, byteSize: buffer.byteLength }
}

// Mint a short-lived signed URL for a private object. The serve route streams
// from this instead of buffering the whole object into Node memory. Throws
// FileNotFound if the object can't be signed (i.e. it's gone).
export async function createSignedUrl(
  storagePath: string,
  expiresIn = 600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error || !data?.signedUrl) throw new FileNotFound(storagePath)
  return data.signedUrl
}

// ── Cached signed URLs (immutable objects only) ──────────────────────────
// The attachment-preview route redirects the browser straight to a signed URL
// instead of proxying the bytes through this process. Minting a URL per request
// would defeat browser caching (every mint is a unique URL → unique cache key),
// so we reuse one URL per object for a window comfortably SHORTER than the
// URL's validity: a redirect issued at the very end of the reuse window still
// points at a URL with (TTL − reuse window) of life left. Only ever use this
// for IMMUTABLE objects (attachment previews/originals) — for mutable ones
// (avatars) a cached URL + Supabase's own CDN caching could pin stale bytes.
const SIGNED_URL_TTL_SEC = 3600
const SIGNED_URL_REUSE_SEC = 3000
const signedUrlCache = new TtlCache<Promise<{ url: string; mintedAt: number }>>(
  10_000,
  SIGNED_URL_REUSE_SEC * 1000,
)

// Signed URL for an immutable object, reused across requests for the reuse
// window. Returns the URL plus how long (seconds) a redirect to it may safely
// be cached by the browser — the remainder of the reuse window, floored so a
// response near the window's edge still caches briefly. Throws FileNotFound
// (uncached, so a transient storage error doesn't stick) when the object is gone.
export async function getCachedSignedUrl(
  storagePath: string,
): Promise<{ url: string; maxAgeSec: number }> {
  const entry = await cachedAsync(signedUrlCache, storagePath, async () => ({
    url: await createSignedUrl(storagePath, SIGNED_URL_TTL_SEC),
    mintedAt: Date.now(),
  }))
  const ageSec = Math.floor((Date.now() - entry.mintedAt) / 1000)
  return { url: entry.url, maxAgeSec: Math.max(60, SIGNED_URL_REUSE_SEC - ageSec) }
}

// Read an object fully into memory. Throws FileNotFound if it's gone.
export async function getObject(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error || !data) throw new FileNotFound(storagePath)
  return Buffer.from(await data.arrayBuffer())
}

// Alias used by the forward path, which copies an existing attachment's bytes
// into a brand-new object so the forward owns an independent copy.
export const readBuffer = getObject

export async function deleteFile(storagePath: string): Promise<void> {
  // Best-effort — an orphan object is cheaper than failing the whole request.
  await supabase.storage
    .from(BUCKET)
    .remove([storagePath])
    .catch(() => {})
}

// Only keep alphanumeric extensions ≤ 6 chars so a malicious filename like
// "x/../../etc/passwd.txt" never propagates into the object key we write to.
function safeExt(name: string): string {
  const e = extname(name).toLowerCase()
  return /^\.[a-z0-9]{1,6}$/.test(e) ? e : ''
}
