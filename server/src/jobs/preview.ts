import { pool } from '../db/pool.js'
import { savePreview, deleteFile, getObject, FileNotFound } from '../storage.js'
import { makePreview } from '../util/image.js'
import { isImage } from '../middleware/upload.js'
import { getIOIfReady, roomForGroup } from '../realtime.js'
import { elapsedMs, log } from '../util/log.js'

// Outcome of a single preview attempt. Only thrown errors (transient storage /
// network faults) escape this function — every "nothing to do" case returns a
// terminal status the caller can count without retrying.
export type PreviewOutcome =
  | 'done' // generated + stored + announced
  | 'exists' // a preview was already present (dedup)
  | 'missing' // the original object is gone
  | 'skip' // not an image
  | 'unsupported' // animated GIF / undecodable — no preview possible
  | 'gone' // the attachment row no longer exists
  | 'raced' // another worker set the preview first

// Driver-agnostic core for "make this attachment's preview". Shared by the
// in-process queue (passes the upload buffer to avoid a re-download), a future
// durable queue, and the backfill script (no buffer → fetches from storage).
//
// It is self-contained and idempotent: it derives everything it needs from the
// attachment id, refuses to regenerate when preview_path is already set, and
// guards the UPDATE with `preview_path IS NULL` so concurrent workers can't
// double-write. Emits `attachment:preview` only when a Socket.IO server is
// running (no-op in script contexts).
export async function runPreviewForAttachment(
  attachmentId: string,
  opts: { buffer?: Buffer } = {},
): Promise<PreviewOutcome> {
  const startNs = process.hrtime.bigint()

  const { rows } = await pool.query<{
    mime_type: string
    storage_path: string
    preview_path: string | null
    missing: boolean
    message_id: string
    group_id: string
  }>(
    `select a.mime_type, a.storage_path, a.preview_path, a.missing, a.message_id, m.group_id
       from attachments a
       join messages m on m.id = a.message_id
      where a.id = $1`,
    [attachmentId],
  )
  if (rows.length === 0) return 'gone'
  const a = rows[0]
  if (a.preview_path) return 'exists' // dedup — never regenerate
  if (a.missing) return 'missing'
  if (!isImage(a.mime_type)) return 'skip'

  // Prefer the in-memory buffer (upload/forward path); otherwise fetch the
  // original from storage (durable queue / backfill).
  let buffer: Buffer
  try {
    buffer = opts.buffer ?? (await getObject(a.storage_path))
  } catch (err) {
    if (err instanceof FileNotFound) return 'missing'
    throw err
  }

  const preview = await makePreview(buffer, a.mime_type)
  if (!preview) {
    log.info('preview_job', { attachmentId, status: 'unsupported', durationMs: elapsedMs(startNs) })
    return 'unsupported'
  }

  const saved = await savePreview(attachmentId, preview.buffer)
  const upd = await pool.query(
    `update attachments
        set preview_path = $1, width = $2, height = $3
      where id = $4 and preview_path is null`,
    [saved.storagePath, preview.width, preview.height, attachmentId],
  )
  if (!upd.rowCount) {
    // Row vanished or another worker won — don't orphan the object we wrote.
    await deleteFile(saved.storagePath)
    return 'raced'
  }

  // Notify open clients (when a server is up); revisits/late joiners get it via
  // the API, which now returns previewUrl.
  getIOIfReady()
    ?.to(roomForGroup(a.group_id))
    .emit('attachment:preview', {
      groupId: a.group_id,
      messageId: a.message_id,
      attachmentId,
      previewUrl: `/api/attachments/${attachmentId}?variant=preview`,
      width: preview.width,
      height: preview.height,
    })

  log.info('preview_job', { attachmentId, status: 'done', durationMs: elapsedMs(startNs) })
  return 'done'
}
