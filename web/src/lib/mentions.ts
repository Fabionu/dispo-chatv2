import type { Mention } from './types'

// Shared @-mention helpers. Mentions are stored/sent as user ids, but in the
// composer and in rendered messages they appear as the literal text
// `@Display Name`. These helpers bridge the two without any HTML injection:
// resolving relies on matching the exact display text, rendering returns plain
// text segments for React to escape.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A mention token ends at the display name's end; the next character must not
// be a word character, so "@Fab" doesn't match a member named "Fabio". We also
// match longest names first so "@Fabio Tofan" wins over a "Fabio" member.
const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c)

type NamedUser = { id: string; displayName: string }

// Which members are *still* mentioned in the given text. Derived from the final
// text at send time, so deleting or editing the `@Name` token before sending
// naturally drops that mention id — no stale ids leak through. Each member is
// returned at most once.
export function resolveMentionIds(text: string, members: NamedUser[]): string[] {
  if (!text.includes('@')) return []
  const sorted = [...members].sort((a, b) => b.displayName.length - a.displayName.length)
  const ids: string[] = []
  // Blank out matched spans so a shorter name can't re-match inside a longer
  // one we already claimed.
  let remaining = text
  for (const m of sorted) {
    const token = '@' + m.displayName
    let from = 0
    for (;;) {
      const idx = remaining.indexOf(token, from)
      if (idx === -1) break
      if (!isWordChar(remaining[idx + token.length])) {
        ids.push(m.id)
        remaining =
          remaining.slice(0, idx) + ' '.repeat(token.length) + remaining.slice(idx + token.length)
        break
      }
      from = idx + 1
    }
  }
  return ids
}

export type BodySegment = { text: string; mention?: Mention; trip?: boolean }

// Split a message body into plain-text and mention segments for tokenized
// rendering. Only the mentions actually attached to the message are
// highlighted; everything else is plain text. Longest display names first so
// overlapping names tokenize to the most specific match.
export function splitBodyByMentions(body: string, mentions: Mention[] | undefined): BodySegment[] {
  if (!mentions || mentions.length === 0 || !body) return [{ text: body }]
  const sorted = [...mentions].sort((a, b) => b.displayName.length - a.displayName.length)
  const pattern = sorted.map((m) => escapeRegExp('@' + m.displayName)).join('|')
  // Trailing (?![\w]) enforces the same word boundary as resolution.
  const re = new RegExp(`(${pattern})(?![A-Za-z0-9_])`, 'g')

  const segments: BodySegment[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) segments.push({ text: body.slice(last, match.index) })
    const name = match[1].slice(1)
    const mention = sorted.find((m) => m.displayName === name)
    segments.push({ text: match[1], mention })
    last = match.index + match[1].length
  }
  if (last < body.length) segments.push({ text: body.slice(last) })
  return segments
}

// Further split the plain-text segments on the active trip's `#<reference>`
// token. Trip mentions are DISPLAY-ONLY: the token is stored as plain text in
// the body and resolved against the group's *current* active trip at render
// time, so nothing structured is persisted and a `#ref` from a past trip
// naturally degrades to plain text once the trip changes. Same word boundaries
// as @-mentions ("#12" doesn't light up inside "#123"); already-tokenized
// mention segments are never re-scanned.
export function splitSegmentsByTripRef(segments: BodySegment[], reference: string): BodySegment[] {
  const ref = reference.trim()
  if (!ref) return segments
  const token = '#' + ref
  const out: BodySegment[] = []
  for (const seg of segments) {
    if (seg.mention || !seg.text.includes('#')) {
      out.push(seg)
      continue
    }
    const text = seg.text
    let last = 0
    let from = 0
    for (;;) {
      const idx = text.indexOf(token, from)
      if (idx === -1) break
      // The `#` must start the text or follow a non-word char (and not another
      // `#`), and the reference must end at a word boundary.
      const beforeOk = idx === 0 || (!isWordChar(text[idx - 1]) && text[idx - 1] !== '#')
      const afterOk = !isWordChar(text[idx + token.length])
      if (beforeOk && afterOk) {
        if (idx > last) out.push({ text: text.slice(last, idx) })
        out.push({ text: token, trip: true })
        last = idx + token.length
        from = last
      } else {
        from = idx + 1
      }
    }
    if (last < text.length) out.push({ text: text.slice(last) })
  }
  return out
}
