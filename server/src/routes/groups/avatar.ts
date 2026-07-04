import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { pool } from '../../db/pool.js'
import { asyncHandler, withTransaction } from '../../http.js'
import { MAX_IMAGE_BYTES, isImage, uploadSingle } from '../../middleware/upload.js'
import { saveBuffer, deleteFile } from '../../storage.js'
import { serveImageObject } from '../../util/serveImage.js'
import { authorizeInviter } from './authz.js'

export const avatarRouter = Router()

// Storage keeps the original extension; infer a content type for the response.
function guessImageType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

// ── GET /api/groups/:id/avatar ───────────────────────────────────────────
// Streams a vehicle group's image, any member may read it. 404 → the client
// renders the themed multi-user fallback icon. Mirrors the user-avatar serve.
avatarRouter.get(
  '/:id/avatar',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const { rows: membership } = await pool.query(
      'select 1 from group_members where group_id = $1 and user_id = $2 limit 1',
      [groupId, userId],
    )
    if (membership.length === 0) return res.status(403).json({ error: 'not_a_member' })

    const { rows } = await pool.query<{ avatar_path: string | null }>(
      'select avatar_path from groups where id = $1 limit 1',
      [groupId],
    )
    const path = rows[0]?.avatar_path
    if (!path) return res.status(404).json({ error: 'no_avatar' })
    const ok = await serveImageObject(res, path, guessImageType(path))
    if (!ok) return res.status(404).json({ error: 'no_avatar' })
  }),
)

// ── POST /api/groups/:id/avatar ──────────────────────────────────────────
// Upload / replace a vehicle group's image. Image-only, size-capped (same caps
// as profile avatars). Authorised to invite-capable members only. The old
// object is deleted after the new path commits so a failure never strands the
// group without an image.
avatarRouter.post(
  '/:id/avatar',
  uploadSingle,
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'no_file' })
    if (!isImage(file.mimetype)) return res.status(415).json({ error: 'not_an_image' })
    if (file.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'image_too_large' })

    const { userId } = req.session!
    const groupId = req.params.id

    const oldPath = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)
      const { rows } = await client.query<{ avatar_path: string | null }>(
        'select avatar_path from groups where id = $1',
        [groupId],
      )
      return rows[0]?.avatar_path ?? null
    })

    const id = `group_${groupId}_${randomUUID().slice(0, 8)}`
    const saved = await saveBuffer(id, file.originalname, file.buffer, file.mimetype)
    await pool.query('update groups set avatar_path = $1 where id = $2', [saved.storagePath, groupId])
    if (oldPath && oldPath !== saved.storagePath) await deleteFile(oldPath)

    res.json({ ok: true, hasAvatar: true })
  }),
)

// ── DELETE /api/groups/:id/avatar ────────────────────────────────────────
// Remove a vehicle group's image. Authorised to invite-capable members only.
avatarRouter.delete(
  '/:id/avatar',
  asyncHandler(async (req, res) => {
    const { userId } = req.session!
    const groupId = req.params.id

    const oldPath = await withTransaction(async (client) => {
      await authorizeInviter(client, groupId, userId)
      const { rows } = await client.query<{ avatar_path: string | null }>(
        'select avatar_path from groups where id = $1',
        [groupId],
      )
      const prev = rows[0]?.avatar_path ?? null
      await client.query('update groups set avatar_path = null where id = $1', [groupId])
      return prev
    })

    if (oldPath) await deleteFile(oldPath)
    res.json({ ok: true, hasAvatar: false })
  }),
)
