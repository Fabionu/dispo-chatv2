import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import {
  STOP_TYPES,
  TRIP_STATUSES,
  labelOf,
  parseCoordinates,
  stopId,
  stopLocationLabel,
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
  // the panel can surface a retryable error and stay open.
  onCreate: (next: VehicleOps) => Promise<void>
}

// Manual "Add trip" RIGHT-SIDE PANEL for a vehicle room. Same shell as the
// GroupInfoPanel — an in-flow column beside the chat on desktop (xl+) and an
// overlay drawer below xl — so trip creation feels native to the app's panel
// system and never covers the chat with a centered pop-up. Creates ONE active
// trip with its trip-level details, a starting status, and a manually-built list
// of stops (none exist by default — the dispatcher adds them one by one).
// Everything is typed by hand: there is intentionally no map, route, GPS, or
// computed ETA. Persistence reuses the existing group `meta.ops` blob (see
// lib/vehicleOps.ts); no new tables/endpoints are introduced.
export default function AddTripPanel({ ops, onClose, onCreate }: Props) {
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

  // Esc closes the panel (matches the rest of the app's overlays); ignored
  // mid-submit so an in-flight create isn't abandoned.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

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
    <>
      {/* Click-away — only as an overlay drawer on narrow screens (< xl). On
          desktop the panel is a real in-flow column, so there's no backdrop and
          the chat behind it stays fully clickable. */}
      <div className="fixed inset-0 z-40 xl:hidden" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-label="Add trip"
        // Same shell as GroupInfoPanel: a fixed right-edge drawer on narrow
        // screens; xl+ a static, in-flow right column beside the chat as its own
        // borderless rail surface (matching radius + gap), so the chat reflows
        // narrower and stays visible.
        className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-[400px] shadow-[-16px_0_48px_rgba(0,0,0,0.4)] bg-rail flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(360px,26vw,420px)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:rounded-[11px] xl:overflow-hidden"
      >
        {/* Header — same height as the chat header so the two line up. */}
        <div className="h-[var(--header-height)] flex items-center justify-between px-4 shrink-0">
          <span className="text-[13px] font-semibold">Add trip</span>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close add trip"
            className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors disabled:opacity-50"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <p className="text-[11.5px] text-muted leading-[1.45]">
            {replacing
              ? 'Creating a new trip will replace the current active trip.'
              : 'Manually create a trip for this vehicle and add its stops.'}
          </p>

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
                      {[stopLocationLabel(s), s.plannedAt].filter(Boolean).join(' · ') || '—'}
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

        {/* Footer action area — sits on the panel's rail surface, no divider. */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3">
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
        </div>
      </aside>
    </>
  )
}

// Inline add-a-stop form. Holds its own draft so adding a stop doesn't disturb
// the trip fields; clears itself after each add so the dispatcher can keep
// adding stops one by one. Location is required to add (an empty stop is noise).
function StopAddForm({ onAdd }: { onAdd: (draft: Omit<VehicleStop, 'id' | 'status'>) => void }) {
  const [type, setType] = useState<StopType>('loading')
  const [company, setCompany] = useState('')
  const [street, setStreet] = useState('')
  const [cityLine, setCityLine] = useState('')
  const [coordinates, setCoordinates] = useState('')
  const [plannedAt, setPlannedAt] = useState('')
  const [notes, setNotes] = useState('')

  const coordParsed = parseCoordinates(coordinates)
  // Friendly hint only when there IS text that doesn't parse — never blocks add.
  const coordInvalid = coordinates.trim().length > 0 && !coordParsed
  // A stop needs at least some place info (any address field or coordinates).
  const canAdd = [company, street, cityLine, coordinates].some((v) => v.trim().length > 0)

  function add() {
    if (!canAdd) return
    const trimOrUndef = (v: string) => (v.trim() ? v.trim() : undefined)
    onAdd({
      type,
      company: trimOrUndef(company),
      street: trimOrUndef(street),
      cityLine: trimOrUndef(cityLine),
      coordinates: trimOrUndef(coordinates),
      lat: coordParsed?.lat,
      lng: coordParsed?.lng,
      plannedAt: trimOrUndef(plannedAt),
      notes: trimOrUndef(notes),
    })
    setType('loading')
    setCompany('')
    setStreet('')
    setCityLine('')
    setCoordinates('')
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
      {/* Address fields — meaning lives in the placeholder (no visible label) to
          keep the form compact; each input keeps an aria-label for a11y. */}
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        aria-label="Company name"
        placeholder="Enter company name..."
        className="modal-input"
      />
      <input
        value={street}
        onChange={(e) => setStreet(e.target.value)}
        aria-label="Street name, number or industrial area"
        placeholder="Enter street name, number or industrial area..."
        className="modal-input"
      />
      <input
        value={cityLine}
        onChange={(e) => setCityLine(e.target.value)}
        aria-label="Country, postal code and city"
        placeholder="Enter country, postal code and city..."
        className="modal-input"
      />
      <div className="flex flex-col gap-1">
        <input
          value={coordinates}
          onChange={(e) => setCoordinates(e.target.value)}
          aria-label="Coordinates"
          placeholder="Enter coordinates..."
          className="modal-input"
        />
        {coordInvalid && (
          <span className="text-[10.5px] text-faint">
            Couldn't read these coordinates — they'll be kept as typed.
          </span>
        )}
      </div>
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
