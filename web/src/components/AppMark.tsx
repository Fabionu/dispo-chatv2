import { Box, MessageCircle } from 'lucide-react'
import { rem } from '../lib/density'

/**
 * The Dispo-chat brand mark: a light `MessageCircle` with a logistics `Box`
 * nested in a black circle at its center. The black fill keeps the box readable
 * against the light message circle. Layered with absolute positioning so the
 * two Lucide glyphs scale together off a single `size`.
 *
 * Kept in sync with the static `web/public/favicon.svg`, which redraws the same
 * concept without the React/Lucide runtime.
 */
export default function AppMark({
  size = 28,
  className = '',
}: {
  size?: number
  className?: string
}) {
  // Inner black disc sits inside the bubble body; the box fills most of the
  // disc so it reads as a logo mark, not a tiny icon-in-an-icon. The disc is
  // sized large enough to carry a bold, glanceable box without fully swallowing
  // the message circle outline.
  const disc = Math.round(size * 0.66)
  const box = Math.round(disc * 0.78)
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: rem(size), height: rem(size) }}
    >
      <MessageCircle size={rem(size)} strokeWidth={1.6} className="text-text" />
      {/* Centered on the bubble body (slightly above the icon's geometric
          center, clear of the tail) so the box reads cleanly. */}
      <span
        className="absolute flex items-center justify-center rounded-full bg-bg"
        style={{
          width: rem(disc),
          height: rem(disc),
          top: '47%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <Box size={rem(box)} strokeWidth={2.4} className="text-text" />
      </span>
    </span>
  )
}
