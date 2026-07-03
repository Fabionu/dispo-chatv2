import { useState } from 'react'
import { ChevronDown, MapPin, Plus, RefreshCw, Trash2 } from 'lucide-react'
import EditableRow from '../EditableRow'
import StopCard from './StopCard'
import StopEditor from './StopEditor'
import { SelectRow, StatusChip, SubHeading } from './opsControls'
import { canRouteStops } from '../../lib/tripRoute'
import {
  TRIP_STATUSES,
  labelOf,
  loadingStops,
  stopCityLine,
  stopFullAddress,
  stopId,
  tripStatusTone,
  unloadingStops,
  type ActiveTrip,
  type VehicleStop,
} from '../../lib/vehicleOps'

type Props = {
  trip: ActiveTrip | null
  // The trip's stops — addresses, times and the route all derive from these
  // (managed in the Stops section below), the single source of truth.
  stops: VehicleStop[]
  canManage: boolean
  // Merge a patch into the active trip (creates the trip if none exists yet).
  onSaveTrip: (patch: Partial<ActiveTrip>) => Promise<void>
  // Start a brand-new, CLEAN trip (no carried-over fields or stops).
  onAddTrip: () => Promise<void>
  // Remove the active trip (and its stops) entirely.
  onClearTrip: () => Promise<void>
  // Persist the full, edited stop list. Coordinate changes recompute the trip
  // route in the background (handled by the panel's save handler).
  onSaveStops: (next: VehicleStop[]) => Promise<void>
  // Foreground "Calculate route" — recompute from the stops and save (quiet, no
  // activity row on a first calculation).
  onCalculateRoute: () => Promise<void>
  // "Edit route" — opens the route map tool, recomputes + saves, and logs a
  // "Route was edited" row when the route changed. Undefined when the trip isn't
  // routable (fewer than two stops with valid coordinates).
  onEditRoute?: () => Promise<void>
}

// Compact place label for the summary card's loading/unloading lines — company +
// "country postal city" (e.g. "FBR EUROPE B.V., NL 9001 GROU"), falling back to
// the full address for legacy single-line stops. Empty when the stop has no
// usable address text.
function placeLabel(s: VehicleStop | undefined): string {
  if (!s) return ''
  const compact = [s.company, stopCityLine(s)]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
    .join(', ')
  return compact || stopFullAddress(s)
}

// One "Loading: <date> · <place>" / "Unloading: …" line in the summary card. The
// date is the relevant stop's planned time; both fall back to a subtle "Not set"
// when nothing is known.
function SummaryStopLine({ label, stop }: { label: string; stop: VehicleStop | undefined }) {
  const date = stop?.plannedAt?.trim()
  const place = placeLabel(stop)
  return (
    <div className="text-[0.71875rem] leading-[1.5] truncate">
      <span className="text-faint">{label}: </span>
      {date || place ? (
        <>
          {date && <span className="text-text tabular-nums">{date}</span>}
          {date && place && <span className="text-faint"> · </span>}
          {place && <span className="text-muted">{place}</span>}
        </>
      ) : (
        <span className="text-faint">Not set</span>
      )}
    </div>
  )
}

