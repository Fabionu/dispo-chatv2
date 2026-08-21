import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, X } from 'lucide-react'
import { api } from '../../lib/api'
import { looksLikeCoordPair, parseLatLng } from '../../lib/here/geo'
import type { HerePlace, LatLng } from '../../lib/here/types'
import { MENU_SURFACE } from '../menuStyles'

// One field surface for both the query input and the locked selected chip so
// the two states read as the SAME control: hairline border, subtle fill and a
// calm brighten on focus (mirrors tripFormStyles / the sidebar search).
// Drawn, not filled — the app's field rule. `bg-white/4` at rest made this the
// only filled control left in the planner.
const FIELD_SURFACE =
  'h-9 border border-line bg-transparent px-3 transition-colors hover:border-line-2'
const FIELD_FOCUS = 'outline-none focus:border-line-2 focus:bg-white/4'

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

type PopupPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
  above: boolean
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
  const [popup, setPopup] = useState<PopupPosition | null>(null)
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLUListElement>(null)

  // Coordinate-input state for the current query: whether it looks like a "lat,
  // lng" pair, and the parsed/validated point (null when out of range).
  const trimmed = query.trim()
  const coordShape = !value && looksLikeCoordPair(trimmed)
  const coord = coordShape ? parseLatLng(trimmed) : null
  const resultsVisible = open && !value && !coordShape && (items.length > 0 || loading)
  const dropdownVisible = coordShape || resultsVisible

  // The planner's itinerary lives inside an overflow-y-auto region. Rendering
  // the autocomplete as an absolute child clips it to that scroller and forces
  // the user to scroll the panel to see results. Measure the input and render
  // the list in document.body instead. `fixed` positioning keeps it above the
  // planner/map layers; when there is less room below, the list flips upward.
  const updatePopupPosition = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const gap = 4
    const viewportPadding = 8
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding
    const spaceAbove = rect.top - gap - viewportPadding
    const above = spaceBelow < 160 && spaceAbove > spaceBelow
    const available = above ? spaceAbove : spaceBelow
    const next: PopupPosition = {
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding)),
      top: above ? rect.top - gap : rect.bottom + gap,
      width: rect.width,
      maxHeight: Math.max(80, Math.min(288, available)),
      above,
    }
    setPopup((current) =>
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.width === next.width &&
      current.maxHeight === next.maxHeight &&
      current.above === next.above
        ? current
        : next,
    )
  }, [])

  useLayoutEffect(() => {
    if (!dropdownVisible) {
      setPopup(null)
      return
    }
    updatePopupPosition()
    window.addEventListener('resize', updatePopupPosition)
    window.addEventListener('scroll', updatePopupPosition, true)
    return () => {
      window.removeEventListener('resize', updatePopupPosition)
      window.removeEventListener('scroll', updatePopupPosition, true)
    }
  }, [dropdownVisible, updatePopupPosition])

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
      const target = e.target as Node
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false)
      }
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

  const fieldSurface = FIELD_SURFACE

  const dropdown = popup && dropdownVisible && (
    <ul
      ref={dropdownRef}
      id={listboxId}
      role="listbox"
      className={`fixed z-[100] ${MENU_SURFACE} overflow-y-auto`}
      style={{
        left: popup.left,
        top: popup.top,
        width: popup.width,
        maxHeight: popup.maxHeight,
        transform: popup.above ? 'translateY(-100%)' : undefined,
      }}
    >
      {coordShape ? (
        coord ? (
          <li role="option" aria-selected={false}>
            <button
              type="button"
              onClick={() => select(coordPlace(coord))}
              className="w-full text-left px-3 py-2 hover:bg-white/6 transition-colors flex items-start gap-2"
            >
              <MapPin size="0.875rem" className="mt-0.5 shrink-0 text-active" strokeWidth={1.8} />
              <span className="min-w-0">
                <span className="block text-base">Go to coordinates</span>
                <span className="block text-xs text-muted tabular-nums">
                  {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
                </span>
              </span>
            </button>
          </li>
        ) : (
          <li className="px-3 py-2.5 text-sm text-amber-200/80">
            Invalid coordinates — latitude −90 to 90, longitude −180 to 180.
          </li>
        )
      ) : (
        <>
          {loading && items.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted">Searching…</li>
          )}
          {items.map((item) => (
            <li key={item.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => select(item)}
                className="w-full text-left px-3 py-2 hover:bg-white/6 transition-colors flex items-start gap-2"
              >
                <MapPin size="0.875rem" className="mt-0.5 shrink-0 text-muted" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-base truncate">{item.title}</span>
                  {item.label && item.label !== item.title && (
                    <span className="block text-xs text-muted truncate">{item.label}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </>
      )}
    </ul>
  )

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-muted">{label}</label>}

      {value ? (
        // Selected state — locked chip with the chosen place + clear button.
        <div className={`flex items-center gap-2 ${fieldSurface}`}>
          <MapPin size="0.9375rem" className="shrink-0 text-active" strokeWidth={1.8} />
          <span className="flex-1 truncate text-base" title={value.label}>
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
          ref={inputRef}
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
          className={`${fieldSurface} ${FIELD_FOCUS} text-base placeholder:text-faint`}
        />
      )}

      {/* The list is portalled outside the planner's overflow scroller, so it
          can cover the panel/map instead of increasing the panel scroll range. */}
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
