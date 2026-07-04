// Small presentational bits for the workspace sidebar: the unified-list filter
// pill, the empty-list hint, and the two menu-item styles (user menu + the
// create/options menu). Kept together so the rail's row/menu chrome lives in one
// place; behaviour is identical to the previous inline definitions.

// Compact pill toggle for the rail's unified-list filter. Theme-native: no
// border, a subtle filled state when active, quiet hover otherwise. Sized off
// the rail's meta-font token so it scales with display density.
export function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ fontSize: 'var(--sidebar-meta-font-size)' }}
      className={`h-8 px-3.5 rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'bg-white/[0.08] text-text' : 'text-muted hover:text-text hover:bg-white/[0.04]'
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
  const danger = tone === 'danger'
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[0.8125rem] transition-colors text-left ${
        danger ? 'text-alert hover:bg-alert/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      <span className={danger ? 'text-alert' : 'text-muted'}>{icon}</span>
      {children}
    </button>
  )
}

export function CreateMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className="w-full px-2.5 py-2 text-[0.8125rem] hover:bg-white/[0.03] transition-colors text-left whitespace-nowrap"
    >
      {label}
    </button>
  )
}
