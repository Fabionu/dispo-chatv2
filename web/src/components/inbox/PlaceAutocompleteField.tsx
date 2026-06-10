import { useEffect, useId, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import Spinner from '../Spinner'
import {
  autocompletePlaces,
  formatCoords,
  getPlace,
  parseCoordinates,
  searchPlaces,
  type LngLat,
  type PlaceSuggestion,
  type ResolvedPlace,
} from '../../lib/hereSearch'

type Props = {
  label: string
  value: string
  placeholder?: string
  // Bias for Suggest — the nearest known waypoint (or a default). Ranks nearby
  // companies/addresses first.
  bias: LngLat
  // Free-text edits (typing). Clears any previously-selected place upstream.
  onTextChange: (v: string) => void
  // A suggestion was picked and resolved to coordinates + structured address.
  onSelect: (place: ResolvedPlace) => void
  // When set, a small remove control appears (used for optional stops).
  onRemove?: () => void
  // True when `value` already reflects a committed selection (e.g. a place set
  // from the map). Suppresses the autocomplete so it doesn't pop a "Use
  // coordinates" / suggestions dropdown for a value the user didn't just type.
  selected?: boolean
}

const MIN_CHARS = 3
const DEBOUNCE_MS = 300

// HERE Geocoding & Search field with a themed dropdown. While typing it uses
// HERE Autosuggest, falling back to Discover (company/POI + address) when
// Autosuggest returns nothing or errors. Debounced, keyboard-navigable, cancels
// superseded requests; most results carry their coordinate inline, so a pick
// reports upward immediately (the getPlace/lookup fallback only runs for the rare
// result without a position).
export default function PlaceAutocompleteField({
  label,
  value,
  placeholder,
  bias,
  onTextChange,
  onSelect,
  onRemove,
  selected,
}: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [resolving, setResolving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Suppress the search that the programmatic input fill would otherwise trigger
  // right after a selection.
  const skipNextSearchRef = useRef(false)
  // Latest "this value is a committed selection" flag, read inside the search
  // effect without making it a dependency.
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  // Latest bias, read at search time so changing it (after selecting another
  // field) doesn't re-trigger this field's search.
  const biasRef = useRef(bias)
  biasRef.current = bias
  const listboxId = useId()

  // Debounced autocomplete. Aborts the in-flight request when the query changes
  // or the component unmounts, so only the latest keystroke's results land.
  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      return
    }
    // Value reflects an already-committed place (e.g. set from the map): don't
    // open the autocomplete — otherwise a coordinate value pops a stray "Use
    // coordinates" suggestion under every map-added stop.
    if (selectedRef.current) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      setError(false)
      return
    }
    const q = value.trim()
    if (q.length < MIN_CHARS) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      setError(false)
      return
    }
    // Raw coordinates → offer them directly (no API call, instant).
    const coords = parseCoordinates(q)
    if (coords) {
      const label = formatCoords(coords[0], coords[1])
      setSuggestions([
        { placeId: 'coordinates', primary: 'Use coordinates', secondary: label, label, position: coords },
      ])
      setActiveIndex(0)
      setOpen(true)
      setLoading(false)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        // While typing, use HERE Autosuggest (optimised for partial input).
        let res = await autocompletePlaces(q, biasRef.current, ctrl.signal)
        // Autosuggest returned nothing useful — fall back to Discover so a manual
        // address/company search still resolves.
        if (res.length === 0) {
          res = await searchPlaces(q, biasRef.current, ctrl.signal)
        }
        setSuggestions(res)
        setActiveIndex(-1)
        setOpen(true)
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        // Autosuggest failed — try Discover before surfacing an error, so the
        // field still works for manual address/company search.
        try {
          const res = await searchPlaces(q, biasRef.current, ctrl.signal)
          setSuggestions(res)
          setActiveIndex(-1)
          setOpen(true)
        } catch (err2) {
          if ((err2 as { name?: string })?.name === 'AbortError') return
          setError(true)
          setSuggestions([])
          setOpen(true)
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [value])

  // Close the dropdown when clicking outside the field.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function handleSelect(s: PlaceSuggestion) {
    skipNextSearchRef.current = true
    onTextChange(s.label)
    setOpen(false)
    setSuggestions([])
    setActiveIndex(-1)
    // Coordinate entries already carry a position — resolve without GetPlace.
    if (s.position) {
      onSelect({
        placeId: s.placeId,
        label: s.label,
        position: s.position,
        postalCode: null,
        country: null,
        region: null,
        locality: null,
      })
      return
    }
    setResolving(true)
    try {
      const resolved = await getPlace(s.placeId)
      if (resolved) onSelect(resolved)
    } catch {
      // Subtle failure — leave the text in place; the user can pick again.
    } finally {
      setResolving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open && suggestions.length) setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault()
        void handleSelect(suggestions[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && value.trim().length >= MIN_CHARS

  return (
    <div className="block" ref={containerRef}>
      <span className="block text-[11px] text-muted mb-1">{label}</span>
      <div className="relative">
        <div className="flex items-center gap-2 px-2.5 h-9 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors">
          <MapPin size={13} strokeWidth={1.6} className="text-faint shrink-0" />
          <input
            value={value}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (suggestions.length) setOpen(true)
            }}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            className="bg-transparent flex-1 outline-none text-[12.5px] placeholder:text-faint min-w-0"
          />
          {resolving ? (
            <Spinner variant="sm" />
          ) : onRemove ? (
            <button
              onClick={onRemove}
              aria-label={`Remove ${label}`}
              className="text-faint hover:text-text shrink-0 transition-colors"
            >
              <X size={12} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>

        {showDropdown && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-30 left-0 right-0 top-[calc(100%+4px)] max-h-[260px] overflow-y-auto rounded-card border border-white/[0.10] bg-surface shadow-2xl shadow-black/50 py-1"
          >
            {loading ? (
              <li className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted">
                <Spinner variant="sm" />
                Searching…
              </li>
            ) : error ? (
              <li className="px-3 py-2 text-[12px] text-alert">Couldn’t load suggestions.</li>
            ) : suggestions.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-faint">No places found</li>
            ) : (
              suggestions.map((s, i) => (
                <li key={s.placeId} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => void handleSelect(s)}
                    className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                      i === activeIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <MapPin size={13} strokeWidth={1.6} className="text-faint shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] text-text truncate">{s.primary}</span>
                      {s.secondary && (
                        <span className="block text-[11px] text-muted truncate">{s.secondary}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
