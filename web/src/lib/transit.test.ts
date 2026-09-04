import test from 'node:test'
import assert from 'node:assert/strict'

import { estimateTransit, type TransitInput } from './transit'

const HOUR = 3_600_000
const MINUTE = 60_000
const DEPART = Date.UTC(2026, 5, 1, 6, 0)

const base = (overrides: Partial<TransitInput> = {}): TransitInput => ({
  drivingSeconds: 4 * 3600,
  crew: 1,
  departAt: DEPART,
  programUntil: null,
  dailyRestHours: 11,
  weeklyWorkUntil: null,
  weeklyRestHours: 45,
  ...overrides,
})

test('a run inside the first shift costs only its driving', () => {
  const r = estimateTransit(base())
  assert.equal(r.drivingMs, 4 * HOUR)
  assert.equal(r.totalMs, 4 * HOUR)
  assert.equal(r.breakMs, 0)
  assert.equal(r.nights, 0)
  assert.equal(r.arrival, DEPART + 4 * HOUR)
})

test('a solo driver stops 45 minutes every 4h30', () => {
  // Exactly one shift of driving: the break falls in the middle of it.
  const r = estimateTransit(base({ drivingSeconds: 9 * 3600 }))
  assert.equal(r.drivingMs, 9 * HOUR)
  assert.equal(r.breakMs, 45 * MINUTE)
  assert.equal(r.totalMs, 9 * HOUR + 45 * MINUTE)
  assert.equal(r.nights, 0)
})

test('driving past a shift buys a night', () => {
  const r = estimateTransit(base({ drivingSeconds: 12 * 3600 }))
  assert.equal(r.drivingMs, 12 * HOUR)
  assert.equal(r.breakMs, 45 * MINUTE)
  assert.equal(r.dailyRestMs, 11 * HOUR)
  assert.equal(r.nights, 1)
  assert.equal(r.totalMs, 12 * HOUR + 45 * MINUTE + 11 * HOUR)
})

test('the reduced daily rest shortens the trip by the hours it saves', () => {
  const long = estimateTransit(base({ drivingSeconds: 12 * 3600, dailyRestHours: 11 }))
  const short = estimateTransit(base({ drivingSeconds: 12 * 3600, dailyRestHours: 9 }))
  assert.equal(long.totalMs - short.totalMs, 2 * HOUR)
})

test('a second driver removes the working breaks and doubles the shift', () => {
  // 24h of driving: a crew covers it in one 18h shift, one 9h rest and six more
  // hours, and never stops for a 45-minute break.
  const r = estimateTransit(base({ crew: 2, drivingSeconds: 24 * 3600 }))
  assert.equal(r.drivingMs, 24 * HOUR)
  assert.equal(r.breakMs, 0)
  assert.equal(r.dailyRestMs, 9 * HOUR)
  assert.equal(r.nights, 1)
  assert.equal(r.totalMs, 33 * HOUR)
})

test('a crew ignores the daily-rest field — its rest is fixed at 9h', () => {
  // The 11h/9h choice is a solo driver's. A multi-manned crew owes 9 consecutive
  // hours inside each 30h window and nothing else, so the field must not apply.
  const eleven = estimateTransit(base({ crew: 2, drivingSeconds: 24 * 3600, dailyRestHours: 11 }))
  const nine = estimateTransit(base({ crew: 2, drivingSeconds: 24 * 3600, dailyRestHours: 9 }))
  assert.equal(eleven.totalMs, nine.totalMs)
  assert.equal(eleven.dailyRestMs, 9 * HOUR)
})

test('the same route is a different trip on a short remaining program', () => {
  const full = estimateTransit(base({ drivingSeconds: 6 * 3600 }))
  // Three hours left on the card: the run breaks over a night it would not
  // otherwise have needed.
  const short = estimateTransit(
    base({ drivingSeconds: 6 * 3600, programUntil: DEPART + 3 * HOUR }),
  )
  assert.equal(full.nights, 0)
  assert.equal(full.totalMs, 6 * HOUR + 45 * MINUTE)
  assert.equal(short.nights, 1)
  assert.equal(short.drivingMs, 6 * HOUR)
  assert.equal(short.totalMs, 6 * HOUR + 11 * HOUR)
})

test('a program already spent starts the trip with a rest', () => {
  const r = estimateTransit(base({ drivingSeconds: 2 * 3600, programUntil: DEPART }))
  assert.equal(r.nights, 1)
  assert.equal(r.totalMs, 2 * HOUR + 11 * HOUR)
})

test('running out of week takes the weekly rest, once', () => {
  const r = estimateTransit(
    base({
      drivingSeconds: 20 * 3600,
      weeklyWorkUntil: DEPART + 8 * HOUR,
      weeklyRestHours: 45,
    }),
  )
  assert.equal(r.weeklyRestTaken, true)
  assert.equal(r.weeklyRestMs, 45 * HOUR)
  // The second shift end falls after the weekly rest is already taken, so it is
  // an ordinary night.
  assert.equal(r.dailyRestMs, 11 * HOUR)
  assert.equal(r.nights, 1)
  assert.equal(r.breakMs, 2 * 45 * MINUTE)
  assert.equal(r.totalMs, 20 * HOUR + 90 * MINUTE + 45 * HOUR + 11 * HOUR)
})

test('the reduced weekly rest is 21 hours cheaper', () => {
  const regular = estimateTransit(
    base({ drivingSeconds: 20 * 3600, weeklyWorkUntil: DEPART + 8 * HOUR, weeklyRestHours: 45 }),
  )
  const reduced = estimateTransit(
    base({ drivingSeconds: 20 * 3600, weeklyWorkUntil: DEPART + 8 * HOUR, weeklyRestHours: 24 }),
  )
  assert.equal(regular.totalMs - reduced.totalMs, 21 * HOUR)
})

test('a week that outlasts the trip changes nothing', () => {
  const near = estimateTransit(
    base({ drivingSeconds: 12 * 3600, weeklyWorkUntil: DEPART + 500 * HOUR }),
  )
  const none = estimateTransit(base({ drivingSeconds: 12 * 3600 }))
  assert.equal(near.totalMs, none.totalMs)
  assert.equal(near.weeklyRestTaken, false)
})

test('no route is no time', () => {
  const r = estimateTransit(base({ drivingSeconds: 0 }))
  assert.equal(r.totalMs, 0)
  assert.equal(r.arrival, DEPART)
  assert.equal(r.nights, 0)
})
