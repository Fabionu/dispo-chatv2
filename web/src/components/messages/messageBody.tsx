import { Fragment, type ReactNode } from 'react'
import type { Mention } from '../../lib/types'
import { splitBodyByMentions } from '../../lib/mentions'
import { renderRichText } from '../../lib/richText'

// Render a message body with @-mentions highlighted and *bold* / _italic_ inline
// formatting applied. Tokenized into plain-text and mention segments (never HTML)
// so user input is always escaped by React; the plain segments additionally run
// through renderRichText for bold/italic. A mention of the current user gets a
// stronger-but-subtle chip; others are a quiet accent-coloured token.
export function renderBody(
  body: string,
  mentions: Mention[] | undefined,
  currentUserId: string,
): ReactNode {
  const segments = splitBodyByMentions(body, mentions)
  if (segments.length === 1 && !segments[0].mention) return renderRichText(body)
  return segments.map((seg, i) => {
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
