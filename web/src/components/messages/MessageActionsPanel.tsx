import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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
  /** Which edge of the message the strip hangs from — its own side. */
  side: 'left' | 'right'
  onClose: () => void
}

// The FULL action list for a message, opened by its MORE button or a
// right-click. Anchored to the message it belongs to, on that message's own
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
//
// ABSOLUTE, not in flow: in flow it would stretch the message block (and its
// rule) to the strip's width the moment the menu opened. A menu overlaying the
// thread around it is normal; a message silently changing shape is not.
export default function MessageActionsPanel({ actions, open, side, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Under the message by default — it reads as belonging to the row above it.
  // Flipped over only when there is no room left below; see the effect.
  const [above, setAbove] = useState(false)

  // Opening on the newest message puts the strip behind the composer, which
  // OVERLAYS the bottom of the thread's scroll area. `nearest` alone can't see
  // that: the strip is inside the scrollport, so the browser considers it in
  // view and scrolls nothing — it just happens to be under the input. The
  // scroll margin (--composer-reserve, published by ChatView's scroller) makes
  // scrollIntoView aim for the last VISIBLE pixel instead of the scroller's
  // edge. Still `nearest`, so a strip already in the clear doesn't move the
  // thread at all.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    // Already flipped: this pass exists only to bring the flipped strip into
    // view, and re-deciding from the new position is how a popover oscillates.
    if (above) return

    // Did the scroll actually clear the composer? On the LAST message it can't.
    // The strip is out of flow, so it adds nothing to the scroller's content and
    // there is no further scroll to spend: the thread is already at its bottom,
    // and the reserve the composer sits in is exactly the band the strip hangs
    // into — it lands underneath the input, entirely hidden. Flip it to the
    // other side of the message, the way any popover handles a wall.
    const port = scrollParent(el)
    // `top-full` is measured from the message; it is also what the strip flips
    // around.
    const anchor = el.offsetParent
    if (!port || !(anchor instanceof HTMLElement)) return
    const reserve = parseFloat(getComputedStyle(el).getPropertyValue('--composer-reserve')) || 0
    const portRect = port.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    if (rect.bottom <= portRect.bottom - reserve) return
    const anchorRect = anchor.getBoundingClientRect()
    // The gap is whatever the placement class supplies (mt-2 / mb-2), read off
    // the live layout rather than restated as a number that can drift from it.
    const gap = rect.top - anchorRect.bottom
    // Only if the message has room above it: hidden under the composer is bad,
    // clipped off the top of the thread is no better, and between the two the
    // strip may as well stay where it belongs.
    if (anchorRect.top - gap - rect.height >= portRect.top) setAbove(true)
  }, [above])

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
      // The materialisation moves AWAY from the message — down when the strip
      // hangs below it, up when it has flipped over — so the motion always reads
      // as unfolding out of the row it belongs to.
      //
      // `origin-top`/`origin-bottom` rather than a corner: the same component is
      // anchored left under an incoming message and right under one of mine.
      className={`${
        open
          ? above
            ? 'action-strip-enter-up'
            : 'action-strip-enter'
          : `${above ? 'action-strip-exit-up' : 'action-strip-exit'} pointer-events-none`
      } absolute z-20 flex w-max items-stretch border bg-bg ${
        side === 'right' ? 'right-[var(--msg-indent)]' : 'left-[var(--msg-indent)]'
      } ${above ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'}`}
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

// The thread's scrollport, when the strip is opened inside one. Found by walking
// up rather than handed down, so the strip stays a self-contained popover — it
// is rendered from a memoised row that knows nothing about the chat's layout.
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}
