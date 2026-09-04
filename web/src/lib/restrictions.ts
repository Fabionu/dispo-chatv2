// Driving-restriction calculator: given a truck route broken into country legs,
// a working plan and the ban windows a dispatcher enters by hand, work out when
// the truck actually arrives.
//
// PURE — no React, no HERE, no network, no Date.now(). Every input is explicit
// and every output is an absolute epoch instant, which is what makes it worth
// testing on its own (restrictions.test.ts) and reusable from the planner, a
// trip, or a future server-side job without being rewritten.
//
// ── The two clocks ──────────────────────────────────────────────────────────
// Everything here is computed on absolute instants and only rendered in local
// time, because the two local times involved are DIFFERENT ones:
//
//   * A BAN WINDOW is local to the country that imposes it. An Austrian Sunday
//     ban runs 00:00–22:00 Vienna time no matter where the truck set off from.
//   * The WORKING DAY is local to the operation, not to whatever country the
//     truck happens to be crossing at the time. A driver who starts at 08:00
//     Bucharest time does not gain an hour of shift by entering Hungary.
//
// Conflating them is a silent one-hour error that appears exactly at borders —
// the hardest kind to notice, because every number still looks plausible. So
// bans carry the country's zone, the shift carries `shiftZone`, and the two
// never touch except through the instants they produce.

// One continuous stretch of the route inside a single country, in route order,
// as returned by /api/here/route. `code` is ISO 3166-1 ALPHA-3 (HERE's format).
export type CountryLeg = {
  code: string
  /** Driving time through this country, in seconds. */
  duration: number
  /** Distance through this country, in metres. Display only. */
  length?: number
}

// A window in which driving is forbidden, as the dispatcher entered it: a date
// and a clock range in the BANNING COUNTRY's local time.
export type BanWindow = {
  id: string
  /** Alpha-3, matching the route legs. */
  countryCode: string
  /** 'YYYY-MM-DD', local to the banning country. */
  date: string
  /** 'HH:mm', local. */
  from: string
  /** 'HH:mm', local. Less than or equal to `from` means the window runs past
   *  midnight into the following day (a 22:00–06:00 night ban). */
  to: string
}

// What the dispatcher actually enters, one entry per country per restriction:
// a RANGE of dates and the intervals that apply on each of them.
//
// Both plurals are load-bearing and neither is a convenience wrapper. A ban
// commonly runs several days together (a holiday weekend), and a country
// commonly splits ONE day into two windows — 07:00–16:00 and then 19:00–00:00
// — which no single from/to pair can express. Modelling it as a rule that
// EXPANDS into windows keeps the simulation working on flat intervals while the
// form stays the shape of the thing being described.
export type BanInterval = { id: string; from: string; to: string }

export type BanRule = {
  id: string
  countryCode: string
  /** 'YYYY-MM-DD', local to the banning country. */
  dateFrom: string
  /** 'YYYY-MM-DD'. Equal to `dateFrom` for a single day. */
  dateTo: string
  intervals: BanInterval[]
}

// How long the truck can drive in one shift after the entered program runs out.
//
// EU 561/2006, and the reason the crew size is an input at all: a single driver
// is capped at 9h of driving a day (10h twice a week), so the VEHICLE stops when
// he does. A two-driver crew is not — each driver keeps his own 9h, but they
// alternate, and the crew only owes 9 consecutive hours of rest inside each 30h
// window. The truck therefore keeps moving for roughly two shifts a day.
//
// The conservative figure of each pair is used: 9 and 18, not the 10 and 20 the
// extensions allow. The extension is limited to twice a week and this calculator
// does not track a week, so planning on it would quietly promise an arrival only
// a perfect fortnight could deliver.
export const SHIFT_HOURS: Record<1 | 2, number> = { 1: 9, 2: 18 }

