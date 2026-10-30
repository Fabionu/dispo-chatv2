import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MENU_CONTAINER, MENU_SEPARATOR, menuIconClass, menuItemClass } from '../menuStyles'

export type MessageAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'alert'
  // Lucide glyph, drawn in the row's leading slot beside the label.
  icon?: ReactNode
  // Actions of one group sit together; a hairline is drawn wherever the group
  // changes (respond / manage / destructive — see buildMessageActions).
  group?: string
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
// A NAMED LIST, grouped (user, 2026-10-30, replacing a straight run of ten
// glyphs that could only be told apart by tooltip): respond to it, manage it,
// delete it — a hairline where the group changes, so the destructive pair is
// always the last thing and never next to Reply. It is the app's shared action
// menu (menuStyles), which is what every other anchored menu already is; the
// strip it replaces was drawn like the composer, a one-off.
//
// The common verbs are still spelled out in the row's own text strip
// (ThreadActions in MessageRow); this is the full list behind MORE.
//
// ABSOLUTE, not in flow: in flow it would stretch the message block (and its
// rule) to the strip's width the moment the menu opened. A menu overlaying the
// thread around it is normal; a message silently changing shape is not.

// Extra room the strip asks the thread's scroller for when it would otherwise
// open underneath the composer. ChatView spends it as bottom padding, on top of
// the composer's own reserve; nothing else writes it, and it is cleared the
// moment the strip goes away.
const STRIP_RESERVE = '--strip-reserve'

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
  //
  // On the LAST message even that has nothing to work with. The strip is out of
  // flow, so it adds nothing to the scroller's content: the thread is already at
  // its bottom, there is no scroll left to spend, and the reserve the composer
  // sits in is exactly the band the strip hangs into. So the thread is asked for
  // the difference — the same thing it already does for the composer's own
  // height, and for the typing indicator, which lifts and settles the
  // conversation as it appears. The room is released when the strip closes.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (above) {
      // Flipped: it no longer hangs into the composer's band, so it needs no
      // room reserved — only bringing into view. Re-deciding placement from the
      // new position is also how a popover oscillates.
      el.scrollIntoView({ block: 'nearest' })
      return
    }
    const port = scrollParent(el)
    const anchor = el.offsetParent
    // No scrollport means no composer overlaying one: nothing can be occluding
    // the strip, and there is nothing to ask for room from.
    if (!port || !(anchor instanceof HTMLElement)) return

    // Everything below measures the strip's LAID-OUT box rather than its drawn
    // one. Its entrance animation is in flight while this runs, and a transform
    // moves what is painted without moving layout — read as a rect, the strip is
    // four pixels higher and 3% smaller than where it will actually settle.
    const gap = px(getComputedStyle(el).marginTop)
    const composerReserve = px(getComputedStyle(el).getPropertyValue('--composer-reserve'))
    // How far past the last visible pixel of the thread the strip reaches.
    const overrun = () =>
      anchor.getBoundingClientRect().bottom +
      gap +
      el.offsetHeight -
      (port.getBoundingClientRect().bottom - composerReserve)

    // Ask only for what is missing: a reader who has scrolled up already has
    // some of the room, and taking more than the shortfall would move the thread
    // further than the strip needs.
    const spare = port.scrollHeight - port.clientHeight - port.scrollTop
    const need = Math.ceil(overrun() - spare)
    if (need > 0) port.style.setProperty(STRIP_RESERVE, `${need}px`)

    el.scrollIntoView({ block: 'nearest' })
    // scrollIntoView aims with the DRAWN box, so the entrance animation's lift
    // leaves it those few pixels short of where the strip settles. Spend the
    // remainder of the room that was just granted.
    const short = overrun()
    if (short > 0) port.scrollTop += short

    // Last resort. With the room granted the strip always fits below, so this
    // only fires if the thread could not grant it — a scroller that doesn't
    // spend --strip-reserve, say. Flipping covers the message above, which is
    // why it is the fallback and not the fix.
    if (overrun() > 0.5) {
      const anchorRect = anchor.getBoundingClientRect()
      // Only if the message has room above it: hidden under the composer is bad,
      // clipped off the top of the thread is no better, and between the two the
      // strip may as well stay where it belongs.
      if (anchorRect.top - gap - el.offsetHeight >= port.getBoundingClientRect().top) setAbove(true)
    }

    return () => {
      port.style.removeProperty(STRIP_RESERVE)
    }
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
      //
      // `msg-anchored` + `data-side`: the bubble message style pulls this back
      // to the box's own edge — same anchor, and the same reason, as the hover
      // action strip (see ThreadActions in thread/threadChrome).
      //
      // MENU_CONTAINER: the surface, the 10px radius and the edge-to-edge item
      // hovers every named action menu shares. A fixed 14rem column keeps the
      // longest label ("Delete for everyone") on one line.
      data-side={side}
      className={`msg-anchored ${
        open
          ? above
            ? 'action-strip-enter-up'
            : 'action-strip-enter'
          : `${above ? 'action-strip-exit-up' : 'action-strip-exit'} pointer-events-none`
      } ${MENU_CONTAINER} absolute z-20 w-56 ${
        side === 'right' ? 'right-[var(--msg-indent)]' : 'left-[var(--msg-indent)]'
      } ${above ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'}`}
    >
      {actions.map((a, i) => {
        const alert = a.tone === 'alert'
        const tone = alert ? 'danger' : 'default'
        // A hairline wherever the group changes, never above the first item.
        const startsGroup = i > 0 && a.group !== actions[i - 1].group
        return (
          <Fragment key={i}>
            {startsGroup && <div role="separator" className={MENU_SEPARATOR} />}
            <button
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                if (a.disabled) return
                a.onClick()
                onClose()
              }}
              className={`${menuItemClass(tone)} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/20`}
            >
              <span aria-hidden className={menuIconClass(tone)}>
                {a.icon}
              </span>
              {a.label}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}

/** A CSS length as a number; 0 for the ones that aren't set. */
function px(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
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
