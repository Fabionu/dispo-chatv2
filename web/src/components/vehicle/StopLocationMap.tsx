import { useEffect, useState } from 'react'
import { Check, MapPin, Search, X } from 'lucide-react'
import { api } from '../../lib/api'
import { looksLikeCoordPair, parseLatLng } from '../../lib/here/geo'
import type { HerePlace, LatLng } from '../../lib/here/types'
import HereMap from '../here/HereMap'

type Props = {
  // Seed query composed from the stop's address fields (may be empty).
  initialQuery: string
  // Called with a canonical "lat, lng" string when the user confirms.
  onConfirm: (coords: string) => void
  // Close without changing anything.
  onCancel: () => void
}

// Wrap a raw coordinate as a HerePlace so picking it follows the same path as a
// search result (the confirm reads `position`).
function coordPlace(c: LatLng): HerePlace {
  const text = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
  return { id: `coord:${c.lat},${c.lng}`, title: text, label: text, position: c }
}

function coordText(c: LatLng): string {
  return `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
}

// In-chat map tool for picking ONE stop's coordinates. Opens seeded with the
// stop's address, searches it via HERE Discover, and lets the user pick a
// result, type a "lat, lng" pair, or right-click the map to drop a pin — then
// confirm, which writes "lat, lng" back into that stop's field. Reuses HereMap
// for the pin. Never auto-confirms and never geocodes on its own.
export default function StopLocationMap({ initialQuery, onConfirm, onCancel }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [items, setItems] = useState<HerePlace[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<HerePlace | null>(null)

  // Debounced address search. A coordinate pair is parsed locally and never sent
  // to address search; a selected value short-circuits searching.
  useEffect(() => {
    if (selected) return
    const q = query.trim()
    if (looksLikeCoordPair(q) || q.length < 3) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await api.here.search(q)
        if (!cancelled) setItems(res.items)
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, selected])

  const trimmed = query.trim()
  const coord = !selected && looksLikeCoordPair(trimmed) ? parseLatLng(trimmed) : null

  function pick(place: HerePlace) {
    setSelected(place)
    setItems([])
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Search bar */}
      <div className="shrink-0 px-3 pt-2.5 pb-1.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.04] px-3.5 h-10 transition-colors focus-within:border-white/[0.12]">
          {selected ? (
            <MapPin size="0.9375rem" strokeWidth={1.8} className="shrink-0 text-active" />
          ) : (
            <Search size="0.9375rem" strokeWidth={1.8} className="shrink-0 text-faint" />
          )}
          {selected ? (
            <>
              <span className="flex-1 truncate text-[0.8125rem]" title={selected.label}>
                {selected.label || selected.title}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Search again"
                className="shrink-0 text-muted hover:text-text transition-colors"
              >
                <X size="0.9375rem" strokeWidth={2} />
              </button>
            </>
          ) : (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && coord) pick(coordPlace(coord))
              }}
              placeholder="Search address, place, or lat, lng…"
              className="flex-1 min-w-0 bg-transparent text-[0.8125rem] outline-none placeholder:text-faint"
            />
          )}
        </div>

        {/* Coordinate option / results / gentle hint */}
        {!selected && coord && (
          <button
            type="button"
            onClick={() => pick(coordPlace(coord))}
            className="w-full text-left rounded-soft border border-white/[0.06] bg-rail px-3 py-2 hover:bg-white/[0.05] transition-colors flex items-start gap-2"
          >
            <MapPin size="0.875rem" className="mt-0.5 shrink-0 text-active" strokeWidth={1.8} />
            <span className="min-w-0">
              <span className="block text-[0.8125rem]">Go to coordinates</span>
              <span className="block text-[0.6875rem] text-muted tabular-nums">{coordText(coord)}</span>
            </span>
          </button>
        )}
        {!selected && !coord && (loading || items.length > 0) && (
          <div className="rounded-soft border border-white/[0.06] bg-rail overflow-hidden max-h-56 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="px-3 py-2 text-[0.75rem] text-muted">Searching…</div>
            )}
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => pick(it)}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors flex items-start gap-2"
              >
                <MapPin size="0.875rem" className="mt-0.5 shrink-0 text-muted" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] truncate">{it.title}</span>
                  {it.label && it.label !== it.title && (
                    <span className="block text-[0.6875rem] text-muted truncate">{it.label}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        {!selected && !coord && !loading && items.length === 0 && (
          <div className="text-[0.71875rem] text-faint px-1.5">
            {trimmed.length === 0
              ? "Search for the stop's address, or right-click a spot on the map."
              : trimmed.length < 3
                ? 'Keep typing to search…'
                : 'No matches — try a different address, or right-click the map.'}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0 relative">
        <HereMap
          className="absolute inset-0"
          markers={
            selected ? [{ id: 'pick', kind: 'destination', position: selected.position }] : []
          }
          routePolylines={[]}
          truckOverlay={false}
          center={selected?.position ?? null}
          onMapContextMenu={async ({ lat, lng, zoom }) => {
            // Right-click drops a pin; best-effort reverse geocode for a label.
            let label = coordText({ lat, lng })
            try {
              const { place } = await api.here.revgeocode(lat, lng, zoom)
              if (place) label = place.label
            } catch {
              /* keep the plain coordinate label */
            }
            setSelected({ id: `map:${lat},${lng}`, title: label, label, position: { lat, lng } })
            setItems([])
          }}
        />
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[0.6875rem] text-faint bg-bg/70 backdrop-blur-sm rounded-full px-2.5 py-1 pointer-events-none">
          Right-click the map to drop a pin
        </div>
      </div>

      {/* Action bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5">
        <div className="flex-1 min-w-0 text-[0.75rem] text-muted truncate">
          {selected ? (
            <span className="tabular-nums">{coordText(selected.position)}</span>
          ) : (
            'No location selected yet'
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 inline-flex items-center rounded-full text-[0.75rem] text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => selected && onConfirm(coordText(selected.position))}
          disabled={!selected}
          className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/[0.1] text-[0.75rem] font-medium text-text hover:bg-white/[0.16] disabled:opacity-40 disabled:cursor-default transition-colors"
        >
          <Check size="0.875rem" strokeWidth={2.2} /> Use coordinates
        </button>
      </div>
    </div>
  )
}
