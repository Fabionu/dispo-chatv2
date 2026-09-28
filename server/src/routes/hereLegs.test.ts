import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decode, encode } from '@here/flexpolyline'
import { joinPolylines, legSections, type LegSection } from './hereLegs.js'

// The shape these tests defend: HERE splits a leg at every ferry, and the
// client reads section i as the leg from waypoint i to waypoint i+1. A route
// Munich → (via) Jönköping → Hamburg comes back as drive, ferry, drive | drive,
// ferry, drive — six sections for two legs.

const line = (...pts: Array<[number, number]>) => encode({ polyline: pts })
// A decoded line, at the precision it was encoded with (decoding sums float
// deltas, so raw values drift by a few ulps).
const points = (encoded: string) => {
  const { polyline, precision } = decode(encoded)
  return polyline.map((p) => p.map((v) => Number(v.toFixed(precision))))
}

function section(
  id: string,
  from: [number, number],
  to: [number, number],
  opts: { via?: number; duration?: number; length?: number; notice?: string } = {},
): LegSection {
  return {
    id,
    polyline: line(from, to),
    summary: { duration: opts.duration ?? 100, length: opts.length ?? 1000 },
    notices: opts.notice ? [{ code: opts.notice }] : [],
    departure: { place: { location: { lat: from[0], lng: from[1] } } },
    arrival: {
      place: { location: { lat: to[0], lng: to[1] }, ...(opts.via !== undefined ? { waypoint: opts.via } : {}) },
    },
  }
}

const MUNICH: [number, number] = [48.137, 11.575]
const ROSTOCK: [number, number] = [54.1526, 12.1011]
const GEDSER: [number, number] = [54.5737, 11.9246]
const JONKOPING: [number, number] = [57.7692, 14.1898]
const RODBY: [number, number] = [54.6543, 11.3508]
const PUTTGARDEN: [number, number] = [54.5023, 11.2278]
const HAMBURG: [number, number] = [53.5511, 9.9937]

const ferryRoute = [
  section('a', MUNICH, ROSTOCK, { duration: 36015, length: 781034 }),
  section('ferry-1', ROSTOCK, GEDSER, { duration: 6142, length: 48239, notice: 'noSchedule' }),
  section('b', GEDSER, JONKOPING, { via: 0, duration: 20263, length: 477144 }),
  section('c', JONKOPING, RODBY, { duration: 21218, length: 490358 }),
  section('ferry-2', RODBY, PUTTGARDEN, { duration: 3486, length: 18739 }),
  section('d', PUTTGARDEN, HAMBURG, { duration: 7581, length: 152202 }),
]

describe('legSections', () => {
  test('folds ferry crossings into the leg they belong to', () => {
    const legs = legSections(ferryRoute, 2)
    assert.equal(legs.length, 2)
    // Leg 0 ends ON the via — the point the user dragged — not at the ferry.
    assert.deepEqual(legs[0].arrival?.place?.location, { lat: JONKOPING[0], lng: JONKOPING[1] })
    assert.deepEqual(legs[1].departure?.place?.location, { lat: JONKOPING[0], lng: JONKOPING[1] })
    assert.deepEqual(legs[0].departure?.place?.location, { lat: MUNICH[0], lng: MUNICH[1] })
    assert.deepEqual(legs[1].arrival?.place?.location, { lat: HAMBURG[0], lng: HAMBURG[1] })
  })

  test('sums duration and length, keeps every notice', () => {
    const legs = legSections(ferryRoute, 2)
    assert.deepEqual(legs[0].summary, { duration: 36015 + 6142 + 20263, length: 781034 + 48239 + 477144 })
    assert.deepEqual(legs[1].summary, { duration: 21218 + 3486 + 7581, length: 490358 + 18739 + 152202 })
    assert.deepEqual(legs[0].notices, [{ code: 'noSchedule' }])
  })

  test('the leg line runs through the crossing, boundary vertices kept once', () => {
    const legs = legSections(ferryRoute, 2)
    assert.deepEqual(points(legs[0].polyline!), [MUNICH, ROSTOCK, GEDSER, JONKOPING])
  })

  test('a route without ferries passes through as the same array', () => {
    const plain = [section('a', MUNICH, JONKOPING, { via: 0 }), section('b', JONKOPING, HAMBURG)]
    assert.equal(legSections(plain, 2), plain)
  })

  test('a ferry on a route with no vias is one leg', () => {
    const legs = legSections(
      [section('a', MUNICH, ROSTOCK), section('f', ROSTOCK, GEDSER), section('b', GEDSER, JONKOPING)],
      1,
    )
    assert.equal(legs.length, 1)
    assert.deepEqual(points(legs[0].polyline!), [MUNICH, ROSTOCK, GEDSER, JONKOPING])
  })

  test('an answer that does not add up to the legs passes through untouched', () => {
    // Three sections, none tagged as a via, but two legs expected.
    const odd = [section('a', MUNICH, ROSTOCK), section('f', ROSTOCK, GEDSER), section('b', GEDSER, HAMBURG)]
    assert.equal(legSections(odd, 2), odd)
  })
})

describe('joinPolylines', () => {
  test('keeps the first part’s precision', () => {
    const a = encode({ polyline: [[1.1234567, 2.1234567], [3, 4]], precision: 7 })
    const b = encode({ polyline: [[3, 4], [5, 6]], precision: 7 })
    const joined = joinPolylines([a, b])!
    assert.equal(decode(joined).precision, 7)
    assert.deepEqual(points(joined), [[1.1234567, 2.1234567], [3, 4], [5, 6]])
  })

  test('skips missing parts', () => {
    assert.equal(joinPolylines([undefined]), undefined)
    assert.deepEqual(points(joinPolylines([undefined, line([1, 2], [3, 4])])!), [[1, 2], [3, 4]])
  })
})
