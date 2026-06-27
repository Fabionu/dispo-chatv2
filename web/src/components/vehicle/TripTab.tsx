import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import EditableRow from '../EditableRow'
import StopCard from './StopCard'
import StopEditor from './StopEditor'
import { SelectRow, StatusChip, SubHeading } from './opsControls'
import {
  TRIP_STATUSES,
  labelOf,
  loadingStops,
  stopFullAddress,
  stopId,
  tripStatusTone,
  unloadingStops,
  type ActiveTrip,
  type VehicleStop,
} from '../../lib/vehicleOps'

type Props = {
  trip: ActiveTrip | null
  // The trip's stops — loading/unloading addresses and the route derive from
  // these (managed in the Stops section below), not from the legacy free-text
  // fields.
  stops: VehicleStop[]
  canManage: boolean
  // Merge a patch into the active trip (creates the trip if none exists yet).
  onSaveTrip: (patch: Partial<ActiveTrip>) => Promise<void>
  // Remove the active trip entirely.
  onClearTrip: () => Promise<void>
  // Persist the full, edited stop list. Coordinate changes recompute the trip
  // route in the background (handled by the panel's save handler).
  onSaveStops: (next: VehicleStop[]) => Promise<void>
}

// Active Trip tab: ONE manually-managed trip per vehicle room. Loading/unloading
// addresses are DERIVED from the trip's Loading/Unloading stops (managed in the
// Stops tab) so they match what was entered in Add-trip; older trips that still
// carry the legacy free-text address fields fall back to those. The route summary
// is computed from the stop coordinates (planning data — no live GPS). Every
// editable field uses the shared integrated edit control, with notes the only
// multiline field so heights stay consistent.
export default function TripTab({ trip, stops, canManage, onSaveTrip, onClearTrip, onSaveStops }: Props) {
  const [busy, setBusy] = useState(false)
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
        <div className="text-[12.5px] text-muted">No active trip.</div>
        <div className="text-[11.5px] text-faint mt-1">
          Add a trip to track its loading, unloading, cargo and status.
        </div>
        {canManage && (
          <button
            onClick={() => void run(() => onSaveTrip({ status: 'planned' }))}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-btn bg-text text-bg text-[12px] font-semibold hover:bg-text/90 disabled:opacity-50 transition-colors"
          >
            <Plus size={14} strokeWidth={2.2} /> Add trip
          </button>
        )}
      </div>
    )
  }

  const loads = loadingStops(stops)
  const unloads = unloadingStops(stops)
  const route = trip.route

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">Active trip</span>
        {canManage && (
          <button
            onClick={() => void run(onClearTrip)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-alert transition-colors disabled:opacity-50"
          >
            <Trash2 size={12} strokeWidth={1.8} /> Clear trip
          </button>
        )}
      </div>

      {/* Current status as a colored chip — the scannable summary; the row below
          stays the manual control for changing it. */}
      <div className="mb-1">
        <StatusChip
          tone={tripStatusTone(trip.status)}
          label={labelOf(TRIP_STATUSES, trip.status) || 'Planned'}
        />
      </div>

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

      {/* Loading / Unloading derive from the stops. Read-only here — the addresses
          live on the stops (Stops tab); legacy trips with the old free-text fields
          fall back to an editable field so nothing is lost. */}
      <StopGroup
        heading="Loading"
        stops={loads}
        legacyValue={trip.loadingAddress}
        legacyAt={trip.loadingAt}
        legacyLabel="Loading address"
        legacyAtLabel="Loading date & time"
        canManage={canManage}
        onSaveAddress={(v) => onSaveTrip({ loadingAddress: v || undefined })}
        onSaveAt={(v) => onSaveTrip({ loadingAt: v || undefined })}
      />
      <StopGroup
        heading="Unloading"
        stops={unloads}
        legacyValue={trip.unloadingAddress}
        legacyAt={trip.unloadingAt}
        legacyLabel="Unloading address"
        legacyAtLabel="Unloading date & time"
        canManage={canManage}
        onSaveAddress={(v) => onSaveTrip({ unloadingAddress: v || undefined })}
        onSaveAt={(v) => onSaveTrip({ unloadingAt: v || undefined })}
      />

      <SubHeading>Route</SubHeading>
      {route?.status === 'ok' ? (
        <div className="flex items-stretch gap-6 py-2 border-b border-white/[0.04]">
          <div>
            <div className="text-[11px] text-muted">Distance</div>
            <div className="text-[12.5px] text-text mt-0.5 tabular-nums">{route.distanceText}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Driving time</div>
            <div className="text-[12.5px] text-text mt-0.5 tabular-nums">{route.durationText}</div>
          </div>
        </div>
      ) : (
        <div className="py-2 border-b border-white/[0.04] text-[11.5px] text-faint leading-[1.45]">
          {route?.status === 'failed'
            ? "Route couldn't be calculated — the trip is saved; check the stop coordinates."
            : 'Route unavailable — add coordinates to at least two stops to build a route.'}
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

      {/* Stops — the trip's full stop list, using the shared card style. Adding,
          editing or removing a stop persists immediately; when coordinates change
          the trip route above is recomputed in the background by the panel's save
          handler (so distance/duration stay in sync with the stops). */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow">Stops{stops.length ? ` · ${stops.length}` : ''}</span>
          {canManage && editingStop !== 'new' && (
            <button
              onClick={() => setEditingStop('new')}
              className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-text transition-colors"
            >
              <Plus size={12} strokeWidth={1.8} /> Add stop
            </button>
          )}
        </div>

        {editingStop === 'new' && (
          <div className="mb-1.5">
            <StopEditor onCancel={() => setEditingStop(null)} onSave={addStop} />
          </div>
        )}

        {stops.length === 0 && editingStop !== 'new' ? (
          <div className="text-[12px] text-faint py-4 text-center">No stops yet.</div>
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
    </div>
  )
}

// A loading/unloading section: the derived stop address(es) when stops of that
// type exist (read-only — edited in the Stops tab), otherwise the legacy editable
// free-text fields for backwards compatibility.
function StopGroup({
  heading,
  stops,
  legacyValue,
  legacyAt,
  legacyLabel,
  legacyAtLabel,
  canManage,
  onSaveAddress,
  onSaveAt,
}: {
  heading: string
  stops: VehicleStop[]
  legacyValue?: string
  legacyAt?: string
  legacyLabel: string
  legacyAtLabel: string
  canManage: boolean
  onSaveAddress: (v: string) => Promise<void>
  onSaveAt: (v: string) => Promise<void>
}) {
  if (stops.length > 0) {
    const first = stops[0]
    return (
      <>
        <SubHeading>{heading}</SubHeading>
        <EditableRow label={`${heading} address`} value={stopFullAddress(first)} hint="From stops" />
        {first.plannedAt && (
          <EditableRow label={`${heading} date & time`} value={first.plannedAt} hint="From stops" />
        )}
        {stops.length > 1 && (
          <div className="py-1.5 text-[11px] text-faint border-b border-white/[0.04]">
            +{stops.length - 1} more {heading.toLowerCase()} stop{stops.length - 1 === 1 ? '' : 's'} — see the
            Stops tab.
          </div>
        )}
      </>
    )
  }
  return (
    <>
      <SubHeading>{heading}</SubHeading>
      <EditableRow
        label={legacyLabel}
        value={legacyValue}
        editable={canManage}
        placeholder={`Add a ${heading.toLowerCase()} stop in the Stops tab`}
        onSave={onSaveAddress}
      />
      <EditableRow
        label={legacyAtLabel}
        value={legacyAt}
        editable={canManage}
        placeholder="e.g. 18/06/2025 08:00"
        onSave={onSaveAt}
      />
    </>
  )
}
