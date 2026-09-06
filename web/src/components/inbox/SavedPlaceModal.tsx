import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import type { WorkspacePlace, WorkspacePlaceCategory, WorkspacePlaceInput } from '../../lib/types'
import { PLACE_CATEGORIES, PLACE_CATEGORY_LABEL } from '../../lib/savedPlaces'
import { fieldClass } from '../forms/fieldStyles'

type Props = {
  place?: WorkspacePlace | null
  coordinates: { lat: number; lng: number }
  address?: string | null
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: WorkspacePlaceInput) => void
}

// The app's ONE field recipe, not a local one. This modal used to declare its
// own (`h-10 … border border-line …`), which is how it ended up as the last
// square-cornered form in the app after everything else was rounded — and why
// the notes box below carried a comment explaining that it had been squared to
// match. Nothing to match any more: both are `fieldClass()`.
const FIELD = fieldClass()

export default function SavedPlaceModal({ place, coordinates, address, saving, error, onClose, onSave }: Props) {
  const [name, setName] = useState(place?.name ?? '')
  const [category, setCategory] = useState<WorkspacePlaceCategory>(place?.category ?? 'parking')
  const [placeAddress, setPlaceAddress] = useState(place?.address ?? address ?? '')
  const [street, setStreet] = useState(place?.street ?? '')
  const [country, setCountry] = useState(place?.country ?? '')
  const [postalCode, setPostalCode] = useState(place?.postalCode ?? '')
  const [city, setCity] = useState(place?.city ?? '')
  const [notes, setNotes] = useState(place?.notes ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    const trimOrNull = (value: string) => value.trim() || null
    onSave({
      name: name.trim(),
      category,
      address: trimOrNull(placeAddress),
      street: trimOrNull(street),
      country: trimOrNull(country),
      postalCode: trimOrNull(postalCode),
      city: trimOrNull(city),
      latitude: coordinates.lat,
      longitude: coordinates.lng,
      notes: trimOrNull(notes),
    })
  }

  return (
    <Modal
      title={place ? 'Edit saved place' : 'Save this place'}
      subtitle="Available to everyone in this workspace."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-btn px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/6 hover:text-text disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" form="saved-place-form" disabled={!name.trim() || saving} className="rounded-btn bg-text px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-text/90 disabled:opacity-40">
            {saving ? 'Saving…' : place ? 'Save changes' : 'Save place'}
          </button>
        </>
      }
    >
      <form id="saved-place-form" onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. Linz night parking" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as WorkspacePlaceCategory)} className={FIELD}>
            {PLACE_CATEGORIES.map((item) => <option key={item} value={item}>{PLACE_CATEGORY_LABEL[item]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Address label</span>
          <input value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} maxLength={240} placeholder="Address or location details" className={FIELD} />
        </label>

        {/* The address, in the SAME four boxes a stop keeps it in. That is the
            whole reason they exist: a place is picked while adding a stop, and a
            stop stores street / country / postal code / city apart. Storing one
            line here and splitting it there would mean guessing which comma is
            which, and a wrong guess writes a wrong address into an operational
            record without anyone seeing it happen.

            All four are optional. A parking pinned on a motorway shoulder has no
            postal code, and being made to invent one would be worse than an
            empty box. */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            Street <span className="font-normal text-faint">(optional)</span>
          </span>
          <input value={street} onChange={(event) => setStreet(event.target.value)} maxLength={160} placeholder="Street name, number or industrial area" className={FIELD} />
        </label>
        <div className="flex gap-2">
          <label className="flex shrink-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Country</span>
            {/* Same compact, centred, uppercase box as the stop form's — the two
                fields hold the same 2–3 letter code and should not look like
                different questions. */}
            <input
              value={country}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
              maxLength={3}
              placeholder="DE"
              className={`${fieldClass({ fullWidth: false })} w-[4.5rem] text-center uppercase placeholder:normal-case`}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Postal code</span>
            <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} maxLength={16} placeholder="57010" className={FIELD} />
          </label>
          <label className="flex min-w-0 flex-[1.6] flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">City</span>
            <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} placeholder="Tremery" className={FIELD} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Notes <span className="font-normal text-faint">(optional)</span></span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={3} placeholder="Access instructions, opening hours…" className={`${fieldClass({ multiline: true })} resize-none leading-relaxed`} />
        </label>
        <div className="rounded-card border border-line px-3 py-2 text-xs tabular-nums text-faint">
          {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
        </div>
        {error && <div className="text-sm text-alert">{error}</div>}
      </form>
    </Modal>
  )
}
