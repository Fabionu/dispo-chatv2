import { Suspense, lazy, useState } from 'react'
import { ArrowLeft, MapPin, Plus, Route as RouteIcon, X } from 'lucide-react'
import Spinner from '../Spinner'

// MapLibre is heavy, so the map is pulled in lazily when this workspace opens.
// center=null renders a neutral, themed world view — this same component is the
// future home for the real calculated-route geometry.
const MapView = lazy(() => import('../map/MapView'))

type Props = {
  // Return to the Inbox tool grid.
  onBack: () => void
}

// Dedicated "Check route" workspace: a large map as the primary surface with a
// compact route panel beside it (left on desktop, stacked above on narrow
// screens). UI ONLY for now — no distance/duration is calculated, so the result
// fields stay neutral em-dashes until the backend route calculator is wired up.
export default function CheckRouteWorkspace({ onBack }: Props) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [stops, setStops] = useState<string[]>([])

  const canCheck = from.trim().length > 0 && to.trim().length > 0

  function setStop(i: number, v: string) {
    setStops((s) => s.map((x, idx) => (idx === i ? v : x)))
  }
  function removeStop(i: number) {
    setStops((s) => s.filter((_, idx) => idx !== i))
  }

  return (
    <>
      {/* Header — title + back to the workspace tools. */}
      <header className="h-[var(--header-height)] flex items-center gap-1.5 px-3 border border-white/[0.08] rounded-[11px] bg-rail shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to workspace tools"
          title="Back to tools"
          className="h-9 w-9 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <RouteIcon size={16} strokeWidth={1.8} className="text-active shrink-0" />
          <div className="text-[15px] font-semibold truncate leading-tight">Check route</div>
        </div>
      </header>

      {/* Body — route panel + map. Stacks on narrow screens; side-by-side (panel
          left, map filling the rest) from lg up. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Route panel */}
        <div className="lg:w-[340px] shrink-0 lg:h-full overflow-y-auto border-b lg:border-b-0 lg:border-r border-white/[0.06] p-4 flex flex-col gap-2.5">
          <Field label="From" value={from} onChange={setFrom} placeholder="Start address or city" />

          {stops.map((s, i) => (
            <Field
              key={i}
              label={`Stop ${i + 1}`}
              value={s}
              onChange={(v) => setStop(i, v)}
              placeholder="Intermediate stop"
              onRemove={() => removeStop(i)}
            />
          ))}

          <Field label="To" value={to} onChange={setTo} placeholder="Destination address or city" />

          <button
            onClick={() => setStops((s) => [...s, ''])}
            className="self-start flex items-center gap-1 text-[11.5px] text-muted hover:text-text transition-colors"
          >
            <Plus size={12} strokeWidth={1.8} />
            Add stop
          </button>

          {/* Calculation is wired up in a later task — the button stays present
              and styled, but performs no calculation yet (no fake values). */}
          <button
            type="button"
            disabled={!canCheck}
            className="mt-0.5 bg-text text-bg font-semibold text-[12px] rounded-btn px-3 py-1.5 transition-colors enabled:hover:bg-text/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Check route
          </button>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Stat label="Distance" value="—" />
            <Stat label="Duration" value="—" />
          </div>
        </div>

        {/* Map — the primary surface, filling the remaining space. */}
        <Suspense
          fallback={
            <div className="flex-1 min-h-[280px] flex items-center justify-center bg-rail">
              <Spinner variant="lg" />
            </div>
          }
        >
          <MapView className="flex-1 min-h-[280px]" center={null} />
        </Suspense>
      </div>
    </>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  onRemove,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  // When set, a small remove control appears (used for optional stops).
  onRemove?: () => void
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted mb-1">{label}</span>
      <span className="flex items-center gap-2 px-2.5 h-9 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors">
        <MapPin size={13} strokeWidth={1.6} className="text-faint shrink-0" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="bg-transparent flex-1 outline-none text-[12.5px] placeholder:text-faint min-w-0"
        />
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="text-faint hover:text-text shrink-0 transition-colors"
          >
            <X size={12} strokeWidth={1.8} />
          </button>
        )}
      </span>
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
