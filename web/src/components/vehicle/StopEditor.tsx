import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { DateField, TimeField, joinPlannedAt, splitPlannedAt } from '../DateTimeField'
import {
  STOP_STATUSES,
  STOP_TYPES,
  parseCoordinates,
  type StopStatus,
  type StopType,
  type VehicleStop,
} from '../../lib/vehicleOps'

// Integrated pill field styles — the shared trip-form set (tripFormStyles.ts),
// matching the inline EditableRow / DateTimeField look. Local aliases keep the
// JSX below readable.
import { AREA_CLASS, FIELD_BASE, INPUT_CLASS, SELECT_CLASS } from './tripFormStyles'

const PILL = INPUT_CLASS
const PILL_BASE = FIELD_BASE
const SELECT_PILL = SELECT_CLASS
const AREA_PILL = AREA_CLASS

// Add/edit a stop with the integrated pill-style fields. Holds its own draft and
// only calls onSave on confirm, so nothing is persisted until the user commits
// (no half-saved blank rows). Save/Cancel are the same circular icon buttons used
// by the inline trip fields. Editable: type, planned date/time, company, street,
// country/postal/city, coordinates, notes and status.
export default function StopEditor({
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
    !initial.country &&
    !initial.postalCode &&
    !initial.city &&
    !initial.coordinates &&
    !!initial.location
  // A stop with only the legacy combined `cityLine` (no split fields yet):
  // migrate that text into the City field so it stays editable and re-saves as
  // structured, mirroring how a legacy `location` migrates into Street.
  const cityLegacy =
    initial?.cityLine && !initial.country && !initial.postalCode && !initial.city
      ? initial.cityLine
      : ''
  const [type, setType] = useState<StopType>(initial?.type ?? 'other')
  const [status, setStatus] = useState<StopStatus>(initial?.status ?? 'planned')
  const [company, setCompany] = useState(initial?.company ?? '')
  const [street, setStreet] = useState(initial?.street ?? (legacyOnly ? initial!.location! : ''))
  const [country, setCountry] = useState(initial?.country ?? '')
  const [postalCode, setPostalCode] = useState(initial?.postalCode ?? '')
  const [city, setCity] = useState(initial?.city ?? cityLegacy)
  const [coordinates, setCoordinates] = useState(initial?.coordinates ?? '')
  const initialPlanned = splitPlannedAt(initial?.plannedAt)
  const [plannedDate, setPlannedDate] = useState(initialPlanned.date)
  const [plannedTime, setPlannedTime] = useState(initialPlanned.time)
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
        country: trimOrUndef(country),
        postalCode: trimOrUndef(postalCode),
        city: trimOrUndef(city),
        coordinates: trimOrUndef(coordinates),
        lat: coordParsed?.lat,
        lng: coordParsed?.lng,
        plannedAt: trimOrUndef(joinPlannedAt(plannedDate, plannedTime)),
        notes: trimOrUndef(notes),
      })
    } catch {
      setError(true)
      setSaving(false)
    }
  }

  return (
    <div className="rounded-soft border border-white/[0.12] bg-white/[0.03] p-2.5 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] text-muted">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as StopType)} className={SELECT_PILL}>
            {STOP_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] text-muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StopStatus)} className={SELECT_PILL}>
            {STOP_STATUSES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* Planned date + time — two separate pill fields, each with its own custom
          picker (calendar / clock). */}
      <div className="flex flex-col gap-1">
        <span className="text-[0.6875rem] text-muted">Planned date &amp; time</span>
        <div className="flex gap-2">
          <DateField value={plannedDate} onChange={setPlannedDate} className="flex-1 min-w-0" />
          <TimeField value={plannedTime} onChange={setPlannedTime} className="w-[7.25rem] shrink-0" />
        </div>
      </div>
      {/* Address fields — meaning lives in the placeholder (no visible label) to
          keep the editor compact; each input keeps an aria-label for a11y. */}
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        aria-label="Company name"
        placeholder="Enter company name..."
        className={PILL}
      />
      <input
        value={street}
        onChange={(e) => setStreet(e.target.value)}
        aria-label="Street name, number or industrial area"
        placeholder="Enter street name, number or industrial area..."
        className={PILL}
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
          className={`${PILL_BASE} w-[3.625rem] shrink-0 !px-2 text-center uppercase placeholder:normal-case`}
        />
        <input
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          aria-label="Postal code"
          placeholder="Postal code"
          className={`${PILL_BASE} flex-1 min-w-0`}
        />
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label="City"
          placeholder="City"
          className={`${PILL_BASE} flex-[1.6] min-w-0`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <input
          value={coordinates}
          onChange={(e) => setCoordinates(e.target.value)}
          aria-label="Coordinates"
          placeholder="Enter coordinates..."
          className={PILL}
        />
        {coordInvalid && (
          <span className="text-[0.65625rem] text-faint px-1">
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
        className={AREA_PILL}
      />
      {error && <div className="text-[0.6875rem] text-alert">Could not save. Try again.</div>}
      {/* Circular Save/Cancel — same integrated icon buttons as the inline fields. */}
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onCancel}
          disabled={saving}
          aria-label="Cancel"
          title="Cancel"
          className="h-8 w-8 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
        >
          <X size="0.875rem" strokeWidth={2} />
        </button>
        <button
          onClick={() => void commit()}
          disabled={saving}
          aria-label="Save stop"
          title="Save"
          className="h-8 w-8 flex items-center justify-center rounded-full bg-text text-bg hover:bg-text/90 disabled:opacity-50 transition-colors"
        >
          <Check size="0.875rem" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
