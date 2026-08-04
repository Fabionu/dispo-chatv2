import { z } from 'zod'
import { HttpError } from '../http.js'
import { opsSchema } from './groups/ops.js'

// ── The driver permission boundary ───────────────────────────────────────────
// Every /api/driver/* read and write funnels through assertAssignedTrip, so the
// rule "a caller sees a trip only when they are BOTH a member of the vehicle
// room AND one of that trip's assigned drivers" is stated exactly once.
//
// Kept in its own module — free of the pool, the router and the storage layer —
// so the boundary can be exercised directly by tests without a database.

export type Ops = z.infer<typeof opsSchema>
export type Trip = NonNullable<Ops['trip']>

/**
 * The drivers assigned to a trip. The persistent vehicle-room assignment wins;
 * the trip-level list is the legacy fallback for rooms not edited since the
 * model changed.
 */
export function assignedDriverIds(ops: Ops, trip: Trip): string[] {
  return ops.vehicle.assignedDriverIds ?? trip.assignedDriverIds ?? []
}

/** A trip is drivable unless it has finished. A missing status means a freshly
 *  planned trip, which is active. */
export function isActiveStatus(status: Trip['status']): boolean {
  return status !== 'completed' && status !== 'cancelled'
}

/**
 * Parse the stored ops blob for a group. Returns null when the group has never
 * stored ops or the blob doesn't validate — the driver API then treats it as
 * "no trip" rather than erroring the whole request.
 */
export function parseOps(meta: Record<string, unknown> | null): Ops | null {
  const parsed = opsSchema.safeParse(meta?.ops ?? {})
  return parsed.success ? parsed.data : null
}

/**
 * Apply the full permission boundary to a fetched room row.
 *
 * The caller is expected to have fetched the row through a `group_members`
 * join, so a missing row already means "not a member" — which is why that case
 * and "no trip here" both answer 404: neither may reveal that the room or trip
 * exists. 403 is reserved for the one case where the caller demonstrably has
 * access to the room but not to this trip.
 */
export function assertAssignedTrip(
  userId: string,
  row: { id: string; meta: Record<string, unknown> | null } | undefined,
): { groupId: string; ops: Ops; trip: Trip } {
  if (!row) throw new HttpError(404, 'trip_not_found')
  const ops = parseOps(row.meta)
  if (!ops?.trip) throw new HttpError(404, 'trip_not_found')
  const trip = ops.trip
  if (!assignedDriverIds(ops, trip).includes(userId)) throw new HttpError(403, 'forbidden')
  return { groupId: row.id, ops, trip }
}
