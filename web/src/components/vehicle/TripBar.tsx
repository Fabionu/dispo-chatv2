import { ArrowRight, ChevronRight } from 'lucide-react'
import CountryFlag from '../CountryFlag'
import { TONE_TEXT } from './opsControls'
import type { ChipTone, TripPlace, TripProgress, TripStop, TripSummary } from '../../lib/vehicleOps'

// Operational strip under a vehicle-room header — a continuation of the header
// rather than a card floating under it, so it shares the header's full-bleed
// width and is closed by its own bottom hairline.
//
// TWO ROWS since 2026-09-06. The first is unchanged: status, the route read as
// one line, the order. The second is the itinerary drawn as a track — a dot per
// stop, with what each stop IS and when it is due written above it.
//
// The route line above already names the places, so the track deliberately does
// NOT repeat them. What it adds is the thing a line of arrows cannot say: how
// many stops there actually are, which of them are behind the truck, and what is
// due when. A dispatcher reading "FR Tremery → SK Zavar" cannot tell whether
// that is two stops or six with four collapsed out of sight.

// The strip's horizontal gutter, as one value. It is `px-5` on the caption row
// and arithmetic on the track below it, and the two MUST agree or a dot stops
// sitting under its own caption — so neither of them gets to write `1.25rem` on
// its own.
const GUTTER = '1.25rem'

export default function TripBar({ trip, onOpen }: { trip: TripSummary; onOpen: () => void }) {
  // Prefer the complete dispatcher-entered sequence. The fallback keeps older
  // summary objects safe during hot reloads while still showing their endpoints.
  const routePlaces = trip.routePlaces?.length
    ? trip.routePlaces
    : [...trip.loadingPlaces, ...trip.unloadingPlaces]
  const orderClient = [trip.reference && `#${trip.reference}`, trip.client]
    .filter(Boolean)
    .join(' · ')
  const stops = trip.stops ?? []

  return (
    <button
      type="button"
      onClick={onOpen}
      title="View trip details"
      // `border-b` ONLY when there is no track. With stops, the track's own line
      // IS the bottom border — drawing both would put two rules a few pixels
      // apart, which is the thing this rework removed.
      className={`group/tripbar shrink-0 w-full flex flex-col text-left hover:bg-white/4 active:bg-white/6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        stops.length > 0 ? '' : 'border-b'
      }`}
    >
      {/* Row one. Equal outer Grid tracks keep the complete route geometrically
          centred even when the status or order text on either side has a
          different width. */}
      <span
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2.4fr) minmax(0, 1fr)' }}
        className="w-full h-10 px-5 grid items-center gap-3"
      >
        {/* Status + completion stay in the left track. */}
        <span className="flex items-center gap-2.5 min-w-0 justify-self-start">
          {trip.progress && <ProgressRing progress={trip.progress} tone={trip.statusTone} />}
          <span className={`eyebrow truncate ${TONE_TEXT[trip.statusTone]}`}>
            {trip.statusLabel}
          </span>
        </span>

        {/* Loading, intermediate, and unloading stops remain one centered route. */}
        <span className="min-w-0 w-full flex items-center justify-center text-base">
          {routePlaces.length > 0 && (
            <span className="inline-flex max-w-full min-w-0 items-center justify-center gap-2 overflow-hidden">
              {routePlaces.map((place, index) => (
                <span key={`${place.code ?? ''}-${place.text}-${index}`} className="contents">
                  {index > 0 && (
                    <ArrowRight
                      size="0.875rem"
                      strokeWidth={2}
                      className="shrink-0 text-faint"
                    />
                  )}
                  <Place place={place} />
                </span>
              ))}
            </span>
          )}
        </span>

        {/* Order / client + open affordance stay in the right track. */}
        <span className="flex items-center gap-2 min-w-0 justify-self-end text-faint">
          {orderClient && (
            <span className="eyebrow hidden lg:block max-w-[14rem] truncate">
              {orderClient}
            </span>
          )}
          <ChevronRight
            size="1rem"
            strokeWidth={1.8}
            className="shrink-0 text-faint transition-colors group-hover/tripbar:text-muted"
          />
        </span>
      </span>

      {stops.length > 0 && (
        <StopTrack stops={stops} progress={trip.progress} tone={trip.statusTone} />
      )}
    </button>
  )
}

