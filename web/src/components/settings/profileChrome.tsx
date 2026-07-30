// ── Shared profile / info-panel chrome ──────────────────────────────────────
// Account is the reference for every "who / what is this" surface in the app.
// My profile, User profile (preview), Company profile and Group info all render
// the same three parts in the same order and at the same metrics:
//
//   PanelHeader (panelChrome)  — the seam, back or close affordance, title
//   ProfileHero                — large image, name, one meta line, status pill,
//                                optional icon actions, optional error
//   ProfileSection × n         — eyebrow label over ONE grouped card of rows
//
// Everything below is presentational. The rows themselves stay EditableRow, so a
// field is read-only or individually editable purely by whether the caller
// passes `editable` + `onSave` — which is where each surface's permission rule
// lives (own profile, company admin, group manager).

import type { ReactNode } from 'react'
import { rem } from '../../lib/density'

// The hero image size shared by Account, My profile, User profile, Company
// profile and Group info. Design px rendered as rem by the size-prop components
// (Avatar / GroupAvatar / CompanyLogo), so it tracks --ui-scale and shrinks on
// compact displays and narrow rails without any per-panel override.
export const PROFILE_HERO_SIZE = 168

// The avatar SLOT. Every profile surface puts its image through this, so the
// picture lands on exactly the same pixel whichever panel you are on — the thing
// that was visibly shifting when moving between Account and My profile.
//
// It reserves the hero box unconditionally (fixed width AND height, centred),
// so all of these occupy identical space:
//   • a loaded photo
//   • the generated fallback initials/glyph
//   • the still-loading state
//   • the editable variant, whose hover scrim and corner "Options" button are
//     absolutely positioned INSIDE the slot and therefore add nothing to it
// Height is reserved with a real box rather than min-height so the content below
// (name, meta, sections) starts at the same y on every panel.
export function ProfileAvatarSlot({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: rem(PROFILE_HERO_SIZE), height: rem(PROFILE_HERO_SIZE) }}
    >
      {children}
    </div>
  )
}

// The panel body: one scroll region with the app's standard panel padding and
// the same rhythm between sections everywhere.
//
// `scrollbar-gutter: stable` is load-bearing, not a detail. Account is short
// enough not to scroll while My profile is long enough to, so without a
// reserved gutter the two bodies had different content widths — and the centred
// avatar landed 5px further right on Account than on My profile, which is
// exactly the shift you see when flipping between them. Reserving the gutter on
// every panel makes the centre line identical whether or not a panel scrolls.
export const PANEL_BODY =
  'flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 py-4 space-y-5'

// Right-hand panels opened beside the conversation share the chat window's base
// tone. Panels that replace the conversation list in the LEFT sidebar use the
// pure-black sidebar token instead, so drilling into Account / Profile /
// Company / Settings never changes the rail's background colour.
export const PANEL_SURFACE = 'bg-panel'
export const SIDEBAR_PANEL_SURFACE = 'bg-sidebar'

// A grouped card of rows — the same recipe as Account's settings groups. Rows
// inside carry their own hairline (EditableRow), so this only draws the box.
export const PANEL_FIELD_CARD = 'rounded-card border border-white/6 bg-white/2 px-3.5'

// One labelled block: eyebrow over a grouped card. `action` is an optional
// trailing control on the label line (e.g. "Invite" in the members list).
export function ProfileSection({
  label,
  action,
  children,
  /** Rows already bring their own card (members, invites) — skip the wrapper. */
  bare = false,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
  bare?: boolean
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="eyebrow">{label}</span>
        {action}
      </div>
      {bare ? children : <div className={PANEL_FIELD_CARD}>{children}</div>}
    </section>
  )
}

// The identity hero. `image` is the caller's avatar slot — an AvatarPhotoEditor
// wrapping an Avatar / GroupAvatar / CompanyLogo — so each surface keeps its own
// shape and its own change/crop permissions while the layout stays identical.
export function ProfileHero({
  image,
  title,
  subtitle,
  meta,
  status,
  actions,
  error,
}: {
  image: ReactNode
  title: string
  /** Role · job title, member count, "Managed by an admin" … */
  subtitle?: ReactNode
  /** A quieter third line (plates, workspace, etc.). */
  meta?: ReactNode
  /** Availability pill or status chip. */
  status?: ReactNode
  /** Icon actions row (message, connect, …). */
  actions?: ReactNode
  error?: string | null
}) {
  return (
    // pt-1 + the fixed avatar slot are the whole reason this is one component:
    // the distance from the panel header to the top of the picture is defined
    // HERE, once, instead of by whatever each panel happened to wrap its avatar
    // in. Nothing between the header and the image may add margin.
    <div className="relative flex flex-col items-center text-center pt-1">
      <ProfileAvatarSlot>{image}</ProfileAvatarSlot>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.2px] leading-tight break-words max-w-full">
        {title}
      </h2>
      {subtitle && <div className="mt-1 text-base text-muted">{subtitle}</div>}
      {meta && <div className="mt-1 text-sm text-faint">{meta}</div>}
      {status && <div className="mt-2.5">{status}</div>}
      {actions && <div className="mt-3 flex items-center justify-center gap-1">{actions}</div>}
      {error && <p className="mt-2 text-sm text-alert leading-[1.4]">{error}</p>}
    </div>
  )
}

// The availability pill, in its resting (read-only) form. ProfileSidebarPanel
// wraps the same visual in a button to open its status menu, so the pill looks
// identical whether or not it can be changed.
export function StatusPill({
  label,
  color,
  suffix,
  trailing,
}: {
  label: string
  color: string
  /** e.g. "· auto" when presence overrides the stored status. */
  suffix?: ReactNode
  /** e.g. a chevron when the pill opens a menu. */
  trailing?: ReactNode
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium"
      style={{ color, backgroundColor: `${color}22` }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
      {suffix}
      {trailing}
    </span>
  )
}
