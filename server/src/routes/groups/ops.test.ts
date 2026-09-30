import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { newlyClaimedTripId, type OpsLite } from './ops.js'

// update.ts checks every id this returns against the rest of the database, so a
// room can never adopt another room's trip id (and with it, that trip's GPS).
// What matters here: a NEW or CHANGED id is always returned for the check, and
// ordinary re-saves of the room's own trip never pay for it.

const ROOM = '33333333-3333-4333-8333-333333333333'
const tripOps = (id?: string): OpsLite => ({ trip: id === undefined ? {} : { id } })

describe('newlyClaimedTripId', () => {
  test('a new trip claims its id', () => {
    assert.equal(newlyClaimedTripId(null, tripOps('trip-new'), ROOM), 'trip-new')
    assert.equal(newlyClaimedTripId({ trip: null }, tripOps('trip-new'), ROOM), 'trip-new')
  })

  test('replacing the trip claims the replacement id', () => {
    assert.equal(newlyClaimedTripId(tripOps('trip-old'), tripOps('trip-new'), ROOM), 'trip-new')
  })

  test('changing the id of an existing trip is a claim, not a free rename', () => {
    // The attack: keep the trip, swap its id for one copied from another room.
    assert.equal(
      newlyClaimedTripId(tripOps('trip-mine'), tripOps('trip-theirs'), ROOM),
      'trip-theirs',
    )
  })

  test('re-saving the same trip claims nothing', () => {
    assert.equal(newlyClaimedTripId(tripOps('trip-a'), tripOps('trip-a'), ROOM), null)
  })

  test('no trip, or a trip without an id, claims nothing', () => {
    assert.equal(newlyClaimedTripId(tripOps('trip-a'), { trip: null }, ROOM), null)
    assert.equal(newlyClaimedTripId(null, tripOps(), ROOM), null)
    assert.equal(newlyClaimedTripId(null, tripOps(''), ROOM), null)
  })

  test("the room's own id is its legacy canonical trip id, not a claim", () => {
    assert.equal(newlyClaimedTripId(null, tripOps(ROOM), ROOM), null)
  })
})
