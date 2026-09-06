import { useMemo, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { useWorkspacePlaces } from '../../hooks/useWorkspacePlaces'
import { PLACE_CATEGORY_LABEL } from '../../lib/savedPlaces'
// The SAME mark the map draws and the Route planner's Places list draws. The
// panel that owns it argues the point already: a legend that invents its own
// swatch teaches nothing about the pins on the map. A stop form is a third place
// the user meets a saved place, and it has no more right to redraw it than the
// legend did.
import { PlaceMark } from '../inbox/SavedPlacesPanel'
import type { WorkspacePlace } from '../../lib/types'

// A saved place, in the shape a stop stores an address.
//
// A place now keeps street / country / postal code / city apart, exactly as a
// stop does (migration 0033), so this is a field-for-field copy rather than a
// guess. That was the point of changing how places are stored: the alternative
// was splitting the one-line `address` on its commas here, and a wrong split
// writes a wrong address into an operational record silently.
//
// FALLBACK for places saved before the split, which have only that line: it goes
// to Street, where it is at least visible and editable, and the three fields
// nobody can derive stay empty rather than being filled with a guess.
export type PlaceStopFields = {
  company: string
  street: string
  country: string
  postalCode: string
  city: string
  coordinates: string
}

export function stopFieldsFromPlace(place: WorkspacePlace): PlaceStopFields {
  const structured = place.street || place.country || place.postalCode || place.city
  return {
    company: place.name,
    street: (structured ? place.street : place.address)?.trim() ?? '',
    country: place.country?.trim() ?? '',
    postalCode: place.postalCode?.trim() ?? '',
    city: place.city?.trim() ?? '',
    // Six decimals ≈ 0.1 m. `parseCoordinates` reads this back, so the stop ends
    // up with lat/lng set and is immediately routable.
    coordinates: `${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}`,
  }
}

// Pick a saved workspace place instead of retyping it.
//
// Mounted only while open, which is also how it loads: `useWorkspacePlaces`
// fetches on mount, so a dispatcher who never opens the picker never pays for
// the request — and one who does gets a list that is current rather than one
// cached since the panel opened.
export default function SavedPlacePicker({
  onPick,
  onClose,
}: {
  onPick: (place: WorkspacePlace) => void
  onClose: () => void
}) {
  const { places, loading, error } = useWorkspacePlaces()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return places
    return places.filter((place) =>
      `${place.name} ${place.address ?? ''} ${PLACE_CATEGORY_LABEL[place.category]}`
        .toLocaleLowerCase()
        .includes(q),
    )
  }, [places, query])

  return (
    <div className="rounded-soft border border-line bg-white/2 p-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-btn border border-line px-2.5 transition-colors focus-within:border-line-2">
          <Search size="0.8125rem" className="shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved places"
            aria-label="Search saved places"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
          />
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close saved places"
          className="rounded-btn h-6 w-6 shrink-0 flex items-center justify-center text-faint hover:text-text hover:bg-white/6 transition-colors"
        >
          <X size="0.8125rem" strokeWidth={1.8} />
        </button>
      </div>

      {loading ? (
        <div className="py-5 text-center text-sm text-muted">Loading places…</div>
      ) : error ? (
        <div className="py-5 text-center text-sm text-alert">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center px-3 py-5 text-center">
          <MapPin size="1.125rem" strokeWidth={1.5} className="mb-1.5 text-faint" />
          <div className="text-sm text-muted">
            {places.length === 0 ? 'No saved places yet' : 'No matching places'}
          </div>
          {places.length === 0 && (
            // Places are created from the map, not from here. Saying where keeps
            // this from being a dead end for someone who has never made one.
            <div className="mt-1 text-xs leading-snug text-faint">
              Right-click a location on the Route planner map to save one.
            </div>
          )}
        </div>
      ) : (
        // Capped and scrollable: the list is inside a stop form inside a drawer,
        // and an unbounded one would push Save off the bottom of the panel.
        <div className="flex max-h-[13rem] flex-col gap-1 overflow-y-auto">
          {filtered.map((place) => (
            <button
              key={place.id}
              type="button"
              onClick={() => onPick(place)}
              className="group flex w-full items-center gap-2.5 rounded-btn px-1.5 py-1.5 text-left transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
            >
              <PlaceMark category={place.category} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">{place.name}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {place.address || PLACE_CATEGORY_LABEL[place.category]}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
