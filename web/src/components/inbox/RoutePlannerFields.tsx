import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Star, X } from 'lucide-react'
import { MENU_SURFACE } from '../menuStyles'
import { truckSummary } from './routePlannerUtils'
import type { TruckPreset } from '../../lib/here/truckPresets'

// Small presentational controls for the Route planner panel: a labelled numeric
// input (truck-profile fields), a labelled read-only stat (route summary), a
// compact copy-to-clipboard icon button (context-menu coordinate header), and
// the truck-preset dropdown (PresetSelect).
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs leading-tight text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-card h-7 border border-line bg-transparent px-2 text-base outline-none transition-colors hover:border-line-2 focus:border-line-2 focus:bg-white/4 placeholder:text-faint"
      />
    </label>
  )
}

// Tiny circular copy button for a coordinate string — the map context menu's
// header sits tighter than ICON_ACTION_SMALL's 24px, so this is its 20px
// sibling with the same borderless muted-glyph-warms-on-hover look. Shows a
// brief ✓ (done) after a successful copy and a quiet ✗ (alert) when the
// clipboard is unavailable/refused, then settles back to idle.
export function CopyCoordButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    let next: 'copied' | 'failed' = 'failed'
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        next = 'copied'
      }
    } catch {
      /* clipboard refused — show the failed state below */
    }
    setState(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy coordinates"
      title={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy coordinates'}
      className="rounded-btn h-5 w-5 shrink-0 flex items-center justify-center text-muted hover:text-text hover:bg-white/6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {state === 'copied' ? (
        <Check size="0.75rem" strokeWidth={2.4} className="text-done" />
      ) : state === 'failed' ? (
        <X size="0.75rem" strokeWidth={2.4} className="text-alert" />
      ) : (
        <Copy size="0.75rem" strokeWidth={1.8} />
      )}
    </button>
  )
}

// ── Truck preset dropdown ────────────────────────────────────────────────────
// Project-styled replacement for the native <select> (whose option list can't
// be themed): the trigger is the planner's standard field recipe, the menu is
// the shared MENU_SURFACE. Each option shows the preset name plus its derived
// specs (via truckSummary) as a muted second line; the selected row gets a
// check glyph, hover/keyboard-highlight share one quiet fill. Selection
// semantics are unchanged from the old select: an id applies that preset,
// null (the "No preset" row) only clears the active id and leaves the current
// field values alone.

type PresetOption = { id: string | null; name: string; specs: string }

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-2xs font-semibold text-faint">
      {children}
    </div>
  )
}

