import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { AvailabilityStatus } from '../../lib/types'
import { AVAILABILITY, AWAY, statusMeta } from '../../lib/availability'

// What each status tells colleagues — shown under its name in the list.
const MEANING: Record<AvailabilityStatus, string> = {
  available: 'At work and replying',
  busy: 'At work, replies may take a while',
  off_duty: 'Not working right now',
}

// The Status field (user, 2026-10-29/30 canvases): collapsed, it shows the
// current choice; open, the three you can pick drop under it, each with one
// line on what it means, and Away sits apart at the foot as the one the app
// sets for you. Used by the account window and My profile.
//
// Escape is caught in the capture phase and stopped, so closing the list never
// also closes the window around it.
export default function StatusSelect({
  value,
  onChange,
  title,
}: {
  value: AvailabilityStatus
  onChange: (next: AvailabilityStatus) => void
  /** Hover hint on the field. */
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = statusMeta(value)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
    }
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [open])

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${current.label}`}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-btn flex h-8 w-full items-center gap-2 border bg-surface pl-2.5 pr-2 text-left text-base font-medium text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
          open ? 'border-line-2' : 'border-line hover:border-line-2'
        }`}
      >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
        <span className="flex-1 truncate">{current.label}</span>
        <ChevronDown
          size="0.9375rem"
          strokeWidth={1.8}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="panel-fade-in absolute inset-x-0 top-[calc(100%+0.25rem)] z-20 rounded-card border border-line bg-surface-2 p-1 shadow-overlay">
          <div role="listbox" aria-label="Availability" className="flex flex-col gap-px">
            {AVAILABILITY.map((a) => {
              const on = a.value === value
              return (
                <button
                  key={a.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    setOpen(false)
                    onChange(a.value)
                  }}
                  className={`rounded-btn flex w-full items-center gap-2.5 px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                    on ? 'bg-white/8' : 'hover:bg-white/6'
                  }`}
                >
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="text-base font-medium leading-tight text-text">{a.label}</span>
                    <span className="truncate text-sm leading-snug text-muted">{MEANING[a.value]}</span>
                  </span>
                  {on && <Check size="0.9375rem" strokeWidth={2} className="shrink-0 text-text" />}
                </button>
              )
            })}
          </div>
          {/* Away is not a choice — shown so people know where it comes from. */}
          <div className="mt-0.5 flex items-center gap-2.5 border-t border-line px-2 pt-2 pb-1">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border-2" style={{ borderColor: AWAY.color }} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-base font-medium leading-tight text-muted">{AWAY.label}</span>
              <span className="truncate text-sm leading-snug text-faint">Set for you while idle or this tab is hidden</span>
            </span>
            <span className="shrink-0 rounded-btn border border-line px-1.5 py-px text-xs font-medium text-faint">Automatic</span>
          </div>
        </div>
      )}
    </div>
  )
}
