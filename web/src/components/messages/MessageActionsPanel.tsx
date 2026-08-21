import { useEffect, useRef, type ReactNode } from 'react'

export type MessageAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'alert'
  // Lucide glyph — the ONLY thing rendered; the label lives in the tooltip and
  // the accessible name.
  icon?: ReactNode
}

type Props = {
  actions: MessageAction[]
  open: boolean
  onClose: () => void
}

// The FULL action list for a message, opened by its MORE button or a
// right-click. Anchored under the message it belongs to, on that message's own
// side, so it never floats free of its subject.
//
// A single straight run of glyphs — ten actions in the width of a short
// message, which a column of named rows can't manage without covering the
// conversation underneath. The common verbs are already spelled out in the
// row's own text strip (ThreadActions in MessageRow); this is the overflow, so
// it optimises for staying out of the way.
//
// DRAWN LIKE THE COMPOSER, which is this app's other control floating over the
// thread: `bg-bg` and one hairline, with no tone step and no shadow. Earlier
// passes gave it `surface` + `shadow-overlay` — that was the old floating-card
// vocabulary, and against a flat field it read as a foreign pill rather than
// part of the same drawing.
//
// Internally: equal cells inside one drawn box, with NOTHING between them. The
// cells used to be divided by a 1px rule each (and a `line-2` one at the
// destructive boundary), which turned a seven-glyph strip into a seven-panel
// grid — more lines than glyphs. The hover wash is the only cell boundary now:
// it appears under the cell you're actually addressing, which is the only
// moment the division matters. Destructive actions still separate themselves,
// by colour.
export default function MessageActionsPanel({ actions, open, onClose }: Props) {
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
      // `origin-top` rather than a corner: the same component is anchored left
      // under an incoming message and right under one of mine.
      className={`${
        open ? 'action-strip-enter' : 'action-strip-exit pointer-events-none'
      } mt-2 flex w-max origin-top items-stretch border bg-bg`}
    >
      {actions.map((a, i) => {
        const alert = a.tone === 'alert'
        return (
          <button
            key={i}
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
            className={`flex h-7 w-8 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent ${
              alert
                ? 'text-alert hover:bg-alert/10'
                : 'text-muted hover:bg-white/6 hover:text-text'
            }`}
          >
            {a.icon}
          </button>
        )
      })}
    </div>
  )
}
