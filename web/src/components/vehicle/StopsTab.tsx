import { useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { StatusChip } from './opsControls'
import {
  STOP_STATUSES,
  STOP_TYPES,
  labelOf,
  parseCoordinates,
  stopId,
  stopStatusTone,
  type StopStatus,
  type StopType,
  type VehicleStop,
} from '../../lib/vehicleOps'

type Props = {
  stops: VehicleStop[]
  canManage: boolean
  // Persist the full, reordered/edited stop list.
  onSaveStops: (next: VehicleStop[]) => Promise<void>
}

// Stops tab: manual stops for the active trip (fuel, break, customs, …). A clean
// compact list; managers add/edit/remove. Editing uses a local draft form so a
// stop is only persisted on Save (no half-saved blank rows). Purely manual — no
// map picker or coordinates.
export default function StopsTab({ stops, canManage, onSaveStops }: Props) {
  // Which stop is being edited: an id, 'new' for the add form, or null.
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  async function addStop(draft: Omit<VehicleStop, 'id'>) {
    await onSaveStops([...stops, { ...draft, id: stopId() }])
    setEditing(null)
  }
  async function updateStop(id: string, draft: Omit<VehicleStop, 'id'>) {
    await onSaveStops(stops.map((s) => (s.id === id ? { ...draft, id } : s)))
    setEditing(null)
  }
  async function removeStop(id: string) {
    await onSaveStops(stops.filter((s) => s.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">Stops{stops.length ? ` · ${stops.length}` : ''}</span>
        {canManage && editing !== 'new' && (
          <button
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-text transition-colors"
          >
            <Plus size={12} strokeWidth={1.8} /> Add stop
          </button>
        )}
      </div>

      {editing === 'new' && (
        <StopEditor onCancel={() => setEditing(null)} onSave={addStop} />
      )}

      {stops.length === 0 && editing !== 'new' ? (
        <div className="text-[12px] text-faint py-4 text-center">No stops yet.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {stops.map((stop) =>
            editing === stop.id ? (
              <StopEditor
                key={stop.id}
                initial={stop}
                onCancel={() => setEditing(null)}
                onSave={(draft) => updateStop(stop.id, draft)}
              />
            ) : (
              <StopRow
                key={stop.id}
                stop={stop}
                canManage={canManage}
                onEdit={() => setEditing(stop.id)}
                onRemove={() => void removeStop(stop.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

// One compact, read-only stop row: type + status chip on top, then location and
// planned time, with manage actions revealed on hover.
function StopRow({
  stop,
  canManage,
  onEdit,
  onRemove,
}: {
  stop: VehicleStop
  canManage: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="group rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium">{labelOf(STOP_TYPES, stop.type)}</span>
        <StatusChip tone={stopStatusTone(stop.status)} label={labelOf(STOP_STATUSES, stop.status)} />
        <div className="flex-1" />
        {canManage && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={onEdit}
              aria-label="Edit stop"
              title="Edit stop"
              className="h-6 w-6 flex items-center justify-center rounded-chip text-faint hover:text-text hover:bg-white/[0.04] transition-colors"
            >
              <Pencil size={12} strokeWidth={1.8} />
            </button>
            <button
              onClick={onRemove}
              aria-label="Remove stop"
              title="Remove stop"
              className="h-6 w-6 flex items-center justify-center rounded-chip text-faint hover:text-alert hover:bg-white/[0.04] transition-colors"
            >
              <Trash2 size={12} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>
      {(() => {
        // Structured address lines, falling back to the legacy single-line
        // `location` for stops created before the structured fields existed.
        const lines = [stop.company, stop.street, stop.cityLine]
          .map((v) => v?.trim())
          .filter((v): v is string => Boolean(v))
        if (lines.length === 0 && stop.location?.trim()) lines.push(stop.location.trim())
        return lines.length > 0 ? (
          <div className="mt-1 space-y-0.5">
            {lines.map((l, i) => (
              <div key={i} className="text-[12px] text-text break-words">
                {l}
              </div>
            ))}
          </div>
        ) : null
      })()}
      {stop.coordinates && (
        <div className="text-[11px] text-muted mt-0.5 break-words">{stop.coordinates}</div>
      )}
      {stop.plannedAt && <div className="text-[11px] text-muted mt-0.5">{stop.plannedAt}</div>}
      {stop.notes && <div className="text-[11px] text-faint mt-0.5 break-words">{stop.notes}</div>}
    </div>
  )
}

// Local draft editor for adding or editing a stop. Holds its own form state and
// only calls onSave on confirm, so nothing is persisted until the user commits.
function StopEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial?: VehicleStop
  onCancel: () => void
  onSave: (draft: Omit<VehicleStop, 'id'>) => Promise<void>
}) {
  // A stop with no structured fields yet but a legacy `location` — migrate that
  // text into the Street field so it stays editable and isn't lost on save.
  const legacyOnly =
    !!initial &&
    !initial.company &&
    !initial.street &&
    !initial.cityLine &&
    !initial.coordinates &&
    !!initial.location
  const [type, setType] = useState<StopType>(initial?.type ?? 'other')
  const [status, setStatus] = useState<StopStatus>(initial?.status ?? 'planned')
  const [company, setCompany] = useState(initial?.company ?? '')
  const [street, setStreet] = useState(initial?.street ?? (legacyOnly ? initial!.location! : ''))
  const [cityLine, setCityLine] = useState(initial?.cityLine ?? '')
  const [coordinates, setCoordinates] = useState(initial?.coordinates ?? '')
  const [plannedAt, setPlannedAt] = useState(initial?.plannedAt ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  const coordParsed = parseCoordinates(coordinates)
  const coordInvalid = coordinates.trim().length > 0 && !coordParsed

  async function commit() {
    setSaving(true)
    setError(false)
    const trimOrUndef = (v: string) => (v.trim() ? v.trim() : undefined)
    try {
      // Legacy `location` is intentionally not re-saved: its text was migrated
      // into the structured fields above, so the stop ends up fully structured.
      await onSave({
        type,
        status,
        company: trimOrUndef(company),
        street: trimOrUndef(street),
        cityLine: trimOrUndef(cityLine),
        coordinates: trimOrUndef(coordinates),
        lat: coordParsed?.lat,
        lng: coordParsed?.lng,
        plannedAt: trimOrUndef(plannedAt),
        notes: trimOrUndef(notes),
      })
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  const selectClass =
    'h-8 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-2 text-[12.5px] text-text outline-none focus:border-white/[0.25]'

  return (
    <div className="rounded-lg border border-white/[0.12] bg-white/[0.03] p-2.5 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as StopType)} className={selectClass}>
            {STOP_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StopStatus)} className={selectClass}>
            {STOP_STATUSES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* Address fields — meaning lives in the placeholder (no visible label) to
          keep the editor compact; each input keeps an aria-label for a11y. */}
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
        <span className="text-[11px] text-muted">Planned time</span>
        <input
          value={plannedAt}
          onChange={(e) => setPlannedAt(e.target.value)}
          placeholder="e.g. 18 Jun, 12:30"
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
      {error && <div className="text-[11px] text-alert">Could not save. Try again.</div>}
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onCancel}
          disabled={saving}
          className="h-8 px-3 inline-flex items-center gap-1 rounded-btn border border-white/[0.12] text-[12px] text-muted hover:text-text hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
        >
          <X size={13} strokeWidth={2} /> Cancel
        </button>
        <button
          onClick={() => void commit()}
          disabled={saving}
          className="h-8 px-3 inline-flex items-center gap-1 rounded-btn bg-text text-bg text-[12px] font-semibold hover:bg-text/90 disabled:opacity-50 transition-colors"
        >
          <Check size={13} strokeWidth={2.2} /> Save
        </button>
      </div>
    </div>
  )
}
