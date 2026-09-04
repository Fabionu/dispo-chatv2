import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateArrival,
  expandBanRules,
  legDurationSec,
  partsIn,
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
  programUntil: null,
  driverCount: 1,
  breakHours: [],
  shiftZone: 'Europe/Bucharest',
  averageSpeedKmh: null,
  legs: [{ code: 'ROU', duration: 4 * 3600, length: 320_000 }],
  bans: [],
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
  assert.equal(result.breakMs, 0)
  assert.equal(result.banMs, 0)
  assert.equal(result.segments.length, 1)
})

test('a ban window holds the truck and pushes the arrival', () => {
  const bans: BanWindow[] = [
    { id: 'b1', countryCode: 'ROU', date: '2026-06-01', from: '08:00', to: '10:00' },
  ]
  const result = calculateArrival(base({ bans }))
  assert.deepEqual(
    result.segments.map((s) => [
      s.kind,
      clock('Europe/Bucharest', s.start),
      clock('Europe/Bucharest', s.end),
    ]),
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
    windows.map((w) => w.date + ' ' + w.from + '-' + w.to),
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

test('entered rest blocks are summed onto the arrival', () => {
  const result = calculateArrival(base({ breakHours: [9, 45] }))
  // 4h of driving, then 54h of rest the dispatcher entered.
  assert.equal(result.drivingMs, 4 * HOUR)
  assert.equal(result.breakMs, 54 * HOUR)
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-03 16:00')
  assert.deepEqual(
    result.segments.map((s) => s.kind),
    ['drive', 'break'],
  )
})

test('no rest blocks entered adds nothing and shows no rest segment', () => {
  const result = calculateArrival(base({ breakHours: [] }))
  assert.equal(result.breakMs, 0)
  assert.ok(!result.segments.some((s) => s.kind === 'break'))
})

test('the overrun is what the crew cannot cover, in shifts', () => {
  const departAt = zonedToUtc('Europe/Bucharest', 2026, 6, 1, 6, 0)
  const legs = [{ code: 'ROU', duration: 30 * 3600, length: 2_400_000 }]
  // Six hours of program left against thirty hours of driving: 24h short.
  const programUntil = departAt + 6 * HOUR

  const solo = calculateArrival(base({ departAt, legs, programUntil, driverCount: 1 }))
  assert.equal(solo.overrunMs, 24 * HOUR)
  assert.equal(solo.shiftHours, 9)
  assert.equal(solo.shiftsNeeded, 3)

  // The same run with a second driver: the truck keeps moving through the shift
  // the solo driver would have had to sleep through, so it needs fewer rests.
  const crew = calculateArrival(base({ departAt, legs, programUntil, driverCount: 2 }))
  assert.equal(crew.overrunMs, 24 * HOUR)
  assert.equal(crew.shiftHours, 18)
  assert.equal(crew.shiftsNeeded, 2)
})

test('a run inside the remaining program needs no further shift', () => {
  const departAt = zonedToUtc('Europe/Bucharest', 2026, 6, 1, 6, 0)
  const result = calculateArrival(base({ departAt, programUntil: departAt + 5 * HOUR }))
  assert.equal(result.overrunMs, 0)
  assert.equal(result.shiftsNeeded, 0)
})

test('a closed border does not consume the driver hours', () => {
  // Two hours held at a ban, four hours of driving, five hours of program. The
  // overrun is measured on DRIVING time, so waiting costs the arrival but not
  // the card — a truck parked at a barrier is not driving.
  const departAt = zonedToUtc('Europe/Bucharest', 2026, 6, 1, 6, 0)
  const result = calculateArrival(
    base({
      departAt,
      programUntil: departAt + 5 * HOUR,
      bans: [{ id: 'b', countryCode: 'ROU', date: '2026-06-01', from: '08:00', to: '10:00' }],
    }),
  )
  assert.equal(result.banMs, 2 * HOUR)
  assert.equal(clock('Europe/Bucharest', result.arrival), '2026-06-01 12:00')
  assert.equal(result.overrunMs, 0)
  assert.equal(result.shiftsNeeded, 0)
})

test('average speed replaces the routing engine estimate', () => {
  // 100km that HERE calls an hour takes two at 50 km/h.
  assert.equal(legDurationSec({ code: 'ROU', duration: 3600, length: 100_000 }, 50), 7200)
  // No distance to work from, or no speed given: keep HERE's own number.
  assert.equal(legDurationSec({ code: 'ROU', duration: 3600 }, 50), 3600)
  assert.equal(legDurationSec({ code: 'ROU', duration: 3600, length: 100_000 }, null), 3600)

  const result = calculateArrival(
    base({ averageSpeedKmh: 40, legs: [{ code: 'ROU', duration: 4 * 3600, length: 320_000 }] }),
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
