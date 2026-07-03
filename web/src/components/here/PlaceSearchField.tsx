import { useEffect, useId, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { api } from '../../lib/api'
import { looksLikeCoordPair, parseLatLng } from '../../lib/here/geo'
import type { HerePlace, LatLng } from '../../lib/here/types'

// Build a HerePlace from directly-entered coordinates so the selection flow is
// identical to picking a search result (caller reads `position` + `label`).
function coordPlace(c: LatLng): HerePlace {
  const text = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
  return { id: `coord:${c.lat},${c.lng}`, title: text, label: text, position: c }
}

type Props = {
  // Optional — omit when the caller renders its own header (e.g. stop rows with
  // reorder controls).
  label?: string
  value: HerePlace | null
  onChange: (place: HerePlace | null) => void
  placeholder?: string
  // Seed the query box (no selected value) — used when editing an existing point
  // so the field opens pre-populated with the current address, ready to replace.
  initialQuery?: string
  // Focus the input on mount (inline edit / "add stop" reveal).
  autoFocus?: boolean
}

// Address/location autocomplete backed by HERE Discover (via /api/here/search).
// Debounced; selecting a result locks the field to that place's label, with a
// clear (×) button to pick again. Stays deliberately simple — no keyboard
// arrow-nav yet, just click/tap selection.
export default function PlaceSearchField({ label, value, onChange, placeholder, initialQuery, autoFocus }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [items, setItems] = useState<HerePlace[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  // Debounced search. A selected value short-circuits searching (the field shows
  // the chosen label, not a query).
  useEffect(() => {
    if (value) return
    const q = query.trim()
    // Coordinate input ("lat, lng") is parsed locally and never sent to address
    // search — otherwise HERE Discover treats the numbers as free text and
    // returns a "random" place. The render shows a direct "Go to coordinates"
    // option (or an invalid-coordinate hint) instead.
    if (looksLikeCoordPair(q)) {
      setItems([])
      setLoading(false)
      return
    }
    if (q.length < 3) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await api.here.search(q)
        if (!cancelled) {
          setItems(res.items)
          setOpen(true)
        }
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
  }, [query, value])

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function select(place: HerePlace) {
    onChange(place)
    setQuery('')
    setItems([])
    setOpen(false)
  }

  function clear() {
    onChange(null)
    setQuery('')
    setItems([])
  }

  // Coordinate-input state for the current query: whether it looks like a "lat,
  // lng" pair, and the parsed/validated point (null when out of range).
  const trimmed = query.trim()
  const coordShape = !value && looksLikeCoordPair(trimmed)
  const coord = coordShape ? parseLatLng(trimmed) : null

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      {label && <label className="text-[0.75rem] font-medium text-muted">{label}</label>}

      {value ? (
        // Selected state — locked chip with the chosen place + clear button.
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 h-10">
          <MapPin size="0.9375rem" className="shrink-0 text-active" strokeWidth={1.8} />
          <span className="flex-1 truncate text-[0.8125rem]" title={value.label}>
            {value.label || value.title}
          </span>
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear ${label}`}
            className="shrink-0 text-muted hover:text-text transition-colors"
          >
            <X size="0.9375rem" strokeWidth={2} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => (items.length || coordShape) && setOpen(true)}
          onKeyDown={(e) => {
            // Enter submits a valid coordinate pair directly (no result to click).
            if (e.key === 'Enter' && coord) {
              e.preventDefault()
              select(coordPlace(coord))
            }
          }}
          placeholder={placeholder ?? 'Search address, place, or lat, lng…'}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          autoComplete="off"
          autoFocus={autoFocus}
          className="h-10 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 text-[0.8125rem] outline-none focus:border-white/[0.25] placeholder:text-muted/70"
        />
      )}

      {/* Coordinate input: a direct "Go to coordinates" option, or an invalid
          hint. Never runs an address search, so the map only moves on selection
          of a valid, in-range coordinate. */}
      {coordShape && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 top-full mt-1 w-full rounded-xl border border-white/[0.1] bg-rail shadow-xl"
        >
          {coord ? (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => select(coordPlace(coord))}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors flex items-start gap-2"
              >
                <MapPin size="0.875rem" className="mt-0.5 shrink-0 text-active" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-[0.8125rem]">Go to coordinates</span>
                  <span className="block text-[0.6875rem] text-muted tabular-nums">
                    {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
                  </span>
                </span>
              </button>
            </li>
          ) : (
            <li className="px-3 py-2.5 text-[0.75rem] text-amber-200/80">
              Invalid coordinates — latitude −90 to 90, longitude −180 to 180.
            </li>
          )}
        </ul>
      )}

      {open && !value && !coordShape && (items.length > 0 || loading) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 top-full mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-white/[0.1] bg-rail shadow-xl"
        >
          {loading && items.length === 0 && (
            <li className="px-3 py-2.5 text-[0.75rem] text-muted">Searching…</li>
          )}
          {items.map((item) => (
            <li key={item.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => select(item)}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors flex items-start gap-2"
              >
                <MapPin size="0.875rem" className="mt-0.5 shrink-0 text-muted" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] truncate">{item.title}</span>
                  {item.label && item.label !== item.title && (
                    <span className="block text-[0.6875rem] text-muted truncate">{item.label}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
