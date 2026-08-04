import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateFix,
  metersBetween,
  downsampleTrack,
  splitSegments,
  trackGaps,
  MAX_ACCURACY_M,
  MIN_MOVE_M,
  MAX_SPEED_MPS,
  SEGMENT_GAP_MS,
  SEGMENT_GAP_M,
  type TrackCursor,
  type TrackPoint,
} from './tripTrack.js'

// A stretch of the A1 near Bucharest, far enough from the equator that a
// latitude-only test would hide a longitude bug.
const BASE = { lat: 44.4268, lng: 26.1025 }
const T0 = Date.parse('2026-08-04T09:00:00.000Z')

/** Offset a position by metres, so tests can state distance directly. */
function offset(lat: number, lng: number, northM: number, eastM: number) {
  const dLat = northM / 111_320
  const dLng = eastM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { lat: lat + dLat, lng: lng + dLng }
}

function cursorAt(lat: number, lng: number, atMs: number, segment = 0): TrackCursor {
  return { lat, lng, recordedAtMs: atMs, segment }
}

describe('metersBetween', () => {
  test('measures a known short distance to within a metre', () => {
    const b = offset(BASE.lat, BASE.lng, 100, 0)
    assert.ok(Math.abs(metersBetween(BASE.lat, BASE.lng, b.lat, b.lng) - 100) < 1)
  })

  test('is symmetric and zero for the same point', () => {
    const b = offset(BASE.lat, BASE.lng, 250, 400)
    assert.equal(metersBetween(BASE.lat, BASE.lng, BASE.lat, BASE.lng), 0)
    assert.ok(
      Math.abs(
        metersBetween(BASE.lat, BASE.lng, b.lat, b.lng) -
          metersBetween(b.lat, b.lng, BASE.lat, BASE.lng),
      ) < 1e-6,
    )
  })
})

describe('evaluateFix — structural validation', () => {
  test('accepts the first fix of a track with zero distance', () => {
    const d = evaluateFix(null, { ...BASE, recordedAtMs: T0 })
    assert.equal(d.accept, true)
    assert.equal(d.accept && d.distanceM, 0)
    assert.equal(d.accept && d.segment, 0)
  })

  test('rejects non-finite and out-of-range coordinates', () => {
    for (const bad of [
      { lat: Number.NaN, lng: 26.1 },
      { lat: 44.4, lng: Number.POSITIVE_INFINITY },
      { lat: 91, lng: 26.1 },
      { lat: 44.4, lng: -181 },
    ]) {
      const d = evaluateFix(null, { ...bad, recordedAtMs: T0 })
      assert.equal(d.accept, false, `expected rejection for ${JSON.stringify(bad)}`)
      assert.equal(!d.accept && d.reason, 'invalid')
    }
  })
})

describe('evaluateFix — accuracy gate', () => {
  test('rejects a fix less precise than the ceiling', () => {
    const d = evaluateFix(null, { ...BASE, recordedAtMs: T0, accuracyM: MAX_ACCURACY_M + 1 })
    assert.equal(d.accept, false)
    assert.equal(!d.accept && d.reason, 'accuracy')
  })

  test('accepts a fix exactly at the ceiling', () => {
    const d = evaluateFix(null, { ...BASE, recordedAtMs: T0, accuracyM: MAX_ACCURACY_M })
    assert.equal(d.accept, true)
  })

  test('accepts a fix that reports no accuracy at all', () => {
    assert.equal(evaluateFix(null, { ...BASE, recordedAtMs: T0 }).accept, true)
  })

  test('rejects on accuracy before considering movement', () => {
    // A wildly imprecise fix that also happens to be a plausible move must still
    // be refused — otherwise tower-level noise enters the distance total.
    const moved = offset(BASE.lat, BASE.lng, 300, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...moved,
      recordedAtMs: T0 + 30_000,
      accuracyM: 900,
    })
    assert.equal(!d.accept && d.reason, 'accuracy')
  })
})

describe('evaluateFix — deduplication and ordering', () => {
  test('rejects a replay of the stored instant', () => {
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), { ...BASE, recordedAtMs: T0 })
    assert.equal(!d.accept && d.reason, 'duplicate')
  })

  test('rejects a fix that arrives out of order', () => {
    const moved = offset(BASE.lat, BASE.lng, 500, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...moved,
      recordedAtMs: T0 - 60_000,
    })
    assert.equal(!d.accept && d.reason, 'out_of_order')
  })

  test('rejects two providers reporting the same sub-second instant', () => {
    const moved = offset(BASE.lat, BASE.lng, 40, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...moved,
      recordedAtMs: T0 + 400,
    })
    assert.equal(!d.accept && d.reason, 'duplicate')
  })

  test('a retried ping banks no additional distance', () => {
    // The exact scenario the phone produces on a flaky network: the same fix
    // posted twice. The second attempt must contribute nothing.
    const cursor = cursorAt(BASE.lat, BASE.lng, T0)
    const moved = offset(BASE.lat, BASE.lng, 200, 0)
    const first = evaluateFix(cursor, { ...moved, recordedAtMs: T0 + 20_000 })
    assert.equal(first.accept, true)

    const advanced = cursorAt(moved.lat, moved.lng, T0 + 20_000)
    const replay = evaluateFix(advanced, { ...moved, recordedAtMs: T0 + 20_000 })
    assert.equal(replay.accept, false)
    assert.equal(!replay.accept && replay.reason, 'duplicate')
  })
})

