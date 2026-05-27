import { mkdirSync, createReadStream, existsSync } from 'node:fs'
import { writeFile, unlink, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

// Local-disk attachment storage. Keep the surface narrow (save / open / delete
// + a path resolver for streaming) so the underlying store can later swap to
// S3 / Supabase / a Railway volume without touching routes.
//
// Configurable via UPLOAD_DIR — on Railway this should point at a mounted
// volume so uploads survive deploys. Locally it defaults to ./uploads.

export const UPLOAD_DIR = resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads')

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

export type StoredFile = {
  /** Relative path persisted in the DB. */
  storagePath: string
  byteSize: number
}

export async function saveBuffer(
  id: string,
  originalName: string,
  buffer: Buffer,
): Promise<StoredFile> {
  const relative = `${id}${safeExt(originalName)}`
  await writeFile(join(UPLOAD_DIR, relative), buffer)
  return { storagePath: relative, byteSize: buffer.byteLength }
}

export function openStream(storagePath: string) {
  return createReadStream(join(UPLOAD_DIR, storagePath))
}

export async function fileSize(storagePath: string): Promise<number | null> {
  try {
    const s = await stat(join(UPLOAD_DIR, storagePath))
    return s.size
  } catch {
    return null
  }
}

export async function deleteFile(storagePath: string): Promise<void> {
  try {
    await unlink(join(UPLOAD_DIR, storagePath))
  } catch {
    // best-effort — orphan rows are cheaper than failing the whole request
  }
}

// Only keep alphanumeric extensions ≤ 6 chars so a malicious filename like
// "x/../../etc/passwd.txt" never propagates into the path we write to.
function safeExt(name: string): string {
  const e = extname(name).toLowerCase()
  return /^\.[a-z0-9]{1,6}$/.test(e) ? e : ''
}
