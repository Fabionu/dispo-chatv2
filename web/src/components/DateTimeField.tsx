import { useEffect, useRef, useState, type RefObject } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react'

// Custom, theme-native date & time fields used by the stop forms. Each is a pill
// input (typeable) with an icon button that opens a compact custom picker — a
// month calendar for the date (DD/MM/YYYY) and an hour/minute list for the time
// (HH:MM, 24h). No native <input type="date/time"> (those can't be themed); the
// value is plain text so it slots into the existing free-text `plannedAt`.

// ── plannedAt <-> { date, time } ────────────────────────────────────────────
// `plannedAt` stays a single string in the data model. We compose it from the
// two fields ("DD/MM/YYYY HH:MM", or just one part) and split it back for
// editing — tolerant of legacy free-text by extracting any DD/MM/YYYY + HH:MM.
const DMY_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/
const HM_RE = /(\d{1,2}):(\d{2})/

export function splitPlannedAt(s: string | undefined): { date: string; time: string } {
  const v = (s ?? '').trim()
  const dm = v.match(DMY_RE)
  const tm = v.match(HM_RE)
  return {
    date: dm ? `${dm[1].padStart(2, '0')}/${dm[2].padStart(2, '0')}/${dm[3]}` : '',
    time: tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : '',
  }
}

export function joinPlannedAt(date: string, time: string): string {
  return [date.trim(), time.trim()].filter(Boolean).join(' ')
}

// ── Shared styling (matches the Add-trip pill fields) ───────────────────────
const FIELD_WRAP =
  'flex items-center rounded-full border border-white/[0.06] bg-white/[0.04] pr-1 transition-colors focus-within:border-white/[0.12] focus-within:bg-white/[0.05]'
const FIELD_INPUT =
  'flex-1 min-w-0 bg-transparent pl-4 pr-1 py-2 text-[0.78125rem] text-text placeholder:text-faint outline-none'
const FIELD_BTN =
  'h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors'
const POPOVER =
  'absolute z-30 mt-1.5 rounded-2xl border border-white/[0.08] bg-surface p-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)]'

// Close a popover on outside-click or Escape.
function usePopoverClose(ref: RefObject<HTMLDivElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close])
}

// ── Date field ──────────────────────────────────────────────────────────────
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parseDMY(s: string): { d: number; m: number; y: number } | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const d = +m[1]
  const mo = +m[2]
  const y = +m[3]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { d, m: mo, y }
}

export function DateField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const today = new Date()
  // The month currently shown in the calendar (m is 0-11).
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const p = parseDMY(value)
    return p
      ? { y: p.y, m: p.m - 1 }
      : { y: today.getFullYear(), m: today.getMonth() }
  })
  usePopoverClose(ref, open, () => setOpen(false))

  function toggle() {
    // Re-sync the calendar to the typed value (if any) when opening.
    if (!open) {
      const p = parseDMY(value)
      if (p) setView({ y: p.y, m: p.m - 1 })
    }
    setOpen((o) => !o)
  }

  function selectDay(d: number) {
    onChange(`${String(d).padStart(2, '0')}/${String(view.m + 1).padStart(2, '0')}/${view.y}`)
    setOpen(false)
  }

  function shift(delta: number) {
    setView((v) => {
      const m = v.m + delta
      if (m < 0) return { y: v.y - 1, m: 11 }
      if (m > 11) return { y: v.y + 1, m: 0 }
      return { y: v.y, m }
    })
  }

  // Monday-first grid for the shown month.
  const firstDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const sel = parseDMY(value)
  const isSelected = (d: number) => !!sel && sel.d === d && sel.m === view.m + 1 && sel.y === view.y
  const isToday = (d: number) =>
    today.getDate() === d && today.getMonth() === view.m && today.getFullYear() === view.y

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <div className={FIELD_WRAP}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          aria-label="Planned date"
          className={FIELD_INPUT}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label="Open calendar"
          title="Pick a date"
          className={FIELD_BTN}
        >
          <Calendar size="0.9375rem" strokeWidth={1.8} />
        </button>
      </div>

      {open && (
        <div className={`${POPOVER} w-[15.25rem]`}>
          <div className="flex items-center justify-between mb-2 px-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Previous month"
              className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
            >
              <ChevronLeft size="0.9375rem" strokeWidth={1.8} />
            </button>
            <span className="text-[0.78125rem] font-medium text-text tabular-nums">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Next month"
              className="h-6 w-6 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
            >
              <ChevronRight size="0.9375rem" strokeWidth={1.8} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="h-6 flex items-center justify-center text-[0.625rem] text-faint font-medium">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) =>
              d === null ? (
                <div key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(d)}
                  className={`h-7 rounded-full text-[0.75rem] tabular-nums flex items-center justify-center transition-colors ${
                    isSelected(d)
                      ? 'bg-active text-bg font-semibold'
                      : isToday(d)
                        ? 'text-active hover:bg-white/[0.06]'
                        : 'text-text hover:bg-white/[0.06]'
                  }`}
                >
                  {d}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Time field ──────────────────────────────────────────────────────────────
function parseHM(s: string): { h: number; min: number } | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = +m[1]
  const min = +m[2]
  if (h > 23 || min > 59) return null
  return { h, min }
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
// 5-minute steps in the picker; exact minutes can still be typed in the input.
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

export function TimeField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  usePopoverClose(ref, open, () => setOpen(false))

  const parsed = parseHM(value)

  function setHour(h: number) {
    const min = parsed?.min ?? 0
    onChange(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
  }
  function setMinute(min: number) {
    const h = parsed?.h ?? 0
    onChange(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <div className={FIELD_WRAP}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="HH:MM"
          inputMode="numeric"
          maxLength={5}
          aria-label="Planned time"
          className={FIELD_INPUT}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Open time picker"
          title="Pick a time"
          className={FIELD_BTN}
        >
          <Clock size="0.9375rem" strokeWidth={1.8} />
        </button>
      </div>

      {open && (
        <div className={`${POPOVER} right-0 flex gap-2`}>
          <div className="flex flex-col">
            <div className="text-[0.625rem] text-faint font-medium text-center mb-1">Hour</div>
            <div className="h-44 w-12 overflow-y-auto flex flex-col gap-0.5 pr-1 [scrollbar-width:thin]">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHour(h)}
                  className={`h-7 shrink-0 rounded-full text-[0.75rem] tabular-nums transition-colors ${
                    parsed?.h === h ? 'bg-active text-bg font-semibold' : 'text-text hover:bg-white/[0.06]'
                  }`}
                >
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col">
            <div className="text-[0.625rem] text-faint font-medium text-center mb-1">Min</div>
            <div className="h-44 w-12 overflow-y-auto flex flex-col gap-0.5 [scrollbar-width:thin]">
              {MINUTES.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setMinute(min)}
                  className={`h-7 shrink-0 rounded-full text-[0.75rem] tabular-nums transition-colors ${
                    parsed?.min === min ? 'bg-active text-bg font-semibold' : 'text-text hover:bg-white/[0.06]'
                  }`}
                >
                  {String(min).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