export type CalcInput = {
  /** Departure instant (epoch ms). */
  departAt: number
  /**
   * The instant the crew's CURRENT program runs out — an absolute moment, not a
   * clock time that repeats daily.
   *
   * It has to be absolute because neither regime it describes is daily. A driver
   * who starts a run with four hours left on his card has a program that ends
   * this afternoon and never recurs; a two-driver crew runs past midnight, which
   * a time-of-day field cannot express at all. `null` means no stated limit.
   *
   * It does NOT stop the driving in the timeline below — see calculateArrival.
   * It is what the rest requirement is measured against.
   */
  programUntil: number | null
  /** 1 or 2 up front; picks the shift length from SHIFT_HOURS. */
  driverCount: 1 | 2
  /**
   * Rest blocks the dispatcher entered by hand, in hours, summed onto the
   * arrival.
   *
   * They are deliberately NOT placed at a moment. Where a truck can actually
   * stop for 9h — never mind 45 — depends on parking, the shipper's window and
   * where the driver happens to be when his hours run out, none of which this
   * tool knows. Inventing a stop time would dress a guess up as a schedule. The
   * hours are real and the dispatcher knows them; only their position is
   * unknowable, so only their position is left out.
   */
  breakHours: number[]
  /** IANA zone the operation's clock runs in (typically the departure country). */
  shiftZone: string
  /**
   * Average speed in km/h. When set, driving time is recomputed from each
   * leg's DISTANCE instead of trusting HERE's own duration.
   *
   * Worth having as an input rather than a correction factor: HERE's duration
   * comes from its speed model for the road classes involved, which is a
   * statement about the road, not about this truck on this run. A dispatcher
   * knows their own average — it already contains fuel stops, border queues,
   * the driver's habits and a governed top speed — and over a 1500km route the
   * gap between 78 km/h modelled and 68 km/h real is several hours, which is
   * more than enough to move the arrival across a ban window and make the whole
   * calculation wrong. `null` keeps HERE's durations.
   */
  averageSpeedKmh: number | null
  legs: CountryLeg[]
  bans: BanWindow[]
}

export type SegmentKind = 'drive' | 'ban' | 'break'

export type Segment = {
  kind: SegmentKind
  /** Which country the truck is in for this segment. */
  countryCode: string
  start: number
  end: number
  /** 'ban' only: which window held the truck. */
  banId?: string
}

export type CalcResult = {
  segments: Segment[]
  /** Arrival instant (epoch ms), rest blocks included. */
  arrival: number
  drivingMs: number
  /** The entered rest blocks, summed. */
  breakMs: number
  banMs: number
  /**
   * Driving that falls past `programUntil` — the part of the run the crew
   * cannot do on the hours they have now.
   */
  overrunMs: number
  /**
   * How many further shifts that overrun takes, at this crew's shift length.
   * The number of rest blocks the trip needs, which is the one thing the
   * calculator CAN say about rests without inventing where they happen.
   */
  shiftsNeeded: number
  /** Hours per shift for this crew size, from SHIFT_HOURS. */
  shiftHours: number
  /** Countries on the route with no known time zone — their bans were
   *  evaluated in `shiftZone` instead, which the UI must say out loud. */
  unknownZones: string[]
}

const HOUR_MS = 3_600_000

