import { formatDay } from './messageUtils'

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
  const day = formatDay(iso)
  return (
    <div className="flex items-center gap-4 pt-8 pb-2" role="separator">
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="eyebrow shrink-0">
        {conversationStart ? `Conversation started · ${day}` : day}
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  )
}
