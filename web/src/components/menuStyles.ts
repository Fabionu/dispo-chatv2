// ── Shared dropdown/menu recipe ──────────────────────────────────────────────
// ONE source of truth for every anchored floating action menu — context menus,
// dropdowns and small action popovers — so they read as the same layer wherever
// they open (same exported-constant pattern as ICON_ACTION_* in
// HeaderIconButton.tsx). Callers add positioning, sizing and z-index only.
//
// Surface:   card radius, standard hairline border, shared #202020 fill, one calm
//            elevation shadow. MENU_SURFACE alone is also used by non-menu
//            popovers (pickers, date fields); action menus use MENU_CONTAINER,
//            which adds the standard vertical inset.
// Items:     one row recipe (height, padding, type, hover) with two tones —
//            default and danger — plus a muted leading-glyph slot so icons
//            share a vertical axis and labels start at the same x everywhere.
// Glyphs:    lucide, MENU_GLYPH size/stroke (rem so they track the UI scale).
// Separator: a subtle hairline used only where grouping helps (e.g. before the
//            destructive group).
export const MENU_SURFACE =
  'rounded-card border border-white/[0.08] bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.5)]'

// The standard action-menu container: surface + edge-to-edge item hovers +
// the y-inset every action menu shares.
export const MENU_CONTAINER = `${MENU_SURFACE} overflow-hidden py-1`

// One menu row. Fixed metrics — no size/weight change on hover, so nothing
// shifts. Disabled rows dim uniformly and lose their hover fill.
export const MENU_ITEM =
  'w-full flex items-center gap-2.5 px-3 py-2 text-[0.8125rem] font-normal text-left ' +
  'whitespace-nowrap transition-colors ' +
  'disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent'

// Row tones. Danger is the app's single destructive treatment: alert text with
// a quiet alert-tinted hover — never a filled/bright row.
const MENU_ITEM_DEFAULT = 'text-text hover:bg-white/[0.04]'
const MENU_ITEM_DANGER = 'text-alert hover:bg-alert/10'

export function menuItemClass(tone: 'default' | 'danger' = 'default'): string {
  return `${MENU_ITEM} ${tone === 'danger' ? MENU_ITEM_DANGER : MENU_ITEM_DEFAULT}`
}

// Leading-glyph slot: muted so the label carries the row; danger rows tint the
// glyph with the text.
export function menuIconClass(tone: 'default' | 'danger' = 'default'): string {
  return `shrink-0 ${tone === 'danger' ? 'text-alert' : 'text-muted'}`
}

// Standard lucide spec for menu glyphs — spread as {...MENU_GLYPH}. rem so the
// glyphs track the global UI scale.
export const MENU_GLYPH = { size: '0.875rem', strokeWidth: 1.7 } as const

// Hairline group separator (e.g. above the destructive group).
export const MENU_SEPARATOR = 'my-1 h-px bg-white/[0.06]'
