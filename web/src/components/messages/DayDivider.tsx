import { formatDay } from './messageUtils'

// A compact, centered timeline separator rendered as a low-weight PILL (subtle
// border, muted text) rather than a divider line or chat bubble — it cleanly
// breaks the timeline into day sections without competing with messages. The
// first separator of a thread doubles as the conversation-start marker
// ("Conversation started · <date>"). Dark-theme friendly via theme tokens.
export default function DayDivider({
  iso,
  conversationStart = false,
}: {
  iso: string
  conversationStart?: boolean
}) {
  const day = formatDay(iso)
  return (
    <div className="flex justify-center py-3">
      <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[11px] leading-[1.5] text-faint">
        {conversationStart ? `Conversation started · ${day}` : day}
      </span>
    </div>
  )
}
