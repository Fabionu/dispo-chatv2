// ── Shared sidebar-panel chrome ─────────────────────────────────────────────
// The rail's drill-in views (Account, My profile, Company profile, Workspace
// settings and every settings detail) are ONE navigation pattern: a header that
// lines up with the conversation toolbar and carries a single back affordance,
// over a scrolling body of grouped rows. Each panel used to redeclare its own
// copy of that header; they live here now so a drill-in always reads the same
// wherever it opens — the same exported-recipe approach as menuStyles.ts.

import type { ReactNode } from 'react'
import { ArrowLeft, ChevronRight, X } from 'lucide-react'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'

// Drill-in header — matches the rail's header height so the panel title sits on
// the same line as the conversation toolbar it replaced. The back target differs
// per level (detail → list, list → conversations), so it's passed in along with
// an accessible label.
export function PanelHeader({
  title,
  onBack,
  backLabel,
  action,
}: {
  title: string
  onBack: () => void
  backLabel: string
  /** Optional trailing control (e.g. a panel-level action button). */
  action?: ReactNode
}) {
  return (
    <div className="h-[var(--header-height)] flex items-center gap-2 px-3 shrink-0">
      <button
        onClick={onBack}
        aria-label={backLabel}
        title={backLabel}
        className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
      >
        <ArrowLeft size="1.25rem" strokeWidth={1.8} />
      </button>
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
      {action}
    </div>
  )
}

// The same seam for panels that CLOSE rather than drill back — the right-hand
// side panels (Group info, User profile) and overlay drawers. Title on the left,
// one circular close action on the right, identical height and type to
// PanelHeader so every panel in the app starts on the same line.
export function PanelCloseHeader({
  title,
  onClose,
  closeLabel,
  action,
}: {
  title: string
  onClose: () => void
  closeLabel: string
  /** Optional extra control, placed before the close button. */
  action?: ReactNode
}) {
  return (
    <div className="h-[var(--header-height)] flex items-center gap-1 px-4 shrink-0">
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
      {action}
      <button
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0 -mr-1.5`}
      >
        <X size="1.125rem" strokeWidth={1.8} />
      </button>
    </div>
  )
}

// One entry of a grouped list card — leading glyph chip, title over its live
// current value, trailing chevron. Rows share the card's border and are
// separated by hairlines; hover brightens the row only, so the group reads as
// one calm menu.
export function CategoryRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: ReactNode
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20"
    >
      <span className="h-8 w-8 shrink-0 flex items-center justify-center rounded-tile border border-line bg-white/2 text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-text leading-tight">{title}</span>
        <span className="block text-sm text-faint mt-0.5 leading-[1.4] truncate">{value}</span>
      </span>
      <ChevronRight size="1rem" strokeWidth={1.8} className="shrink-0 text-faint" />
    </button>
  )
}

// The wrapper every grouped row list shares: hairline card, hairline dividers,
// clipped corners so the first/last row hover follows the radius.
//
// `overflow-hidden` is what makes the radius safe here — CategoryRow's hover
// fill is full-bleed, so without the clip it would square off the top and
// bottom corners on hover. A list that must let a popover escape its edge
// cannot use this recipe; see the invites list in WorkspaceSettingsPanel, which
// rounds its own first/last rows instead.
export const PANEL_GROUP_CARD =
  'rounded-list border border-line bg-white/2 divide-y divide-line overflow-hidden'
