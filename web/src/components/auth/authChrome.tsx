import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import AppMark from '../AppMark'
import { RowMeta } from '../../pages/sidebarBits'
import { FIELD_EDGE } from '../forms/fieldStyles'

// ── Auth chrome ─────────────────────────────────────────────────────────────
// The drawing vocabulary of the signed-out pages, in the same shape as
// threadChrome / panelChrome / profileChrome: one module the auth surfaces
// render THROUGH, so sign in, create workspace and "check your email" can't
// drift apart the way they had.
//
// The page is the app's own geometry. Dispo-chat is a rail and a thread with a
// single hairline between them; the auth page is an identity column and a form
// column with the SAME hairline between them. Nothing here is decoration —
// before this the page carried a masked 48px grid and a 34rem white blur pool
// behind the column, which is exactly the tone-and-glow the rework took out of
// every other surface. A signed-out page is not the one place that gets to keep
// a light source.
//
// Everything below is on the shared scales: `line` for every rule, `.eyebrow`
// for the label voice, the rem type steps, the field recipe's own hover/focus
// progression (FIELD_EDGE), and the square radius tokens. No literal colours,
// no fills, no shadows.

// What the left column says about the product. Deliberately written as three
// RAIL ROWS — a name over a meta line, split by a hairline, which is the
// exact row the sidebar draws for a conversation (see SidebarGroupRow: the
// avatars came off and line 2 took over the identifying job). RowMeta is the
// real component, imported rather than re-drawn, so if that idiom ever changes
// this page follows it.
const SURFACES: { title: string; meta: string[] }[] = [
  { title: 'Vehicle rooms', meta: ['Plate', 'Corridor', 'Crew'] },
  { title: 'Trips and routes', meta: ['Planner', 'Stops', 'Live position'] },
  { title: 'Company network', meta: ['Internal', 'Cross-company'] },
]

// The measure both columns are set to. One number, so the identity block and
// the form are the same width and hang off the seam symmetrically.
const COLUMN = 'w-full max-w-[26.25rem]'

// The page. Two columns split by one rule at `lg`, stacked under it with the
// identity block as a header band and the rule turned horizontal — the rule
// never disappears, it just changes axis, because it IS the layout.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-bg text-text lg:grid lg:grid-cols-2">
      <AuthIdentity />
      {/* Both blocks sit against the seam with equal padding, rather than each
          being centred in its own half — on a wide display centring would open
          a gap in the middle that a hairline is far too quiet to hold. */}
      <div className="auth-grid flex flex-1 items-center justify-center px-6 py-12 sm:px-10 lg:border-l lg:border-line lg:px-14">
        {/* The form is a card (user, 2026-10-15: "a more modern look, keeping the
            theme"): the same one hairline and 10px curve as every other surface,
            lifted by a top highlight and the overlay shadow. */}
        <main className={`relative rounded-soft border border-line bg-bg px-6 pb-7 pt-9 shadow-overlay sm:px-8 ${COLUMN}`}>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-text/50 to-transparent"
          />
          {children}
        </main>
      </div>
    </div>
  )
}

