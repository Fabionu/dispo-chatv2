import { useEffect, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

// Small presentational controls for the Route planner panel: a labelled numeric
// input (truck-profile fields), a labelled read-only stat (route summary), and a
// compact copy-to-clipboard icon button (context-menu coordinate header).
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-card border border-white/[0.06] bg-white/[0.04] px-2.5 text-[0.8125rem] outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.05] placeholder:text-faint"
      />
    </label>
  )
}

// Tiny circular copy button for a coordinate string — the map context menu's
// header sits tighter than ICON_ACTION_SMALL's 24px, so this is its 20px
// sibling with the same borderless muted-glyph-warms-on-hover look. Shows a
// brief ✓ (done) after a successful copy and a quiet ✗ (alert) when the
// clipboard is unavailable/refused, then settles back to idle.
export function CopyCoordButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    let next: 'copied' | 'failed' = 'failed'
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        next = 'copied'
      }
    } catch {
      /* clipboard refused — show the failed state below */
    }
    setState(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1200)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy coordinates"
      title={state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy coordinates'}
      className="h-5 w-5 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      {state === 'copied' ? (
        <Check size="0.75rem" strokeWidth={2.4} className="text-done" />
      ) : state === 'failed' ? (
        <X size="0.75rem" strokeWidth={2.4} className="text-alert" />
      ) : (
        <Copy size="0.75rem" strokeWidth={1.8} />
      )}
    </button>
  )
}

// Compact metric tile (route summary): a quiet fill so the three stats read as
// one scannable row without adding border weight to the panel.
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex flex-col gap-0.5 rounded-card bg-white/[0.03] px-2 py-1.5">
      <span className="text-[0.625rem] uppercase tracking-badge text-faint">{label}</span>
      <span className="text-[0.8125rem] font-semibold tracking-[-0.2px] tabular-nums truncate">{value}</span>
    </div>
  )
}