// ── Country reference ────────────────────────────────────────────────────────
// Alpha-3 (what HERE returns) → alpha-2 (what Intl.DisplayNames wants, and what
// trip stops carry elsewhere in the app) + the IANA zone its clocks run on.
//
// One zone per country is correct for every country a European truck drives
// through: the multi-zone states (Russia past the Urals, France's overseas
// territories, Portugal's Atlantic islands) are not reachable by road from
// mainland Europe, so the mainland zone is the only one that can apply here.
const COUNTRIES: Record<string, { alpha2: string; zone: string }> = {
  ALB: { alpha2: 'AL', zone: 'Europe/Tirane' },
  AND: { alpha2: 'AD', zone: 'Europe/Andorra' },
  AUT: { alpha2: 'AT', zone: 'Europe/Vienna' },
  BEL: { alpha2: 'BE', zone: 'Europe/Brussels' },
  BGR: { alpha2: 'BG', zone: 'Europe/Sofia' },
  BIH: { alpha2: 'BA', zone: 'Europe/Sarajevo' },
  BLR: { alpha2: 'BY', zone: 'Europe/Minsk' },
  CHE: { alpha2: 'CH', zone: 'Europe/Zurich' },
  CZE: { alpha2: 'CZ', zone: 'Europe/Prague' },
  DEU: { alpha2: 'DE', zone: 'Europe/Berlin' },
  DNK: { alpha2: 'DK', zone: 'Europe/Copenhagen' },
  ESP: { alpha2: 'ES', zone: 'Europe/Madrid' },
  EST: { alpha2: 'EE', zone: 'Europe/Tallinn' },
  FIN: { alpha2: 'FI', zone: 'Europe/Helsinki' },
  FRA: { alpha2: 'FR', zone: 'Europe/Paris' },
  GBR: { alpha2: 'GB', zone: 'Europe/London' },
  GRC: { alpha2: 'GR', zone: 'Europe/Athens' },
  HRV: { alpha2: 'HR', zone: 'Europe/Zagreb' },
  HUN: { alpha2: 'HU', zone: 'Europe/Budapest' },
  IRL: { alpha2: 'IE', zone: 'Europe/Dublin' },
  ITA: { alpha2: 'IT', zone: 'Europe/Rome' },
  LTU: { alpha2: 'LT', zone: 'Europe/Vilnius' },
  LUX: { alpha2: 'LU', zone: 'Europe/Luxembourg' },
  LVA: { alpha2: 'LV', zone: 'Europe/Riga' },
  MDA: { alpha2: 'MD', zone: 'Europe/Chisinau' },
  MKD: { alpha2: 'MK', zone: 'Europe/Skopje' },
  MNE: { alpha2: 'ME', zone: 'Europe/Podgorica' },
  NLD: { alpha2: 'NL', zone: 'Europe/Amsterdam' },
  NOR: { alpha2: 'NO', zone: 'Europe/Oslo' },
  POL: { alpha2: 'PL', zone: 'Europe/Warsaw' },
  PRT: { alpha2: 'PT', zone: 'Europe/Lisbon' },
  ROU: { alpha2: 'RO', zone: 'Europe/Bucharest' },
  RUS: { alpha2: 'RU', zone: 'Europe/Moscow' },
  SRB: { alpha2: 'RS', zone: 'Europe/Belgrade' },
  SVK: { alpha2: 'SK', zone: 'Europe/Bratislava' },
  SVN: { alpha2: 'SI', zone: 'Europe/Ljubljana' },
  SWE: { alpha2: 'SE', zone: 'Europe/Stockholm' },
  TUR: { alpha2: 'TR', zone: 'Europe/Istanbul' },
  UKR: { alpha2: 'UA', zone: 'Europe/Kyiv' },
  XKX: { alpha2: 'XK', zone: 'Europe/Belgrade' },
}

export function countryZone(alpha3: string): string | null {
  return COUNTRIES[alpha3]?.zone ?? null
}

export function countryAlpha2(alpha3: string): string | null {
  return COUNTRIES[alpha3]?.alpha2 ?? null
}

// Localised country name, falling back to the raw code for anything the
// runtime's ICU data doesn't carry.
//
// BOTH caches matter. `new Intl.DisplayNames` is one of the most expensive
// constructors in the platform — it loads ICU display data — and this function
// is called once per country row AND once per timeline row, so an uncached
// version rebuilt it twenty-odd times on every keystroke in the form and made
// typing visibly stutter. The names themselves never change for a given
// locale + code, so the result cache means a re-render costs a Map lookup.
const displayNamesByLocale = new Map<string, Intl.DisplayNames | null>()
const nameCache = new Map<string, string>()

export function countryName(alpha3: string, locale: string): string {
  const key = `${locale}:${alpha3}`
  const cached = nameCache.get(key)
  if (cached !== undefined) return cached

  const alpha2 = countryAlpha2(alpha3)
  let name = alpha3
  if (alpha2) {
    if (!displayNamesByLocale.has(locale)) {
      try {
        displayNamesByLocale.set(locale, new Intl.DisplayNames([locale], { type: 'region' }))
      } catch {
        displayNamesByLocale.set(locale, null)
      }
    }
    try {
      name = displayNamesByLocale.get(locale)?.of(alpha2) ?? alpha3
    } catch {
      name = alpha3
    }
  }
  nameCache.set(key, name)
  return name
}