export function PresetSelect({
  builtIn,
  saved,
  activeId,
  onSelect,
  defaultId,
  onSetDefault,
}: {
  builtIn: TruckPreset[]
  saved: TruckPreset[]
  activeId: string | null
  onSelect: (id: string | null) => void
  /** The preset the planner opens with, or null for none. */
  defaultId: string | null
  onSetDefault: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const options = useMemo<PresetOption[]>(
    () => [
      { id: null, name: 'No preset', specs: 'Keep the current values' },
      ...builtIn.map((p) => ({ id: p.id, name: p.name, specs: truckSummary(p.values) })),
      ...saved.map((p) => ({ id: p.id, name: p.name, specs: truckSummary(p.values) })),
    ],
    [builtIn, saved],
  )
  const active = options.find((o) => o.id === activeId && o.id !== null) ?? null

  function openMenu() {
    const i = options.findIndex((o) => o.id === activeId)
    setHighlight(i >= 0 ? i : 0)
    setOpen(true)
  }

  function choose(id: string | null) {
    onSelect(id)
    setOpen(false)
  }

  // Click outside closes. Bound only while open.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the keyboard-highlighted row in view when the list scrolls.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      // preventDefault also stops the trigger button's synthetic click, which
      // would otherwise re-toggle the menu.
      e.preventDefault()
      choose(options[highlight]?.id ?? null)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} onKeyDown={onKeyDown} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded-card h-7 w-full min-w-0 flex items-center justify-between gap-1.5 border border-line bg-transparent px-2 text-sm outline-none transition-colors hover:border-line-2 focus:border-line-2 focus:bg-white/4"
      >
        <span className={`truncate ${active ? 'text-text' : 'text-faint'}`} title={active?.name}>
          {active ? active.name : 'Preset…'}
        </span>
        <ChevronDown
          size="0.875rem"
          strokeWidth={2}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Truck presets"
          className={`absolute left-0 right-0 top-[calc(100%+6px)] z-30 ${MENU_SURFACE} py-1 max-h-60 overflow-y-auto overflow-x-hidden`}
        >
          {options.map((o, i) => {
            const selected = o.id === activeId
            return (
              <Fragment key={o.id ?? 'none'}>
                {i === 1 && <SectionLabel>Built-in</SectionLabel>}
                {saved.length > 0 && i === 1 + builtIn.length && <SectionLabel>Saved</SectionLabel>}
                <div
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex items-center transition-colors ${
                    i === highlight ? 'bg-white/6' : ''
                  }`}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-highlighted={i === highlight}
                    onClick={() => choose(o.id)}
                    className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-text truncate">{o.name}</span>
                      <span className="block text-xs text-muted truncate mt-0.5">
                        {o.specs}
                      </span>
                    </span>
                    {selected && (
                      <Check size="0.8125rem" strokeWidth={2.4} className="shrink-0 text-active" />
                    )}
                  </button>
                  {/* Its own control, not part of the row's click: which preset
                      this route uses and which preset every FUTURE route starts
                      from are two different decisions, and folding them into one
                      gesture would make picking a profile once silently change
                      the next twenty routes. A separate button also means the
                      star can be a sibling rather than a button inside a button,
                      which is invalid markup and breaks the row's own click. */}
                  {o.id !== null && (
                    <button
                      type="button"
                      onClick={() => onSetDefault(o.id === defaultId ? null : o.id)}
                      title={
                        o.id === defaultId
                          ? 'Stop opening the planner with this preset'
                          : 'Open the planner with this preset'
                      }
                      aria-label={
                        o.id === defaultId ? 'Clear the default preset' : 'Set as the default preset'
                      }
                      aria-pressed={o.id === defaultId}
                      className={`rounded-btn mr-1.5 h-6 w-6 shrink-0 flex items-center justify-center transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                        o.id === defaultId ? 'text-active' : 'text-faint hover:text-text'
                      }`}
                    >
                      <Star
                        size="0.75rem"
                        strokeWidth={2}
                        fill={o.id === defaultId ? 'currentColor' : 'none'}
                      />
                    </button>
                  )}
                </div>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Compact route-summary metric. The parent grid supplies the dividers, keeping
// these values flat inside the route panel instead of nesting extra cards.
//
// The value line is the panel's readout, so it gets the largest type in the
// card and is laid out to be READ, not squeezed: the caller puts these two
// across (never four), which is what makes "4 h 40 min" and "Not calculated"
// fit whole. `truncate` stays as a backstop for a value nobody predicted, with
// the full string on hover so it is never simply lost.
export function Stat({
  label,
  value,
  size = 'base',
}: {
  label: string
  value: string
  /**
   * `lg` is the one headline readout of the card — the total distance, on a
   * row of its own (user, 2026-09-15: "mai mare, pe un singur rand"). It is
   * the number a dispatcher quotes, so it gets the card's largest type; every
   * other stat stays at the compact size and shares a row with a neighbour.
   */
  size?: 'base' | 'lg'
}) {
  // 34px per cell (was 46): the label sits directly on the value, and the
  // value is the same 13px as the point cards' headline rather than a step
  // up — a readout in a compact panel, not a dashboard tile.
  const large = size === 'lg'
  return (
    <div className={`min-w-0 flex flex-col px-2.5 ${large ? 'py-1.5' : 'py-1'}`}>
      <span className="text-2xs leading-tight text-faint">{label}</span>
      <span
        className={`font-semibold leading-tight tabular-nums truncate ${
          large ? 'text-2xl tracking-[-0.3px]' : 'text-base tracking-[-0.1px]'
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

// ── Folding tool card ────────────────────────────────────────────────────────
// The Truck profile and Crew & hours cards under the route card. At rest each
// is nothing but its glyph — a square the size of the row's chip (user,
// 2026-09-15: "pana sa se faca hover pe ele, sa fie niste butoane simple") —
// so the two of them stop reading as two more panels stacked under the route
// and the map gets the width back. Hovering (or focusing) grows the square
// into the full row — glyph, title, live summary, chevron — and the click on
// that row unfolds the fields beneath it. An UNFOLDED card holds the full
// width until it is folded again, whatever the pointer does: the fields are
// being edited, and a card that shrank away mid-edit because the cursor
// strayed would be a trap.
//
// The grow is CSS (index.css `.planner-fold`): width on the card, driven by
// :hover / :focus-within / [data-open], with the text fading in a beat after
// the width starts so it is never read half-clipped. The card clips only
// while folded — the preset dropdown and the date pickers are absolute
// popovers INSIDE it, and an open card must let them out.
export function FoldCard({
  icon,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode
  title: string
  /** The card's live current value, shown under the title. */
  summary: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div
      data-open={open || undefined}
      className="planner-fold shrink-0 rounded-soft border border-line bg-surface shadow-overlay"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
      >
        <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-tile border border-line bg-white/2 text-muted">
          {icon}
        </span>
        <span className="planner-fold-text min-w-0 flex-1">
          <span className="block whitespace-nowrap text-base font-medium leading-tight text-text">{title}</span>
          <span className="block truncate text-xs leading-tight text-faint" title={summary}>
            {summary}
          </span>
        </span>
        <ChevronDown
          size="0.875rem"
          strokeWidth={1.8}
          className={`planner-fold-text shrink-0 text-faint transition-transform motion-reduce:transition-none ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && <div className="flex flex-col gap-2 border-t border-line p-2">{children}</div>}
    </div>
  )
}
