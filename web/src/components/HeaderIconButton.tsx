import type { ReactNode } from 'react'

// ── Shared icon-button style ────────────────────────────────────────────────
// ONE source of truth for the app's borderless 36×36 icon action button:
// rounded-full, muted glyph that warms on hover, a subtle hover fill, an
// on-theme focus ring, no border, no shadow. Exported so non-button preview
// surfaces that can't use this component directly — e.g. the download <a> link
// and the tooltip-wrapped buttons in the attachment preview action bar — render
// the IDENTICAL control instead of a one-off class string.
export const ICON_ACTION_BASE =
  'h-9 w-9 flex items-center justify-center rounded-full transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ' +
  'disabled:opacity-30 disabled:cursor-default'
export const ICON_ACTION_IDLE = 'text-muted hover:text-text hover:bg-white/[0.05]'
export const ICON_ACTION_ACTIVE = 'text-text bg-white/[0.06]'

type Props = {
  /** Accessible name + default tooltip. */
  label: string
  onClick: () => void
  children: ReactNode
  /** Toggled/pressed look (e.g. the search button while search is open). Also
   *  sets aria-pressed so the control reads as a toggle. */
  active?: boolean
  disabled?: boolean
  /** Overrides the tooltip text when it should differ from `label`. */
  title?: string
  /** Tags the button with `data-search-region` so ChatView's outside-click
   *  handler treats clicks on it as inside the search UI. */
  searchRegion?: boolean
}

// The app's standard borderless header / overlay action button: a 36×36 circle
// with a muted glyph that warms on hover, an on-theme focus ring, and an
// optional pressed (active) state. Shared by the chat header (search, group
// info) and the attachment preview top bar so every action button reads the
// same — borderless, no shadow, muted icon. Icon size/stroke is set by the
// caller's child glyph so each surface keeps its existing sizing.
export default function HeaderIconButton({
  label,
  onClick,
  children,
  active,
  disabled,
  title,
  searchRegion,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      data-search-region={searchRegion ? '' : undefined}
      className={`${ICON_ACTION_BASE} ${active ? ICON_ACTION_ACTIVE : ICON_ACTION_IDLE}`}
    >
      {children}
    </button>
  )
}
