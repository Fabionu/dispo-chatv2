import { Fragment, forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

// ── The trigger ─────────────────────────────────────────────────────────────
// ONE affordance for both timeline styles: the bubble variant rides the
// bubble's outer edge as a small circular control, the inline variant sits in
// the plain stream's meta row with no chrome of its own. Shared so the two can't
// drift in size, tone or motion.
//
// Motion is deliberately small: it fades in with a slight lift and scale (never
// a size or position change on the BUBBLE — the button is always mounted and
// only its opacity/transform move, so revealing it can't reflow the row), and
// the chevron rotates a controlled half-turn while the actions are open.
// Reduced motion drops the transitions and the resting transform, so the button
// simply appears already in place.
export const MessageActionsTrigger = forwardRef<
  HTMLButtonElement,
  {
    open: boolean
    onToggle: () => void
    /** 'bubble' — circular control beside a bubble; 'inline' — bare glyph in
     *  the plain stream's trailing meta cluster. */
    variant?: 'bubble' | 'inline'
  }
>(function MessageActionsTrigger({ open, onToggle, variant = 'bubble' }, ref) {
  // Each timeline style names its own hover group, so the reveal condition
  // differs; everything else about the control is identical.
  const reveal = open
    ? 'opacity-100 scale-100 translate-y-0 text-text'
    : variant === 'bubble'
      ? 'opacity-0 scale-90 -translate-y-0.5 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 focus-visible:opacity-100 focus-visible:scale-100 focus-visible:translate-y-0'
      : 'opacity-0 scale-90 -translate-y-0.5 group-hover/msg:opacity-100 group-hover/msg:scale-100 group-hover/msg:translate-y-0 focus-visible:opacity-100 focus-visible:scale-100 focus-visible:translate-y-0'

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label="Message actions"
      aria-haspopup="menu"
      aria-expanded={open}
      className={`shrink-0 flex items-center justify-center text-faint
        transition-[opacity,transform,color,background-color] duration-200 ease-out
        motion-reduce:transition-none motion-reduce:transform-none
        hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
          variant === 'bubble'
            ? 'h-6 w-6 rounded-full hover:bg-white/4'
            : 'leading-none pb-[2px]'
        } ${reveal}`}
    >
      <ChevronDown
        size="0.9375rem"
        strokeWidth={1.8}
        aria-hidden
        className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
          open ? 'rotate-180' : ''
        }`}
      />
    </button>
  )
})

export type MessageAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'alert'
  // Lucide glyph — the ONLY thing rendered; the label lives in the tooltip.
  icon?: ReactNode
  // Render a hairline before this item — used to set the destructive (delete)
  // actions apart from the rest.
  separator?: boolean
}

type Props = {
  actions: MessageAction[]
  // Own messages align right and take the own-bubble fill; incoming ones align
  // left with the incoming fill, so the strip reads as part of its own message.
  mine: boolean
  open: boolean
  onClose: () => void
}

// A message's actions, inline UNDER its bubble instead of in a floating
// popover: the strip belongs to the message it came from, stays put while the
// thread scrolls, and never covers the messages around it. Icons only — hover
// (or focus) names the action — so the strip stays narrow enough to sit under
// even a short bubble. Styled as a small sibling of the bubble: same fill, same
// corner family, so it reads as chat furniture rather than a system menu.
export default function MessageActionsPanel({ actions, mine, open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Opening on the newest message puts the strip behind the composer, which
  // OVERLAYS the bottom of the thread's scroll area. `nearest` alone can't see
  // that: the strip is inside the scrollport, so the browser considers it in
  // view and scrolls nothing — it just happens to be under the input. The
  // scroll margin (--composer-reserve, published by ChatView's scroller) makes
  // scrollIntoView aim for the last VISIBLE pixel instead of the scroller's
  // edge, so the strip clears the composer. Still `nearest`, so a strip already
  // in the clear doesn't move the thread at all.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Message actions"
      aria-hidden={!open}
      onClick={(e) => e.stopPropagation()}
      // Keeps the strip clear of the overlaid composer when it scrolls itself
      // into view (see the effect above). Falls back to 0 outside that scroller.
      style={{ scrollMarginBottom: 'var(--composer-reserve, 0px)' }}
      // rounded-[1rem] — the bubble's own outer radius (shapeMine/shapeOther),
      // so the strip reads as that bubble's footer, not a foreign card.
      className={`${open ? 'action-strip-enter' : 'action-strip-exit pointer-events-none'} mt-1 flex w-max origin-top items-center gap-0.5 rounded-[0.875rem] border px-1 py-0.5 ${
        mine ? 'origin-top-right' : 'origin-top-left'
      } ${
        mine ? 'bg-bubble-own border-white/8' : 'bg-surface-2 border-white/6'
      }`}
    >
      {actions.map((a, i) => {
        const alert = a.tone === 'alert'
        return (
          <Fragment key={i}>
            {a.separator && <span aria-hidden className="mx-0.5 h-3.5 w-px bg-white/8" />}
            <button
              type="button"
              role="menuitem"
              disabled={a.disabled}
              // Native tooltip: the same affordance the rest of the app uses for
              // icon-only controls (sidebar badges, header actions).
              title={a.label}
              aria-label={a.label}
              onClick={() => {
                if (a.disabled) return
                a.onClick()
                onClose()
              }}
              className={`flex h-6 w-7 shrink-0 items-center justify-center rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent ${
                alert
                  ? 'text-alert hover:bg-alert/10'
                  : 'text-muted hover:bg-white/6 hover:text-text'
              }`}
            >
              {a.icon}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
