import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '../Modal'
import {
  STOP_TYPES,
  TRIP_STATUSES,
  labelOf,
  stopId,
  type StopType,
  type TripStatus,
  type VehicleOps,
  type VehicleStop,
} from '../../lib/vehicleOps'

type Props = {
  // Current ops — its `vehicle` block is preserved untouched; an existing trip
  // (if any) is replaced by the one created here (one active trip per room).
  ops: VehicleOps
  onClose: () => void
  // Persist the new ops blob (vehicle + new trip + stops). Throws on failure so
  // the modal can surface a retryable error and stay open.
  onCreate: (next: VehicleOps) => Promise<void>
}

// Manual "Add trip" modal for a vehicle room. Creates ONE active trip with its
// trip-level details, a starting status, and a manually-built list of stops
// (none exist by default — the dispatcher adds them one by one). Everything is
// typed by hand: there is intentionally no map, route, GPS, or computed ETA.
// Persistence reuses the existing group `meta.ops` blob (see lib/vehicleOps.ts);
// no new tables/endpoints are introduced.
export default function AddTripModal({ ops, onClose, onCreate }: Props) {
  const replacing = ops.trip !== null

  // ── Trip-level fields ──────────────────────────────────────────────────
  const [reference, setReference] = useState('')
  const [client, setClient] = useState('')
  const [cargo, setCargo] = useState('')
  const [weight, setWeight] = useState('')
  const [pallets, setPallets] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<TripStatus>('planned')

  // ── Stops the user has added so far (manual, one at a time) ─────────────
  const [stops, setStops] = useState<VehicleStop[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addStop(draft: Omit<VehicleStop, 'id' | 'status'>) {
    setStops((prev) => [...prev, { ...draft, id: stopId(), status: 'planned' }])
  }
  function removeStop(id: string) {
    setStops((prev) => prev.filter((s) => s.id !== id))
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    const trimOrUndef = (v: string) => {
      const t = v.trim()
      return t ? t : undefined
    }
    // Spread drops keys whose value is undefined once JSON-serialised, so empty
    // optional fields simply aren't stored.
    const next: VehicleOps = {
      vehicle: ops.vehicle,
      trip: {
        status,
        reference: trimOrUndef(reference),
        client: trimOrUndef(client),
        cargo: trimOrUndef(cargo),
        weight: trimOrUndef(weight),
        pallets: trimOrUndef(pallets),
        notes: trimOrUndef(notes),
      },
      stops,
    }
    try {
      await onCreate(next)
      onClose()
    } catch {
      setError('Could not create the trip. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="Add trip"
      subtitle={
        replacing
          ? 'Creating a new trip will replace the current active trip.'
          : 'Manually create a trip for this vehicle and add its stops.'
      }
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[12.5px] text-muted hover:text-text border border-white/[0.12] rounded-btn px-3 py-1.5 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="text-[12.5px] font-semibold bg-text text-bg rounded-btn px-3.5 py-1.5 hover:bg-text/90 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create trip'}
          </button>
        </>
      }
    >
      <div className="max-h-[62vh] overflow-y-auto -mx-5 px-5 space-y-3.5">
        <Field label="Trip reference / order number">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoFocus
            placeholder="e.g. 12345"
            className="modal-input"
          />
        </Field>

        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TripStatus)}
            className={SELECT_CLASS}
          >
            {TRIP_STATUSES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {/* TODO(driver/mobile): drivers will later set/advance this status from
              their phone in the vehicle room. The data model already supports
              manual status changes — only a driver-facing control is missing. */}
        </Field>

        <Field label="Client / customer name">
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Customer name"
            className="modal-input"
          />
        </Field>

        <Field label="Cargo description">
          <textarea
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
            rows={2}
            placeholder="What is being transported"
            className="modal-input resize-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Weight">
            <input
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="e.g. 22 t"
              className="modal-input"
            />
          </Field>
          <Field label="Pallets">
            <input
              value={pallets}
              onChange={(e) => setPallets(e.target.value)}
              placeholder="e.g. 33"
              className="modal-input"
            />
          </Field>
        </div>

        <Field label="Internal trip notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes about this trip (internal)"
            className="modal-input resize-none"
          />
        </Field>

        {/* ── Stops ───────────────────────────────────────────────────────── */}
        <div className="pt-1">
          <div className="eyebrow mb-2">Stops{stops.length ? ` · ${stops.length}` : ''}</div>

          {stops.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-2.5">
              {stops.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2"
                >
                  <span className="text-[12px] font-medium shrink-0">
                    {labelOf(STOP_TYPES, s.type)}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[12px] text-muted">
                    {[s.location, s.plannedAt].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <button
                    onClick={() => removeStop(s.id)}
                    aria-label="Remove stop"
                    title="Remove stop"
                    className="h-6 w-6 shrink-0 flex items-center justify-center rounded-chip text-faint hover:text-alert hover:bg-white/[0.04] transition-colors"
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <StopAddForm onAdd={addStop} />
        </div>

        {error && <div className="text-[12px] text-alert">{error}</div>}
      </div>
    </Modal>
  )
}

// Inline add-a-stop form. Holds its own draft so adding a stop doesn't disturb
// the trip fields; clears itself after each add so the dispatcher can keep
// adding stops one by one. Location is required to add (an empty stop is noise).
function StopAddForm({ onAdd }: { onAdd: (draft: Omit<VehicleStop, 'id' | 'status'>) => void }) {
  const [type, setType] = useState<StopType>('loading')
  const [location, setLocation] = useState('')
  const [plannedAt, setPlannedAt] = useState('')
  const [notes, setNotes] = useState('')

  const canAdd = location.trim().length > 0

  function add() {
    if (!canAdd) return
    onAdd({
      type,
      location: location.trim() || undefined,
      plannedAt: plannedAt.trim() || undefined,
      notes: notes.trim() || undefined,
    })
    setType('loading')
    setLocation('')
    setPlannedAt('')
    setNotes('')
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Stop type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as StopType)}
            className={SELECT_CLASS}
          >
            {STOP_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Planned date/time</span>
          <input
            value={plannedAt}
            onChange={(e) => setPlannedAt(e.target.value)}
            placeholder="e.g. 18 Jun, 08:00"
            className="modal-input"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Address / location</span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Where is the stop"
          className="modal-input"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional notes"
          className="modal-input resize-none"
        />
      </label>
      <div className="flex justify-end">
        <button
          onClick={add}
          disabled={!canAdd}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-btn bg-white/[0.06] text-[12px] text-text hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-default transition-colors"
        >
          <Plus size={13} strokeWidth={2.2} /> Add stop
        </button>
      </div>
    </div>
  )
}

const SELECT_CLASS =
  'h-9 w-full rounded-btn border border-white/[0.1] bg-white/[0.03] px-2 text-[12.5px] text-text outline-none focus:border-white/[0.25]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-text mb-1.5">{label}</label>
      {children}
    </div>
  )
}
