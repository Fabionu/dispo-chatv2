type Props = {
  // Diameter in px. Defaults to a compact 20px.
  size?: number
  // Optional subtle label rendered below the ring.
  label?: string
  className?: string
}

// Themed two-tone loading ring: a faint base with the warm `active` accent on
// the moving segment. Compact and professional — shared by the full-page auth
// gate and the in-conversation message loader so they read as one system.
export default function Spinner({ size = 20, label, className = '' }: Props) {
  return (
    <div
      role="status"
      aria-label={label ?? 'Loading'}
      className={`flex flex-col items-center justify-center gap-2 ${className}`}
    >
      <div
        style={{ height: size, width: size }}
        className="rounded-full border-2 border-white/[0.12] border-t-active animate-spin"
      />
      {label && <span className="text-[11px] text-faint">{label}</span>}
    </div>
  )
}
