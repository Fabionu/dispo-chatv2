import { rem } from '../lib/density'

type SpinnerVariant = 'sm' | 'md' | 'lg'

// Preset diameters (px). sm = inline/contextual (cards, pickers), md = sidebar
// list, lg = the main chat content area. Ring thickness scales with size so the
// larger variants don't look spindly on big displays.
const VARIANT_SIZE: Record<SpinnerVariant, number> = {
  sm: 18,
  md: 30,
  lg: 46,
}

type Props = {
  // Preset size. Defaults to `sm`. Ignored when an explicit `size` is given.
  variant?: SpinnerVariant
  // Explicit diameter in px — overrides `variant` for one-off needs.
  size?: number
  // Optional subtle label rendered below the ring.
  label?: string
  className?: string
}

// Themed two-tone loading ring: a faint base with the warm `active` accent on
// the moving segment. Compact and professional — shared by the full-page auth
// gate, the sidebar list loader, and the in-conversation message loader so they
// all read as one system. Use `className="h-full"` (or a centring wrapper) to
// place it in the middle of the available area.
export default function Spinner({ variant = 'sm', size, label, className = '' }: Props) {
  const px = size ?? VARIANT_SIZE[variant]
  // Thicker ring for the larger variants so the stroke stays proportional.
  const border = px >= 40 ? 4 : px >= 28 ? 3 : 2

  return (
    <div
      role="status"
      aria-label={label ?? 'Loading'}
      className={`flex flex-col items-center justify-center gap-2.5 ${className}`}
    >
      <div
        style={{ height: rem(px), width: rem(px), borderWidth: rem(border) }}
        className="rounded-full border-white/[0.12] border-t-active animate-spin"
      />
      {label && <span className="text-[0.6875rem] text-faint">{label}</span>}
    </div>
  )
}
