// Small presentational bits for the workspace sidebar: the unified-list filter
// pill, the empty-list hint, and the two menu-item styles (user menu + the
// create/options menu). Kept together so the rail's row/menu chrome lives in one
// place; behaviour is identical to the previous inline definitions.

import type { ReactNode } from 'react'
import { menuIconClass, menuItemClass } from '../components/menuStyles'

// One item in the rail's TYPE segmented control (All / Groups / Direct). Lives
// inside a recessed track (see Workspace): the active option lifts to a soft
// white pill, the others stay quiet and warm on hover. Sized off the rail's
// meta-font token so it scales with display density. The Archived STATE lives on
// its own toggle (ArchiveToggle) — never mixed in here.
export function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
      className={`h-6 px-2.5 rounded-btn font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'bg-white/[0.06] text-text' : 'text-faint hover:bg-white/[0.025] hover:text-muted'
      }`}
    >
      {children}
    </button>
  )
}

// The Archived-state toggle — a quiet icon button sitting apart from the type
// tabs, so the two filter axes (what TYPE vs. archived STATE) never read as peers.
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
        active ? 'bg-white/[0.06] text-text' : 'text-faint hover:text-muted hover:bg-white/[0.025]'
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