function AuthIdentity() {
  return (
    <aside className="relative flex flex-col justify-center overflow-hidden border-b border-line px-6 py-8 sm:px-10 lg:items-end lg:border-b-0 lg:px-14 lg:py-12">
      <AuthEmber />
      <div className={`relative ${COLUMN}`}>
        <div className="flex items-center gap-2.5">
          <AppMark size={30} />
          <span className="text-2xl font-semibold tracking-[-0.01em]">Dispo-chat</span>
        </div>

        {/* Hidden on the narrowest screens: there the band exists to say which
            app this is, and the form should start above the fold. */}
        <p className="mt-4 hidden text-lg leading-normal text-muted sm:block">
          A dispatcher workspace for transport teams. Every conversation is
          attached to something real — a truck, a trip, a company.
        </p>

        <div className="mt-9 hidden border-t border-line lg:block">
          {SURFACES.map((surface) => (
            <div key={surface.title} className="border-b border-line py-3">
              <div className="text-lg leading-snug">{surface.title}</div>
              <div className="mt-1">
                <RowMeta segments={surface.meta} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

// Eyebrow → title → lede. The eyebrow is what the old tab strip used to do: it
// names which flow you are in, in the label voice the app uses for structure
// everywhere else, and it costs one line instead of a second control that
// duplicates the switch at the bottom of the form.
// The identity half's live background (user, 2026-10-15, "Ember"): copper light
// rises from the bottom edge and breathes, a second, redder glow drifts beside
// it and a cool white veil hangs above. Three blurred discs and nothing else —
// no canvas, no script. Behind the text, never over it; it holds still when the
// OS or the Animations setting asks for stillness (see .auth-ember in index.css).
function AuthEmber() {
  return (
    <div aria-hidden className="auth-ember pointer-events-none absolute inset-0">
      <i className="auth-ember-rise" />
      <i className="auth-ember-drift" />
      <i className="auth-ember-veil" />
    </div>
  )
}

export function AuthHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string
  title: string
  children?: ReactNode
}) {
  return (
    <header>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className={`${eyebrow ? 'mt-3' : ''} text-4xl font-semibold leading-tight tracking-[-0.03em]`}>{title}</h1>
      {children ? <p className="mt-2 text-lg leading-normal text-muted">{children}</p> : null}
    </header>
  )
}

export const AUTH_LABEL = 'mb-2 block text-base font-medium'

// The app's field recipe (components/forms/fieldStyles) one size step up: same
// square corner, same hairline edge with no fill, and the SAME hover/focus
// progression imported directly — only the control height and text size change,
// because an auth field on a bare canvas is doing more work than a row in a
// dense panel.
//
// `bg-transparent` is load-bearing and NOT redundant. Tailwind's preflight
// zeroes the background of buttons only; a text input keeps the UA's, and under
// `color-scheme: dark` that is a solid rgb(59,59,59) — a fill several steps
// louder than the #2C2C2C hairline that is supposed to be the field's only
// mark. Without this line "a field is drawn, not filled" is true of the CSS and
// false of the pixels. Every hand-rolled input in the app writes it for the
// same reason; FIELD_BASE itself still doesn't (see EditableField).
export const AUTH_FIELD =
  'w-full min-w-0 h-11 px-3 rounded-card border bg-transparent text-lg text-text ' +
  'placeholder:text-faint/70 outline-none ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ' +
  'motion-reduce:transition-none ' +
  FIELD_EDGE

export function AuthField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  autoFocus,
  required,
  icon,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  autoFocus?: boolean
  required?: boolean
  /** A glyph at the field's left edge. */
  icon?: ReactNode
}) {
  return (
    <div>
      <label className={AUTH_LABEL} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        {icon && <AuthFieldIcon>{icon}</AuthFieldIcon>}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        className={`${AUTH_FIELD} ${icon ? 'pl-10' : ''}`}
      />
      </div>
    </div>
  )
}

// Something went wrong, drawn the way the timeline draws a message: a rule down
// the left and the text indented off it, in alert. It used to be a tinted
// bordered box — a fill and four rules to say one thing. The indent is
// --msg-indent's 14px, so the text hangs off its rule at exactly the distance
// every message in the app does.
// The glyph at a field's left edge. Decorative: the label already names it.
export function AuthFieldIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-faint"
    >
      {children}
    </span>
  )
}

export function AuthNotice({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div
      role={live ? 'alert' : undefined}
      aria-live={live ? 'polite' : undefined}
      className="border-l border-alert py-0.5 pl-3.5 text-base leading-normal text-alert"
    >
      {children}
    </div>
  )
}

// The page's one primary action — the app's primary-button recipe (FormActions'
// `bg-text text-bg`) at full width and the 40px auth control height.
export function AuthButton({
  children,
  busy = false,
  busyLabel,
  trailing,
  type = 'submit',
  onClick,
}: {
  children: ReactNode
  busy?: boolean
  /** Replaces the label while the request is in flight. */
  busyLabel?: string
  /** Rest-state glyph after the label — the spinner takes its place while busy. */
  trailing?: ReactNode
  type?: 'submit' | 'button'
  onClick?: () => void
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      className="group flex h-11 w-full items-center justify-center gap-2 rounded-soft bg-text text-lg font-semibold text-bg transition-colors hover:bg-text/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy && busyLabel ? busyLabel : children}
      {busy ? (
        <Loader2
          size="0.9375rem"
          strokeWidth={2.2}
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        trailing
      )}
    </button>
  )
}

// The closing line under the form — the flow switch, or the way back. A hairline
// separates it so it reads as an aside rather than as a third form control.
// "New here?" — a quiet rule with a word in it, then an outlined button: the
// other way through the page, one step quieter than the primary action.
export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-3 text-sm text-faint">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export function AuthSecondaryButton({
  children,
  icon,
  onClick,
}: {
  children: ReactNode
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-soft border border-line-2 text-lg font-medium text-text transition-colors hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {icon}
      {children}
    </button>
  )
}

export function AuthAside({ children }: { children: ReactNode }) {
  return <p className="mt-8 border-t border-line pt-5 text-base text-muted">{children}</p>
}

export const AUTH_LINK =
  'font-semibold text-text underline-offset-4 transition-opacity ' +
  'hover:underline hover:opacity-80 focus-visible:underline focus-visible:outline-none'
