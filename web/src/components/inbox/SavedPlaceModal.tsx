import { useState, type FormEvent } from 'react'
import Modal from '../Modal'
import type { WorkspacePlace, WorkspacePlaceCategory, WorkspacePlaceInput } from '../../lib/types'
import { PLACE_CATEGORIES, PLACE_CATEGORY_LABEL } from '../../lib/savedPlaces'

type Props = {
  place?: WorkspacePlace | null
  coordinates: { lat: number; lng: number }
  address?: string | null
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: WorkspacePlaceInput) => void
}

const FIELD = 'h-10 w-full border border-line bg-transparent px-3 text-sm text-text outline-none transition-colors placeholder:text-faint hover:border-line-2 focus:border-line-2 focus:bg-white/4'

export default function SavedPlaceModal({ place, coordinates, address, saving, error, onClose, onSave }: Props) {
  const [name, setName] = useState(place?.name ?? '')
  const [category, setCategory] = useState<WorkspacePlaceCategory>(place?.category ?? 'parking')
  const [placeAddress, setPlaceAddress] = useState(place?.address ?? address ?? '')
  const [notes, setNotes] = useState(place?.notes ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    onSave({
      name: name.trim(),
      category,
      address: placeAddress.trim() || null,
      latitude: coordinates.lat,
      longitude: coordinates.lng,
      notes: notes.trim() || null,
    })
  }

  return (
    <Modal
      title={place ? 'Edit saved place' : 'Save this place'}
      subtitle="Available to everyone in this workspace."
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className=" px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/6 hover:text-text disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" form="saved-place-form" disabled={!name.trim() || saving} className="bg-text px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-text/90 disabled:opacity-40">
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
          <span className="text-xs font-medium text-muted">Address</span>
          <input value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} maxLength={240} placeholder="Address or location details" className={FIELD} />
        </label>
        {/* The notes box is a FIELD, so it stays square with the `FIELD` inputs
            above it. It used to carry `rounded-soft`, which was harmless while
            that token was 0 and became visible on 2026-09-03 when `soft` was
            given the chrome radius — it was briefly the only rounded input in
            the modal. `soft` means a drawn PLATE (a tool card, a route point,
            a stop editor), and a multi-line input is not one. */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Notes <span className="font-normal text-faint">(optional)</span></span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={3} placeholder="Access instructions, opening hours…" className="w-full resize-none border border-line bg-white/4 px-3.5 py-2.5 text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-faint focus:border-line-2 focus:bg-white/6" />
        </label>
        <div className="border border-line px-3 py-2 text-xs tabular-nums text-faint">
          {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
        </div>
        {error && <div className="text-sm text-alert">{error}</div>}
      </form>
    </Modal>
  )
}