// Active Trip tab: ONE manually-managed trip per vehicle room, shown as a compact
// summary card first (order, client, status, loading/unloading) that EXPANDS into
// the full editable detail (stops, route, cargo, planning, notes). The trip's
// stops are the single source of truth for loading/unloading addresses and the
// route — there are no separate Loading/Unloading address fields. The route
// summary is computed from the stop coordinates (planning data — no live GPS).
export default function TripTab({
  trip,
  stops,
  canManage,
  onSaveTrip,
  onAddTrip,
  onClearTrip,
  onSaveStops,
  onCalculateRoute,
  onEditRoute,
}: Props) {
  const [busy, setBusy] = useState(false)
  // The summary card starts collapsed — full detail is one click away.
  const [expanded, setExpanded] = useState(false)
  // Which stop is being edited: an id, 'new' for the add form, or null.
  const [editingStop, setEditingStop] = useState<string | 'new' | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  async function addStop(draft: Omit<VehicleStop, 'id'>) {
    await onSaveStops([...stops, { ...draft, id: stopId() }])
    setEditingStop(null)
  }
  async function updateStop(id: string, draft: Omit<VehicleStop, 'id'>) {
    await onSaveStops(stops.map((s) => (s.id === id ? { ...draft, id } : s)))
    setEditingStop(null)
  }
  async function removeStop(id: string) {
    await onSaveStops(stops.filter((s) => s.id !== id))
  }

  if (!trip) {
    return (
      <div className="flex flex-col items-center text-center py-8 px-4">
        <div className="text-[0.78125rem] text-muted">No active trip.</div>
        <div className="text-[0.71875rem] text-faint mt-1">
          Add a trip to track its stops, cargo and status.
        </div>
        {canManage && (
          <button
            onClick={() => void run(onAddTrip)}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-btn bg-text text-bg text-[0.75rem] font-semibold hover:bg-text/90 disabled:opacity-50 transition-colors"
          >
            <Plus size="0.875rem" strokeWidth={2.2} /> Add trip
          </button>
        )}
      </div>
    )
  }

  const route = trip.route
  // Route availability is derived from the STOPS (the source of truth), not from
  // legacy address fields — so it's never "unavailable" while ≥2 stops carry
  // valid coordinates, even if the stored route hasn't been (re)computed yet.
  const canRoute = canRouteStops(stops)

  // Summary derivations. Loading = the first loading-type stop (falling back to
  // the first stop); Unloading = the last unloading-type stop (falling back to
  // the last stop). Dates come from the relevant stop's planned time.
  const ls = loadingStops(stops)
  const us = unloadingStops(stops)
  const loadingStop = ls[0] ?? stops[0]
  const unloadingStop =
    us[us.length - 1] ?? (stops.length > 1 ? stops[stops.length - 1] : undefined)
  const statusLabel = labelOf(TRIP_STATUSES, trip.status) || 'Planned'

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">Active trip</span>
        {canManage && (
          <button
            onClick={() => void run(onClearTrip)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-muted hover:text-alert transition-colors disabled:opacity-50"
          >
            <Trash2 size="0.75rem" strokeWidth={1.8} /> Clear trip
          </button>
        )}
      </div>

      {/* Summary card — the scannable overview. Click anywhere to expand into the
          full editable detail below. Matches the dark card style used across the
          panel (rounded, hairline border, subtle fill). */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full text-left rounded-xl border border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.04] transition-colors px-3 py-2.5 flex flex-col gap-1"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[0.8125rem] font-semibold leading-tight min-w-0 truncate">
            Order{' '}
            {trip.reference ? (
              <span className="text-text">#{trip.reference}</span>
            ) : (
              <span className="text-faint font-normal">Not set</span>
            )}
          </div>
          <StatusChip tone={tripStatusTone(trip.status)} label={statusLabel} />
        </div>
        <div className="text-[0.75rem] leading-tight truncate">
          {trip.client ? (
            <span className="text-muted">{trip.client}</span>
          ) : (
            <span className="text-faint">Not set</span>
          )}
        </div>
        <SummaryStopLine label="Loading" stop={loadingStop} />
        <SummaryStopLine label="Unloading" stop={unloadingStop} />
        <div className="flex justify-center pt-0.5 text-faint">
          <ChevronDown
            size="1rem"
            strokeWidth={2}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Full editable detail — only when expanded. */}
      {expanded && (
        <div className="mt-3">
          <SelectRow
            label="Trip status"
            value={trip.status}
            options={TRIP_STATUSES}
            editable={canManage}
            onSave={(v) => onSaveTrip({ status: v })}
          />

          <SubHeading>Order</SubHeading>
          <EditableRow
            label="Trip reference / order no."
            value={trip.reference}
            editable={canManage}
            placeholder="e.g. ORD-10482"
            onSave={(v) => onSaveTrip({ reference: v || undefined })}
          />
          <EditableRow
            label="Client / customer"
            value={trip.client}
            editable={canManage}
            placeholder="Customer name"
            onSave={(v) => onSaveTrip({ client: v || undefined })}
          />

          {/* Stops — the trip's full stop list (the source of truth for addresses
              and times), using the shared card style. Adding, editing or removing
              a stop persists immediately; when coordinates change the route below
              is recomputed in the background by the panel's save handler. */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow">Stops{stops.length ? ` · ${stops.length}` : ''}</span>
              {canManage && editingStop !== 'new' && (
                <button
                  onClick={() => setEditingStop('new')}
                  className="inline-flex items-center gap-1 text-[0.71875rem] text-muted hover:text-text transition-colors"
                >
                  <Plus size="0.75rem" strokeWidth={1.8} /> Add stop
                </button>
              )}
            </div>

            {editingStop === 'new' && (
              <div className="mb-1.5">
                <StopEditor onCancel={() => setEditingStop(null)} onSave={addStop} />
              </div>
            )}

            {stops.length === 0 && editingStop !== 'new' ? (
              <div className="text-[0.75rem] text-faint py-4 text-center">No stops yet.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {stops.map((stop) =>
                  editingStop === stop.id ? (
                    <StopEditor
                      key={stop.id}
                      initial={stop}
                      onCancel={() => setEditingStop(null)}
                      onSave={(draft) => updateStop(stop.id, draft)}
                    />
                  ) : (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      canManage={canManage}
                      onEdit={() => setEditingStop(stop.id)}
                      onRemove={() => void removeStop(stop.id)}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          <SubHeading>Route</SubHeading>
          {route?.status === 'ok' ? (
            <div className="py-2 border-b border-white/[0.04]">
              <div className="flex items-stretch gap-6">
                <div>
                  <div className="text-[0.6875rem] text-muted">Distance</div>
                  <div className="text-[0.78125rem] text-text mt-0.5 tabular-nums">
                    {route.distanceText}
                  </div>
                </div>
                <div>
                  <div className="text-[0.6875rem] text-muted">Driving time</div>
                  <div className="text-[0.78125rem] text-text mt-0.5 tabular-nums">
                    {route.durationText}
                  </div>
                </div>
              </div>
              {canManage && onEditRoute && (
                <button
                  onClick={() => void run(onEditRoute)}
                  disabled={busy}
                  className="mt-2 inline-flex items-center gap-1 text-[0.71875rem] text-muted hover:text-text transition-colors disabled:opacity-50"
                >
                  <MapPin size="0.75rem" strokeWidth={1.8} /> Edit route
                </button>
              )}
            </div>
          ) : canRoute ? (
            // Coordinates exist for ≥2 stops, but the stored route isn't an "ok"
            // result yet — show an accurate state (never "missing coordinates")
            // with ways to build it from the current stops.
            <div className="py-2 border-b border-white/[0.04]">
              <div className="text-[0.71875rem] text-faint leading-[1.45]">
                {route?.status === 'failed'
                  ? "Route couldn't be calculated last time — try again."
                  : 'Route ready — not calculated yet.'}
              </div>
              {canManage && (
                <div className="mt-2 flex items-center gap-4">
                  <button
                    onClick={() => void run(onCalculateRoute)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-[0.71875rem] text-muted hover:text-text transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size="0.75rem" strokeWidth={1.8} /> Calculate route
                  </button>
                  {onEditRoute && (
                    <button
                      onClick={() => void run(onEditRoute)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-[0.71875rem] text-muted hover:text-text transition-colors disabled:opacity-50"
                    >
                      <MapPin size="0.75rem" strokeWidth={1.8} /> Edit route
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-2 border-b border-white/[0.04] text-[0.71875rem] text-faint leading-[1.45]">
              Add coordinates to at least two stops to build a route.
            </div>
          )}

          <SubHeading>Cargo</SubHeading>
          <EditableRow
            label="Cargo description"
            value={trip.cargo}
            editable={canManage}
            placeholder="What is being transported"
            onSave={(v) => onSaveTrip({ cargo: v || undefined })}
          />
          <EditableRow
            label="Weight"
            value={trip.weight}
            editable={canManage}
            placeholder="e.g. 22 t"
            onSave={(v) => onSaveTrip({ weight: v || undefined })}
          />
          <EditableRow
            label="Pallets"
            value={trip.pallets}
            editable={canManage}
            placeholder="e.g. 33"
            onSave={(v) => onSaveTrip({ pallets: v || undefined })}
          />

          <SubHeading>Planning</SubHeading>
          <EditableRow
            label="ETA"
            value={trip.eta}
            editable={canManage}
            hint="Manual"
            placeholder="e.g. 19/06/2025 13:30"
            onSave={(v) => onSaveTrip({ eta: v || undefined })}
          />
          <EditableRow
            label="Internal trip notes"
            value={trip.notes}
            editable={canManage}
            multiline
            placeholder="Notes about this trip (internal)"
            onSave={(v) => onSaveTrip({ notes: v || undefined })}
          />
        </div>
      )}
    </div>
  )
}
