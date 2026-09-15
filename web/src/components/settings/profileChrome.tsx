// ── Shared profile / info-panel chrome ──────────────────────────────────────
// Account is the reference for every "who / what is this" surface in the app.
// My profile, User profile (preview), Company profile and Group info all render
// the same three parts in the same order and at the same metrics:
//
//   PanelHeader (panelChrome)  — the seam, back or close affordance, title
//   ProfileHero                — full-bleed photo banner with the name, meta,
//                                status pill and actions in its scrim; parallax
//   ProfileSection × n         — eyebrow label over ONE grouped card of rows
//
// Everything below is presentational. The rows themselves stay EditableRow, so a
// field is read-only or individually editable purely by whether the caller
// passes `editable` + `onSave` — which is where each surface's permission rule
// lives (own profile, company admin, group manager).

import { useEffect, useRef, useState, type ReactNode } from 'react'

// ── The hero banner ─────────────────────────────────────────────────────────
// A port of the Android ProfileHero (ui/profile/ProfileUi.kt), which is the
// version the user asked for on the web (2026-09-14: "I like how the image
// looks when you enter the profile and the effect when you scroll"). The
// picture IS the page header: it runs the full width of the panel, the identity
// block sits in its bottom scrim, and it drifts at a third of the scroll speed
// so the page slides over it. Same numbers as the phone so the two read as one
// feature — height 94% of the width clamped 280–420, the five-stop scrim, a
// 25px name, and 0.34× parallax.
//
// It used to be a centred 168px disc with the name under it (`ProfileAvatarSlot`
// / PROFILE_HERO_SIZE, now gone). The banner replaces both, and it bleeds out of
// PANEL_BODY's padding with negative margins so the panel keeps its one scroll
// region and its one padding recipe.
const HERO_DRIFT = 0.34

// Cover for avatars (they fill the banner); contain for artwork that must not
// be cut — a company logo — which then sits on the backdrop gradient instead.
export type HeroFit = 'cover' | 'contain'

// Find the scroll container the banner lives in. The panels never pass a ref:
// the body is always the nearest ancestor that scrolls, which is exactly the
// element a `scroll` listener has to sit on.
function scrollParentOf(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null
  while (el) {
    const overflowY = getComputedStyle(el).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return el
    el = el.parentElement
  }
  return null
}

// The photo layer with its own load-failure handling: the avatar/logo URLs
// answer 204 (no body) when nothing is stored, which fails the <img> — the
// banner then shows the fallback exactly as if `src` had been null, so callers
// that only know "probably has a photo" still draw the right thing.
function HeroImage({
  src,
  alt,
  fit,
  onFailed,
}: {
  src: string
  alt: string
  fit: HeroFit
  onFailed: () => void
}) {
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={onFailed}
      className={`absolute inset-0 h-full w-full select-none ${
        fit === 'contain' ? 'object-contain p-10' : 'object-cover'
      }`}
    />
  )
}

