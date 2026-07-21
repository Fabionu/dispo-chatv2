import { useMemo, useState } from 'react'
import {
  Building2,
  CircleParking,
  Fuel,
  Landmark,
  MapPin,
  Search,
  ShieldCheck,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react'
import type { WorkspacePlace, WorkspacePlaceCategory } from '../../lib/types'
import { PLACE_CATEGORIES, PLACE_CATEGORY_COLOR, PLACE_CATEGORY_LABEL } from '../../lib/savedPlaces'

type Props = {
  places: WorkspacePlace[]
  loading: boolean
  error: string | null
  onClose: () => void
  onSelect: (place: WorkspacePlace) => void
}

export function SavedPlaceIcon({ category, size = 15 }: { category: WorkspacePlaceCategory; size?: number }) {
  const props = { size, strokeWidth: 1.9 }
  if (category === 'parking') return <CircleParking {...props} />
  if (category === 'depot') return <Warehouse {...props} />
  if (category === 'fuel') return <Fuel {...props} />
  if (category === 'customer') return <Building2 {...props} />
  if (category === 'service') return <Wrench {...props} />
  if (category === 'customs') return <ShieldCheck {...props} />
  return <Landmark {...props} />
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
    <section className="absolute z-20 top-[3.25rem] right-3 flex max-h-[calc(100%-4rem)] w-[18rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-panel border border-white/[0.08] bg-rail shadow-[0_8px_24px_rgba(0,0,0,0.34)]">
      <header className="flex items-center justify-between px-3.5 py-2.5">
        <div>
          <div className="text-[0.8125rem] font-semibold">Saved places</div>
          <div className="mt-0.5 text-[0.625rem] text-faint">Right-click the map to add one</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close saved places"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
        >
          <X size="0.9375rem" strokeWidth={1.9} />
        </button>
      </header>

      <div className="grid grid-cols-[1fr_auto] gap-1.5 border-y border-white/[0.06] px-2.5 py-2">
        <label className="flex h-8 min-w-0 items-center gap-2 rounded-full bg-white/[0.045] px-3 focus-within:ring-1 focus-within:ring-white/20">
          <Search size="0.8125rem" className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places"
            className="min-w-0 flex-1 bg-transparent text-[0.71875rem] text-text outline-none placeholder:text-faint"
          />
        </label>
        <select
          aria-label="Filter saved places"
          value={category}
          onChange={(event) => setCategory(event.target.value as WorkspacePlaceCategory | 'all')}
          className="h-8 max-w-[6.5rem] rounded-full border border-white/[0.08] bg-surface px-2.5 text-[0.6875rem] text-muted outline-none focus:border-white/20"
        >
          <option value="all">All</option>
          {PLACE_CATEGORIES.map((item) => (
            <option key={item} value={item}>{PLACE_CATEGORY_LABEL[item]}</option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="px-2 py-6 text-center text-[0.71875rem] text-muted">Loading places…</div>
        ) : error ? (
          <div className="px-2 py-6 text-center text-[0.71875rem] text-alert">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-7 text-center">
            <MapPin size="1.25rem" strokeWidth={1.5} className="mb-2 text-faint" />
            <div className="text-[0.75rem] font-medium text-muted">
              {places.length === 0 ? 'No saved places yet' : 'No matching places'}
            </div>
            {places.length === 0 && (
              <div className="mt-1 text-[0.65625rem] leading-snug text-faint">
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
                className="group flex w-full items-center gap-2.5 rounded-card px-2.5 py-2 text-left transition-colors hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08]"
                  style={{ color: PLACE_CATEGORY_COLOR[place.category], backgroundColor: `${PLACE_CATEGORY_COLOR[place.category]}16` }}
                >
                  <SavedPlaceIcon category={place.category} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.75rem] font-medium text-text">{place.name}</span>
                  <span className="mt-0.5 block truncate text-[0.65625rem] text-muted">
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