describe('evaluateFix — stationary jitter', () => {
  test('rejects movement below the threshold', () => {
    const jitter = offset(BASE.lat, BASE.lng, MIN_MOVE_M - 5, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...jitter,
      recordedAtMs: T0 + 10_000,
    })
    assert.equal(!d.accept && d.reason, 'stationary')
  })

  test('accepts movement above the threshold', () => {
    const moved = offset(BASE.lat, BASE.lng, MIN_MOVE_M + 10, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...moved,
      recordedAtMs: T0 + 10_000,
    })
    assert.equal(d.accept, true)
    assert.ok(d.accept && d.distanceM > MIN_MOVE_M)
  })

  test('a parked truck accumulates no distance over many pings', () => {
    // Twenty minutes of dock jitter at ±6 m must total exactly zero, which is
    // the whole point of the gate: noise must not become kilometres.
    let cursor = cursorAt(BASE.lat, BASE.lng, T0)
    let total = 0
    for (let i = 1; i <= 40; i++) {
      const wobble = offset(BASE.lat, BASE.lng, i % 2 === 0 ? 6 : -6, i % 3 === 0 ? 5 : -4)
      const d = evaluateFix(cursor, { ...wobble, recordedAtMs: T0 + i * 30_000 })
      if (d.accept) {
        total += d.distanceM
        cursor = cursorAt(wobble.lat, wobble.lng, T0 + i * 30_000, d.segment)
      }
    }
    assert.equal(total, 0)
  })
})

describe('evaluateFix — impossible movement', () => {
  test('rejects a jump faster than a truck can travel', () => {
    // 5 km in 10 s = 1800 km/h.
    const teleport = offset(BASE.lat, BASE.lng, 5_000, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...teleport,
      recordedAtMs: T0 + 10_000,
    })
    assert.equal(!d.accept && d.reason, 'impossible_speed')
  })

  test('rejects a continental jump even when the gap is long enough to excuse it', () => {
    // Six hours makes almost any speed "plausible", which is exactly why the
    // distance ceiling exists independently of the speed test.
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      lat: -33.86,
      lng: 151.2,
      recordedAtMs: T0 + 6 * 3_600_000,
    })
    assert.equal(!d.accept && d.reason, 'impossible_jump')
  })

  test('accepts motorway speed', () => {
    // 90 km/h for 30 s = 750 m.
    const moved = offset(BASE.lat, BASE.lng, 750, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...moved,
      recordedAtMs: T0 + 30_000,
    })
    assert.equal(d.accept, true)
    assert.ok(d.accept && Math.abs(d.distanceM - 750) < 5)
  })

  test('the speed ceiling is applied at the documented boundary', () => {
    const justOver = offset(BASE.lat, BASE.lng, MAX_SPEED_MPS * 10 + 100, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...justOver,
      recordedAtMs: T0 + 10_000,
    })
    assert.equal(!d.accept && d.reason, 'impossible_speed')
  })
})

describe('evaluateFix — signal gaps', () => {
  test('a long silence opens a new segment and claims no distance', () => {
    const moved = offset(BASE.lat, BASE.lng, 900, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...moved,
      recordedAtMs: T0 + SEGMENT_GAP_MS + 60_000,
    })
    assert.equal(d.accept, true)
    assert.equal(d.accept && d.gap, true)
    assert.equal(d.accept && d.segment, 1)
    // The path across the hole is unknown, so nothing is invented for it.
    assert.equal(d.accept && d.distanceM, 0)
  })

  test('a large distance between consecutive fixes also breaks the segment', () => {
    const far = offset(BASE.lat, BASE.lng, SEGMENT_GAP_M + 500, 0)
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...far,
      recordedAtMs: T0 + 120_000,
    })
    assert.equal(d.accept, true)
    assert.equal(d.accept && d.gap, true)
    assert.equal(d.accept && d.distanceM, 0)
  })

  test('a stationary fix after a gap is kept, so the hole has a visible end', () => {
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...BASE,
      recordedAtMs: T0 + SEGMENT_GAP_MS + 30_000,
    })
    assert.equal(d.accept, true, 'a post-gap fix must survive the stationary gate')
    assert.equal(d.accept && d.gap, true)
  })

  test('segments keep incrementing across successive gaps', () => {
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0, 4), {
      ...BASE,
      recordedAtMs: T0 + SEGMENT_GAP_MS * 2,
    })
    assert.equal(d.accept && d.segment, 5)
  })
})

