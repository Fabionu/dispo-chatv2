import { ArrowRight, ChevronRight } from 'lucide-react'
import CountryFlag from '../CountryFlag'
import { TONE_TEXT } from './opsControls'
import type { ChipTone, TripPlace, TripProgress, TripSummary } from '../../lib/vehicleOps'

// The active-trip strip under a vehicle room's header — a slim, glanceable
// "where is this load" bar. Left: a completion ring + the status. Middle: the
// route as origin → destination (with a "+N" when there are stops in between).
// Right: the order / client, when set. The whole bar opens the Trip tab.
//
// Only rendered for vehicle rooms with an active trip (the caller gates on
// `trip`), so there's always something to show; empty pieces simply drop out and
// the bar collapses to what's known.
export default function TripBar({ trip, onOpen }: { trip: TripSummary; onOpen: () => void }) {
  const origin = trip.loadingPlaces[0]
  const dest = trip.unloadingPlaces[trip.unloadingPlaces.length - 1]
  // Stops sitting between the shown origin and destination (extra loadings,
  // customs, fuel, etc.). Only meaningful when both endpoints are shown.
  const between = origin && dest ? Math.max(0, trip.stopCount - 2) : 0
  const orderClient = [trip.reference && `#${trip.reference}`, trip.client]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={onOpen}
      title="View trip details"
      className="group/tripbar w-full shrink-0 h-11 px-4 flex items-center gap-3 text-left bg-white/[0.02] border-b border-white/[0.06] hover:bg-white/[0.035] transition-colors"
    >
      {/* Status + completion. */}
      <span className="flex items-center gap-2.5 shrink-0">
        {trip.progress && <ProgressRing progress={trip.progress} tone={trip.statusTone} />}
        <span className={`text-[0.78125rem] font-medium whitespace-nowrap ${TONE_TEXT[trip.statusTone]}`}>
          {trip.statusLabel}
        </span>
      </span>

      {/* Route — origin → (+N) → destination. */}
      {(origin || dest) && (
        <>
          <Divider />
          <span className="flex items-center gap-2 min-w-0 flex-1 text-[0.78125rem]">
            {origin && <Place place={origin} />}
            {origin && dest && (
              <span className="flex items-center gap-1.5 shrink-0 text-faint">
                <ArrowRight size="0.875rem" strokeWidth={2} />
                {between > 0 && (
                  <>
                    <span
                      title={`${between} stop${between === 1 ? '' : 's'} in between`}
                      className="rounded-full bg-white/[0.06] text-faint text-[0.625rem] font-medium leading-none px-1.5 py-0.5"
                    >
                      +{between}
                    </span>
                    <ArrowRight size="0.875rem" strokeWidth={2} />
                  </>
                )}
              </span>
            )}
            {dest && <Place place={dest} />}
          </span>
        </>
      )}

      {/* Order / client + open affordance. */}
      <span className="flex items-center gap-2 shrink-0 ml-auto pl-1 text-faint">
        {orderClient && (
          <span className="hidden lg:block max-w-[14rem] truncate text-[0.75rem] text-muted">
            {orderClient}
          </span>
        )}
        <ChevronRight
          size="1rem"
          strokeWidth={1.8}
          className="text-faint transition-colors group-hover/tripbar:text-muted"
        />
      </span>
    </button>
  )
}

// One place in the route — country flag + the "NL 9001 Grou" text. Truncates as a
// flex item; the two places share the middle space.
function Place({ place }: { place: TripPlace }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
      <CountryFlag code={place.code} />
      <span className="truncate text-muted">{place.text || place.code || '—'}</span>
    </span>
  )
}

function Divider() {
  return <span className="shrink-0 h-4 w-px bg-white/[0.1]" />
}

// A small completion donut: a faint full track with a tone-coloured arc for the
// done fraction and the percentage in the centre. Tone comes from the trip status
// (via TONE_TEXT → currentColor), so the ring matches the status label's colour.
function ProgressRing({ progress, tone }: { progress: TripProgress; tone: ChipTone }) {
  const pct = Math.max(0, Math.min(1, progress.pct))
  // viewBox units; width/height in rem so the ring tracks the global UI scale.
  const R = 12.5
  const C = 2 * Math.PI * R
  const label = Math.round(pct * 100)
  const title =
    progress.total > 0 ? `${progress.done}/${progress.total} stops done · ${label}%` : `${label}% complete`
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 w-7 h-7 ${TONE_TEXT[tone]}`}
      title={title}
      aria-label={title}
    >
      <svg viewBox="0 0 28 28" className="w-7 h-7 -rotate-90">
        <circle cx="14" cy="14" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle
          cx="14"
          cy="14"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <span className="absolute text-[0.5625rem] font-semibold tabular-nums text-text">{label}</span>
    </span>
  )
}
