import { ArrowRight, ChevronRight } from 'lucide-react'
import CountryFlag from '../CountryFlag'
import { TONE_TEXT } from './opsControls'
import type { ChipTone, TripPlace, TripProgress, TripSummary } from '../../lib/vehicleOps'

// Slim operational strip under a vehicle-room header. Equal outer Grid tracks
// keep the complete route geometrically centered even when the status or order
// text on either side has a different width.
export default function TripBar({ trip, onOpen }: { trip: TripSummary; onOpen: () => void }) {
  // Prefer the complete dispatcher-entered sequence. The fallback keeps older
  // summary objects safe during hot reloads while still showing their endpoints.
  const routePlaces = trip.routePlaces?.length
    ? trip.routePlaces
    : [...trip.loadingPlaces, ...trip.unloadingPlaces]
  const orderClient = [trip.reference && `#${trip.reference}`, trip.client]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={onOpen}
      title="View trip details"
      style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2.4fr) minmax(0, 1fr)' }}
      className="group/tripbar shrink-0 mx-3 mb-1.5 h-11 px-3.5 grid items-center gap-3 text-left rounded-card bg-white/[0.03] hover:bg-white/[0.05] active:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {/* Status + completion stay in the left track. */}
      <span className="flex items-center gap-2.5 min-w-0 justify-self-start">
        {trip.progress && <ProgressRing progress={trip.progress} tone={trip.statusTone} />}
        <span
          className={`truncate text-[0.78125rem] font-medium ${TONE_TEXT[trip.statusTone]}`}
        >
          {trip.statusLabel}
        </span>
      </span>

      {/* Loading, intermediate, and unloading stops remain one centered route. */}
      <span className="min-w-0 w-full flex items-center justify-center text-[0.78125rem]">
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
          <span className="hidden lg:block max-w-[14rem] truncate text-[0.75rem] text-muted">
            {orderClient}
          </span>
        )}
        <ChevronRight
          size="1rem"
          strokeWidth={1.8}
          className="shrink-0 text-faint transition-colors group-hover/tripbar:text-muted"
        />
      </span>
    </button>
  )
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
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <span className="absolute text-[0.5625rem] font-semibold tabular-nums text-text">
        {label}
      </span>
    </span>
  )
}
