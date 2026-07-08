import { Hash } from 'lucide-react'
import { MENU_SURFACE } from '../menuStyles'

type Props = {
  reference: string
  /** Secondary line, e.g. "ERFOLG · In transit" (client · status). */
  subtitle?: string
  onSelect: () => void
}

// Single-suggestion picker shown above the composer while typing a `#` trip
// mention in a vehicle room with an active trip. Mirrors MentionPicker's
// surface/row styling so both pickers read as the same control; there's only
// ever one active trip, so the row is always the highlighted one (Enter/Tab in
// the composer selects it). onMouseDown + preventDefault keeps textarea focus.
export default function TripMentionPicker({ reference, subtitle, onSelect }: Props) {
  return (
    <div
      role="listbox"
      aria-label="Mention the active trip"
      className={`absolute bottom-full left-0 mb-1.5 w-[16.25rem] ${MENU_SURFACE} py-1 z-20`}
      style={{ boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}
    >
      <button
        type="button"
        role="option"
        aria-selected
        onMouseDown={(e) => {
          // Keep textarea focus; perform the insert ourselves.
          e.preventDefault()
          onSelect()
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left bg-white/[0.07] transition-colors"
      >
        <span className="h-6 w-6 rounded-full bg-active/15 text-active flex items-center justify-center shrink-0">
          <Hash size="0.75rem" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.78125rem] text-text truncate">Trip #{reference}</span>
          {subtitle && (
            <span className="block text-[0.65625rem] text-faint truncate">{subtitle}</span>
          )}
        </span>
      </button>
    </div>
  )
}
