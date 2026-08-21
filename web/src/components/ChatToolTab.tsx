import { X } from 'lucide-react'

// One tab in the chat-window tool banner. A drawn mono button, matching the
// composer's own controls below it: the active tab takes the hairline and full
// text, the rest stay borderless and quiet until hovered. An optional × (for
// closeable tools like the Map) sits inside without triggering the tab's click.
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
      className={`eyebrow h-7 inline-flex items-center gap-1.5 border pl-2.5 transition-colors ${
        onClose ? 'pr-1.5' : 'pr-2.5'
      } ${active ? 'border-strong text-text' : 'border-transparent hover:text-text'}`}
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
          className="h-4 w-4 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/8 transition-colors"
        >
          <X size="0.6875rem" strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
