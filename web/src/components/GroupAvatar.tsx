import { Users } from 'lucide-react'

type Props = {
  /** Pixel diameter — match the DM Avatar so every conversation reads the same. */
  size?: number
  className?: string
}

// Vehicle-room identity icon. Deliberately a GENERATED, generic multi-user glyph
// in the same circular slot as a DM `Avatar` — vehicle rooms never use an
// uploaded/custom image (their identity comes from plate/name/trailer/status +
// this icon). Purely presentational: no image fetch, no cache, no version. The
// slot stays visually consistent across the header, sidebar rows, and panel.
export default function GroupAvatar({ size = 28, className = '' }: Props) {
  return (
    <span
      style={{ width: size, height: size }}
      className={`rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-muted ${className}`}
    >
      <Users size={Math.max(12, Math.round(size * 0.46))} strokeWidth={1.7} />
    </span>
  )
}
