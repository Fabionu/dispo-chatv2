import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { uploadSingle, isImage, MAX_IMAGE_BYTES } from '../middleware/upload.js'
import { saveBuffer, deleteFile } from '../storage.js'
import { serveImageObject } from '../util/serveImage.js'

export const profileRouter = Router()
profileRouter.use(requireAuth)

// Shape of a user profile row → API. `hasAvatar` lets the client decide whether
// to request the image at all (vs rendering initials immediately).
type ProfileRow = {
  id: string
  email: string
  display_name: string
  role: string
  job_title: string | null
  work_phone: string | null
  native_language: string | null
  other_languages: string[]
  availability_status: string
  avatar_path: string | null
  workspace_name: string
}

function mapProfile(r: ProfileRow) {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    // Role is permission-based and NOT self-editable — returned read-only.
    role: r.role,
    jobTitle: r.job_title,
    workPhone: r.work_phone,
    nativeLanguage: r.native_language,
    otherLanguages: r.other_languages ?? [],
    availabilityStatus: r.availability_status,
    hasAvatar: r.avatar_path !== null,
    company: r.workspace_name,
  }
}

const PROFILE_SELECT = `
  select u.id, u.email, u.display_name, u.role,
         u.job_title, u.work_phone, u.native_language,
         u.other_languages, u.availability_status, u.avatar_path,
         w.name as workspace_name
    from users u
    join workspaces w on w.id = u.workspace_id
   where u.id = $1
   limit 1`

async function loadProfile(userId: string) {
  const { rows } = await pool.query<ProfileRow>(PROFILE_SELECT, [userId])
  return rows[0] ? mapProfile(rows[0]) : null
}

// ── GET /api/profile ─────────────────────────────────────────────────────
// The current user's operational profile (own row only — never another user's
// sensitive fields like email).
profileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const profile = await loadProfile(req.session!.userId)
    if (!profile) return res.status(404).json({ error: 'not_found' })
    res.json({ profile })
  }),
)

// ── PATCH /api/profile ───────────────────────────────────────────────────
// Update the caller's own editable fields. Email is identity (read-only here)
// and role is permission-based (admin-managed) — neither is accepted.
const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  workPhone: z.string().trim().max(40).nullable().optional(),
  nativeLanguage: z.string().trim().max(40).nullable().optional(),
  otherLanguages: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
  availabilityStatus: z.enum(['available', 'busy', 'off_duty']).optional(),
})

// Map camelCase API fields → snake_case columns. Empty strings on nullable
// text fields become NULL so "clearing" a field works.
const COLUMN: Record<string, string> = {
  displayName: 'display_name',
  jobTitle: 'job_title',
  workPhone: 'work_phone',
  nativeLanguage: 'native_language',
  otherLanguages: 'other_languages',
  availabilityStatus: 'availability_status',
}

profileRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, raw] of Object.entries(parsed.data)) {
      if (raw === undefined) continue
      const col = COLUMN[key]
      // Normalise empty strings on text fields to NULL.
      const value = typeof raw === 'string' && raw.trim() === '' ? null : raw
      values.push(value)
      sets.push(`${col} = $${values.length}`)
    }

    if (sets.length > 0) {
      values.push(req.session!.userId)
      await pool.query(`update users set ${sets.join(', ')} where id = $${values.length}`, values)
    }

    const profile = await loadProfile(req.session!.userId)
    res.json({ profile })
  }),
)

// ── POST /api/profile/avatar ─────────────────────────────────────────────
// Upload / replace the caller's avatar. Image-only, size-capped. The old object
// is deleted after the new path is committed so a failure never strands the
// user without an avatar.
profileRouter.post(
  '/avatar',
  uploadSingle,
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'no_file' })
    if (!isImage(file.mimetype)) return res.status(415).json({ error: 'not_an_image' })
    if (file.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'image_too_large' })

    const userId = req.session!.userId
    const { rows: prevRows } = await pool.query<{ avatar_path: string | null }>(
      'select avatar_path from users where id = $1',
      [userId],
    )
    const oldPath = prevRows[0]?.avatar_path ?? null

    const id = `avatar_${userId}_${randomUUID().slice(0, 8)}`
    const saved = await saveBuffer(id, file.originalname, file.buffer, file.mimetype)
    await pool.query('update users set avatar_path = $1 where id = $2', [saved.storagePath, userId])
    if (oldPath && oldPath !== saved.storagePath) await deleteFile(oldPath)

    const profile = await loadProfile(userId)
    res.json({ profile })
  }),
)

// ── DELETE /api/profile/avatar ───────────────────────────────────────────
profileRouter.delete(
  '/avatar',
  asyncHandler(async (req, res) => {
    const userId = req.session!.userId
    const { rows } = await pool.query<{ avatar_path: string | null }>(
      'select avatar_path from users where id = $1',
      [userId],
    )
    const oldPath = rows[0]?.avatar_path ?? null
    await pool.query('update users set avatar_path = null where id = $1', [userId])
    if (oldPath) await deleteFile(oldPath)
    const profile = await loadProfile(userId)
    res.json({ profile })
  }),
)

// ── GET /api/users/:id/avatar ────────────────────────────────────────────
// Streams any user's avatar by id (message authors, member pickers). Auth-only
// and image-only — 404 → the client renders initials. Mounted separately under
// /api/users (see index.ts) but defined here to keep avatar logic together.
export const usersRouter = Router()
usersRouter.use(requireAuth)
usersRouter.get(
  '/:id/avatar',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ avatar_path: string | null }>(
      'select avatar_path from users where id = $1 limit 1',
      [req.params.id],
    )
    const path = rows[0]?.avatar_path
    if (!path) return res.status(404).json({ error: 'no_avatar' })
    const ok = await serveImageObject(res, path, guessImageType(path))
    if (!ok) return res.status(404).json({ error: 'no_avatar' })
  }),
)

// Storage keeps the original extension; infer a content type for the response.
function guessImageType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}
