import { formatDay } from './messageUtils'
import type { LocalMessage } from './types'

// Human verb for a system activity event. Unknown events degrade to a neutral
// "updated a message" rather than rendering an internal code.
function verbFor(event?: string | null): string {
  switch (event) {
    case 'message_pinned':
      return 'pinned'
    case 'message_unpinned':
      return 'unpinned'
    default:
      return 'updated'
  }
}

// Compact, centered timeline entry for persisted activity (pin/unpin, …). No
// avatar, no bubble, no actions menu — just muted text. When the activity has a
// target message, "a message" becomes a button that jumps to it (no-op hint if
// the target isn't currently loaded, handled by onJumpToMessage).
export default function SystemMessageRow({
  message,
  prev,
  onJumpToMessage,
}: {
  message: LocalMessage
  prev?: LocalMessage
  onJumpToMessage: (messageId: string) => void
}) {
  // Keep day dividers correct even when a system row is the first of a new day.
  const showDayDivider =
    prev === undefined ||
    new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  const verb = verbFor(message.systemEvent)
  const targetId = message.systemTargetMessageId ?? null

  return (
    <>
      {showDayDivider && (
        <div className="flex items-center gap-3 py-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="eyebrow">{formatDay(message.createdAt)}</span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      )}
      <div className="flex justify-center my-1.5">
        <span className="text-[11px] text-faint text-center px-2 leading-[1.5]">
          <span className="text-muted font-medium">{message.authorName}</span> {verb}{' '}
          {targetId ? (
            <button
              type="button"
              onClick={() => onJumpToMessage(targetId)}
              className="text-muted underline decoration-dotted underline-offset-2 hover:text-text transition-colors"
            >
              a message
            </button>
          ) : (
            'a message'
          )}
        </span>
      </div>
    </>
  )
}
