// Small presentational bits for the workspace sidebar: the unified-list filter
// pill, the empty-list hint, and the two menu-item styles (user menu + the
// create/options menu). Kept together so the rail's row/menu chrome lives in one
// place; behaviour is identical to the previous inline definitions.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { menuIconClass, menuItemClass } from '../components/menuStyles'

// ── Conversation-row glyph spec ─────────────────────────────────────────────
// Pinned, muted and the actions trigger used to each carry their own size and
// stroke (13px/1.8, 12px/1.7, 12px/1.8), which is why they never quite lined up
// on a row. They are ONE family now: same lucide outline set, same optical box,
// same stroke, same tone. Sizes are rem so they track the UI scale.
export const ROW_GLYPH = { size: '0.8125rem', strokeWidth: 1.7 } as const

// A state indicator on the preview line (pinned, muted). Deliberately quieter
// than the unread badge — it reports a setting, it does not demand attention —
// and it is a labelled <span role="img"> so screen readers and tooltips both
// name it (a bare <svg aria-label> is not announced).
export function RowStateIcon({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="shrink-0 inline-flex items-center justify-center text-faint"
    >
      <Icon {...ROW_GLYPH} aria-hidden />
    </span>
  )
}

// The row's actions trigger: the same chevron as the message bubble's, with the
// three states the rest of the app uses — idle (hidden until the row is hovered
// or focused), hover/focus (warms + fills), open (stays visible, flipped).
export function RowActionsTrigger({
  open,
  label,
  onToggle,
}: {
  open: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        // Never let the click fall through to the row (which opens the chat).
        e.stopPropagation()
        e.preventDefault()
        onToggle()
      }}
      className={`h-5 w-5 flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        open ? 'bg-white/8 text-text' : 'text-muted hover:text-text hover:bg-white/6'
      }`}
    >
      <ChevronDown
        {...ROW_GLYPH}
        aria-hidden
        className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
          open ? 'rotate-180' : ''
        }`}
      />
    </button>
  )
}

// The rail's segmented control as a whole — the Archived toggle plus the type
// tabs — and the single moving bar that marks which one is live.
//
// ONE BAR, NOT A BORDER PER TAB. Every tab used to draw its own bottom rule, so
// the selection teleported: the mark disappeared in one place and reappeared in
// another, which reads as two marks rather than one selection moving. A shared
// bar travels the distance and takes the eye with it. It is placed with a
// transform and a width, so the motion costs no layout and cannot disturb the
// tabs it runs under.
//
// The position is MEASURED off whichever child reports `aria-pressed="true"`
// rather than passed down: the buttons already declare their state for
// assistive tech, and reading the same source means the bar can never disagree
// with what a screen reader is told. Measuring also means the bar survives the
// row wrapping at the narrowest rail width — it tracks y as well as x.
export function FilterTabBar({
  activeKey,
  children,
}: {
  /** Changes whenever the selection does; re-measures the bar. */
  activeKey: string
  children: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [bar, setBar] = useState<{ x: number; y: number; w: number } | null>(null)

  const measure = useCallback(() => {
    const row = rowRef.current
    if (!row) return
    const active = row.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!active) {
      setBar(null)
      return
    }
    const x = active.offsetLeft
    // One pixel above the item's bottom edge, so the 2px bar covers the tab's
    // own (now permanently transparent) hairline AND the top of the row rule
    // under it: the mark reads as that rule thickening and lighting up, not as
    // a third line stacked on the other two.
    const y = active.offsetTop + active.offsetHeight - 1
    const w = active.offsetWidth
    setBar((prev) => (prev && prev.x === x && prev.y === y && prev.w === w ? prev : { x, y, w }))
  }, [])

  useLayoutEffect(measure, [measure, activeKey])

  // The row is the offsetParent, so its own resize — the rail widening, the
  // tabs wrapping — is what moves the items. The callback ref owns the
  // observer's whole life: React calls it with `null` on unmount, and a
  // separate cleanup effect would be run once by StrictMode and kill the
  // observer for the rest of the session.
  const attachRow = useCallback(
    (node: HTMLDivElement | null) => {
      roRef.current?.disconnect()
      roRef.current = null
      rowRef.current = node
      if (!node) return
      const ro = new ResizeObserver(measure)
      ro.observe(node)
      roRef.current = ro
    },
    [measure],
  )

  // The labels are mono and the mono face loads late, so the widths measured on
  // the first pass can be the fallback font's. Re-measure once it lands.
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (live) measure()
    })
    return () => {
      live = false
    }
  }, [measure])

  return (
    <div ref={attachRow} className="relative px-3 flex items-center gap-4 shrink-0 border-b">
      <div className="flex min-w-0 flex-wrap items-center gap-4">{children}</div>
      {bar && (
        <span
          aria-hidden
          // Mounted only once a position is known, which is also what keeps the
          // first placement still: a transition has no previous value to run
          // from on the frame an element is inserted, so the bar appears under
          // the live tab and only travels on later changes.
          className="filter-tab-bar pointer-events-none absolute left-0 top-0 h-0.5 bg-text motion-reduce:transition-none"
          style={{ width: bar.w, transform: `translate(${bar.x}px, ${bar.y}px)` }}
        />
      )}
    </div>
  )
}

// One item in the rail's segmented control (All / Groups / Direct / Unread).
//
// A mono uppercase TEXT tab, not a pill: filters are chrome, and chrome speaks
// mono in this UI. The active option is marked by full-brightness text under
// the shared travelling bar rather than by a fill — a filled pill would be the
// only solid shape in a rail made entirely of rules. Sized off the shared
// eyebrow recipe. The Archived STATE lives on its own toggle (ArchiveToggle) —
// never mixed in, though it shares the bar, since exactly one of the five is
// live at a time.
//
// The transparent `border-b` stays on every tab in every state: it reserves the
// row the bar is drawn into, so switching tabs cannot shift the text by a
// pixel. `.filter-tab-active` rather than `text-text` because `.eyebrow` sets
// this label's colour and wins a tie on specificity.
export function FilterTab({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  /** Live count shown after the label (Unread). Omitted when zero. */
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`eyebrow inline-flex items-center gap-1.5 border-b border-transparent py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'filter-tab-active' : 'hover:text-text'
      }`}
    >
      {children}
      {badge !== undefined && (
        <span
          aria-hidden
          className={`min-w-[1.25em] px-1 text-center text-2xs font-semibold leading-[1.35] tabular-nums ${
            active ? 'bg-text text-bg' : 'bg-white/10 text-muted'
          }`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// The Archived-state toggle — a quiet icon button leading the type tabs. Its
// icon-only treatment keeps this state axis distinct from the labelled tabs.
export function ArchiveToggle({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      // `self-stretch`, not a fixed height: it shares the travelling bar with
      // the tabs beside it, so its bottom edge has to BE their bottom edge. At
      // h-6 it sat two pixels shy of them and the bar jogged upward on its way
      // in.
      className={`w-6 self-stretch flex items-center justify-center border-b border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'text-text' : 'text-faint hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// A rail row's second line: the conversation's operational facts, set in the
