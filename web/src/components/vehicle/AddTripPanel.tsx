import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'
import { stopId, tripId, type VehicleOps, type VehicleStop } from '../../lib/vehicleOps'
import StopForm from './StopForm'
import AddTripStopCard from './AddTripStopCard'
import { AREA_CLASS, INPUT_CLASS } from './tripFormStyles'

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
        // Fresh id so the mobile driver API can address this trip (drivers are
        // assigned afterward from the Trip tab, keeping creation lean).
        id: tripId(),
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
        className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-[25rem] shadow-[-16px_0_48px_rgba(0,0,0,0.4)] bg-rail flex flex-col
                   xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0 xl:shadow-none
                   xl:rounded-panel xl:overflow-hidden"
      >
        {/* Header — same height as the chat header so the two line up. */}
        <div className="h-[var(--header-height)] flex items-center justify-between px-4 shrink-0">
          <span className="text-[0.8125rem] font-semibold">Add trip</span>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close add trip"
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
          <p className="text-[0.71875rem] text-muted leading-[1.45]">
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
                    <AddTripStopCard
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

          {error && <div className="text-[0.75rem] text-alert">{error}</div>}
        </div>

        {/* Footer action area — sits on the panel's rail surface, no divider. */}
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 py-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[0.78125rem] text-muted hover:text-text border border-white/[0.12] rounded-btn px-3 py-1.5 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="text-[0.78125rem] font-semibold bg-text text-bg rounded-btn px-3.5 py-1.5 hover:bg-text/90 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create trip'}
          </button>
        </div>
      </aside>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[0.75rem] text-text mb-1.5">{label}</label>
      {children}
    </div>
  )
}
