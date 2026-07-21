import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { pool } from '../db/pool.js'
import { asyncHandler } from '../http.js'
import { getIOIfReady, roomForWorkspace } from '../realtime.js'

export const placesRouter = Router()
placesRouter.use(requireAuth)

const categorySchema = z.enum([
  'parking',
  'depot',
  'fuel',
  'customer',
  'service',
  'customs',
  'other',
])

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: categorySchema,
  address: optionalText(240),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  notes: optionalText(500),
})
const patchSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0)

type PlaceRow = {
  id: string
  name: string
  category: z.infer<typeof categorySchema>
  address: string | null
  latitude: number
  longitude: number
  notes: string | null
  created_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

const SELECT_COLUMNS = `
  id, name, category, address, latitude, longitude, notes,
  created_by, created_at, updated_at`

function mapPlace(row: PlaceRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function nullable(value: string | null | undefined) {
  return typeof value === 'string' && value.length === 0 ? null : value ?? null
}

function notify(workspaceId: string) {
  getIOIfReady()?.to(roomForWorkspace(workspaceId)).emit('workspace:places_changed')
}

placesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<PlaceRow>(
      `select ${SELECT_COLUMNS}
         from workspace_places
        where workspace_id = $1
        order by category asc, lower(name) asc
        limit 1000`,
      [req.session!.workspaceId],
    )
    res.json({ places: rows.map(mapPlace) })
  }),
)

placesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
    const { workspaceId, userId } = req.session!
    const input = parsed.data
    const { rows } = await pool.query<PlaceRow>(
      `insert into workspace_places
         (workspace_id, created_by, name, category, address, latitude, longitude, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${SELECT_COLUMNS}`,
      [
        workspaceId,
        userId,
        input.name,
        input.category,
        nullable(input.address),
        input.latitude,
        input.longitude,
        nullable(input.notes),
      ],
    )
    notify(workspaceId)
    res.status(201).json({ place: mapPlace(rows[0]) })
  }),
)

placesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })

    const columns: Record<string, string> = {
      name: 'name',
      category: 'category',
      address: 'address',
      latitude: 'latitude',
      longitude: 'longitude',
      notes: 'notes',
    }
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, raw] of Object.entries(parsed.data)) {
      values.push(key === 'address' || key === 'notes' ? nullable(raw as string | null) : raw)
      sets.push(`${columns[key]} = $${values.length}`)
    }
    sets.push('updated_at = now()')
    values.push(req.params.id, req.session!.workspaceId)

    const { rows } = await pool.query<PlaceRow>(
      `update workspace_places
          set ${sets.join(', ')}
        where id = $${values.length - 1}
          and workspace_id = $${values.length}
      returning ${SELECT_COLUMNS}`,
      values,
    )
    if (!rows[0]) return res.status(404).json({ error: 'not_found' })
    notify(req.session!.workspaceId)
    res.json({ place: mapPlace(rows[0]) })
  }),
)

placesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      'delete from workspace_places where id = $1 and workspace_id = $2',
      [req.params.id, req.session!.workspaceId],
    )
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    notify(req.session!.workspaceId)
    res.json({ ok: true })
  }),
)