// The identity hero. Photo + fallback + the text block over the scrim, with two
// slots the editing surfaces fill: `onPhotoClick` (View photo → lightbox) and
// `overlay` (the pinned Options control, bottom-right, like the phone's pencil).
export function ProfileHero({
  photo,
  fallback,
  fit = 'cover',
  title,
  subtitle,
  meta,
  status,
  actions,
  error,
  onPhotoClick,
  overlay,
}: {
  /** The full-size image, or null when none is stored. */
  photo: { src: string; alt: string } | null
  /** Drawn centred on the backdrop when there is no photo: initials or a glyph. */
  fallback: ReactNode
  fit?: HeroFit
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
  /** Whole-banner click, e.g. open the photo in the lightbox. */
  onPhotoClick?: () => void
  /** Controls pinned to the banner (the photo editor's Options button). */
  overlay?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const showPhoto = photo !== null && !failed
  // The layer that drifts. Driven imperatively from the scroll event — reading
  // scrollTop in a listener and writing one transform, never through React
  // state — so the parallax costs nothing per frame (the phone reads it in
  // the draw phase for the same reason).
  const driftRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFailed(false)
  }, [photo?.src])

  useEffect(() => {
    const scroller = scrollParentOf(rootRef.current)
    const layer = driftRef.current
    if (!scroller || !layer) return
    const apply = () => {
      layer.style.transform = `translate3d(0, ${scroller.scrollTop * HERO_DRIFT}px, 0)`
    }
    apply()
    scroller.addEventListener('scroll', apply, { passive: true })
    return () => scroller.removeEventListener('scroll', apply)
  }, [])

  const clickable = Boolean(onPhotoClick && showPhoto)

  return (
    // `-mx-4 -mt-4`: out of PANEL_BODY's padding to the panel's edges. The
    // height is the phone's rule — squarish on a narrow rail, capped wide.
    <div className="-mx-4 -mt-4">
      <div
        ref={rootRef}
        className="relative w-full overflow-hidden bg-bg"
        style={{ aspectRatio: '100 / 94', minHeight: '17.5rem', maxHeight: '26.25rem' }}
      >
        {/* The drifting layer: backdrop (always painted — a contain photo sits
            on it, a cover photo hides it) and the photo. */}
        <div ref={driftRef} className="absolute inset-0 will-change-transform">
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background:
                'linear-gradient(135deg, rgb(var(--color-surface-2)), rgb(var(--color-surface)), rgb(var(--color-composer)))',
            }}
          >
            {!showPhoto && (
              // Lifted out of the bottom scrim so it stays centred in the
              // visible part of the banner (the phone's 46dp).
              <div className="pb-12 text-text/35">{fallback}</div>
            )}
          </div>
          {showPhoto && (
            <HeroImage src={photo.src} alt={photo.alt} fit={fit} onFailed={() => setFailed(true)} />
          )}
        </div>

        {/* Top scrim keeps pinned controls readable over a bright photo; the
            bottom one carries the name and dissolves the picture into the
            page. The phone paints both in black; here they are the PAGE
            colour at the same alphas, so on the dark theme they are that
            black and on the light theme the picture fades into white with
            the ink text set on it — the one place the port is not literal. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, rgb(var(--color-bg) / 0.55) 0%, rgb(var(--color-bg) / 0) 22%, rgb(var(--color-bg) / 0) 52%, rgb(var(--color-bg) / 0.72) 80%, rgb(var(--color-bg)) 100%)',
          }}
        />

        {/* View photo — the whole banner, like the phone. A real button for
            keyboard users; the text block below stays on top of it so its own
            controls (status menu, actions) keep working. */}
        {clickable && (
          <button
            type="button"
            onClick={onPhotoClick}
            aria-label={`View ${photo?.alt ?? 'photo'}`}
            title="View photo"
            className="absolute inset-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-active/60"
          />
        )}

        {/* Identity, bottom-left in the scrim. Sizes are the phone's: 25/30
            semibold name, 13px meta, then the pill and any actions. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[25px] leading-[30px] font-semibold tracking-[-0.3px] text-text break-words line-clamp-2">
              {title}
            </h2>
            {subtitle && (
              <div className="mt-0.5 text-[13px] leading-tight text-muted truncate">{subtitle}</div>
            )}
            {meta && (
              <div className="mt-0.5 text-[13px] leading-tight text-faint truncate">{meta}</div>
            )}
            {status && <div className="mt-2.5">{status}</div>}
            {actions && <div className="mt-2.5 flex items-center gap-1">{actions}</div>}
          </div>
          {overlay && <div className="relative z-10 shrink-0">{overlay}</div>}
        </div>
      </div>
      {error && <p className="mx-4 mt-2 text-sm text-alert leading-[1.4]">{error}</p>}
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
//
// No `overflow-hidden` next to the radius, unlike PANEL_GROUP_CARD: the `px-3.5`
// insets every row from the card's edge, so nothing reaches a corner to square
// it off — and rows here open popovers (status, role, date pickers) that have to
// be able to escape the card.
export const PANEL_FIELD_CARD = 'rounded-list border border-line bg-white/2 px-3.5'

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