describe('evaluateFix — silence versus stillness', () => {
  // A parked truck keeps reporting, and those reports are correctly filtered out
  // as stationary. If the gap test measured from the last STORED point, that
  // filtering would itself manufacture a signal gap for a truck sitting at a
  // dock with perfect reception — which is why the cursor carries a separate
  // "last heard from" clock.
  test('a long park with steady pings is NOT a gap', () => {
    const parkedFor = SEGMENT_GAP_MS * 5
    const cursor: TrackCursor = {
      lat: BASE.lat,
      lng: BASE.lng,
      // Last stored point is hours old…
      recordedAtMs: T0,
      segment: 0,
      // …but the phone reported 30 seconds ago.
      lastSeenAtMs: T0 + parkedFor,
    }
    const moved = offset(BASE.lat, BASE.lng, 300, 0)
    const d = evaluateFix(cursor, { ...moved, recordedAtMs: T0 + parkedFor + 30_000 })
    assert.equal(d.accept, true)
    assert.equal(d.accept && d.gap, false, 'a reporting phone is not a signal gap')
    assert.equal(d.accept && d.segment, 0, 'no new segment for a parked truck')
    assert.ok(d.accept && Math.abs(d.distanceM - 300) < 5, 'distance still measured from the anchor')
  })

  test('real silence IS a gap even when the truck never moved', () => {
    const cursor: TrackCursor = {
      lat: BASE.lat,
      lng: BASE.lng,
      recordedAtMs: T0,
      segment: 0,
      lastSeenAtMs: T0,
    }
    const d = evaluateFix(cursor, { ...BASE, recordedAtMs: T0 + SEGMENT_GAP_MS + 60_000 })
    assert.equal(d.accept && d.gap, true)
  })

  test('pulling away after a long stop is not read as a teleport', () => {
    // Speed must be measured against the anchor's age, not against "we heard
    // from it 10 seconds ago" — otherwise every departure from a dock divides a
    // real displacement by a few seconds and reads as impossible.
    const cursor: TrackCursor = {
      lat: BASE.lat,
      lng: BASE.lng,
      recordedAtMs: T0,
      segment: 0,
      lastSeenAtMs: T0 + 3_600_000,
    }
    const moved = offset(BASE.lat, BASE.lng, 900, 0)
    const d = evaluateFix(cursor, { ...moved, recordedAtMs: T0 + 3_600_000 + 10_000 })
    assert.equal(d.accept, true, 'a departure after an hour parked must be accepted')
    assert.ok(d.accept && Math.abs(d.distanceM - 900) < 10)
  })

  test('a fix older than the last SEEN one is still refused', () => {
    // The ordering test must use the last-seen clock, or a filtered stationary
    // ping would let a stale queued fix slip in behind it.
    const cursor: TrackCursor = {
      lat: BASE.lat,
      lng: BASE.lng,
      recordedAtMs: T0,
      segment: 0,
      lastSeenAtMs: T0 + 600_000,
    }
    const moved = offset(BASE.lat, BASE.lng, 400, 0)
    const d = evaluateFix(cursor, { ...moved, recordedAtMs: T0 + 300_000 })
    assert.equal(!d.accept && d.reason, 'out_of_order')
  })

  test('an absent last-seen clock falls back to the stored point', () => {
    // Tracks written before the two clocks were separated have no last_seen_at;
    // they must behave exactly as they did.
    const d = evaluateFix(cursorAt(BASE.lat, BASE.lng, T0), {
      ...BASE,
      recordedAtMs: T0 + SEGMENT_GAP_MS + 60_000,
    })
    assert.equal(d.accept && d.gap, true)
  })
})

