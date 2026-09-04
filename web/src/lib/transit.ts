// Transit-time estimator: how long a route actually takes once EU driving law
// is applied to it, rather than how long the wheels turn.
//
// PURE — no React, no HERE, no Date.now(). Separate from lib/restrictions.ts on
// purpose, because the two answer different questions and must not drift into
// each other:
//
//   transit.ts      "how long does this trip take?" — rests are PRESCRIBED by
//                   law, so they are placed on the clock and counted.
//   restrictions.ts "when does the truck arrive given the bans I know about?" —
//                   rests are entered by the dispatcher and only summed,
//                   because nobody can say in advance where a truck will find
//                   nine hours of parking.
//
// Reference: Regulation (EC) 561/2006. The numbers below are the conservative
// end of it, and every place they could have been optimistic says why.

export type Crew = 1 | 2

/**
 * Driving hours a shift can hold, by crew size.
 *
 * A single driver may drive 9h a day, extendable to 10h twice a week — the
 * extension is not used here because this estimator does not track a week, and
 * planning on twice-weekly permission would promise an arrival only a perfect
 * fortnight delivers.
 *
 * A two-driver crew is not one driver twice: each keeps his own 9h, but they
 * alternate at the wheel, so the VEHICLE keeps moving. 18h of driving plus the
 * crew's 9h rest is 27h, inside the 30h window the regulation gives multi-manned
 * crews to take that rest.
 */
export const SHIFT_DRIVING_HOURS: Record<Crew, number> = { 1: 9, 2: 18 }

/**
 * The daily rest a two-driver crew takes. FIXED, not a preference: the crew rule
 * is 9 consecutive hours inside each 30h window, so there is no 11h/9h choice to
 * offer here the way there is for a solo driver.
 */
export const CREW_DAILY_REST_HOURS = 9

/** Driving before a working break is due, and how long that break is. */
const BREAK_AFTER_HOURS = 4.5
const BREAK_MINUTES = 45

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

export type TransitInput = {
  /** Seconds of driving the route needs (HERE's estimate, or an adjusted one). */
  drivingSeconds: number
  crew: Crew
  /** Departure instant (epoch ms). */
  departAt: number
  /**
   * The instant the CURRENT shift's program runs out. `null` means the crew
   * starts on a full shift.
   *
   * This is the "they only have four hours left today" case, and it is the one
   * input that makes an estimate match reality on a Friday afternoon: the same
   * route started with a full card and started with three hours left are two
   * different trips.
   */
  programUntil: number | null
  /**
   * Daily rest between shifts, in hours. Ignored for a two-driver crew, which
   * always takes CREW_DAILY_REST_HOURS.
   *
   * 11h is the regular rest; 9h is the reduced one, permitted at most three
   * times between two weekly rests. The estimator does not count how many
   * reductions have been used, so a 9h answer here is the dispatcher asserting
   * one is available — which is why it is an input rather than an assumption.
   */
  dailyRestHours: number
  /**
   * The instant the crew's working week runs out. `null` means the trip is not
   * near it.
   */
  weeklyWorkUntil: number | null
  /** The weekly rest taken when the week runs out — 45h regular, 24h reduced. */
  weeklyRestHours: number
}

export type TransitResult = {
  /** Arrival instant (epoch ms). */
  arrival: number
  /** Departure to arrival, rests included. */
  totalMs: number
  drivingMs: number
  /** The 45-minute working breaks. Always 0 for a two-driver crew. */
  breakMs: number
  dailyRestMs: number
  weeklyRestMs: number
  /** Daily rests taken — i.e. nights out. */
  nights: number
  /** Whether the trip runs into the weekly rest. */
  weeklyRestTaken: boolean
}

/**
 * Walk the route's driving time through the crew's hours.
 *
 * The loop drives in chunks bounded by whichever comes first: what is left of
 * the route, what is left of the shift, or the next working break. Whatever
 * stops the chunk is then resolved and the loop looks again — the same
 * "resolve one blocker, then re-decide" shape lib/restrictions.ts uses, and for
 * the same reason: a break can fall on a shift boundary, a shift can end on the
 * week's last hour, and hard-coding an order for those makes one of them wrong.
 */
export function estimateTransit(input: TransitInput): TransitResult {
  const crew: Crew = input.crew === 2 ? 2 : 1
  const shiftMs = SHIFT_DRIVING_HOURS[crew] * HOUR_MS
  const dailyRestMsEach =
    (crew === 2 ? CREW_DAILY_REST_HOURS : Math.max(0, input.dailyRestHours)) * HOUR_MS
  const weeklyRestMsEach = Math.max(0, input.weeklyRestHours) * HOUR_MS

  // A two-driver crew does not stop for the working break: a driver may take it
  // in a vehicle his colleague is driving, so it costs the TRUCK nothing. For a
  // solo driver it is 45 minutes of standing still every 4h30, which over a
  // 1500km run is most of an hour and a half.
  const breakEvery = crew === 1 ? BREAK_AFTER_HOURS * HOUR_MS : Infinity
  const breakMsEach = crew === 1 ? BREAK_MINUTES * MINUTE_MS : 0

  let now = input.departAt
  let remaining = Math.max(0, input.drivingSeconds) * 1000

  // What the FIRST shift can still hold. A stated program shorter than a full
  // shift is the whole point of the input; a program already spent (or in the
  // past) leaves zero, and the trip starts with a rest.
  let shiftLeft =
    input.programUntil === null
      ? shiftMs
      : Math.max(0, Math.min(shiftMs, input.programUntil - input.departAt))

  let sinceBreak = 0
  let drivingMs = 0
  let breakMs = 0
  let dailyRestMs = 0
  let weeklyRestMs = 0
  let nights = 0
  let weeklyRestTaken = false

  // End the shift: the weekly rest when the week has run out (once), the daily
  // rest otherwise. Checked at the shift boundary rather than mid-drive because
  // a driver finishes his shift and then starts the weekly rest; the regulation
  // does not stop a truck in the middle of one.
  const endShift = () => {
    if (input.weeklyWorkUntil !== null && !weeklyRestTaken && now >= input.weeklyWorkUntil) {
      now += weeklyRestMsEach
      weeklyRestMs += weeklyRestMsEach
      weeklyRestTaken = true
    } else {
      now += dailyRestMsEach
      dailyRestMs += dailyRestMsEach
      nights += 1
    }
    shiftLeft = shiftMs
    sinceBreak = 0
  }

  let guard = 0
  while (remaining > 0) {
    if (++guard > 10_000) break

    if (shiftLeft <= 0) {
      endShift()
      continue
    }

    const untilBreak = crew === 1 ? breakEvery - sinceBreak : Infinity
    const chunk = Math.min(remaining, shiftLeft, untilBreak)
    now += chunk
    drivingMs += chunk
    remaining -= chunk
    shiftLeft -= chunk
    sinceBreak += chunk

    if (remaining <= 0) break

    // Shift first: a break due at the exact moment the shift ends is absorbed by
    // the daily rest that follows, not taken on top of it.
    if (shiftLeft <= 0) {
      endShift()
    } else if (sinceBreak >= breakEvery) {
      now += breakMsEach
      breakMs += breakMsEach
      sinceBreak = 0
    }
  }

  return {
    arrival: now,
    totalMs: now - input.departAt,
    drivingMs,
    breakMs,
    dailyRestMs,
    weeklyRestMs,
    nights,
    weeklyRestTaken,
  }
}
