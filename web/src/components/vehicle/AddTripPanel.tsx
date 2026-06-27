import { useEffect, useState } from 'react'
import { MapPinned, Pencil, Plus, Trash2, X } from 'lucide-react'
import { DateField, TimeField, joinPlannedAt, splitPlannedAt } from '../DateTimeField'
import {
  STOP_TYPES,
  labelOf,
  parseCoordinates,
  stopId,
  stopLocationLabel,
  type StopType,
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
  // Open the in-chat map tool to pick a stop's coordinates. Receives the seed
  // query (composed from the stop's address) and a callback that writes the
  // chosen "lat, lng" back into that stop. Omitted when the panel is used
  // somewhere without the chat-window map (the map button is then hidden).
  onPickLocation?: (req: { query: string; onConfirm: (coords: string) => void }) => void
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
export default function AddTripPanel({ ops, onClose, onCreate, onPickLocation }: Props) {
  const replacing = ops.trip !== null

  // ── Trip-level fields ──────────────────────────────────────────────────
  const [reference, setReference] = useState('')
  const [client, setClient] = useState('')
  const [cargo, setCargo] = useState('')
  const [weight, setWeight] = useState('')
  const [pallets, setPallets] = useState('')
  const [notes, setNotes] = useState('')

  // ── Stops the user has added so far (manual, one at a time) ─────────────
  const [stops, setStops] = useState<VehicleStop[]>([])
  // Which added stop is being edited inline (before the trip is created). Null
  // when none — the add form shows instead.
  const [editingId, setEditingId] = useState<string | null>(null)

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
  function updateStop(id: string, draft: Omit<VehicleStop, 'id' | 'status'>) {
    setStops((prev) => prev.map((s) => (s.id === id ? { ...draft, id, status: s.status } : s)))
    setEditingId(null)
  }
  function removeStop(id: string) {
    setStops((prev) => prev.filter((s) => s.id !== id))
    setEditingId((cur) => (cur === id ? null : cur))
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
        // New trips always start as Planned; status is advanced later from the
        // trip's status-management UI, not at creation.
        status: 'planned',
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
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Client / customer name">
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Customer name"
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Cargo description">
            <textarea
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              rows={2}
              placeholder="What is being transported"
              className={AREA_CLASS}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight">
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g. 22 t"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Pallets">
              <input
                value={pallets}
                onChange={(e) => setPallets(e.target.value)}
                placeholder="e.g. 33"
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <Field label="Internal trip notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notes about this trip (internal)"
              className={AREA_CLASS}
            />
          </Field>

          {/* ── Stops ───────────────────────────────────────────────────────── */}
          <div className="pt-1">
            <div className="eyebrow mb-2">Stops{stops.length ? ` · ${stops.length}` : ''}</div>

            {stops.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-2.5">
                {stops.map((s) =>
                  editingId === s.id ? (
                    // Inline editor for an already-added stop (reuses the add form).
                    <StopForm
                      key={s.id}
                      initial={s}
                      onSubmit={(draft) => updateStop(s.id, draft)}
                      onCancelEdit={() => setEditingId(null)}
                      onPickLocation={onPickLocation}
                    />
                  ) : (
                    <StopCard
                      key={s.id}
                      stop={s}
                      onEdit={() => setEditingId(s.id)}
                      onRemove={() => removeStop(s.id)}
                    />
                  ),
                )}
              </div>
            )}

            {/* Add form — hidden while editing an existing stop so there's never
                two open forms at once. */}
            {editingId === null && <StopForm onSubmit={addStop} onPickLocation={onPickLocation} />}
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

// Stop add/edit form. ADD mode starts as a single "Add stop" button → type
// picker → fields (nothing is pre-created). EDIT mode (when `initial` is given)
// opens straight to the pre-filled fields. Holds its own draft; a stop needs at
// least some place info to save (empty = noise).
function StopForm({
  initial,
  onSubmit,
  onCancelEdit,
  onPickLocation,
}: {
  initial?: VehicleStop
  onSubmit: (draft: Omit<VehicleStop, 'id' | 'status'>) => void
  // Provided in EDIT mode — closes the inline editor (on cancel or after save).
  onCancelEdit?: () => void
  onPickLocation?: (req: { query: string; onConfirm: (coords: string) => void }) => void
}) {
  const editing = Boolean(initial)
  const initialPlanned = splitPlannedAt(initial?.plannedAt)
  // 'idle' → the Add-stop button; 'type' → pick a stop type; 'form' → fill it in.
  // Editing opens straight to the form.
  const [phase, setPhase] = useState<'idle' | 'type' | 'form'>(editing ? 'form' : 'idle')
  const [type, setType] = useState<StopType>(initial?.type ?? 'loading')
  const [company, setCompany] = useState(initial?.company ?? '')
  const [street, setStreet] = useState(initial?.street ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [coordinates, setCoordinates] = useState(initial?.coordinates ?? '')
  const [plannedDate, setPlannedDate] = useState(initialPlanned.date)
  const [plannedTime, setPlannedTime] = useState(initialPlanned.time)
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const coordParsed = parseCoordinates(coordinates)
  // Friendly hint only when there IS text that doesn't parse — never blocks save.
  const coordInvalid = coordinates.trim().length > 0 && !coordParsed
  // A stop needs at least some place info (any address field or coordinates).
  const canSave = [company, street, country, postalCode, city, coordinates].some(
    (v) => v.trim().length > 0,
  )

  function reset() {
    setCompany('')
    setStreet('')
    setCountry('')
    setPostalCode('')
    setCity('')
    setCoordinates('')
    setPlannedDate('')
    setPlannedTime('')
    setNotes('')
  }

  // Cancel: in EDIT mode close the inline editor; in ADD mode clear + collapse.
  function cancel() {
    if (editing) {
      onCancelEdit?.()
      return
    }
    reset()
    setPhase('idle')
  }

  // Open the in-chat map seeded with this stop's address. Prefer the structured
  // location (street + postal/city + country); fall back to the company name.
  // Empty is fine — the map opens with an empty search. The map writes the
  // chosen "lat, lng" back into the coordinates field; the form stays open.
  function pickOnMap() {
    const locParts = [street, postalCode, city, country].map((v) => v.trim()).filter(Boolean)
    const query = (locParts.length ? locParts : [company.trim()].filter(Boolean)).join(', ')
    onPickLocation?.({ query, onConfirm: (coords) => setCoordinates(coords) })
  }

  function submit() {
    if (!canSave) return
    const trimOrUndef = (v: string) => (v.trim() ? v.trim() : undefined)
    onSubmit({
      type,
      company: trimOrUndef(company),
      street: trimOrUndef(street),
      country: trimOrUndef(country),
      postalCode: trimOrUndef(postalCode),
      city: trimOrUndef(city),
      coordinates: trimOrUndef(coordinates),
      lat: coordParsed?.lat,
      lng: coordParsed?.lng,
      plannedAt: trimOrUndef(joinPlannedAt(plannedDate, plannedTime)),
      notes: trimOrUndef(notes),
    })
    if (editing) {
      onCancelEdit?.()
      return
    }
    reset()
    setPhase('idle')
  }

  // Idle — a single, theme-native trigger; no form until asked for (add only).
  if (phase === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setPhase('type')}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.04] py-2 text-[12.5px] text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
      >
        <Plus size={14} strokeWidth={2} /> Add stop
      </button>
    )
  }

  // Type picker — choose what kind of stop before any fields appear.
  if (phase === 'type') {
    return (
      <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.02] p-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">Choose stop type</span>
          <button
            type="button"
            onClick={() => (editing ? setPhase('form') : setPhase('idle'))}
            aria-label="Back"
            className="h-6 w-6 flex items-center justify-center rounded-full text-faint hover:text-text hover:bg-white/[0.05] transition-colors"
          >
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {STOP_TYPES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setType(o.value)
                setPhase('form')
              }}
              className="h-8 rounded-full border border-white/[0.06] bg-white/[0.04] text-[11.5px] text-text hover:bg-white/[0.09] transition-colors"
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Form — the stop's fields. The type is shown up top and can be changed (back to
  // the picker) without losing the typed details.
  return (
    <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.02] p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] font-medium text-text truncate">{labelOf(STOP_TYPES, type)}</span>
          <button
            type="button"
            onClick={() => setPhase('type')}
            className="shrink-0 text-[11px] text-muted hover:text-text transition-colors"
          >
            Change
          </button>
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label={editing ? 'Cancel editing stop' : 'Cancel adding stop'}
          className="h-6 w-6 flex items-center justify-center rounded-full text-faint hover:text-text hover:bg-white/[0.05] transition-colors"
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>

      {/* Planned date + time — two separate fields on one row, each with its own
          custom picker (calendar / clock). Field meaning lives in the placeholder
          to keep the form compact. */}
      <div className="flex gap-2">
        <DateField value={plannedDate} onChange={setPlannedDate} className="flex-1 min-w-0" />
        <TimeField value={plannedTime} onChange={setPlannedTime} className="w-[116px] shrink-0" />
      </div>
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        aria-label="Company name"
        placeholder="Enter company name..."
        className={INPUT_CLASS}
      />
      <input
        value={street}
        onChange={(e) => setStreet(e.target.value)}
        aria-label="Street name, number or industrial area"
        placeholder="Enter street name, number or industrial area..."
        className={INPUT_CLASS}
      />
      {/* Country / postal code / city — three fields on one row. Country is a
          short code (DE, IT, FR…), kept compact and centered. */}
      <div className="flex gap-2">
        <input
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase())}
          aria-label="Country code"
          placeholder="DE"
          maxLength={3}
          className={`${FIELD_BASE} w-[58px] shrink-0 !px-2 text-center uppercase placeholder:normal-case`}
        />
        <input
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          aria-label="Postal code"
          placeholder="Postal code"
          className={`${FIELD_BASE} flex-1 min-w-0`}
        />
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label="City"
          placeholder="City"
          className={`${FIELD_BASE} flex-[1.6] min-w-0`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <input
            value={coordinates}
            onChange={(e) => setCoordinates(e.target.value)}
            aria-label="Coordinates"
            placeholder="Enter coordinates..."
            className={`${FIELD_BASE} flex-1 min-w-0`}
          />
          {/* Open the in-chat map to find/confirm coordinates from the address.
              No automatic geocoding — only this explicit click opens the map. */}
          {onPickLocation && (
            <button
              type="button"
              onClick={pickOnMap}
              aria-label="Find coordinates on map"
              title="Find on map"
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.04] text-muted hover:text-text hover:bg-white/[0.08] transition-colors"
            >
              <MapPinned size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>
        {coordInvalid && (
          <span className="text-[10.5px] text-faint px-1">
            Couldn't read these coordinates — they'll be kept as typed.
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        aria-label="Notes"
        placeholder="Optional notes"
        className={AREA_CLASS}
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="h-8 px-3 inline-flex items-center rounded-full text-[12px] text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/[0.1] text-[12px] font-medium text-text hover:bg-white/[0.16] disabled:opacity-40 disabled:cursor-default transition-colors"
        >
          {editing ? 'Save stop' : (
            <>
              <Plus size={13} strokeWidth={2.2} /> Add stop
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// Compact read-only stop row in the Add-trip list, with edit + remove actions.
function StopCard({
  stop,
  onEdit,
  onRemove,
}: {
  stop: VehicleStop
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2">
      <span className="text-[12px] font-medium shrink-0">{labelOf(STOP_TYPES, stop.type)}</span>
      <span className="flex-1 min-w-0 truncate text-[12px] text-muted">
        {[stopLocationLabel(stop), stop.plannedAt].filter(Boolean).join(' · ') || '—'}
      </span>
      <button
        onClick={onEdit}
        aria-label="Edit stop"
        title="Edit stop"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-chip text-faint hover:text-text hover:bg-white/[0.04] transition-colors"
      >
        <Pencil size={13} strokeWidth={1.8} />
      </button>
      <button
        onClick={onRemove}
        aria-label="Remove stop"
        title="Remove stop"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-chip text-faint hover:text-alert hover:bg-white/[0.04] transition-colors"
      >
        <Trash2 size={13} strokeWidth={1.8} />
      </button>
    </div>
  )
}

// Field styling shared across the panel, matching the in-place editable rows
// (EditableRow): a soft rounded pill on a subtle dark fill, no heavy border, and
// a quiet brighten on focus. INPUT_CLASS for single-line inputs, AREA_CLASS for
// textareas.
// Base pill styling without a width, so inline fields (the country/postal/city
// row) can set their own flex/width. INPUT_CLASS is the full-width variant used
// by the standalone fields.
const FIELD_BASE =
  'rounded-full border border-white/[0.06] bg-white/[0.04] px-4 py-2 text-[12.5px] text-text placeholder:text-faint outline-none transition-colors focus:border-white/[0.12] focus:bg-white/[0.05]'

const INPUT_CLASS = `w-full ${FIELD_BASE}`

const AREA_CLASS =
  'w-full resize-none rounded-[18px] border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-[12.5px] text-text placeholder:text-faint outline-none transition-colors focus:border-white/[0.12] focus:bg-white/[0.05]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] text-text mb-1.5">{label}</label>
      {children}
    </div>
  )
}
