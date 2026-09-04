import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateArrival,
  legDurationSec,
  partsIn,
  expandBanRules,
  resolveBans,
  zonedToUtc,
  type BanWindow,
  type CalcInput,
} from './restrictions'

const HOUR = 3_600_000

// Read an instant back as a wall clock, so a failure says "expected 12:00 in
// Rome, got 11:00" instead of comparing two epoch numbers nobody can read.
const clock = (zone: string, ms: number): string => {
  const p = partsIn(zone, ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

const base = (overrides: Partial<CalcInput> = {}): CalcInput => ({
  departAt: zonedToUtc('Europe/Bucharest', 2026, 6, 1, 6, 0),
  shiftEndTime: '22:00',
  shiftZone: 'Europe/Bucharest',
  maxDrivingHoursPerShift: null,
  averageSpeedKmh: null,
  legs: [{ code: 'ROU', duration: 4 * 3600, length: 320_000 }],
  bans: [],
  rest: { defaultHours: 9, overrides: {} },
  ...overrides,
})

test('zonedToUtc resolves standard and summer time', () => {
  // Romania is UTC+2 in January, UTC+3 in June.
  assert.equal(zonedToUtc('Europe/Bucharest', 2026, 1, 15, 8, 0), Date.UTC(2026, 0, 15, 6, 0))
  assert.equal(zonedToUtc('Europe/Bucharest', 2026, 6, 15, 8, 0), Date.UTC(2026, 5, 15, 5, 0))
})

test('zonedToUtc holds across a DST transition', () => {
  // EU clocks go forward on the last Sunday of March — 29 March 2026, at 03:00
  // local in Bucharest. 02:30 does not exist that night; 04:00 does and is
  // already on summer time.
  assert.equal(zonedToUtc('Europe/Bucharest', 2026, 3, 29, 1, 0), Date.UTC(2026, 2, 28, 23, 0))
  assert.equal(zonedToUtc('Europe/Bucharest', 2026, 3, 29, 4, 0), Date.UTC(2026, 2, 29, 1, 0))
})

test('an unobstructed run arrives at departure plus driving time', () => {
  const result = calculateArrival(base())
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-01 10:00')
  assert.equal(result.drivingMs, 4 * HOUR)
  assert.equal(result.restMs, 0)
  assert.equal(result.banMs, 0)
  assert.equal(result.segments.length, 1)
})

test('the working day ends driving and the rest resumes it', () => {
  const result = calculateArrival(
    base({
      shiftEndTime: '14:00',
      legs: [{ code: 'ROU', duration: 10 * 3600, length: 800_000 }],
    }),
  )
  // 06:00 → 14:00 is 8h of the 10h; 9h of rest; the last 2h run into the night.
  assert.deepEqual(
    result.segments.map((s) => [s.kind, clock('Europe/Bucharest', s.start)]),
    [
      ['drive', '2026-06-01 06:00'],
      ['rest', '2026-06-01 14:00'],
      ['drive', '2026-06-01 23:00'],
    ],
  )
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-02 01:00')
  assert.equal(result.drivingMs, 10 * HOUR)
  assert.equal(result.restMs, 9 * HOUR)
})

test('a driving cap ends the shift before the clock does', () => {
  const result = calculateArrival(
    base({
      maxDrivingHoursPerShift: 9,
      legs: [{ code: 'ROU', duration: 12 * 3600, length: 900_000 }],
    }),
  )
  // Stops after 9h at 15:00, not at the 22:00 shift end.
  assert.equal(clock('Europe/Bucharest', result.segments[1].start), '2026-06-01 15:00')
  assert.equal(result.segments[1].kind, 'rest')
  assert.equal(result.drivingMs, 12 * HOUR)
})

test('a ban window holds the truck and pushes the arrival', () => {
  const bans: BanWindow[] = [
    { id: 'b1', countryCode: 'ROU', date: '2026-06-01', from: '08:00', to: '10:00' },
  ]
  const result = calculateArrival(base({ bans }))
  assert.deepEqual(
    result.segments.map((s) => [s.kind, clock('Europe/Bucharest', s.start), clock('Europe/Bucharest', s.end)]),
    [
      ['drive', '2026-06-01 06:00', '2026-06-01 08:00'],
      ['ban', '2026-06-01 08:00', '2026-06-01 10:00'],
      ['drive', '2026-06-01 10:00', '2026-06-01 12:00'],
    ],
  )
  assert.equal(result.banMs, 2 * HOUR)
})

test('a ban is read in the banning country clock, not the operation clock', () => {
  // THE ONE-HOUR TRAP. The operation runs on Bucharest time (UTC+3 in June);
  // the ban is Italian, so 08:00–09:00 Rome (UTC+2) is 09:00–10:00 in Bucharest
  // — an hour later than a naive same-zone reading would put it.
  const bans: BanWindow[] = [
    { id: 'it', countryCode: 'ITA', date: '2026-06-07', from: '08:00', to: '09:00' },
  ]
  const result = calculateArrival(
    base({
      departAt: zonedToUtc('Europe/Bucharest', 2026, 6, 7, 8, 0),
      legs: [{ code: 'ITA', duration: 3 * 3600, length: 240_000 }],
      bans,
    }),
  )
  const ban = result.segments.find((s) => s.kind === 'ban')
  assert.ok(ban, 'expected the ban to hold the truck')
  assert.equal(clock('Europe/Rome', ban.start), '2026-06-07 08:00')
  assert.equal(clock('Europe/Bucharest', ban.start), '2026-06-07 09:00')
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-07 12:00')
})

test('a window whose end is not after its start runs past midnight', () => {
  const resolved = resolveBans(
    [{ id: 'n', countryCode: 'AUT', date: '2026-06-07', from: '22:00', to: '06:00' }],
    'Europe/Bucharest',
  )
  assert.equal(resolved.length, 1)
  assert.equal(clock('Europe/Vienna', resolved[0].start), '2026-06-07 22:00')
  assert.equal(clock('Europe/Vienna', resolved[0].end), '2026-06-08 06:00')
})

test('a rest override lengthens one stop only', () => {
  const result = calculateArrival(
    base({
      shiftEndTime: '14:00',
      legs: [{ code: 'ROU', duration: 10 * 3600, length: 800_000 }],
      rest: { defaultHours: 9, overrides: { 0: [45] } },
    }),
  )
  const rest = result.segments.find((s) => s.kind === 'rest')
  assert.ok(rest)
  assert.equal(rest.end - rest.start, 45 * HOUR)
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-03 13:00')
})

test('rest blocks at one stop are taken back to back', () => {
  const result = calculateArrival(
    base({
      shiftEndTime: '14:00',
      legs: [{ code: 'ROU', duration: 10 * 3600, length: 800_000 }],
      // 9h and then the 45h weekly, the way a dispatcher plans it.
      rest: { defaultHours: 9, overrides: { 0: [9, 45] } },
    }),
  )
  const rest = result.segments.find((s) => s.kind === 'rest')
  assert.ok(rest)
  assert.equal(rest.end - rest.start, 54 * HOUR)
  assert.equal(result.restMs, 54 * HOUR)
})

test('a rule expands over its date range and all of its windows', () => {
  // Two windows a day — the shape a country that closes 07:00–16:00 and then
  // 19:00–00:00 needs — across three consecutive days.
  const windows = expandBanRules([
    {
      id: 'r1',
      countryCode: 'ITA',
      dateFrom: '2026-06-05',
      dateTo: '2026-06-07',
      intervals: [
        { id: 'a', from: '07:00', to: '16:00' },
        { id: 'b', from: '19:00', to: '00:00' },
      ],
    },
  ])
  assert.equal(windows.length, 6)
  assert.deepEqual(
    windows.map((w) => w.date + " " + w.from + "-" + w.to),
    [
      '2026-06-05 07:00-16:00',
      '2026-06-05 19:00-00:00',
      '2026-06-06 07:00-16:00',
      '2026-06-06 19:00-00:00',
      '2026-06-07 07:00-16:00',
      '2026-06-07 19:00-00:00',
    ],
  )

  // 19:00–00:00 has to land on the following midnight, not collapse to nothing.
  const resolved = resolveBans(windows.slice(1, 2), 'Europe/Rome')
  assert.equal(clock('Europe/Rome', resolved[0].start), '2026-06-05 19:00')
  assert.equal(clock('Europe/Rome', resolved[0].end), '2026-06-06 00:00')
})

test('a range that ends before it starts expands to nothing', () => {
  assert.deepEqual(
    expandBanRules([
      {
        id: 'r',
        countryCode: 'ROU',
        dateFrom: '2026-06-07',
        dateTo: '2026-06-05',
        intervals: [{ id: 'a', from: '08:00', to: '10:00' }],
      },
    ]),
    [],
  )
})

test('average speed replaces the routing engine estimate', () => {
  // 100km that HERE calls an hour takes two at 50 km/h.
  assert.equal(legDurationSec({ code: 'ROU', duration: 3600, length: 100_000 }, 50), 7200)
  // No distance to work from, or no speed given: keep HERE's own number.
  assert.equal(legDurationSec({ code: 'ROU', duration: 3600 }, 50), 3600)
  assert.equal(legDurationSec({ code: 'ROU', duration: 3600, length: 100_000 }, null), 3600)

  const result = calculateArrival(
    base({ averageSpeedKmh: 40, legs: [{ code: 'ROU', duration: 4 * 3600, length: 320_000 }] })
  )
  // 320km at 40 km/h is 8h, not the 4h HERE estimated.
  assert.equal(result.drivingMs, 8 * HOUR)
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-01 14:00')
})

test('consecutive countries chain into one arrival', () => {
  const result = calculateArrival(
    base({
      legs: [
        { code: 'ROU', duration: 2 * 3600, length: 160_000 },
        { code: 'HUN', duration: 2 * 3600, length: 160_000 },
      ],
      bans: [{ id: 'hu', countryCode: 'HUN', date: '2026-06-01', from: '08:00', to: '10:00' }],
    }),
  )
  // Hungary is UTC+2 in June against Bucharest's UTC+3, so its 08:00 ban bites
  // at 09:00 on the operation's clock — an hour after the border, catching the
  // truck mid-leg rather than at the crossing.
  assert.deepEqual(
    result.segments.map((s) => [s.kind, s.countryCode]),
    [
      ['drive', 'ROU'],
      ['drive', 'HUN'],
      ['ban', 'HUN'],
      ['drive', 'HUN'],
    ],
  )
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-01 12:00')
})
