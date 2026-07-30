// Small presentational bits for the workspace sidebar: the unified-list filter
// pill, the empty-list hint, and the two menu-item styles (user menu + the
// create/options menu). Kept together so the rail's row/menu chrome lives in one
// place; behaviour is identical to the previous inline definitions.

import type { ReactNode } from 'react'
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

// One item in the rail's segmented control (All / Groups / Direct / Unread).
// The active option lifts to a soft white pill, the others stay quiet and warm
// on hover. Sized off the rail's meta-font token so it scales with display
// density. The Archived STATE lives on its own toggle (ArchiveToggle) — never
// mixed in here.
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
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
      className={`h-6 px-2.5 inline-flex items-center gap-1.5 rounded-btn font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'bg-white/10 text-text' : 'text-faint hover:bg-white/8 hover:text-text'
      }`}
    >
      {children}
      {badge !== undefined && (
        <span
          aria-hidden
          className={`min-w-[1.25em] rounded-full px-1 text-2xs font-semibold leading-[1.35] tabular-nums ${
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
// icon-only treatment keeps this state axis distinct from the labelled pills.
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
      className={`h-6 w-6 flex items-center justify-center rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'bg-white/10 text-text' : 'text-faint hover:text-text hover:bg-white/8'
      }`}
    >
      {children}
    </button>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-faint px-2 py-1 leading-[1.45]"
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
