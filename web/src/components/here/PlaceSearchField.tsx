import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, X } from 'lucide-react'
import { looksLikeCoordPair, parseLatLng } from '../../lib/here/geo'
import type { HerePlace, LatLng } from '../../lib/here/types'
import { newPlaceSession, suggestPlaces, type PlaceSession, type PlaceSuggestion } from '../../lib/google/places'
import type { MapViewport } from '../map/mapProps'
import Spinner from '../Spinner'
import { MENU_SURFACE } from '../menuStyles'

// One field surface for both the query input and the locked selected chip so
// the two states read as the SAME control: hairline border, subtle fill and a
// calm brighten on focus (mirrors tripFormStyles / the sidebar search).
// Drawn, not filled — the app's field rule. `bg-white/4` at rest made this the
// only filled control left in the planner. 28px tall (h-7): the planner's rows
// went compact on 2026-09-11 and the row shell (RoutePointCard RouteRow)
// centres its badge on this height — change the two together.
const FIELD_SURFACE =
  'h-7 rounded-card border border-line bg-transparent px-2.5 transition-colors hover:border-line-2'
const FIELD_FOCUS = 'outline-none focus:border-line-2 focus:bg-white/4'

// One suggestion row. Compact (user, 2026-09-15): the list opens over the map
// beside a 28px field, and at the old `py-2` + loose leading five rows took
// ~230px of it — more list than map. Two tiers, still — the place and the
// locality answer different questions and a single truncated line would lose
// the town on any street address — but drawn tight: 3px of padding over
// headline and meta on their own leading, so a row is ~34px, not ~46. The
// glyph is dropped to the meta size and centred on the headline.
const ROW = 'w-full text-left px-2.5 py-[3px] transition-colors flex items-start gap-2'
const ROW_GLYPH = 'mt-[3px] shrink-0'
const ROW_TITLE = 'block text-base leading-[1.25] truncate'
const ROW_META = 'block text-xs leading-[1.2] text-faint truncate'

// Google starts suggesting from the first letter; two is where the list stops
// being every street on the continent that starts with "a".
const MIN_QUERY = 2

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
  // What the map beside the field is showing, read at request time (a function,
  // so a pan does not re-render every field). Suggestions are biased toward it.
  view?: () => MapViewport | null
}

type PopupPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
  above: boolean
}

