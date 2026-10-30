import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import type { WorkspacePlace, WorkspacePlaceCategory } from '../../lib/types'
import { rem } from '../../lib/density'
import {
  PLACE_CATEGORIES,
  PLACE_CATEGORY_COLOR,
  PLACE_CATEGORY_LABEL,
} from '../../lib/savedPlaces'
import { PLACE_CATEGORY_PICTOGRAM, ROUTE_HALO } from '../here/hereMapIcons'

type Props = {
  places: WorkspacePlace[]
  loading: boolean
  error: string | null
  onClose: () => void
  onSelect: (place: WorkspacePlace) => void
}

// How many rows the list shows before it scrolls, and the fewest the user can
// drag it down to. The card grows with its content up to the cap, so a short
// list stays short; the bottom edge then lets the user trade rows for map.
const DEFAULT_VISIBLE_ROWS = 8
const MIN_VISIBLE_ROWS = 3
const KEY_STEP_PX = 24
// A height the user chose is a per-device preference, like the other panel
// layout choices; a bad or missing value just means "the default".
const HEIGHT_KEY = 'dispo:places-panel-height'

function readStoredHeight(): number | null {
  try {
    const raw = window.localStorage.getItem(HEIGHT_KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) && value >= 80 ? value : null
  } catch {
    return null
  }
}

function storeHeight(value: number | null) {
  try {
    if (value === null) window.localStorage.removeItem(HEIGHT_KEY)
    else window.localStorage.setItem(HEIGHT_KEY, String(Math.round(value)))
  } catch {
    // Storage can be blocked; the resize still works for this session.
  }
}

