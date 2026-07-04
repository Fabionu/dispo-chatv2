import { X } from 'lucide-react'

// One tab in the chat-window tool banner. A compact pill: a subtle filled state
// when active, quiet hover otherwise. An optional × (for closeable tools like the
// Map) sits inside the pill without triggering the tab's own click.
export default function ToolTab({
  active,
  icon,
  label,
  onClick,
  onClose,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  onClose?: () => void
}) {
  return (
    <div
      className={`h-7 inline-flex items-center gap-1.5 rounded-full pl-2.5 text-[0.75rem] font-medium transition-colors ${
        onClose ? 'pr-1.5' : 'pr-2.5'
      } ${active ? 'bg-white/[0.07] text-text' : 'text-muted hover:text-text hover:bg-white/[0.04]'}`}
    >
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label}`}
          className="h-4 w-4 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.08] transition-colors"
        >
          <X size="0.6875rem" strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
