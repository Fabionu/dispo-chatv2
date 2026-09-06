import { useMemo, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import type { WorkspacePlace, WorkspacePlaceCategory } from '../../lib/types'
import { rem } from '../../lib/density'
import {
  PLACE_CATEGORIES,
  PLACE_CATEGORY_COLOR,
  PLACE_CATEGORY_GLYPH,
  PLACE_CATEGORY_LABEL,
} from '../../lib/savedPlaces'

type Props = {
  places: WorkspacePlace[]
  loading: boolean
  error: string | null
  onClose: () => void
  onSelect: (place: WorkspacePlace) => void
}

// The saved-place mark, as it is drawn on the map: a solid square of category
// ink with a single white glyph (see here/hereMapIcons savedPlaceIconFor).
//
// It is the SAME mark here on purpose. This list is the map's legend, and a
// legend that draws its own thing — the swatch used to be a lucide pictogram in
// the category colour on a 16%-alpha tint — teaches nothing about the pins the
// user is actually looking at. Learning "blue P" once now works in both places.
//
// The block carries its own ground, so it needs no border and no theme-aware
// tint: it reads identically on the black field and the white one, which is
// what the old tinted swatch could not do.
export function PlaceMark({
  category,
  size = 32,
}: {
  category: WorkspacePlaceCategory
  size?: number
}) {
  return (
    <span
      title={PLACE_CATEGORY_LABEL[category]}
      aria-label={PLACE_CATEGORY_LABEL[category]}
      role="img"
      className="shrink-0 inline-flex items-center justify-center font-semibold leading-none text-pure-white"
      style={{
        // Design px through `rem()`, not raw px: the mark then tracks --ui-scale
        // with the rest of the panel's chrome instead of staying 32 physical
        // pixels while everything around it grows on a 4K display. Numeric prop,
        // rem output — the convention lib/density.ts documents.
        width: rem(size),
        height: rem(size),
        // The glyph rides at ~40% of the box, the same proportion it holds in
        // the 18px map pin, so passing a size scales the whole mark rather than
        // leaving a fixed glyph rattling inside a bigger square.
        fontSize: rem(Math.round(size * 0.4)),
        backgroundColor: PLACE_CATEGORY_COLOR[category],
      }}
    >
      {PLACE_CATEGORY_GLYPH[category]}
    </span>
  )
}

export default function SavedPlacesPanel({ places, loading, error, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<WorkspacePlaceCategory | 'all'>('all')
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return places.filter((place) => {
      if (category !== 'all' && place.category !== category) return false
      if (!q) return true
      return `${place.name} ${place.address ?? ''} ${place.notes ?? ''}`.toLocaleLowerCase().includes(q)
    })
  }, [places, query, category])

  return (
    <section className="absolute z-20 top-[3.25rem] right-3 flex max-h-[calc(100%-4rem)] w-[18rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
      <header className="flex items-center justify-between px-3.5 py-2.5">
        <div>
          <div className="eyebrow">Saved places</div>
          <div className="mt-1 text-xs text-faint">Right-click the map to add one</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close saved places"
          className="rounded-btn flex h-7 w-7 items-center justify-center text-muted transition-colors hover:bg-white/6 hover:text-text"
        >
          <X size="0.9375rem" strokeWidth={1.9} />
        </button>
      </header>

      <div className="grid grid-cols-[1fr_auto] gap-1.5 border-y border-line px-2.5 py-2">
        <label className="flex h-8 min-w-0 items-center gap-2 rounded-btn border border-line px-2.5 transition-colors focus-within:border-line-2">
          <Search size="0.8125rem" className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint"
          />
        </label>
        <select
          aria-label="Filter saved places"
          value={category}
          onChange={(event) => setCategory(event.target.value as WorkspacePlaceCategory | 'all')}
          className="h-8 max-w-[6.5rem] rounded-btn border border-line bg-transparent px-2.5 text-xs text-muted outline-none transition-colors hover:border-line-2 focus:border-line-2"
        >
          <option value="all">All</option>
          {PLACE_CATEGORIES.map((item) => (
            <option key={item} value={item}>{PLACE_CATEGORY_LABEL[item]}</option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="px-2 py-6 text-center text-sm text-muted">Loading places…</div>
        ) : error ? (
          <div className="px-2 py-6 text-center text-sm text-alert">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-7 text-center">
            <MapPin size="1.25rem" strokeWidth={1.5} className="mb-2 text-faint" />
            <div className="text-sm font-medium text-muted">
              {places.length === 0 ? 'No saved places yet' : 'No matching places'}
            </div>
            {places.length === 0 && (
              <div className="mt-1 text-xs leading-snug text-faint">
                Right-click a parking, depot or fuel station on the map.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => onSelect(place)}
                className="group flex w-full items-center gap-2.5 rounded-btn px-2.5 py-2 text-left transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              >
                <PlaceMark category={place.category} />
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
    </section>
  )
}