// mono voice and split by a vertical hairline — `SV 14 HLS │ RO→IT`.
//
// This is what replaced the avatar. Type used to be encoded by the identity
// slot's SHAPE (circle = person, squircle = vehicle room); now it's encoded by
// what the row can actually say about itself, which is more useful to scan and
// costs no horizontal space. Empty segments are dropped, so a row with one fact
// simply shows one.
export function RowMeta({ segments }: { segments: (string | null | undefined)[] }) {
  const parts = segments.filter((p): p is string => Boolean(p && p.trim()))
  if (parts.length === 0) return null
  return (
    <span className="eyebrow flex min-w-0 items-center leading-tight">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="mx-2 h-3 w-px shrink-0 bg-line" />}
          <span className="min-w-0 truncate">{part}</span>
        </Fragment>
      ))}
    </span>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-faint px-3 py-1 leading-[1.45]"
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
    >
      {children}
    </div>
  )
}

// One rail menu row (user menu + the create/options menu) — the shared action-
// menu recipe from menuStyles, so the sidebar's menus read identically to the
// message and conversation-row menus.
export function MenuItem({
  icon,
  onClick,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  // 'danger' renders the row (icon + label) in the alert colour, with a subtle
  // red hover — used for destructive actions like Sign out.
  tone?: 'default' | 'danger'
}) {
  return (
    <button onClick={onClick} role="menuitem" className={menuItemClass(tone)}>
      <span className={menuIconClass(tone)}>{icon}</span>
      {children}
    </button>
  )
}
