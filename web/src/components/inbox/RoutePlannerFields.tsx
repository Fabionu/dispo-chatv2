import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, X } from 'lucide-react'
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
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-card border border-white/[0.06] bg-white/[0.04] px-2.5 text-[0.8125rem] outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.05] placeholder:text-faint"
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
      className="h-5 w-5 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
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
    <div className="px-2.5 pt-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-badge text-faint">
      {children}
    </div>
  )
}

export function PresetSelect({
  builtIn,
  saved,
  activeId,
  onSelect,
}: {
  builtIn: TruckPreset[]
  saved: TruckPreset[]
  activeId: string | null
  onSelect: (id: string | null) => void
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
        className="h-8 w-full min-w-0 flex items-center justify-between gap-1.5 rounded-card border border-white/[0.06] bg-white/[0.04] px-2.5 text-[0.75rem] outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.05]"
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
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-highlighted={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(o.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                    i === highlight ? 'bg-white/[0.05]' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.75rem] text-text truncate">{o.name}</span>
                    <span className="block text-[0.65625rem] text-muted truncate mt-0.5">
                      {o.specs}
                    </span>
                  </span>
                  {selected && (
                    <Check size="0.8125rem" strokeWidth={2.4} className="shrink-0 text-active" />
                  )}
                </button>
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Compact route-summary metric. The parent row supplies dividers, keeping these
// values flat inside the route panel instead of nesting three extra cards.
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex flex-col gap-0.5 px-2 py-1">
      <span className="text-[0.625rem] uppercase tracking-badge text-faint">{label}</span>
      <span className="text-[0.8125rem] font-semibold tracking-[-0.2px] tabular-nums truncate">{value}</span>
    </div>
  )
}
