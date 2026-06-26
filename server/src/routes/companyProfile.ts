import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireAuth } from '../auth.js'
import { asyncHandler } from '../http.js'
import { uploadSingle, isImage, MAX_IMAGE_BYTES } from '../middleware/upload.js'
import { saveBuffer, deleteFile } from '../storage.js'
import { serveImageObject } from '../util/serveImage.js'
import {
  LOCKED_COMPANY_FIELDS,
  LOCK_ONCE_SET_COMPANY_FIELDS,
  lockedFieldsInBody,
  lockOnceSetViolations,
} from '../util/identityLock.js'

export const companyProfileRouter = Router()
companyProfileRouter.use(requireAuth)

// Company profile is readable by any member of the workspace but editable only
// by admins. This guard sits on the mutating routes.
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query<{ role: string }>(
      'select role from users where id = $1',
      [req.session!.userId],
    )
    if (rows[0]?.role !== 'admin') {
      res.status(403).json({ error: 'admin_only' })
      return
    }
    next()
  } catch (err) {
    next(err)
  }
}

type CompanyRow = {
  id: string
  name: string
  legal_name: string | null
  vat_id: string | null
  country: string | null
  city: string | null
  operational_address: string | null
  dispatch_email: string | null
  dispatch_phone: string | null
  website: string | null
  logo_path: string | null
}

function mapCompany(r: CompanyRow, canEdit: boolean) {
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    vatId: r.vat_id,
    country: r.country,
    city: r.city,
    operationalAddress: r.operational_address,
    dispatchEmail: r.dispatch_email,
    dispatchPhone: r.dispatch_phone,
    website: r.website,
    hasLogo: r.logo_path !== null,
    // Lets the client render the form read-only for non-admins.
    canEdit,
  }
}

const COMPANY_SELECT = `
  select id, name, legal_name, vat_id, country, city,
         operational_address, dispatch_email, dispatch_phone, website, logo_path
    from workspaces
   where id = $1
   limit 1`

async function loadCompany(workspaceId: string, canEdit: boolean) {
  const { rows } = await pool.query<CompanyRow>(COMPANY_SELECT, [workspaceId])
  return rows[0] ? mapCompany(rows[0], canEdit) : null
}

async function isAdmin(userId: string) {
  const { rows } = await pool.query<{ role: string }>('select role from users where id = $1', [
    userId,
  ])
  return rows[0]?.role === 'admin'
}

// ── GET /api/company-profile ─────────────────────────────────────────────
companyProfileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const company = await loadCompany(req.session!.workspaceId, await isAdmin(req.session!.userId))
    if (!company) return res.status(404).json({ error: 'not_found' })
    res.json({ company })
  }),
)

// ── PATCH /api/company-profile ───────────────────────────────────────────
// Admins only. Updates the registration + dispatch details. Identity fields are
// LOCKED (see util/identityLock): the company name (captured at signup) is fully
// immutable — not in the schema and rejected if sent — and the legal name +
// dispatch email lock once they hold a value (settable while empty, then frozen).
// Attempts to change a locked field are rejected with `identity_fields_locked`,
// never silently dropped, so the lock can't be bypassed via the API.
const patchSchema = z.object({
  legalName: z.string().trim().max(160).nullable().optional(),
  vatId: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  operationalAddress: z.string().trim().max(240).nullable().optional(),
  dispatchEmail: z.string().trim().max(254).nullable().optional(),
  dispatchPhone: z.string().trim().max(40).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
})

const COLUMN: Record<string, string> = {
  legalName: 'legal_name',
  vatId: 'vat_id',
  country: 'country',
  city: 'city',
  operationalAddress: 'operational_address',
  dispatchEmail: 'dispatch_email',
  dispatchPhone: 'dispatch_phone',
  website: 'website',
}

