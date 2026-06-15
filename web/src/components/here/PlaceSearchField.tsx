import { useEffect, useId, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { HerePlace } from '../../lib/here/types'

type Props = {
  // Optional — omit when the caller renders its own header (e.g. stop rows with
  // reorder controls).
  label?: string
  value: HerePlace | null
  onChange: (place: HerePlace | null) => void
  placeholder?: string
}

// Address/location autocomplete backed by HERE Discover (via /api/here/search).
// Debounced; selecting a result locks the field to that place's label, with a
// clear (×) button to pick again. Stays deliberately simple — no keyboard
// arrow-nav yet, just click/tap selection.
export default function PlaceSearchField({ label, value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState('')
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

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      {label && <label className="text-[12px] font-medium text-muted">{label}</label>}

      {value ? (
        // Selected state — locked chip with the chosen place + clear button.
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 h-10">
          <MapPin size={15} className="shrink-0 text-active" strokeWidth={1.8} />
          <span className="flex-1 truncate text-[13px]" title={value.label}>
            {value.label || value.title}
          </span>
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear ${label}`}
            className="shrink-0 text-muted hover:text-text transition-colors"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          placeholder={placeholder ?? 'Search address or place…'}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          autoComplete="off"
          className="h-10 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-[13px] outline-none focus:border-white/[0.25] placeholder:text-muted/70"
        />
      )}

      {open && !value && (items.length > 0 || loading) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 top-full mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-white/[0.1] bg-rail shadow-xl"
        >
          {loading && items.length === 0 && (
            <li className="px-3 py-2.5 text-[12px] text-muted">Searching…</li>
          )}
          {items.map((item) => (
            <li key={item.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => select(item)}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors flex items-start gap-2"
              >
                <MapPin size={14} className="mt-0.5 shrink-0 text-muted" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-[13px] truncate">{item.title}</span>
                  {item.label && item.label !== item.title && (
                    <span className="block text-[11px] text-muted truncate">{item.label}</span>
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
