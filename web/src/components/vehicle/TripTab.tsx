import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import EditableRow from '../EditableRow'
import { SelectRow, StatusChip, SubHeading } from './opsControls'
import { TRIP_STATUSES, labelOf, tripStatusTone, type ActiveTrip } from '../../lib/vehicleOps'

type Props = {
  trip: ActiveTrip | null
  canManage: boolean
  // Merge a patch into the active trip (creates the trip if none exists yet).
  onSaveTrip: (patch: Partial<ActiveTrip>) => Promise<void>
  // Remove the active trip entirely.
  onClearTrip: () => Promise<void>
}

// Active Trip tab: ONE manually-managed trip per vehicle room. Every field is
// typed by a dispatcher — including the ETA, which is deliberately manual (no
// map/route/GPS calculation). Each field edits individually like the rest of
// the panel; "Clear trip" removes it so a new load can be entered.
export default function TripTab({ trip, canManage, onSaveTrip, onClearTrip }: Props) {
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
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

      {/* TODO(driver/mobile): drivers will advance this status from their phone
          in the vehicle room (e.g. a big "Update progress" control). The status
          is already a plain manual field persisted in meta.ops — only a
          driver-facing, permission-relaxed control needs adding here; nothing is
          ever derived from GPS/maps. The same status drives the room header and
          sidebar summaries. */}
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

      <SubHeading>Loading</SubHeading>
      <EditableRow
        label="Loading address"
        value={trip.loadingAddress}
        editable={canManage}
        multiline
        placeholder="Pickup address"
        onSave={(v) => onSaveTrip({ loadingAddress: v || undefined })}
      />
      <EditableRow
        label="Loading date &amp; time"
        value={trip.loadingAt}
        editable={canManage}
        placeholder="e.g. 18 Jun, 08:00"
        onSave={(v) => onSaveTrip({ loadingAt: v || undefined })}
      />

      <SubHeading>Unloading</SubHeading>
      <EditableRow
        label="Unloading address"
        value={trip.unloadingAddress}
        editable={canManage}
        multiline
        placeholder="Delivery address"
        onSave={(v) => onSaveTrip({ unloadingAddress: v || undefined })}
      />
      <EditableRow
        label="Unloading date &amp; time"
        value={trip.unloadingAt}
        editable={canManage}
        placeholder="e.g. 19 Jun, 14:00"
        onSave={(v) => onSaveTrip({ unloadingAt: v || undefined })}
      />

      <SubHeading>Cargo</SubHeading>
      <EditableRow
        label="Cargo description"
        value={trip.cargo}
        editable={canManage}
        multiline
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
        placeholder="e.g. 19 Jun, 13:30"
        onSave={(v) => onSaveTrip({ eta: v || undefined })}
      />
      {/* TODO(maps/live-tracking): when a mobile driver app exists, an ETA could
          be suggested here from a route/GPS feed. For now it is strictly manual —
          no map, route, or coordinate is read. */}
      <EditableRow
        label="Internal trip notes"
        value={trip.notes}
        editable={canManage}
        multiline
        placeholder="Notes about this trip (internal)"
        onSave={(v) => onSaveTrip({ notes: v || undefined })}
      />
    </div>
  )
}
