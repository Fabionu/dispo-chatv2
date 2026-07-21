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

const FIELD = 'h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 text-[0.75rem] text-text outline-none transition-colors placeholder:text-faint focus:border-white/20 focus:bg-white/[0.055]'

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
          <button type="button" onClick={onClose} disabled={saving} className="rounded-full px-3.5 py-2 text-[0.75rem] font-medium text-muted transition-colors hover:bg-white/[0.05] hover:text-text disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" form="saved-place-form" disabled={!name.trim() || saving} className="rounded-full bg-text px-4 py-2 text-[0.75rem] font-semibold text-bg transition-colors hover:bg-text/90 disabled:opacity-40">
            {saving ? 'Saving…' : place ? 'Save changes' : 'Save place'}
          </button>
        </>
      }
    >
      <form id="saved-place-form" onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium text-muted">Name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. Linz night parking" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium text-muted">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as WorkspacePlaceCategory)} className={FIELD}>
            {PLACE_CATEGORIES.map((item) => <option key={item} value={item}>{PLACE_CATEGORY_LABEL[item]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium text-muted">Address</span>
          <input value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} maxLength={240} placeholder="Address or location details" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium text-muted">Notes <span className="font-normal text-faint">(optional)</span></span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={3} placeholder="Access instructions, opening hours…" className="w-full resize-none rounded-soft border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-text outline-none transition-colors placeholder:text-faint focus:border-white/20 focus:bg-white/[0.055]" />
        </label>
        <div className="rounded-full bg-white/[0.035] px-3.5 py-2 text-[0.65625rem] tabular-nums text-faint">
          {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
        </div>
        {error && <div className="text-[0.71875rem] text-alert">{error}</div>}
      </form>
    </Modal>
  )
}
