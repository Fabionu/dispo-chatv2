import { useState } from 'react'
import { MapPinned, Plus, X } from 'lucide-react'
import { DateField, TimeField, joinPlannedAt, splitPlannedAt } from '../DateTimeField'
import {
  STOP_TYPES,
  labelOf,
  parseCoordinates,
  type StopType,
  type VehicleStop,
} from '../../lib/vehicleOps'
import { AREA_CLASS, FIELD_BASE, INPUT_CLASS } from './tripFormStyles'

// Stop add/edit form. ADD mode starts as a single "Add stop" button → type
// picker → fields (nothing is pre-created). EDIT mode (when `initial` is given)
// opens straight to the pre-filled fields. Holds its own draft; a stop needs at
// least some place info to save (empty = noise).
export default function StopForm({
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
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.04] py-2 text-[0.78125rem] text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
      >
        <Plus size="0.875rem" strokeWidth={2} /> Add stop
      </button>
    )
  }

  // Type picker — choose what kind of stop before any fields appear.
  if (phase === 'type') {
    return (
      <div className="rounded-[1.125rem] border border-white/[0.06] bg-white/[0.02] p-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[0.6875rem] text-muted">Choose stop type</span>
          <button
            type="button"
            onClick={() => (editing ? setPhase('form') : setPhase('idle'))}
            aria-label="Back"
            className="h-6 w-6 flex items-center justify-center rounded-full text-faint hover:text-text hover:bg-white/[0.05] transition-colors"
          >
            <X size="0.8125rem" strokeWidth={1.8} />
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
              className="h-8 rounded-full border border-white/[0.06] bg-white/[0.04] text-[0.71875rem] text-text hover:bg-white/[0.09] transition-colors"
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
    <div className="rounded-[1.125rem] border border-white/[0.06] bg-white/[0.02] p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[0.75rem] font-medium text-text truncate">{labelOf(STOP_TYPES, type)}</span>
          <button
            type="button"
            onClick={() => setPhase('type')}
            className="shrink-0 text-[0.6875rem] text-muted hover:text-text transition-colors"
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
          <X size="0.8125rem" strokeWidth={1.8} />
        </button>
      </div>

      {/* Planned date + time — two separate fields on one row, each with its own
          custom picker (calendar / clock). Field meaning lives in the placeholder
          to keep the form compact. */}
      <div className="flex gap-2">
        <DateField value={plannedDate} onChange={setPlannedDate} className="flex-1 min-w-0" />
        <TimeField value={plannedTime} onChange={setPlannedTime} className="w-[7.25rem] shrink-0" />
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
          className={`${FIELD_BASE} w-[3.625rem] shrink-0 !px-2 text-center uppercase placeholder:normal-case`}
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
              <MapPinned size="1rem" strokeWidth={1.8} />
            </button>
          )}
        </div>
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
        className={AREA_CLASS}
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="h-8 px-3 inline-flex items-center rounded-full text-[0.75rem] text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSave}
          className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/[0.1] text-[0.75rem] font-medium text-text hover:bg-white/[0.16] disabled:opacity-40 disabled:cursor-default transition-colors"
        >
          {editing ? 'Save stop' : (
            <>
              <Plus size="0.8125rem" strokeWidth={2.2} /> Add stop
            </>
          )}
        </button>
      </div>
    </div>
  )
}
