// ── Shared dropdown/menu surface ─────────────────────────────────────────────
// ONE source of truth for every anchored floating surface — context menus,
// dropdowns, suggestion lists, pickers and small popovers: card radius, the
// standard hairline border, `surface` fill and one consistent elevation shadow,
// so menus read as the same layer wherever they open (same pattern as
// ICON_ACTION_* in HeaderIconButton.tsx). Callers add positioning, sizing and
// inner padding (typically `py-1`, plus `overflow-hidden` for edge-to-edge
// item hovers).
export const MENU_SURFACE =
  'rounded-card border border-white/[0.08] bg-surface shadow-[0_12px_32px_rgba(0,0,0,0.5)]'
