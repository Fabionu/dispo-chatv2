import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Moon, Plus, Route as RouteIcon, Sun, Truck } from 'lucide-react'
import Spinner from '../Spinner'
import type { LatLng } from '../map/MapView'
import type { MapColorScheme } from '../../lib/mapConfig'
import {
  calculateRoute,
  formatDistance,
  formatDuration,
  geocode,
  geoConfigured,
  type LngLat,
  type ResolvedPlace,
  type TruckRouteOptions,
} from '../../lib/geo'
import PlaceAutocompleteField from './PlaceAutocompleteField'

// MapLibre is heavy, so the map is pulled in lazily when this workspace opens.
const MapView = lazy(() => import('../map/MapView'))

type Props = {
  // Return to the Inbox tool grid.
  onBack: () => void
}

// One route field: the free text shown, plus the resolved place (with coords)
// once a suggestion is picked. `place` is null while the user is still typing.
type WaypointField = { text: string; place: ResolvedPlace | null }
const EMPTY_FIELD: WaypointField = { text: '', place: null }

type RouteState = {
  distance: string
  duration: string
  geometry: LngLat[]
  points: LatLng[]
  // Travel mode that produced this route, for truthful labelling.
  mode: 'Car' | 'Truck'
}

// Truck restrictions captured from the UI (strings). Converted to numbers and
// real Amazon Location Truck options at route time.
type TruckOptions = {
  height: string
  width: string
  length: string
  grossWeight: string
  axleWeight: string
  hazardous: boolean
}

const EMPTY_TRUCK: TruckOptions = {
  height: '',
  width: '',
  length: '',
  grossWeight: '',
  axleWeight: '',
  hazardous: false,
}