// Address/location autocomplete backed by Google Places (HERE as the fallback —
// see lib/google/places.ts). Debounced; picking a result geocodes it and locks
// the field to the place's label, with a clear (×) button to pick again. Arrow
// keys walk the list, Enter picks, Escape closes.
export default function PlaceSearchField({ label, value, onChange, placeholder, initialQuery, autoFocus, view }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  // The suggestion being geocoded after a pick. The field shows it locked at
  // once — the pick should feel instant — and swaps in the resolved place, or
  // reopens the query with a note, when the lookup answers.
  const [pending, setPending] = useState<PlaceSuggestion | null>(null)
  const [failed, setFailed] = useState(false)
  const [popup, setPopup] = useState<PopupPosition | null>(null)
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLUListElement>(null)
  // One billing session per lookup: opened by the first keystroke, spent by the
  // pick. A ref, because it must survive re-renders and never trigger one.
  const sessionRef = useRef<PlaceSession | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  // Coordinate-input state for the current query: whether it looks like a "lat,
  // lng" pair, and the parsed/validated point (null when out of range).
  const trimmed = query.trim()
  const coordShape = !value && looksLikeCoordPair(trimmed)
  const coord = coordShape ? parseLatLng(trimmed) : null
  const resultsVisible = open && !value && !pending && !coordShape && (items.length > 0 || loading)
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
    if (value || pending) return
    const q = query.trim()
    // Coordinate input ("lat, lng") is parsed locally and never sent to place
    // search — a geocoder treats the numbers as free text and returns a
    // "random" place. The render shows a direct "Go to coordinates" option (or
    // an invalid-coordinate hint) instead.
    if (looksLikeCoordPair(q) || q.length < MIN_QUERY) {
      setItems([])
      setActive(-1)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        sessionRef.current ??= newPlaceSession()
        const next = await suggestPlaces(q, sessionRef.current, viewRef.current?.() ?? null)
        if (!cancelled) {
          setItems(next)
          setActive(-1)
          setOpen(true)
        }
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, value, pending])

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

  // Keep the keyboard-highlighted row in view as the arrows walk past the
  // visible slice of a long list.
  useEffect(() => {
    if (active < 0) return
    const el = dropdownRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function commit(place: HerePlace) {
    onChange(place)
    setQuery('')
    setItems([])
    setActive(-1)
    setOpen(false)
    sessionRef.current = null
  }

  async function pick(suggestion: PlaceSuggestion) {
    setOpen(false)
    setItems([])
    setActive(-1)
    setFailed(false)
    setPending(suggestion)
    try {
      const place = await suggestion.resolve()
      setPending(null)
      commit(place)
    } catch {
      // The pick is the one step the field cannot do without a coordinate.
      // Hand the query back with the picked text so the user can try the next
      // result, rather than leaving a chip that points nowhere.
      setPending(null)
      setFailed(true)
      setQuery(suggestion.label)
      sessionRef.current = null
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  function clear() {
    onChange(null)
    setQuery('')
    setItems([])
    setActive(-1)
    setFailed(false)
    sessionRef.current = null
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter submits a valid coordinate pair directly (no result to click).
    if (e.key === 'Enter' && coord) {
      e.preventDefault()
      commit(coordPlace(coord))
      return
    }
    if (!resultsVisible) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1))
    } else if (e.key === 'Enter') {
      // Enter with nothing highlighted takes the top result — the way a maps
      // search box does — so a dispatcher can type an address and press Enter.
      const target = items[active >= 0 ? active : 0]
      if (target) {
        e.preventDefault()
        void pick(target)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const fieldSurface = FIELD_SURFACE
  const activeId = active >= 0 ? `${listboxId}-${active}` : undefined

  const dropdown = popup && dropdownVisible && (
    <ul
      ref={dropdownRef}
      id={listboxId}
      role="listbox"
      className={`fixed z-[100] ${MENU_SURFACE} overflow-y-auto py-1`}
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
              onClick={() => commit(coordPlace(coord))}
              className={`${ROW} hover:bg-white/6`}
            >
              <MapPin size="0.75rem" className={`${ROW_GLYPH} text-active`} strokeWidth={1.8} />
              <span className="min-w-0">
                <span className={ROW_TITLE}>Go to coordinates</span>
                <span className={`${ROW_META} tabular-nums`}>
                  {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
                </span>
              </span>
            </button>
          </li>
        ) : (
          <li className="px-2.5 py-1.5 text-xs leading-[1.2] text-amber-200/80">
            Invalid coordinates — latitude −90 to 90, longitude −180 to 180.
          </li>
        )
      ) : (
        <>
          {loading && items.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted">Searching…</li>
          )}
          {items.map((item, i) => (
            <li key={item.id} id={`${listboxId}-${i}`} role="option" aria-selected={i === active} data-index={i}>
              <button
                type="button"
                // mousedown, not click: the input's blur would otherwise fire
                // first and the outside-click handler could close the list
                // under the cursor.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(item)}
                onMouseEnter={() => setActive(i)}
                className={`${ROW} ${i === active ? 'bg-white/8' : 'hover:bg-white/6'}`}
              >
                <MapPin size="0.75rem" className={`${ROW_GLYPH} text-muted`} strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className={ROW_TITLE}>{item.title}</span>
                  {item.subtitle && <span className={ROW_META}>{item.subtitle}</span>}
                </span>
              </button>
            </li>
          ))}
        </>
      )}
    </ul>
  )

  const locked = value ?? pending
  const lockedLabel = value ? value.label || value.title : pending ? pending.label : ''

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      {label && <label className="text-xs font-medium text-muted">{label}</label>}

      {locked ? (
        // Selected state — locked chip with the chosen place + clear button.
        // While the pick is still being geocoded the pin gives way to a
        // spinner; the label is already the one the chip will keep.
        <div className={`flex items-center gap-2 ${fieldSurface}`}>
          {pending ? (
            <Spinner size={15} className="shrink-0" />
          ) : (
            <MapPin size="0.9375rem" className="shrink-0 text-active" strokeWidth={1.8} />
          )}
          <span className="flex-1 truncate text-base" title={lockedLabel}>
            {lockedLabel}
          </span>
          {!pending && (
            <button
              type="button"
              onClick={clear}
              aria-label={`Clear ${label ?? 'place'}`}
              className="shrink-0 text-muted hover:text-text transition-colors"
            >
              <X size="0.9375rem" strokeWidth={2} />
            </button>
          )}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setFailed(false)
            }}
            onFocus={() => (items.length || coordShape) && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Search address, place, or lat, lng…'}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            autoFocus={autoFocus}
            className={`${fieldSurface} ${FIELD_FOCUS} text-base placeholder:text-faint`}
          />
          {failed && (
            <span className="text-xs text-amber-200/80">
              That place could not be located — try another result.
            </span>
          )}
        </>
      )}

      {/* The list is portalled outside the planner's overflow scroller, so it
          can cover the panel/map instead of increasing the panel scroll range. */}
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
