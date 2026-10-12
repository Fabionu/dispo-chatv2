import { Fragment, useEffect, useState } from 'react'
import Avatar from '../Avatar'
import { typingParts, type TypingUser } from '../../lib/typing'
import TypingMark from './TypingMark'

// What the dock needs to know about a typer that the typing event does not carry.
export type TypingAuthor = {
  // The author's hue (lib/authorColor), set where a colour would say something —
  // the same gate as a message's rule: someone else, in a room of more than two.
  // Undefined everywhere else, which leaves the tile and the name neutral.
  color?: string
  hasAvatar?: boolean
  avatarVersion?: string | null
}

type Props = {
  users: TypingUser[]
  // Draw the typers' tiles. False in a direct message, where there is one other
  // person in the conversation and a face would answer nothing — the same rule
  // that keeps a tile off a DM's messages.
  tiles: boolean
  authorOf: (userId: string) => TypingAuthor
}

// The tab holds this many tiles; the sentence names the rest ("and 1 more").
const MAX_TILES = 2
// Design px — Avatar renders it as rem. Smaller than a message's 30px tile because
// this is a status on the field's edge, not a speaker; see Avatar's `letters` for
// why a tile this small carries one initial.
const TILE_PX = 20

// Live composing state, drawn as a TAB on the composer's top edge:
// `[S][D] ••• Stanley and Dana are typing`.
//
// THE DOCK (user, 2026-10-12: "implement B - Dock", picked from three placements
// on a design canvas). It was a left-ruled line — in the bubble style, a small
// bubble — of 11px grey text with three dots at 30%. Two things were wrong with
// it: it was easy to miss, and it named who in nothing but a first name, which in
// a room of six is the actual question; the thread answers it with a face and a
// colour on every message, and the typing row had neither. The tab fixes both
// without sending the eye anywhere new. It is attached to the field the reply is
// about to be typed in, so the two read as one object — the input has a visitor —
// and it carries the typers' tiles and author colours the way a message does.
//
// It is the composer's, not the thread's, so it looks the same in all three
// message styles; the bubble-style rule that used to turn it into a bubble is gone.
//
// It sits in the composer lane, and that lane FLOATS over the message list — the
// thread scrolls underneath it — and what keeps the last message clear of it is a
// bottom reserve on the scroller that ChatView sizes from the lane's MEASURED
// height. Two rules follow from that, and both were broken here once:
//
//  1. THE ROW'S HEIGHT ARRIVES IN ONE STEP. It used to animate — an outer grid
//     eased `0fr → 1fr` over 190ms — so for the whole of that transition the
//     reserve was chasing a height no React render had produced, and the row
//     was drawn over the last message until a ResizeObserver frame caught up.
//     Now the height lands with the commit that mounts the tab, so ChatView's
//     post-layout measurement sees the final number immediately and the
//     conversation lifts in one move. The APPEARANCE still eases (see
//     .typing-indicator-enter / -exit): fade and travel cost no layout, so they
//     can take as long as they like without the reserve ever being wrong.
//
//  2. IT IS OPAQUE, like every other object in the lane (the input itself, the
//     reply/edit context rows). Even with the reserve exact, a transparent row
//     over a scrolling thread has no margin for error; the fill costs nothing —
//     it matches the field — and turns any residual frame of overlap into
//     nothing visible at all. (The tab's fill also has to be there for a third
//     reason: it is what hides the composer's top rule under the tab.)
//
// ChatView renders it IMMEDIATELY above the composer — below the error line, not
// above it — because the tab is attached to the composer's edge.
export default function TypingIndicator({ users, tiles, authorOf }: Props) {
  // Keep the last active set mounted very briefly after the socket says typing
  // stopped. That gives the tab time to ease away instead of blinking out; a new
  // typing event during the exit cancels it immediately.
  const [displayedUsers, setDisplayedUsers] = useState(users)
  const [leaving, setLeaving] = useState(false)

  // ARRIVAL IS DERIVED DURING RENDER, not in an effect. The tab's content and
  // the height it occupies have to land in the same commit — adopting the new
  // set in an effect split them across two, and the reserve was a frame stale
  // for the gap. `users` is stable state from useTypingIndicator, so the
  // identity check settles after one extra render.
  if (users.length > 0 && users !== displayedUsers) {
    setDisplayedUsers(users)
    setLeaving(false)
  }

  // Departure keeps its timer: the tab has to outlive the socket's stop event
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
      className={`typing-dock ${tiles ? '' : 'typing-dock-bare'} ${
        leaving ? 'typing-indicator-exit' : 'typing-indicator-enter'
      }`}
    >
      {tiles && (
        <span className="typing-dock-tiles" aria-hidden="true">
          {displayedUsers.slice(0, MAX_TILES).map((u) => {
            const author = authorOf(u.id)
            return (
              <Avatar
                key={u.id}
                userId={u.id}
                name={u.name}
                size={TILE_PX}
                letters={1}
                fallback="initials"
                tint={author.color}
                hasAvatar={author.hasAvatar}
                version={author.avatarVersion}
                className="typing-dock-tile"
              />
            )
          })}
        </span>
      )}
      <TypingMark />
      {/* The names take their author's hue where there is one, so the tile, the
          name and that person's messages above are one identity; with no hue the
          sentence stays one even grey. */}
      <span className="min-w-0 truncate text-sm font-medium leading-none text-muted">
        {typingParts(displayedUsers).map((part, i) => {
          const color = part.user ? authorOf(part.user.id).color : undefined
          return (
            <Fragment key={i}>
              {color ? (
                <span className="font-semibold" style={{ color }}>
                  {part.text}
                </span>
              ) : (
                part.text
              )}
            </Fragment>
          )
        })}
      </span>
    </div>
  )
}