// The saved-place mark, EXACTLY as it is drawn on the map (hereMapIcons
// savedPlaceSvg): a white plate, a round core in the category ink and the
// category's pictogram. It is the same drawing on purpose — this list is the
// map's legend, and a legend that draws its own thing (it was a square with a
// letter in it until 2026-10-30, after the pins had gone to pictograms)
// teaches nothing about the pins the user is actually looking at.
//
// The plate carries its own ground, so it needs no border and no theme-aware
// tint: it reads identically on the black field and the white one.
export function PlaceMark({
  category,
  size = 32,
}: {
  category: WorkspacePlaceCategory
  size?: number
}) {
  const path = PLACE_CATEGORY_PICTOGRAM[category]
  const label = PLACE_CATEGORY_LABEL[category]
  return (
    <svg
      viewBox="0 0 18 18"
      role="img"
      aria-label={label}
      className="shrink-0"
      // Design px through `rem()`, not raw px: the mark then tracks --ui-scale
      // with the rest of the panel's chrome. Numeric prop, rem output — the
      // convention lib/density.ts documents.
      style={{ width: rem(size), height: rem(size) }}
    >
      <title>{label}</title>
      <circle cx="9" cy="9" r="9" fill={ROUTE_HALO} />
      <circle cx="9" cy="9" r="7" fill={PLACE_CATEGORY_COLOR[category]} />
      {path ? (
        <g
          transform="translate(4.4 4.4) scale(0.3833)"
          fill="none"
          stroke={ROUTE_HALO}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={path} />
        </g>
      ) : (
        <circle cx="9" cy="9" r="2.2" fill={ROUTE_HALO} />
      )}
    </svg>
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

  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  // The list's cap in px: what the user dragged it to, else DEFAULT_VISIBLE_ROWS
  // rows. Rows are measured rather than assumed, because their height follows
  // the UI scale; `rows` holds the measured one-row / gap / padding pieces.
  const [userHeight, setUserHeight] = useState<number | null>(readStoredHeight)
  const [rows, setRows] = useState<{ row: number; gap: number; pad: number } | null>(null)
  const drag = useRef<{ startY: number; startH: number; minH: number; maxH: number } | null>(null)
  const lastHeight = useRef<number | null>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    const first = rowsRef.current?.querySelector('button')
    if (!list || !rowsRef.current || !first) return
    const listStyle = window.getComputedStyle(list)
    setRows({
      row: first.getBoundingClientRect().height,
      gap: parseFloat(window.getComputedStyle(rowsRef.current).rowGap) || 0,
      pad: (parseFloat(listStyle.paddingTop) || 0) + (parseFloat(listStyle.paddingBottom) || 0),
    })
  }, [filtered.length, loading, error])

  const heightForRows = (count: number) =>
    rows ? count * rows.row + (count - 1) * rows.gap + rows.pad : null
  const listMax = userHeight ?? heightForRows(DEFAULT_VISIBLE_ROWS)
  const showHandle = !loading && !error && filtered.length > 0

  const limits = () => {
    const list = listRef.current
    if (!list) return null
    const maxH = list.scrollHeight
    const minH = Math.min(heightForRows(MIN_VISIBLE_ROWS) ?? maxH, maxH)
    return { minH, maxH, current: list.getBoundingClientRect().height }
  }
  const clampHeight = (value: number, minH: number, maxH: number) => Math.min(maxH, Math.max(minH, value))
  const commitHeight = (value: number | null) => {
    lastHeight.current = value
    setUserHeight(value)
  }

  return (
    <section className="absolute z-20 top-[3.25rem] right-3 flex max-h-[calc(100%-4rem)] w-[18rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
      {/* One slim row: the title and the close button. The "Right-click the map
          to add one" line went on 2026-10-30 (user: "remove this and compact
          again"); the empty state below still teaches it, where it matters. */}
      <header className="flex items-center justify-between py-0.5 pl-3 pr-1">
        <div className="eyebrow">Saved places</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close saved places"
          className="rounded-btn flex h-6 w-6 items-center justify-center text-muted transition-colors hover:bg-white/6 hover:text-text"
        >
          <X size="0.9375rem" strokeWidth={1.9} />
        </button>
      </header>

      <div className="grid grid-cols-[1fr_auto] gap-1.5 border-b border-line px-2 pb-2 pt-0.5">
        <label className="rounded-card flex h-7 min-w-0 items-center gap-2 border border-line bg-white/4 px-2.5 transition-colors focus-within:border-line-2 focus-within:bg-white/6">
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
          className="rounded-card h-7 max-w-[6.5rem] border border-line bg-white/4 px-2.5 text-xs text-muted outline-none transition-colors hover:border-line-2 focus:border-line-2"
        >
          <option value="all">All</option>
          {PLACE_CATEGORIES.map((item) => (
            <option key={item} value={item}>{PLACE_CATEGORY_LABEL[item]}</option>
          ))}
        </select>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto p-2"
        style={listMax !== null ? { maxHeight: listMax } : undefined}
      >
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
          <div ref={rowsRef} className="flex flex-col gap-1">
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

      {/* The card's bottom edge is its only resize handle: the top is pinned
          under the map buttons and the sides are the panel's width. Drag, or
          focus it and use ↑/↓; a double-click goes back to the default. */}
      {showHandle && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize saved places list"
          aria-valuenow={Math.round(listMax ?? 0)}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={(event) => {
            const l = limits()
            if (!l) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { startY: event.clientY, startH: l.current, minH: l.minH, maxH: l.maxH }
          }}
          onPointerMove={(event) => {
            const d = drag.current
            if (!d) return
            commitHeight(clampHeight(d.startH + event.clientY - d.startY, d.minH, d.maxH))
          }}
          onPointerUp={() => {
            if (!drag.current) return
            drag.current = null
            storeHeight(lastHeight.current)
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onDoubleClick={() => {
            commitHeight(null)
            storeHeight(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            const l = limits()
            if (!l) return
            event.preventDefault()
            const next = clampHeight(
              l.current + (event.key === 'ArrowDown' ? KEY_STEP_PX : -KEY_STEP_PX),
              l.minH,
              l.maxH,
            )
            commitHeight(next)
            storeHeight(next)
          }}
          className="group relative h-2 shrink-0 cursor-ns-resize touch-none border-t border-line focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="rounded-btn absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 bg-line-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          />
        </div>
      )}
    </section>
  )
}
