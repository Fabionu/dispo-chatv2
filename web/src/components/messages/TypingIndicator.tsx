import { useEffect, useState } from 'react'
import { typingStatusText, type TypingUser } from '../../lib/typing'

// Live composing state, drawn as a message that hasn't arrived yet: the same
// left rule, the same indent, the same mono attribution row, and three dots
// where the body will be. It used to be an avatar stack plus an incoming-style
// bubble — neither of which exists in the timeline any more, so it would have
// been the one bubble left on the screen.
//
// It sits in the composer lane, immediately above the input. That lane FLOATS
// over the message list — the thread scrolls underneath it — and what keeps the
// last message clear of it is a bottom reserve on the scroller that ChatView
// sizes from the lane's MEASURED height. Two rules follow from that, and both
// were broken here:
//
//  1. THE ROW'S HEIGHT ARRIVES IN ONE STEP. It used to animate — an outer grid
//     eased `0fr → 1fr` over 190ms — so for the whole of that transition the
//     reserve was chasing a height no React render had produced, and the row
//     was drawn over the last message until a ResizeObserver frame caught up.
//     Now the height lands with the commit that mounts the row, so ChatView's
//     post-layout measurement sees the final number immediately and the
//     conversation lifts in one move. The APPEARANCE still eases (see
//     .typing-indicator-enter / -exit): fade and travel cost no layout, so they
//     can take as long as they like without the reserve ever being wrong.
//
//  2. IT IS OPAQUE, like every other object in the lane (the input itself, the
//     reply/edit context rows). Even with the reserve exact, a transparent row
//     over a scrolling thread has no margin for error; the fill costs nothing —
//     it matches the field — and turns any residual frame of overlap into
//     nothing visible at all.
export default function TypingIndicator({ users }: { users: TypingUser[] }) {
  // Keep the last active set mounted very briefly after the socket says typing
  // stopped. That gives the row time to ease away instead of blinking out; a
  // new typing event during the exit cancels it immediately.
  const [displayedUsers, setDisplayedUsers] = useState(users)
  const [leaving, setLeaving] = useState(false)

  // ARRIVAL IS DERIVED DURING RENDER, not in an effect. The row's content and
  // the height it occupies have to land in the same commit — adopting the new
  // set in an effect split them across two, and the reserve was a frame stale
  // for the gap. `users` is stable state from useTypingIndicator, so the
  // identity check settles after one extra render.
  if (users.length > 0 && users !== displayedUsers) {
    setDisplayedUsers(users)
    setLeaving(false)
  }

  // Departure keeps its timer: the row has to outlive the socket's stop event
  // long enough to play its exit. It holds its full height until it unmounts,
  // which is why the thread settles in one step rather than sliding shut.
  useEffect(() => {
    if (users.length > 0 || displayedUsers.length === 0) return

    setLeaving(true)
    const timer = window.setTimeout(() => {
      setDisplayedUsers([])
      setLeaving(false)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [users, displayedUsers.length])

  if (displayedUsers.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`typing-row ${
        leaving ? 'typing-indicator-exit' : 'typing-indicator-enter'
      } border-l bg-bg pl-[var(--msg-indent)] pb-3`}
    >
      <span className="eyebrow block truncate">{typingStatusText(displayedUsers)}</span>
      <span className="mt-2 flex h-4 items-center gap-1" aria-hidden="true">
        <Dot delay="0ms" />
        <Dot delay="160ms" />
        <Dot delay="320ms" />
      </span>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="typing-dot h-1 w-1 rounded-full bg-muted"
      style={{ animationDelay: delay }}
    />
  )
}
