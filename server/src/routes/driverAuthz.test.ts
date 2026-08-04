import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '../http.js'
import {
  assertAssignedTrip,
  assignedDriverIds,
  isActiveStatus,
  parseOps,
} from './driverAuthz.js'

// The boundary these tests defend: a caller reaches a trip only when they are
// BOTH a member of the vehicle room AND one of the trip's assigned drivers.
// Membership is enforced by the SQL join (a non-member simply fetches no row),
// which is why "no row" and "no trip" must both answer 404 — a 403 there would
// confirm the existence of a room the caller cannot see.

const DRIVER = '11111111-1111-4111-8111-111111111111'
const OTHER_DRIVER = '22222222-2222-4222-8222-222222222222'
const ROOM = '33333333-3333-4333-8333-333333333333'

type Row = { id: string; meta: Record<string, unknown> | null }

/** A room row as the lookup returns it, with the assignment placed where the
 *  caller asks for it (the persistent vehicle field or the legacy trip field). */
function room(options: {
  vehicleDriverIds?: string[]
  tripDriverIds?: string[]
  status?: string
  tripId?: string
  withTrip?: boolean
}): Row {
  const {
    vehicleDriverIds,
    tripDriverIds,
    status = 'planned',
    tripId = 'trip-abc',
    withTrip = true,
  } = options
  return {
    id: ROOM,
    meta: {
      ops: {
        vehicle: { ...(vehicleDriverIds ? { assignedDriverIds: vehicleDriverIds } : {}) },
        stops: [],
        ...(withTrip
          ? {
              trip: {
                id: tripId,
                status,
                ...(tripDriverIds ? { assignedDriverIds: tripDriverIds } : {}),
              },
            }
          : {}),
      },
    },
  }
}

