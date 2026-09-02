// Message style: how a message is DRAWN in the thread. Same persistence shape
// as lib/theme.ts — localStorage plus a root data attribute, applied before the
// first paint so the thread never repaints from one style into the other.
//
// Two styles, and they are two readings of ONE drawing vocabulary rather than
// two skins:
//
//   timeline  the default (the 2026-08-20 rework). A message is not a shape; it
//             is a label, a 2px side rule and an indent. Ownership is the SIDE
//             the rule is on, identity is the rule's colour.
//   bubble    the message set in a block instead. One mark does it: a rounded
//             fill, no border and no accent edge, one step off the field for
//             someone else's message and two for my own. The attribution is
//             lifted OUT of the block and captions it from above, so the block
//             holds nothing but what was said — a bubble that contains its own
//             label is a card, not a bubble. Ownership is still the SIDE, and
//             the per-author colour still says which of the room's people is
//             talking; with no rule to carry it, it goes on the name. It is the
//             one rounded thing in the product (user, 2026-09-02): the radius
//             scale in tailwind.config.js is still 0 across the board, and the
//             curve belongs to this style and the composer under it — see
//             --soft-radius in index.css. Pick Timeline and every corner in the
//             app is square again.
//
// WHY A ROOT ATTRIBUTE AND NOT A PROP. The two styles render the SAME DOM. The
// attribution row is a sibling ABOVE the message's content in both, and the
// content sits in a wrapper that `display: contents` erases from the box tree
// in the timeline and that becomes the block here. The author photo and the
// hover clock are absolutely positioned into the lane either way. So the whole
// difference is what that one wrapper draws — which CSS can do on its own (see
// the bubble block in index.css).
//
// That matters for more than tidiness: a thread holds a hundred memoized rows,
// and a `useMessageStyle()` per row would mount a hundred MutationObservers.
// The attribute costs one selector match per row, in the compositor's own pass.
//
// ONE prop survives that argument (2026-09-02): `MessageRow.messageStyle`,
// read once in ChatView and passed down, for the one thing CSS cannot do —
// move an element to a different PARENT. The timestamp captions the message
// from above in the timeline and sits inside the block in the bubble style.
// The cost is re-rendering the rows when the SETTING changes, which is a
// deliberate once-in-a-while action; this note used to reject a prop on that
// ground too, and that half was overstating it. Everything that CSS can do
// still goes through the attribute — do not grow the prop into a second
// styling channel.
//
// The storage key is v3 ON PURPOSE. `dispo:msg-style-v2` belonged to the
// pre-rework bubble/plain preference that was deleted along with the bubbles;
// a browser that has been running this app for a while can still hold a value
// under that key, and it means something this module does not.

import { useEffect, useState } from 'react'

export type MessageStyle = 'timeline' | 'bubble'

const STORAGE_KEY = 'dispo:msg-style-v3'

// The timeline is the default: it is the design the thread was reworked into,
// and it stays what a new device sees.
const FALLBACK: MessageStyle = 'timeline'

function isMessageStyle(value: unknown): value is MessageStyle {
  return value === 'timeline' || value === 'bubble'
}

export function getStoredMessageStyle(): MessageStyle {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isMessageStyle(value) ? value : FALLBACK
  } catch {
    return FALLBACK
  }
}

function apply(style: MessageStyle) {
  document.documentElement.dataset.msgStyle = style
}

export function setMessageStyle(style: MessageStyle) {
  try {
    localStorage.setItem(STORAGE_KEY, style)
  } catch {
    /* ignore storage failures — the live style still applies */
  }
  apply(style)
}

export function initMessageStyle() {
  if (typeof document === 'undefined') return
  apply(getStoredMessageStyle())
}

// Subscribe to the root attribute so every settings surface reflects a change
// immediately, including one made by another mounted component. Deliberately
// NOT called by message rows — see the note at the top about why the thread
// reads this from CSS instead.
export function useMessageStyle(): MessageStyle {
  const [style, setLiveStyle] = useState<MessageStyle>(() => {
    if (typeof document === 'undefined') return FALLBACK
    const value = document.documentElement.dataset.msgStyle
    return isMessageStyle(value) ? value : getStoredMessageStyle()
  })

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      const value = root.dataset.msgStyle
      if (isMessageStyle(value)) setLiveStyle(value)
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-msg-style'] })
    return () => observer.disconnect()
  }, [])

  return style
}