// ── Time-zone arithmetic ─────────────────────────────────────────────────────
// Intl is the only zone database in the browser, and it converts one way only
// (instant → local parts). Everything below is built from that one primitive.

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, f)
  }
  return f
}

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** The wall-clock reading in `zone` at instant `ms`. */
export function partsIn(zone: string, ms: number): ZonedParts {
  const parts = formatterFor(zone).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Zone offset in ms at a given instant (positive east of UTC). */
function offsetAt(zone: string, ms: number): number {
  const p = partsIn(zone, ms)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // Instants carry sub-second precision that the formatter drops; round the
  // instant the same way so the difference is the offset and nothing else.
  return asIfUtc - Math.floor(ms / 1000) * 1000
}

/**
 * A wall-clock time in `zone` → the absolute instant.
 *
 * Two passes, because the offset we need is the one in force AT the answer, and
 * we only have the wall clock to start from. Pass one guesses using the offset
 * at the naive instant; pass two re-reads the offset at that guess and corrects
 * it. That converges everywhere except inside a DST gap, where the wall time
 * does not exist at all — there the result lands just after the jump, which is
 * the same thing every calendar does with an invalid local time.
 */
export function zonedToUtc(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  let utc = naive - offsetAt(zone, naive)
  utc = naive - offsetAt(zone, utc)
  return utc
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

// ── Ban windows ──────────────────────────────────────────────────────────────

const MAX_BAN_DAYS = 62

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Flatten the dispatcher's rules into one window per day per interval.
 *
 * The calendar walk runs in UTC on purpose, even though every date it produces
 * is later read in a country's own zone: UTC is the only calendar with no DST,
 * so stepping a day is always exactly 86400000ms and "the 29th of March" can
 * never be skipped or repeated on the way to the 30th. Turning each resulting
 * date back into an instant is resolveBans' job, and that IS zone-aware.
 */
export function expandBanRules(rules: BanRule[]): BanWindow[] {
  const windows: BanWindow[] = []
  for (const rule of rules) {
    const start = parseDate(rule.dateFrom)
    if (!start) continue
    const end = parseDate(rule.dateTo) ?? start
    let cursor = Date.UTC(start.year, start.month - 1, start.day)
    const last = Date.UTC(end.year, end.month - 1, end.day)
    if (last < cursor) continue
    for (let day = 0; cursor <= last && day < MAX_BAN_DAYS; day += 1) {
      const d = new Date(cursor)
      const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
      for (const interval of rule.intervals) {
        windows.push({
          id: `${rule.id}:${date}:${interval.id}`,
          countryCode: rule.countryCode,
          date,
          from: interval.from,
          to: interval.to,
        })
      }
      cursor += 86_400_000
    }
  }
  return windows
}

type ResolvedBan = { id: string; countryCode: string; start: number; end: number }

/**
 * Turn the dispatcher's date + clock range into an absolute interval.
 *
 * `to <= from` wraps into the next day, which is how a night ban is naturally
 * written (22:00–06:00). Resolving each end independently through the country's
 * zone — rather than adding 24h to the start — is what keeps a window correct
 * across a DST change, where the night it spans is 23 or 25 hours long.
 */
export function resolveBans(bans: BanWindow[], fallbackZone: string): ResolvedBan[] {
  const resolved: ResolvedBan[] = []
  for (const ban of bans) {
    const date = parseDate(ban.date)
    const from = parseClock(ban.from)
    const to = parseClock(ban.to)
    if (!date || !from || !to) continue
    const zone = countryZone(ban.countryCode) ?? fallbackZone
    const start = zonedToUtc(zone, date.year, date.month, date.day, from.hour, from.minute)
    const endDay =
      to.hour * 60 + to.minute <= from.hour * 60 + from.minute
        ? new Date(Date.UTC(date.year, date.month - 1, date.day + 1))
        : new Date(Date.UTC(date.year, date.month - 1, date.day))
    const end = zonedToUtc(
      zone,
      endDay.getUTCFullYear(),
      endDay.getUTCMonth() + 1,
      endDay.getUTCDate(),
      to.hour,
      to.minute,
    )
    if (end > start) resolved.push({ id: ban.id, countryCode: ban.countryCode, start, end })
  }
  return resolved.sort((a, b) => a.start - b.start)
}

// The window holding the truck right now, if any. Overlapping windows in the
// same country are chained by the caller (it re-checks after each jump), so
// this only has to find one.
function banAt(bans: ResolvedBan[], country: string, at: number): ResolvedBan | null {
  for (const ban of bans) {
    if (ban.countryCode !== country) continue
    if (at >= ban.start && at < ban.end) return ban
  }
  return null
}

function nextBanStart(bans: ResolvedBan[], country: string, after: number): number | null {
  for (const ban of bans) {
    if (ban.countryCode !== country) continue
    if (ban.start > after) return ban.start
  }
  return null
}

// ── The simulation ───────────────────────────────────────────────────────────

/**
 * Driving seconds for one leg, at the dispatcher's average speed when they gave
 * one and HERE's own estimate otherwise.
 *
 * Falls back to HERE's duration for a leg with no distance too: a leg the
 * average cannot be applied to should keep a real number rather than silently
 * become zero and hand back an arrival that is hours early.
 */
export function legDurationSec(leg: CountryLeg, averageSpeedKmh: number | null): number {
  if (!averageSpeedKmh || averageSpeedKmh <= 0) return leg.duration
  if (!leg.length || leg.length <= 0) return leg.duration
  return (leg.length / 1000 / averageSpeedKmh) * 3600
}

/**
 * Walk the route leg by leg, advancing an absolute clock, and hold the truck
 * whenever a ban window is in force.
 *
 * DRIVING IS CONTINUOUS HERE, and that is a deliberate limitation rather than a
 * missing feature. The calculator does not place rest blocks on the timeline
 * because it cannot know where a truck will be able to stop for nine hours; the
 * hours are added to the arrival instead (see CalcInput.breakHours). The cost is
 * stated plainly so nobody has to discover it: a ban that falls AFTER the first
 * rest is evaluated at an hour the truck would not really be driving. Bans on
 * the first leg — the ones a dispatcher is usually checking — are exact.
 *
 * The loop stays "resolve one blocker, then look again" rather than a schedule
 * computed up front: two ban windows can abut, and one can end inside the next.
 */
export function calculateArrival(input: CalcInput): CalcResult {
  const segments: Segment[] = []
  const bans = resolveBans(input.bans, input.shiftZone)

  let now = input.departAt
  const unknownZones = new Set<string>()

  const push = (segment: Segment) => {
    const last = segments[segments.length - 1]
    // Merge onto the previous segment when they are the same kind, the same
    // country and the same cause — a ban split by a section boundary, or two
    // adjacent driving stretches, should read as one row.
    if (
      last &&
      last.kind === segment.kind &&
      last.countryCode === segment.countryCode &&
      last.end === segment.start &&
      last.banId === segment.banId
    ) {
      last.end = segment.end
      return
    }
    segments.push(segment)
  }

  for (const leg of input.legs) {
    if (!countryZone(leg.code)) unknownZones.add(leg.code)
    let remaining = Math.max(0, legDurationSec(leg, input.averageSpeedKmh)) * 1000

    let guard = 0
    while (remaining > 0) {
      if (++guard > 10_000) break

      // Held by a ban? Wait it out and re-decide — the window may be followed
      // immediately by another.
      const ban = banAt(bans, leg.code, now)
      if (ban) {
        push({ kind: 'ban', countryCode: leg.code, start: now, end: ban.end, banId: ban.id })
        now = ban.end
        continue
      }

      const banStart = nextBanStart(bans, leg.code, now) ?? Infinity
      const stopAt = Math.min(banStart, now + remaining)
      push({ kind: 'drive', countryCode: leg.code, start: now, end: stopAt })
      remaining -= stopAt - now
      now = stopAt
    }
  }

  // The rest blocks, as one trailing span. One block rather than several because
  // the calculator is not claiming they happen consecutively at the end — only
  // that these hours belong to the trip and the arrival has to carry them.
  const breakMs = input.breakHours.reduce((total, hours) => total + Math.max(0, hours), 0) * HOUR_MS
  const lastCountry = input.legs[input.legs.length - 1]?.code ?? ''
  if (breakMs > 0) {
    segments.push({ kind: 'break', countryCode: lastCountry, start: now, end: now + breakMs })
    now += breakMs
  }

  let drivingMs = 0
  let banMs = 0
  for (const segment of segments) {
    const span = segment.end - segment.start
    if (segment.kind === 'drive') drivingMs += span
    else if (segment.kind === 'ban') banMs += span
  }

  // What the crew cannot cover on the hours it has now, and how many shifts that
  // takes. Measured on DRIVING time rather than on elapsed time: being held at a
  // closed border does not consume a driver's card.
  const shiftHours = SHIFT_HOURS[input.driverCount]
  const programMs =
    input.programUntil === null ? Infinity : Math.max(0, input.programUntil - input.departAt)
  const overrunMs = Number.isFinite(programMs) ? Math.max(0, drivingMs - programMs) : 0
  const shiftsNeeded = overrunMs > 0 ? Math.ceil(overrunMs / (shiftHours * HOUR_MS)) : 0

  return {
    segments,
    arrival: now,
    drivingMs,
    breakMs,
    banMs,
    overrunMs,
    shiftsNeeded,
    shiftHours,
    unknownZones: [...unknownZones],
  }
}
