import { Fragment, type ReactNode } from 'react'
import type { Mention } from '../../lib/types'
import { splitBodyByMentions, splitSegmentsByTripRef } from '../../lib/mentions'
import { renderRichText } from '../../lib/richText'

// The group's active trip, for `#<reference>` trip-mention tokens. Resolved at
// render time (never stored), so it's only passed for vehicle rooms with an
// active trip; clicking the token deep-links to the Group info Trip tab.
export type TripRefContext = { reference: string; onOpen: () => void }

// Render a message body with @-mentions highlighted and *bold* / _italic_ inline
// formatting applied. Tokenized into plain-text and mention segments (never HTML)
// so user input is always escaped by React; the plain segments additionally run
// through renderRichText for bold/italic. A mention of the current user gets a
// stronger-but-subtle chip; others are a quiet accent-coloured token. When the
// room has an active trip, its `#reference` tokens render as clickable trip
// mentions that open the Trip tab.
export function renderBody(
  body: string,
  mentions: Mention[] | undefined,
  currentUserId: string,
  trip?: TripRefContext,
): ReactNode {
  let segments = splitBodyByMentions(body, mentions)
  if (trip) segments = splitSegmentsByTripRef(segments, trip.reference)
  if (segments.length === 1 && !segments[0].mention && !segments[0].trip)
    return renderRichText(body)
  return segments.map((seg, i) => {
    if (seg.trip && trip) {
      // A real <button> so the trip link is keyboard-reachable; align-baseline
      // keeps it sitting on the text line and wrapping like an inline token.
      return (
        <button
          key={i}
          type="button"
          title="View trip details"
          onClick={(e) => {
            e.stopPropagation()
            trip.onOpen()
          }}
          className="align-baseline rounded px-0.5 font-medium text-active bg-active/10 hover:bg-active/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-active/50"
        >
          {seg.text}
        </button>
      )
    }
    if (!seg.mention) return <Fragment key={i}>{renderRichText(seg.text, `s${i}-`)}</Fragment>
    const isMe = seg.mention.userId === currentUserId
    return (
      <span
        key={i}
        className={
          isMe
            ? 'rounded px-0.5 font-semibold text-active bg-active/15'
            : 'font-medium text-active'
        }
      >
        {seg.text}
      </span>
    )
  })
}