// ── The itinerary track ─────────────────────────────────────────────────────
// A dot per stop on one rail, labelled above.
//
// The end dots sit FLUSH with the strip's padding rather than half a column in,
// because this is a progress bar and a progress bar that starts a quarter of the
// way across does not read as one. That is also why the geometry is hand-placed
// instead of gridded: equal columns put their dots at (i + 0.5) / n, which can
// never reach either edge. Here each dot is at i / (n - 1), so the first is at 0
// and the last at 100%.
//
// The captions are pinned to the same fractions and then pulled back by that
// same fraction of their own width, which left-aligns the first, right-aligns
// the last, and centres everything between — the only way the end captions stay
// inside the strip once their dots are at the edges.
function StopTrack({
  stops,
  progress,
  tone,
}: {
  stops: TripStop[]
  progress: TripProgress | null
  tone: ChipTone
}) {
  const n = stops.length
  const pct = Math.max(0, Math.min(1, progress?.pct ?? 0))
  // The FIRST stop still planned: where the truck is heading, and the only dot
  // that gets to look different from both the done ones behind it and the ones
  // beyond it.
  const nextIndex = stops.findIndex((s) => s.status === 'planned')
  // A single stop has no span to sit in, so it goes in the middle rather than
  // hard against the left edge with nothing to the right of it.
  const at = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)

  // The dots live in the FULL-BLEED strip so the line under them can run the
  // whole width as a border, but they are inset by the strip's own gutter so
  // they sit under the captions. One expression, used by both.
  const dotX = (i: number) => `calc(${GUTTER} + (100% - ${GUTTER} * 2) * ${at(i) / 100})`

  return (
    // `TONE_TEXT` on the wrapper, then `bg-current` below: the filled rail and
    // the completed dots are the SAME colour as the status word at the far left
    // without either of them naming it, so a status tone can never be changed in
    // one place and forgotten in the other.
    <span className={`block w-full ${TONE_TEXT[tone]}`}>
      <span className="relative block px-5 pb-1">
        {/* An invisible caption left IN FLOW to give the absolutely positioned
            real ones a height. Every caption is the same three lines tall, so
            any of them will do — and taking the height from a rendered one
            means it tracks the fluid type scale instead of being a hardcoded
            pixel figure that drifts at the next resolution. */}
        <span className="invisible block" aria-hidden>
          <StopLabelBody stop={stops[0]} next={false} />
        </span>
        {stops.map((stop, index) => (
          <span
            key={stop.id}
            className="absolute top-0"
            style={{
              left: `calc(${GUTTER} + (100% - ${GUTTER} * 2) * ${at(index) / 100})`,
              transform: `translateX(-${at(index)}%)`,
              // Enough room to matter, never enough to reach the next caption.
              maxWidth: `calc(${100 / n}% - 0.5rem)`,
              textAlign: n === 1 ? 'center' : index === 0 ? 'left' : index === n - 1 ? 'right' : 'center',
            }}
          >
            <StopLabelBody stop={stop} next={index === nextIndex} />
          </span>
        ))}
      </span>

      {/* THE BOTTOM BORDER IS THE PROGRESS BAR (user, 2026-09-06). The banner
          used to carry a `border-b` AND, above it, a separate inset rail with
          its own padding — two horizontal lines a few pixels apart, one of them
          purely structural. They are one line now: it runs the full bleed like
          the border it replaces, the driven part of it is tone-coloured, and the
          stop dots sit on it.

          The strip is as tall as the largest dot so the dots stay INSIDE the
          banner. Centring them on a line at the literal bottom edge would push
          half of each one over the message list, which scrolls underneath. */}
      <span className="relative block h-2.5">
        <span aria-hidden className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-line" />
        {n > 1 && pct > 0 && (
          <span
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 h-px bg-current"
            style={{
              left: GUTTER,
              // Dot to dot, not edge to edge: the gutter at each end is the
              // border sealing the banner, not part of the journey.
              width: `calc((100% - ${GUTTER} * 2) * ${pct})`,
            }}
          />
        )}
        {stops.map((stop, index) => (
          <span
            key={stop.id}
            className="absolute top-1/2 flex"
            // Both offsets in ONE transform: a Tailwind `-translate-y-1/2` here
            // would be overwritten by this style attribute, and centring the dot
            // by a hardcoded negative margin only works while every dot is the
            // same width — which they are not, the next-stop ring is larger.
            style={{ left: dotX(index), transform: 'translate(-50%, -50%)' }}
          >
            <StopDot done={stop.status === 'done'} next={index === nextIndex} />
          </span>
        ))}
      </span>
    </span>
  )
}

