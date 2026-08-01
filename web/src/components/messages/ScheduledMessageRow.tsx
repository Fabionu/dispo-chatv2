import { AlertTriangle, Clock3, CornerUpLeft, X } from 'lucide-react'
import type { ScheduledMessage } from '../../lib/types'
import { absoluteLabel, compactLabel, relativeLabel } from '../../lib/scheduleTime'

// A message the user has queued but that hasn't been delivered yet, parked at
// the very bottom of the thread — always below the newest real message, until
// the worker sends it (or the user cancels it in the Schedule dialog).
//
// It is deliberately NOT a MessageRow. That component carries the whole
// interactive surface of a real message — actions menu, reply, pin, edit,
// forward, receipts, retry — and none of it may apply to a row with no message
// id behind it. Rather than mount it with seventeen no-op handlers and hope
// nothing leaks, this borrows only the bubble's geometry.
//
// Scheduled messages are always the signed-in user's own and always text-only
// (the schema stores a body and an optional reply target, never attachments),
// so this is only ever the right-aligned own-bubble form — which is what
// `mine` rows look like in BOTH display modes, bubble and plain. That's why
// there is no `useMessageDisplay` branch here.
export default function ScheduledMessageRow({
  item,
  onCancel,
}: {
  item: ScheduledMessage
  onCancel: (item: ScheduledMessage) => void
}) {
  const failed = item.status === 'failed'
  const at = new Date(item.scheduledFor)

  return (
    <div className="group/sched relative mt-4 pl-1.5 pr-2">
      <div className="flex items-start justify-end gap-2.5">
        <div className="flex min-w-0 max-w-[56rem] flex-col items-end">
          <div className="flex w-full items-center justify-end gap-1.5">
            {/* Cancel sits OUTSIDE the bubble, at full strength. Inside it would
                inherit the 60% fade and read as disabled — exactly the wrong
                signal for the one control here. Always mounted, opacity-only,
                so revealing it never reflows the row (same rule as
                MessageRow's actions trigger). */}
            <button
              type="button"
              onClick={() => onCancel(item)}
              aria-label="Cancel scheduled message"
              title="Cancel scheduled message"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint opacity-0 transition-[opacity,background-color,color] hover:bg-white/6 hover:text-alert focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 group-hover/sched:opacity-100"
            >
              <X size="0.875rem" strokeWidth={1.8} />
            </button>
            <div className="min-w-0 max-w-[min(82%,64rem)]">
            {/* Faded is the whole point: it reads as "not sent yet" without
                inventing a new bubble shape. A failure keeps the alert edge
                real failed sends already use, so the two states match. */}
            <div
              className={`flex flex-col rounded-[1rem] bg-bubble-own px-3.5 pt-2 pb-1.5 text-[length:var(--chat-msg-font-size)] leading-[1.45] text-text opacity-60 ${
                failed ? 'border border-alert/50' : ''
              }`}
            >
              {item.replyToMessageId && (
                <span className="mb-1 flex items-center gap-1 text-2xs text-faint">
                  <CornerUpLeft size="0.6875rem" strokeWidth={1.8} />
                  Reply
                </span>
              )}

              <span className="whitespace-pre-wrap break-words">{item.body}</span>

              {/* Sits where a real bubble's timestamp sits and stays just as
                  terse — `nowrap` because "Sends today at 13:58 · in 1 minute"
                  wrapped to two lines inside the bubble and read as a status
                  sentence instead of a corner stamp. The full time and the full
                  failure text both live in the Schedule dialog. */}
              <span
                className={`mt-1 flex items-center gap-1 self-end whitespace-nowrap text-2xs ${
                  failed ? 'text-alert' : 'text-faint'
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
                    <span className="tabular-nums">{compactLabel(at)}</span>
                  </>
                )}
              </span>
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
