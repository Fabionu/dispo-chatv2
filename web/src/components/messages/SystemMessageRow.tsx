import type { ReactNode } from 'react'
import type { LocalMessage } from './types'
import DayDivider from './DayDivider'

// Compact, centered timeline entry for persisted activity (joins, member adds,
// pin/unpin, trips, …). No avatar, no bubble, no actions menu — just muted
// text. Pin/unpin carry a target message, rendered as a button that jumps to it.
// (Only the date/start separator is the subtle pill — the operational activity
// line below stays as readable muted text so real events aren't hidden.)
export default function SystemMessageRow({
  message,
  prev,
  conversationStart,
  onJumpToMessage,
}: {
  message: LocalMessage
  prev?: LocalMessage
  // True when this is the very first message of the whole thread (no older page).
  conversationStart?: boolean
  onJumpToMessage: (messageId: string) => void
}) {
  // Keep day dividers correct even when a system row is the first of a new day.
  const showDayDivider =
    prev === undefined ||
    new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  return (
    <>
      {showDayDivider && (
        <DayDivider iso={message.createdAt} conversationStart={conversationStart} />
      )}
      <div className="flex justify-center my-1.5">
        <span className="text-[11px] text-faint text-center px-2 leading-[1.5]">
          {renderActivity(message, onJumpToMessage)}
        </span>
      </div>
    </>
  )
}

// The actor (who performed the action) — author_name, styled as the subject.
function Actor({ name }: { name: string }) {
  return <span className="text-muted font-medium">{name}</span>
}

// Emphasised inline detail (an added user's name, a trip label).
function Detail({ children }: { children: ReactNode }) {
  return <span className="text-muted font-medium">{children}</span>
}

// Build the sentence for one activity row. Unknown events degrade to a neutral
// "updated the conversation" rather than leaking an internal event code.
function renderActivity(
  message: LocalMessage,
  onJumpToMessage: (messageId: string) => void,
): ReactNode {
  const actor = <Actor name={message.authorName} />
  const payload = message.systemPayload ?? {}
  const targetId = message.systemTargetMessageId ?? null

  // Clickable "a message" → jumps to the referenced message (pin/unpin).
  const messageLink = targetId ? (
    <button
      type="button"
      onClick={() => onJumpToMessage(targetId)}
      className="text-muted underline decoration-dotted underline-offset-2 hover:text-text transition-colors"
    >
      a message
    </button>
  ) : (
    'a message'
  )

  switch (message.systemEvent) {
    case 'group_joined':
      return <>{actor} joined the group</>
    case 'group_member_added':
      return (
        <>
          {actor} added {payload.userName ? <Detail>{payload.userName}</Detail> : 'someone'}
        </>
      )
    case 'message_pinned':
      return <>{actor} pinned {messageLink}</>
    case 'message_unpinned':
      return <>{actor} unpinned {messageLink}</>
    case 'trip_created':
      return (
        <>
          {actor} created{' '}
          {payload.tripLabel ? <>trip <Detail>{payload.tripLabel}</Detail></> : 'a trip'}
        </>
      )
    default:
      return <>{actor} updated the conversation</>
  }
}