// One stop's caption. Every line truncates: six stops on a narrow thread give
// each caption well under 200px, and a wrapped caption would push the rail down
// and make the whole strip change height as stops are added.
function StopLabelBody({ stop, next }: { stop: TripStop; next: boolean }) {
  const place = stop.place.text || stop.place.code || ''
  return (
    <span className="block leading-[1.2]">
      <span
        title={place ? `${stop.typeLabel} · ${place}` : stop.typeLabel}
        className={`block truncate text-xs font-medium ${
          // The stop being driven towards is the one worth reading first.
          // Everything else — done or still ahead — is reference.
          next ? 'text-text' : 'text-muted'
        }`}
      >
        {stop.typeLabel}
      </span>
      <span className="block truncate text-2xs text-faint tabular-nums">
        {stop.plannedAt || '—'}
      </span>
      {/* THE ETA SLOT, deliberately held open (user, 2026-09-06: "a bit of space
          for the ETA which we will include later"). Only the final stop carries
          a value today — the trip's manually typed ETA — so this line is empty
          under most dots. It still occupies its height, so wiring per-stop
          arrival times in later fills a gap that is already laid out rather than
          growing the strip and shifting the whole thread under it. */}
      <span className="block truncate text-2xs tabular-nums text-muted min-h-[1.1em]">
        {stop.eta ? `ETA ${stop.eta}` : ''}
      </span>
    </span>
  )
}

// Three states, and they are read by FILL rather than by colour alone: done is
// solid, the next stop is a ring (an outline is an obvious "not yet"), and the
// ones beyond it are a plain faint disc. The rail passes behind them all, which
// is why the ring carries `bg-bg` — it has to punch the line out to read as
// hollow rather than as a dot with a line through it.
function StopDot({ done, next }: { done: boolean; next: boolean }) {
  if (done) {
    return <span className="w-2 h-2 rounded-full bg-current" />
  }
  if (next) {
    return <span className="w-2.5 h-2.5 rounded-full border-2 border-current bg-bg" />
  }
  return <span className="w-2 h-2 rounded-full bg-line-2" />
}

// One route place: country flag + compact postal/city text. Every place may
// shrink and truncate, allowing multiple stops to remain visible in the center.
function Place({ place }: { place: TripPlace }) {
  const label = place.text || place.code || '—'
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-[11rem] shrink">
      <CountryFlag code={place.code} />
      <span className="truncate text-muted" title={label}>
        {label}
      </span>
    </span>
  )
}

// A small completion donut: a faint full track with a tone-coloured arc for the
// done fraction and percentage in the centre.
function ProgressRing({ progress, tone }: { progress: TripProgress; tone: ChipTone }) {
  const pct = Math.max(0, Math.min(1, progress.pct))
  const R = 12.5
  const C = 2 * Math.PI * R
  const label = Math.round(pct * 100)
  const title =
    progress.total > 0
      ? `${progress.done}/${progress.total} stops done · ${label}%`
      : `${label}% complete`
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 w-7 h-7 ${TONE_TEXT[tone]}`}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 28 28" className="w-7 h-7 -rotate-90">
        <circle
          cx="14"
          cy="14"
          r={R}
          fill="none"
          stroke="rgb(var(--color-wash) / 0.12)"
          strokeWidth="3"
        />
        <circle
          cx="14"
          cy="14"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={C}
          strokeLinecap="round"
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <span className="absolute text-2xs font-semibold tabular-nums text-text">
        {label}
      </span>
    </span>
  )
}
