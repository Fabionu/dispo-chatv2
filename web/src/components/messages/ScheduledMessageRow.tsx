import { AlertTriangle, Clock3, CornerUpLeft } from 'lucide-react'
import type { GroupType, ScheduledMessage } from '../../lib/types'
import { absoluteLabel, compactLabel, relativeLabel } from '../../lib/scheduleTime'
import { Attribution } from '../thread/threadChrome'

// A message the user has queued but that hasn't been delivered yet, parked at
// the very bottom of the thread — always below the newest real message, until
// the worker sends it (or the user cancels it in the Schedule dialog).
//
// It is deliberately NOT a MessageRow. That component carries the whole
// interactive surface of a real message — actions menu, reply, pin, edit,
// forward, receipts, retry — and none of it may apply to a row with no message
// id behind it. Rather than mount it with seventeen no-op handlers and hope
// nothing leaks, this borrows only the row's GEOMETRY: the same left rule, the
// same indent, the same attribution.
//
// Scheduled messages are always the signed-in user's own, so the rule is the
// own-message --color-line-own, and always text-only (the schema stores a body and an
// optional reply target, never attachments).
//
// The whole row sits at 60% — that fade IS the "not sent yet" state, and it is
// why Cancel lives outside it: inside, the control would inherit the fade and
// read as disabled, which is exactly the wrong signal for the one thing you can
// still do here.
export default function ScheduledMessageRow({
  item,
  groupType,
  onCancel,
}: {
  item: ScheduledMessage
  // Only to match the rule weight of the real rows around it — see `boldRule`
  // in MessageRow. A queued message sitting under a thread of 2px rules with a
  // 1px one of its own would read as a different KIND of row rather than as one
  // that has not been sent yet.
  groupType: GroupType
  onCancel: (item: ScheduledMessage) => void
}) {
  const failed = item.status === 'failed'
  const at = new Date(item.scheduledFor)

  const status = (
    <span
      className={`eyebrow inline-flex items-center gap-1 whitespace-nowrap ${
        failed ? 'text-alert' : ''
      }`}
      title={
        failed
          ? item.lastError || 'Delivery failed'
          : `Sends ${absoluteLabel(at)} · ${relativeLabel(at)}`
      }
    >
      {failed ? (
        <>
          <AlertTriangle size="0.6875rem" strokeWidth={1.8} className="shrink-0" />
          Not sent
        </>
      ) : (
        <>
          <Clock3 size="0.6875rem" strokeWidth={1.8} className="shrink-0" />
          {compactLabel(at)}
        </>
      )}
    </span>
  )

  return (
    <div
      // Built exactly like one of my own sent rows (see MessageRow), including
      // `items-end`: the block's width is set by its widest child — here the
      // `SCHEDULED · <time> · Cancel` header, which is longer than most of what
      // gets queued — and without it a short body would sit at the far LEFT of
      // that width while its rule ran down the right.
      // Borrows the message row's box as well as its geometry, so it follows
      // whichever message style is on (lib/messageStyle.ts) — a queued message
      // drawn as a rule under a thread of bubbles would read as a different
      // KIND of row rather than as one that hasn't been sent yet, which is the
      // same argument the rule weight below is already making. `data-head`
      // because it is always the head of its own one-row group: it needs the
      // gap that opens a burst, not the one that continues it.
      data-own
      data-head
      data-alert={failed || undefined}
      className={`msg-row group/sched relative mt-7 ml-auto flex w-fit max-w-full flex-col items-end ${
        groupType === 'direct' ? 'border-r' : 'border-r-2'
      } pr-[var(--msg-indent)] pl-2 ${
        failed ? 'border-alert/60' : 'border-[rgb(var(--color-line-own))]'
      }`}
    >
      <div className="flex items-center justify-end gap-2.5">
        <Attribution name="Scheduled" trailing={status} alignEnd />
        {/* Always mounted, opacity-only, so revealing it never reflows the row
            (same rule as the message action strip). */}
        <button
          type="button"
          onClick={() => onCancel(item)}
          aria-label="Cancel scheduled message"
          title="Cancel scheduled message"
          className="eyebrow -my-1 shrink-0 py-1 opacity-0 transition-opacity hover:text-alert focus-visible:opacity-100 focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4 group-hover/sched:opacity-100"
        >
          Cancel
        </button>
      </div>

      <div className="msg-content max-w-body opacity-60">
        {item.replyToMessageId && (
          <span className="eyebrow mb-1 flex items-center gap-1">
            <CornerUpLeft size="0.6875rem" strokeWidth={1.8} />
            Reply
          </span>
        )}
        <span className="block whitespace-pre-wrap break-words font-[number:var(--msg-body-weight)] text-[length:var(--chat-plain-font-size)] leading-[1.6] text-text">
          {item.body}
        </span>
      </div>
    </div>
  )
}
