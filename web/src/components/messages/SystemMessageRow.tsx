import type { ReactNode } from 'react'
import type { LocalMessage } from './types'
import DayDivider from './DayDivider'
import { TRIP_STATUSES, labelOf, type TripStatus } from '../../lib/vehicleOps'

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
        <span className="text-[0.6875rem] text-faint text-center px-2 leading-[1.5]">
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

// Human label for a TripStatus code carried in a trip_status_changed payload.
// Falls back to "Planned" (the implicit default) when the code is missing/unknown.
function tripStatusLabel(code: string | null | undefined): string {
  return labelOf(TRIP_STATUSES, (code ?? undefined) as TripStatus | undefined) || 'Planned'
}

// Join the driver names carried in a driver-assignment payload into a readable
// list ("Ana", "Ana and Bo", "Ana, Bo and Cy"). Falls back to "a driver".
function driverNamesLabel(names: string[] | undefined): string {
  const list = (names ?? []).filter(Boolean)
  if (list.length === 0) return 'a driver'
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
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
    case 'group_member_removed':
      // The row names the REMOVED person (from the payload), not the actor.
      return (
        <>
          {payload.userName ? <Detail>{payload.userName}</Detail> : 'A member'} was removed from the
          group
        </>
      )
    case 'group_member_left':
      // Actor IS the person who left, so author_name reads correctly.
      return <>{actor} left the group</>
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
    case 'trip_added':
      // Operational event — phrased without an actor prefix to match the rest of
      // the trip activity wording ("Trip 1893 005 was added.").
      return payload.tripLabel ? (
        <>Trip <Detail>{payload.tripLabel}</Detail> was added</>
      ) : (
        <>A trip was added</>
      )
    case 'trip_status_changed':
      return (
        <>
          Trip status changed from <Detail>{tripStatusLabel(payload.from)}</Detail> to{' '}
          <Detail>{tripStatusLabel(payload.to)}</Detail>
        </>
      )
    case 'trip_driver_assigned':
      // "Fabio assigned Claudiu Cojocar as driver for trip #123" — actor prefix,
      // then the assigned driver name(s), and the trip reference when present.
      return (
        <>
          {actor} assigned <Detail>{driverNamesLabel(payload.driverNames)}</Detail> as driver
          {payload.tripLabel ? <> for trip <Detail>#{payload.tripLabel}</Detail></> : null}
        </>
      )
    case 'trip_driver_unassigned':
      return (
        <>
          {actor} unassigned <Detail>{driverNamesLabel(payload.driverNames)}</Detail>
          {payload.tripLabel ? <> from trip <Detail>#{payload.tripLabel}</Detail></> : null}
        </>
      )
    case 'route_edited':
      // Names the actor per the trip-route edit UX ("… edited the trip route").
      return <>{actor} edited the trip route</>
    default:
      return <>{actor} updated the conversation</>
  }
}
