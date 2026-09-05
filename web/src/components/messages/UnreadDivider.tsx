// "You were here": where the unread messages started when this conversation was
// opened.
//
// Same SHAPE as DayDivider — a hairline with a label sitting in it — on purpose.
// Both are the timeline's own punctuation, and inventing a second divider style
// would make one of them read as a different kind of object rather than as the
// same object saying something else. What separates them is colour: a day break
// is structure and stays on `--line`, while this is the one thing on the screen
// asking for attention, so it takes the accent.
//
// It is FROZEN once drawn. The mark says where reading began, not where it has
// got to — a divider that slid down as you read, or vanished the moment the
// conversation was marked read, would destroy the only thing it is for. The
// snapshot that keeps it still is taken in ChatView, which remounts per group.
export default function UnreadDivider() {
  return (
    <div className="flex items-center gap-4 pt-8 pb-2" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-active/40" aria-hidden="true" />
      <span className="eyebrow shrink-0 text-active">New messages</span>
      <span className="h-px flex-1 bg-active/40" aria-hidden="true" />
    </div>
  )
}