// Parse the UI truck strings into numeric route options (metres / tonnes). Only
// positive values pass through.
function truckToOptions(t: TruckOptions): TruckRouteOptions {
  const num = (s: string) => {
    const n = Number.parseFloat(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    heightM: num(t.height),
    widthM: num(t.width),
    lengthM: num(t.length),
    grossWeightT: num(t.grossWeight),
    axleWeightT: num(t.axleWeight),
    hazardous: t.hazardous,
  }
}

// Any usable truck restriction entered? Drives whether routing uses Truck mode.
function hasTruckParams(t: TruckOptions): boolean {
  const o = truckToOptions(t)
  return Boolean(o.heightM || o.widthM || o.lengthM || o.grossWeightT || o.axleWeightT)
}

// Dedicated "Check route" workspace: a full-bleed map as the primary surface with
// a floating, translucent route panel over its top-left (Google-Maps-like, in the
// Dispo-chat dark theme). Fields use Amazon Location Places autocomplete; picking
// From/To drops markers and auto-calculates the route (GeoRoutes), truck-aware
// when truck restrictions are entered.
export default function CheckRouteWorkspace({ onBack }: Props) {
  const [from, setFrom] = useState<WaypointField>(EMPTY_FIELD)
  const [to, setTo] = useState<WaypointField>(EMPTY_FIELD)
  const [stops, setStops] = useState<WaypointField[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RouteState | null>(null)
  // Map basemap appearance — local to this workspace; does NOT change the app
  // theme, only the map style.
  const [mapMode, setMapMode] = useState<MapColorScheme>('Dark')
  // Advanced truck-restriction options, collapsed by default.
  const [truckOpen, setTruckOpen] = useState(false)
  const [truck, setTruck] = useState<TruckOptions>(EMPTY_TRUCK)

  const canCheck = from.text.trim().length > 0 && to.text.trim().length > 0 && geoConfigured && !busy

  function setStopText(i: number, text: string) {
    setStops((s) => s.map((x, idx) => (idx === i ? { text, place: null } : x)))
  }
  function setStopPlace(i: number, place: ResolvedPlace) {
    setStops((s) => s.map((x, idx) => (idx === i ? { text: place.label, place } : x)))
  }
  function removeStop(i: number) {
    setStops((s) => s.filter((_, idx) => idx !== i))
  }
  function setTruckField<K extends keyof TruckOptions>(key: K, value: TruckOptions[K]) {
    setTruck((t) => ({ ...t, [key]: value }))
  }

  // Selected places (with coords), in order, for markers + bounds. Reflects the
  // map state immediately as each suggestion is picked — before any route.
  const selectedPoints = useMemo<LatLng[]>(() => {
    return [from, ...stops, to]
      .filter((w) => w.place)
      .map((w) => ({ lng: w.place!.position[0], lat: w.place!.position[1] }))
  }, [from, stops, to])

  // Resolved waypoints for routing: requires both From and To selected; includes
  // only stops that have been resolved (half-typed stops are ignored here — the
  // manual "Check route" button geocodes free text instead).
  const resolvedWaypoints = useMemo<LngLat[] | null>(() => {
    if (!from.place || !to.place) return null
    return [
      from.place.position,
      ...stops.filter((s) => s.place).map((s) => s.place!.position),
      to.place.position,
    ]
  }, [from.place, to.place, stops])

  // Stable signatures so the auto-recalc effect fires on coordinate/truck changes
  // only — not on every keystroke.
  const routeKey = resolvedWaypoints ? resolvedWaypoints.map((p) => p.join(',')).join('|') : ''
  const truckParams = useMemo(() => truckToOptions(truck), [truck])
  const truckActive = hasTruckParams(truck)
  const truckKey = truckActive ? JSON.stringify(truckParams) : ''

  // Latest values for the effect to read without re-subscribing on identity churn.
  const latest = useRef({ resolvedWaypoints, truckParams, truckActive })
  latest.current = { resolvedWaypoints, truckParams, truckActive }

  // Auto-(re)calculate whenever the resolved From/To/stops or truck params change.
  // Clears the route when From/To aren't both selected.
  useEffect(() => {
    const { resolvedWaypoints: wps, truckParams: tp, truckActive: ta } = latest.current
    if (!wps) {
      setResult(null)
      setError(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    ;(async () => {
      try {
        const route = await calculateRoute(wps, ta ? { truck: tp } : undefined)
        if (cancelled) return
        if (!route) {
          setError('No route could be found between those locations.')
          setResult(null)
          return
        }
        setResult({
          distance: formatDistance(route.distanceMeters),
          duration: formatDuration(route.durationSeconds),
          geometry: route.geometry,
          points: wps.map(([lng, lat]) => ({ lng, lat })),
          mode: route.mode,
        })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Route calculation failed.')
        setResult(null)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [routeKey, truckKey])

  // Manual trigger: geocodes any free-text fields that weren't picked from the
  // dropdown, then routes. (Selected fields use their resolved coordinates.)
  async function handleCheck() {
    const fields = [from, ...stops.filter((s) => s.text.trim()), to]
    setBusy(true)
    setError(null)
    try {
      const waypoints: LngLat[] = []
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        if (f.place) {
          waypoints.push(f.place.position)
          continue
        }
        const g = await geocode(f.text.trim())
        if (!g) {
          const which = i === 0 ? '“From”' : i === fields.length - 1 ? '“To”' : `stop ${i}`
          setError(`Couldn't find a location for ${which}.`)
          setResult(null)
          return
        }
        waypoints.push(g.position)
      }
      const route = await calculateRoute(waypoints, truckActive ? { truck: truckParams } : undefined)
      if (!route) {
        setError('No route could be found between those locations.')
        setResult(null)
        return
      }
      setResult({
        distance: formatDistance(route.distanceMeters),
        duration: formatDuration(route.durationSeconds),
        geometry: route.geometry,
        points: waypoints.map(([lng, lat]) => ({ lng, lat })),
        mode: route.mode,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Route calculation failed.')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Header — back + title, with the subtle map light/dark control on the right. */}
      <header className="h-[var(--header-height)] flex items-center gap-1.5 px-3 rounded-[11px] border border-white/[0.08] bg-rail shrink-0 overflow-hidden">
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
        <div className="ml-auto">
          <MapModeToggle mode={mapMode} onChange={setMapMode} />
        </div>
      </header>

      {/* Map area — full-bleed surface that fills the rest of the workspace, with
          the route form floating over it. `relative` anchors the floating panel;
          `overflow-hidden` keeps the rounded corners clean. */}
      <div className="relative flex-1 min-h-0 mt-2 rounded-[11px] border border-white/[0.08] overflow-hidden bg-rail">
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-rail">
              <Spinner variant="lg" />
            </div>
          }
        >
          <MapView
            className="absolute inset-0 h-full w-full"
            center={null}
            colorScheme={mapMode}
            route={result?.geometry ?? null}
            points={selectedPoints}
          />
        </Suspense>

        {/* Floating route panel — top-left on desktop, full-width across the top
            on narrow screens. Translucent dark, light border, small radius —
            deliberately not a heavy modal. Scrolls internally when stops pile up. */}
        <div className="absolute top-4 left-4 right-4 sm:right-auto sm:w-[360px] lg:w-[400px] max-h-[calc(100%-32px)] overflow-y-auto rounded-[11px] border border-white/[0.10] bg-rail/85 backdrop-blur-md shadow-2xl shadow-black/50 p-4 flex flex-col gap-2.5">
          {/* Route waypoint model: [From, ...stops, To]. Stops are the ordered
              intermediate waypoints. TODO(route-drag): dragging the route line (or
              a draggable handle on it) should INSERT a new entry into `stops` at
              the dragged position (reverse-geocoded for its label) and let the
              existing auto-recalc effect re-route — truck-aware when truck params
              are set. Not faked here: we don't draw an adjusted line that ignores
              restrictions; a dragged waypoint must go through calculateRoute. */}
          <PlaceAutocompleteField
            label="From"
            value={from.text}
            placeholder="Start address or city"
            onTextChange={(text) => setFrom({ text, place: null })}
            onSelect={(place) => setFrom({ text: place.label, place })}
          />

          {stops.map((s, i) => (
            <PlaceAutocompleteField
              key={i}
              label={`Stop ${i + 1}`}
              value={s.text}
              placeholder="Intermediate stop"
              onTextChange={(text) => setStopText(i, text)}
              onSelect={(place) => setStopPlace(i, place)}
              onRemove={() => removeStop(i)}
            />
          ))}

          <PlaceAutocompleteField
            label="To"
            value={to.text}
            placeholder="Destination address or city"
            onTextChange={(text) => setTo({ text, place: null })}
            onSelect={(place) => setTo({ text: place.label, place })}
          />

          <button
            onClick={() => setStops((s) => [...s, EMPTY_FIELD])}
            className="self-start flex items-center gap-1 text-[11.5px] text-muted hover:text-text transition-colors"
          >
            <Plus size={12} strokeWidth={1.8} />
            Add stop
          </button>

          {/* Truck restrictions — advanced, collapsed by default. When dimensions
              / weight are entered, the route is recalculated in real Truck travel
              mode (see calculateRoute), so it honours height/weight limits. */}
          <TruckRestrictions
            open={truckOpen}
            onToggle={() => setTruckOpen((v) => !v)}
            truck={truck}
            onChange={setTruckField}
          />

          <button
            type="button"
            disabled={!canCheck}
            onClick={handleCheck}
            className="mt-0.5 flex items-center justify-center gap-2 bg-text text-bg font-semibold text-[12px] rounded-btn px-3 py-1.5 transition-colors enabled:hover:bg-text/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy && <Spinner variant="sm" />}
            {busy ? 'Calculating…' : 'Check route'}
          </button>

          {!geoConfigured && (
            <div className="text-[11px] text-faint">Routing is not configured.</div>
          )}
          {error && <div className="text-[11px] text-alert">{error}</div>}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Stat label="Distance" value={result?.distance ?? '—'} />
            <Stat label="Duration" value={result?.duration ?? '—'} />
          </div>

          {/* Honest labelling of how the route was computed — never claim truck
              compliance unless GeoRoutes actually ran in Truck mode. */}
          {result &&
            (result.mode === 'Truck' ? (
              <div className="flex items-center gap-1.5 text-[11px] text-active">
                <Truck size={12} strokeWidth={1.8} />
                Routed with truck restrictions
              </div>
            ) : (
              <div className="text-[11px] text-faint">Car route</div>
            ))}
          {mapMode === 'Truck' && result?.mode !== 'Truck' && (
            <div className="text-[11px] text-faint">
              Map shows truck restrictions. Enter truck size/weight to route for a truck.
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Subtle segmented Light/Dark control for the map basemap only.
function MapModeToggle({
  mode,
  onChange,
}: {
  mode: MapColorScheme
  onChange: (m: MapColorScheme) => void
}) {
  return (
    <div
      role="group"
      aria-label="Map appearance"
      className="flex items-center gap-0.5 rounded-chip border border-white/[0.08] bg-white/[0.02] p-0.5"
    >
      <ModeButton
        active={mode === 'Dark'}
        onClick={() => onChange('Dark')}
        label="Dark map"
        icon={<Moon size={13} strokeWidth={1.8} />}
      />
      <ModeButton
        active={mode === 'Light'}
        onClick={() => onChange('Light')}
        label="Light map"
        icon={<Sun size={13} strokeWidth={1.8} />}
      />
      <ModeButton
        active={mode === 'Truck'}
        onClick={() => onChange('Truck')}
        label="Truck restrictions map"
        icon={<Truck size={13} strokeWidth={1.8} />}
      />
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`h-6 w-7 flex items-center justify-center rounded-[3px] transition-colors ${
        active ? 'bg-white/[0.10] text-text' : 'text-faint hover:text-text'
      }`}
    >
      {icon}
    </button>
  )
}

function TruckRestrictions({
  open,
  onToggle,
  truck,
  onChange,
}: {
  open: boolean
  onToggle: () => void
  truck: TruckOptions
  onChange: <K extends keyof TruckOptions>(key: K, value: TruckOptions[K]) => void
}) {
  return (
    <div className="rounded-card border border-white/[0.06] bg-white/[0.015]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Truck size={13} strokeWidth={1.7} className="text-muted shrink-0" />
        <span className="text-[12px] font-medium flex-1">Truck restrictions</span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Height"
              unit="m"
              value={truck.height}
              onChange={(v) => onChange('height', v)}
            />
            <NumberField
              label="Width"
              unit="m"
              value={truck.width}
              onChange={(v) => onChange('width', v)}
            />
            <NumberField
              label="Length"
              unit="m"
              value={truck.length}
              onChange={(v) => onChange('length', v)}
            />
            <NumberField
              label="Gross weight"
              unit="t"
              value={truck.grossWeight}
              onChange={(v) => onChange('grossWeight', v)}
            />
            <NumberField
              label="Axle weight"
              unit="t"
              value={truck.axleWeight}
              onChange={(v) => onChange('axleWeight', v)}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
            <input
              type="checkbox"
              className="checkbox"
              checked={truck.hazardous}
              onChange={(e) => onChange('hazardous', e.target.checked)}
            />
            <span className="text-[12px] text-muted">Hazardous goods</span>
          </label>
        </div>
      )}
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] text-muted mb-1">{label}</span>
      <span className="flex items-center gap-1 px-2 h-8 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="bg-transparent flex-1 outline-none text-[12px] tabular-nums placeholder:text-faint min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[10.5px] text-faint shrink-0">{unit}</span>
      </span>
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
