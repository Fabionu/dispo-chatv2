import { type ReactNode } from 'react'

// ── Compact, panel-native section header ─────────────────────────────────────
// A labelled block with an optional trailing action, used by the group-info
// panel's operational tabs. Kept presentational and dependency-free so any tab
// can reuse it.
export default function PanelSection({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">{label}</span>
        {action}
      </div>
      {children}
    </div>
  )
}
