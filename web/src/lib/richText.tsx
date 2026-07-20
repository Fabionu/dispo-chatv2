import type { ReactNode } from 'react'

// Inline message formatting: *bold* and _italic_ — the same syntax the composer's
// B / I buttons insert. This runs on PLAIN text only; callers apply it to the
// non-mention segments (see MessageRow) so @-mention tokens are never reparsed,
// and because it returns React nodes (never HTML) user input stays escaped.
//
// Rules, kept deliberately simple and chat-app friendly (WhatsApp/Slack-style):
//  - A marker must hug its content (no space just inside the opening marker) and
//    the run can't span a newline, so prose like "5 * 3" or "a_b" mid-sentence
//    isn't accidentally formatted and an unmatched marker stays literal.
//  - Bold and italic nest, e.g. `*bold _and italic_*`.
const RICH_RE = /\*(\S[^*\n]*?)\*|_(\S[^_\n]*?)_/g

export function renderRichText(text: string, keyPrefix = ''): ReactNode {
  // Fast path: nothing that could be a marker → return the raw string.
  if (!text || (!text.includes('*') && !text.includes('_'))) return text

  const nodes: ReactNode[] = []
  let last = 0
  let i = 0
  // matchAll clones the regex internally, so recursing for nested formatting is
  // safe (no shared lastIndex between the outer and inner scans).
  for (const m of text.matchAll(RICH_RE)) {
    const idx = m.index ?? 0
    if (idx > last) nodes.push(text.slice(last, idx))
    if (m[1] != null) {
      nodes.push(
        <strong key={`${keyPrefix}b${i}`} className="font-bold text-text">
          {renderRichText(m[1], `${keyPrefix}b${i}-`)}
        </strong>,
      )
    } else {
      nodes.push(<em key={`${keyPrefix}i${i}`}>{renderRichText(m[2] ?? '', `${keyPrefix}i${i}-`)}</em>)
    }
    last = idx + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  // No marker actually matched → hand back the original string unchanged.
  return nodes.length ? nodes : text
}
