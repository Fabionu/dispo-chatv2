import { formatDayLong } from './messageUtils'

// The timeline's day break: a hairline running the width of the thread with a
// label sitting in it. It was a low-weight pill, which was the right answer
// when the timeline was made of filled bubbles and a divider LINE would have
// competed with them — but the timeline is made of rules now, so the rule is the
// quiet option and the pill would be the only floating shape on the screen.
//
// The first separator of a thread doubles as the conversation-start marker.
export default function DayDivider({
  iso,
  conversationStart = false,
}: {
  iso: string
  conversationStart?: boolean
}) {
  const day = formatDayLong(iso)
  return (
    // Outlined pill (design canvas option A, 2026-10-16): a hairline-bordered
    // pill, no rules running out of it.
    <div className="day-divider flex justify-center pt-8 pb-2" role="separator">
      <span className="shrink-0 rounded-full border border-line px-2.5 py-[3px] text-sm text-muted">
        {conversationStart ? `Conversation started · ${day}` : day}
      </span>
    </div>
  )
}