companyProfileRouter.patch(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Company name is captured at signup and is the official company identity —
    // immutable for everyone (no verified rename flow exists).
    const lockedNow = lockedFieldsInBody(req.body, LOCKED_COMPANY_FIELDS)
    if (lockedNow.length > 0) {
      return res.status(403).json({ error: 'identity_fields_locked', fields: lockedNow })
    }

    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    // Lock-once-set: legal name + dispatch email may be set while empty, but once
    // a value exists they can't be changed or cleared. Compare against the stored
    // values before writing.
    const touchingLockOnce = LOCK_ONCE_SET_COMPANY_FIELDS.some((k) => k in parsed.data)
    if (touchingLockOnce) {
      const { rows } = await pool.query<{ legal_name: string | null; dispatch_email: string | null }>(
        'select legal_name, dispatch_email from workspaces where id = $1',
        [req.session!.workspaceId],
      )
      const current = {
        legalName: rows[0]?.legal_name ?? null,
        dispatchEmail: rows[0]?.dispatch_email ?? null,
      }
      const violations = lockOnceSetViolations(
        LOCK_ONCE_SET_COMPANY_FIELDS,
        current,
        parsed.data as Record<string, unknown>,
      )
      if (violations.length > 0) {
        return res.status(403).json({ error: 'identity_fields_locked', fields: violations })
      }
    }

    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, raw] of Object.entries(parsed.data)) {
      if (raw === undefined) continue
      const value = typeof raw === 'string' && raw.trim() === '' ? null : raw
      values.push(value)
      sets.push(`${COLUMN[key]} = $${values.length}`)
    }

    if (sets.length > 0) {
      values.push(req.session!.workspaceId)
      await pool.query(`update workspaces set ${sets.join(', ')} where id = $${values.length}`, values)
    }

    const company = await loadCompany(req.session!.workspaceId, true)
    res.json({ company })
  }),
)

// ── POST /api/company-profile/logo ───────────────────────────────────────
companyProfileRouter.post(
  '/logo',
  requireAdmin,
  uploadSingle,
  asyncHandler(async (req, res) => {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'no_file' })
    if (!isImage(file.mimetype)) return res.status(415).json({ error: 'not_an_image' })
    if (file.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'image_too_large' })

    const workspaceId = req.session!.workspaceId
    const { rows: prev } = await pool.query<{ logo_path: string | null }>(
      'select logo_path from workspaces where id = $1',
      [workspaceId],
    )
    const oldPath = prev[0]?.logo_path ?? null

    const id = `logo_${workspaceId}_${randomUUID().slice(0, 8)}`
    const saved = await saveBuffer(id, file.originalname, file.buffer, file.mimetype)
    await pool.query('update workspaces set logo_path = $1 where id = $2', [
      saved.storagePath,
      workspaceId,
    ])
    if (oldPath && oldPath !== saved.storagePath) await deleteFile(oldPath)

    const company = await loadCompany(workspaceId, true)
    res.json({ company })
  }),
)

// ── DELETE /api/company-profile/logo ─────────────────────────────────────
companyProfileRouter.delete(
  '/logo',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const workspaceId = req.session!.workspaceId
    const { rows } = await pool.query<{ logo_path: string | null }>(
      'select logo_path from workspaces where id = $1',
      [workspaceId],
    )
    const oldPath = rows[0]?.logo_path ?? null
    await pool.query('update workspaces set logo_path = null where id = $1', [workspaceId])
    if (oldPath) await deleteFile(oldPath)
    const company = await loadCompany(workspaceId, true)
    res.json({ company })
  }),
)

// ── GET /api/company-profile/logo ────────────────────────────────────────
// Streams the caller's workspace logo (the workspace switcher / settings use
// this). 404 → the client keeps the default Box icon.
companyProfileRouter.get(
  '/logo',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ logo_path: string | null }>(
      'select logo_path from workspaces where id = $1 limit 1',
      [req.session!.workspaceId],
    )
    const path = rows[0]?.logo_path
    if (!path) return res.status(404).json({ error: 'no_logo' })
    const ok = await serveImageObject(res, path, guessImageType(path))
    if (!ok) return res.status(404).json({ error: 'no_logo' })
  }),
)

function guessImageType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}