/** Run `fn` and return the HttpError it threw, failing the test if it did not. */
function httpErrorFrom(fn: () => unknown): HttpError {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`)
    return err
  }
  assert.fail('expected the call to throw')
}

describe('assertAssignedTrip — denial', () => {
  test('404 when the lookup returned no row (caller is not a member)', () => {
    // The membership join produced nothing. The response must not distinguish
    // this from "no such trip".
    assert.equal(httpErrorFrom(() => assertAssignedTrip(DRIVER, undefined)).status, 404)
  })

  test('404 when the room exists but holds no trip', () => {
    const err = httpErrorFrom(() => assertAssignedTrip(DRIVER, room({ withTrip: false })))
    assert.equal(err.status, 404)
    assert.equal(err.message, 'trip_not_found')
  })

  test('404 when meta is null entirely', () => {
    assert.equal(httpErrorFrom(() => assertAssignedTrip(DRIVER, { id: ROOM, meta: null })).status, 404)
  })

  test('403 when the caller is a member but not an assigned driver', () => {
    const err = httpErrorFrom(() =>
      assertAssignedTrip(DRIVER, room({ vehicleDriverIds: [OTHER_DRIVER] })),
    )
    assert.equal(err.status, 403)
    assert.equal(err.message, 'forbidden')
  })

  test('403 when the trip has an empty assignment list', () => {
    assert.equal(
      httpErrorFrom(() => assertAssignedTrip(DRIVER, room({ vehicleDriverIds: [] }))).status,
      403,
    )
  })

  test('403 when nobody is assigned at all', () => {
    assert.equal(httpErrorFrom(() => assertAssignedTrip(DRIVER, room({}))).status, 403)
  })

  test('the persistent vehicle assignment overrides a stale trip-level one', () => {
    // The trip still names this driver, but the room has since been reassigned.
    // The current assignment must win, or a removed driver keeps their access.
    const err = httpErrorFrom(() =>
      assertAssignedTrip(
        DRIVER,
        room({ vehicleDriverIds: [OTHER_DRIVER], tripDriverIds: [DRIVER] }),
      ),
    )
    assert.equal(err.status, 403)
  })

  test('a malformed ops blob denies rather than opens access', () => {
    const malformed: Row = { id: ROOM, meta: { ops: { vehicle: 'not-an-object' } } }
    assert.equal(httpErrorFrom(() => assertAssignedTrip(DRIVER, malformed)).status, 404)
  })
})

describe('assertAssignedTrip — access', () => {
  test('resolves for a driver named in the persistent vehicle assignment', () => {
    const resolved = assertAssignedTrip(DRIVER, room({ vehicleDriverIds: [DRIVER] }))
    assert.equal(resolved.groupId, ROOM)
    assert.equal(resolved.trip.id, 'trip-abc')
  })

  test('resolves via the legacy trip-level assignment when the room has none', () => {
    const resolved = assertAssignedTrip(DRIVER, room({ tripDriverIds: [DRIVER] }))
    assert.equal(resolved.groupId, ROOM)
  })

  test('resolves for one driver among several assigned', () => {
    const resolved = assertAssignedTrip(
      DRIVER,
      room({ vehicleDriverIds: [OTHER_DRIVER, DRIVER] }),
    )
    assert.equal(resolved.groupId, ROOM)
  })

  test('a completed trip still resolves — activeness is a separate check', () => {
    // assertAssignedTrip answers "may this caller see it"; the endpoints that
    // must refuse writes to a finished trip apply isActiveStatus on top. Keeping
    // them separate is what lets history stay readable after completion.
    const resolved = assertAssignedTrip(
      DRIVER,
      room({ vehicleDriverIds: [DRIVER], status: 'completed' }),
    )
    assert.equal(resolved.trip.status, 'completed')
    assert.equal(isActiveStatus(resolved.trip.status), false)
  })
})

describe('isActiveStatus', () => {
  test('terminal statuses are inactive', () => {
    assert.equal(isActiveStatus('completed'), false)
    assert.equal(isActiveStatus('cancelled'), false)
  })

  test('in-flight statuses are active', () => {
    for (const status of ['planned', 'accepted', 'to_loading', 'in_transit', 'at_unloading'] as const) {
      assert.equal(isActiveStatus(status), true, status)
    }
  })

  test('a missing status is treated as a freshly planned, active trip', () => {
    assert.equal(isActiveStatus(undefined), true)
  })
})

describe('assignedDriverIds', () => {
  test('prefers the vehicle assignment over the trip one', () => {
    const ops = parseOps(room({ vehicleDriverIds: [DRIVER], tripDriverIds: [OTHER_DRIVER] }).meta)
    assert.ok(ops?.trip)
    assert.deepEqual(assignedDriverIds(ops, ops.trip), [DRIVER])
  })

  test('an empty vehicle assignment is respected, not treated as absent', () => {
    // [] means "nobody is assigned to this room" and must NOT fall through to a
    // stale trip-level list — that fallback is only for rooms that predate the
    // persistent assignment.
    const ops = parseOps(room({ vehicleDriverIds: [], tripDriverIds: [OTHER_DRIVER] }).meta)
    assert.ok(ops?.trip)
    assert.deepEqual(assignedDriverIds(ops, ops.trip), [])
  })

  test('falls back to the trip assignment when the room has none', () => {
    const ops = parseOps(room({ tripDriverIds: [OTHER_DRIVER] }).meta)
    assert.ok(ops?.trip)
    assert.deepEqual(assignedDriverIds(ops, ops.trip), [OTHER_DRIVER])
  })

  test('yields an empty list when neither is present', () => {
    const ops = parseOps(room({}).meta)
    assert.ok(ops?.trip)
    assert.deepEqual(assignedDriverIds(ops, ops.trip), [])
  })
})

describe('parseOps', () => {
  test('null meta yields a trip-less blob', () => {
    // The schema normalises an absent trip to null (not undefined), which is why
    // assertAssignedTrip tests it with `!ops?.trip` rather than an === check.
    assert.equal(parseOps(null)?.trip, null)
  })

  test('a valid blob round-trips the trip id', () => {
    assert.equal(parseOps(room({ tripId: 'trip-xyz' }).meta)?.trip?.id, 'trip-xyz')
  })

  test('a non-uuid driver id is rejected rather than silently trusted', () => {
    const tainted: Row = {
      id: ROOM,
      meta: { ops: { vehicle: { assignedDriverIds: ["'; drop table users; --"] }, stops: [] } },
    }
    assert.equal(parseOps(tainted.meta), null)
  })
})