describe('incremental distance accumulation', () => {
  test('a straight run totals its true length regardless of ping cadence', () => {
    // 20 fixes 100 m apart = 2 km, whatever the sampling interval.
    let cursor = cursorAt(BASE.lat, BASE.lng, T0)
    let total = 0
    for (let i = 1; i <= 20; i++) {
      const p = offset(BASE.lat, BASE.lng, i * 100, 0)
      const at = T0 + i * 10_000
      const d = evaluateFix(cursor, { ...p, recordedAtMs: at })
      assert.equal(d.accept, true)
      total += d.accept ? d.distanceM : 0
      cursor = cursorAt(p.lat, p.lng, at, d.accept ? d.segment : 0)
    }
    assert.ok(Math.abs(total - 2_000) < 10, `expected ~2000 m, got ${total}`)
  })

  test('rejected fixes never advance the cursor, so noise cannot inflate the total', () => {
    let cursor = cursorAt(BASE.lat, BASE.lng, T0)
    let total = 0
    const stream: Array<{ lat: number; lng: number; recordedAtMs: number; accuracyM?: number }> = [
      { ...offset(BASE.lat, BASE.lng, 200, 0), recordedAtMs: T0 + 20_000 },
      // A garbage fix 40 km off, then the real path resumes.
      { ...offset(BASE.lat, BASE.lng, 40_000, 0), recordedAtMs: T0 + 25_000 },
      { ...offset(BASE.lat, BASE.lng, 400, 0), recordedAtMs: T0 + 40_000 },
      { ...offset(BASE.lat, BASE.lng, 600, 0), recordedAtMs: T0 + 60_000 },
    ]
    for (const fix of stream) {
      const d = evaluateFix(cursor, fix)
      if (!d.accept) continue
      total += d.distanceM
      cursor = cursorAt(fix.lat, fix.lng, fix.recordedAtMs, d.segment)
    }
    // 0→200→400→600 m; the 40 km outlier contributed nothing and, crucially,
    // did not become the origin for the following leg.
    assert.ok(Math.abs(total - 600) < 10, `expected ~600 m, got ${total}`)
  })
})

// ── History shaping ──────────────────────────────────────────────────────────

function point(at: number, segment: number, north = 0): TrackPoint {
  const p = offset(BASE.lat, BASE.lng, north, 0)
  return { lat: p.lat, lng: p.lng, at, segment }
}

describe('splitSegments', () => {
  test('splits exactly at segment changes', () => {
    const runs = splitSegments([
      point(T0, 0),
      point(T0 + 1, 0),
      point(T0 + 2, 1),
      point(T0 + 3, 1),
      point(T0 + 4, 2),
    ])
    assert.deepEqual(runs.map((r) => r.length), [2, 2, 1])
  })

  test('an unbroken path stays one run', () => {
    assert.equal(splitSegments([point(T0, 0), point(T0 + 1, 0), point(T0 + 2, 0)]).length, 1)
  })

  test('an empty path yields no runs', () => {
    assert.deepEqual(splitSegments([]), [])
  })
})

describe('trackGaps', () => {
  test('reports the window between two runs', () => {
    const gaps = trackGaps([point(T0, 0), point(T0 + 60_000, 0), point(T0 + 900_000, 1)])
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].from, T0 + 60_000)
    assert.equal(gaps[0].to, T0 + 900_000)
  })

  test('reports nothing for a continuous path', () => {
    assert.deepEqual(trackGaps([point(T0, 0), point(T0 + 1, 0)]), [])
  })
})

describe('downsampleTrack', () => {
  const dense: TrackPoint[] = Array.from({ length: 4_000 }, (_, i) => point(T0 + i * 1_000, 0, i * 10))

  test('leaves a path under the budget untouched', () => {
    const small = dense.slice(0, 50)
    assert.equal(downsampleTrack(small, 500), small)
  })

  test('respects the budget', () => {
    assert.ok(downsampleTrack(dense, 500).length <= 500)
  })

  test('keeps the first and last point exactly', () => {
    const out = downsampleTrack(dense, 300)
    assert.equal(out[0].at, dense[0].at)
    assert.equal(out[out.length - 1].at, dense[dense.length - 1].at)
  })

  test('preserves chronological order', () => {
    const out = downsampleTrack(dense, 400)
    for (let i = 1; i < out.length; i++) assert.ok(out[i].at >= out[i - 1].at)
  })

  test('never merges two segments into one', () => {
    // The critical property: thinning must not be able to bridge a gap, or a
    // downsampled history would draw a straight line across the hole.
    const twoRuns = [
      ...Array.from({ length: 1_000 }, (_, i) => point(T0 + i * 1_000, 0, i * 10)),
      ...Array.from({ length: 1_000 }, (_, i) => point(T0 + 5_000_000 + i * 1_000, 1, i * 10)),
    ]
    const out = downsampleTrack(twoRuns, 100)
    assert.equal(splitSegments(out).length, 2)
    assert.equal(trackGaps(out).length, 1)
  })

  test('keeps every segment represented even when the budget is tight', () => {
    const many = [0, 1, 2, 3, 4].flatMap((segment) =>
      Array.from({ length: 200 }, (_, i) => point(T0 + segment * 1_000_000 + i * 1_000, segment)),
    )
    const out = downsampleTrack(many, 12)
    assert.equal(new Set(out.map((p) => p.segment)).size, 5)
  })
})
