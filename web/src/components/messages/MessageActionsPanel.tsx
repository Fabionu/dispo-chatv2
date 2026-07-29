import { Fragment, useEffect, useRef, type ReactNode } from 'react'

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
  onClose: () => void
}

// A message's actions, inline UNDER its bubble instead of in a floating
// popover: the strip belongs to the message it came from, stays put while the
// thread scrolls, and never covers the messages around it. Icons only — hover
// (or focus) names the action — so the strip stays narrow enough to sit under
// even a short bubble. Styled as a small sibling of the bubble: same fill, same
// corner family, so it reads as chat furniture rather than a system menu.
export default function MessageActionsPanel({ actions, mine, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Opening on the newest message pushes the strip under the composer, which
  // sits below the thread's scroll area. `nearest` scrolls the minimum needed —
  // and nothing at all when the strip is already fully in view.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Message actions"
      onClick={(e) => e.stopPropagation()}
      // rounded-[1rem] — the bubble's own outer radius (shapeMine/shapeOther),
      // so the strip reads as that bubble's footer, not a foreign card.
      className={`mt-1 flex w-max items-center gap-0.5 rounded-[1rem] border px-1 py-1 ${
        mine ? 'bg-bubble-own border-white/8' : 'bg-surface-2 border-white/6'
      }`}
    >
      {actions.map((a, i) => {
        const alert = a.tone === 'alert'
        return (
          <Fragment key={i}>
            {a.separator && <span aria-hidden className="mx-0.5 h-4 w-px bg-white/8" />}
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
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-btn transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent ${
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
