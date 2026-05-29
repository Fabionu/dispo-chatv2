import { extname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

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
