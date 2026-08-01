import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock3, Loader2, Trash2 } from 'lucide-react'
import Modal from '../Modal'
import { DateField, TimeField } from '../DateTimeField'
import { api, ApiError } from '../../lib/api'
import { getSocket } from '../../lib/socket'
import { absoluteLabel, relativeLabel } from '../../lib/scheduleTime'
import type { ScheduledMessage } from '../../lib/types'

type Props = {
  groupId: string
  groupName: string
  draftBody: string
  replyToMessageId: string | null
  mentionUserIds: string[]
  onScheduled: () => void
  onClose: () => void
}

function roundedFuture(minutes = 30): Date {
  const value = new Date(Date.now() + minutes * 60_000)
  value.setSeconds(0, 0)
  value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5)
  return value
}

function tomorrowAt(hour: number): Date {
  const value = new Date()
  value.setDate(value.getDate() + 1)
  value.setHours(hour, 0, 0, 0)
  return value
}

// The three offsets a dispatcher actually reaches for. Each one owns its own
// target so the chip row and the fields can never disagree about what it means.
const PRESETS: ReadonlyArray<{ id: string; label: string; at: () => Date }> = [
  { id: '30m', label: 'In 30 min', at: () => roundedFuture(30) },
  { id: '2h', label: 'In 2 hours', at: () => roundedFuture(120) },
  { id: 'tomorrow', label: 'Tomorrow 08:00', at: () => tomorrowAt(8) },
]

function dateValue(value: Date): string {
  return [
    String(value.getDate()).padStart(2, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    value.getFullYear(),
  ].join('/')
}

function timeValue(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function parseLocalDateTime(date: string, time: string): Date | null {
  const dm = date.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const tm = time.trim().match(/^(\d{2}):(\d{2})$/)
  if (!dm || !tm) return null
  const day = Number(dm[1])
  const month = Number(dm[2])
  const year = Number(dm[3])
  const hour = Number(tm[1])
  const minute = Number(tm[2])
  if (hour > 23 || minute > 59) return null
  const value = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  ) {
    return null
  }
  return value
}

const CHIP_BASE =
  'h-7 whitespace-nowrap rounded-full border px-2.5 text-sm font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20'
const CHIP_IDLE = 'border-white/8 text-muted hover:bg-white/6 hover:text-text'
const CHIP_ACTIVE = 'border-white/16 bg-white/10 text-text'

export default function ScheduleMessageModal({
  groupId,
  groupName,
  draftBody,
  replyToMessageId,
  mentionUserIds,
  onScheduled,
  onClose,
}: Props) {
  const initial = useMemo(() => roundedFuture(), [])
  const [body, setBody] = useState(draftBody.trim())
  const [date, setDate] = useState(() => dateValue(initial))
  const [time, setTime] = useState(() => timeValue(initial))
  // Which preset chip filled the fields, or null once they were edited by hand
  // — same idiom as the Route planner's truck presets, so a highlighted chip
  // never claims a time the fields no longer hold.
  const [preset, setPreset] = useState<string | null>(null)
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The chosen moment, resolved on every render so the readout under the fields
  // and the Schedule button's enabled state are always the same judgement.
  const when = parseLocalDateTime(date, time)
  const whenProblem = !when
    ? 'Enter a valid date and time.'
    : when.getTime() < Date.now() + 10_000
      ? 'Pick a time in the future.'
      : null

  const loadScheduled = useCallback(async () => {
    try {
      const result = await api.groups.scheduledMessages(groupId)
      setScheduled(result.scheduledMessages)
    } catch {
      setError('Could not load scheduled messages.')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void loadScheduled()
    const socket = getSocket()
    const onChanged = (event: { groupId?: string }) => {
      if (event.groupId === groupId) void loadScheduled()
    }
    socket.on('scheduled-message:changed', onChanged)
    return () => {
      socket.off('scheduled-message:changed', onChanged)
    }
  }, [groupId, loadScheduled])

  function applyPreset(item: (typeof PRESETS)[number]) {
    const next = item.at()
    setDate(dateValue(next))
    setTime(timeValue(next))
    setPreset(item.id)
    setError(null)
  }

  function editDate(value: string) {
    setDate(value)
    setPreset(null)
  }

  function editTime(value: string) {
    setTime(value)
    setPreset(null)
  }

  async function schedule() {
    // The button is disabled for both of these, but the modal can sit open long
    // enough for a valid time to fall into the past — so they stay reachable.
    if (!body) {
      setError('Write a message before scheduling it.')
      return
    }
    if (!when || whenProblem) {
      setError(whenProblem ?? 'Choose a valid date and time.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.groups.scheduleMessage(groupId, {
        body,
        scheduledFor: when.toISOString(),
        ...(replyToMessageId ? { replyToMessageId } : {}),
        ...(mentionUserIds.length ? { mentionUserIds } : {}),
      })
      setScheduled((items) =>
        [...items.filter((item) => item.id !== result.scheduledMessage.id), result.scheduledMessage]
          .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)),
      )
      setBody('')
      setNotice(`Scheduled for ${absoluteLabel(new Date(result.scheduledMessage.scheduledFor))}.`)
      onScheduled()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'scheduled_time_not_future') {
        setError('Choose a time in the future.')
      } else if (cause instanceof ApiError && cause.code === 'scheduled_time_too_far') {
        setError('Messages can be scheduled up to one year ahead.')
      } else {
        setError('Could not schedule this message. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function removeScheduled(id: string) {
    setDeletingId(id)
    setError(null)
    // The success notice names a send time that may be the one being removed —
    // leaving it up would claim a message is still queued when it isn't.
    setNotice(null)
    try {
      await api.groups.deleteScheduledMessage(groupId, id)
      setScheduled((items) => items.filter((item) => item.id !== id))
    } catch {
      setError('Could not remove the scheduled message.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Modal
      title="Schedule message"
      subtitle={`Choose when this goes to ${groupName}.`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/16 px-3.5 py-1.5 text-sm font-medium text-text transition-colors hover:bg-white/4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void schedule()}
            disabled={saving || !body || Boolean(whenProblem)}
            // `border-transparent` matches Cancel's border box so the two pills
            // are exactly the same height — a 2px difference that read as
            // nothing at 6px corners is obvious once both are fully round.
            className="flex items-center gap-1.5 rounded-full border border-transparent bg-text px-3.5 py-1.5 text-sm font-semibold text-bg transition-colors hover:bg-text/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving && <Loader2 size="0.8125rem" strokeWidth={2.2} className="animate-spin" />}
            {saving ? 'Scheduling…' : 'Schedule'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {body ? (
          <>
            {/* What will be sent. Scrolls rather than clamping so a long draft
                can still be read in full before committing to a send time. */}
            <div className="flex gap-2.5 rounded-card border border-white/8 bg-white/2 px-3 py-2.5">
              <span className="w-0.5 shrink-0 rounded-full bg-active/70" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="max-h-[5.5rem] overflow-y-auto whitespace-pre-wrap break-words text-base text-text">
                  {body}
                </p>
                {replyToMessageId && (
                  <p className="mt-1.5 text-xs text-faint">Sent as a reply.</p>
                )}
              </div>
            </div>

            <section>
              <div className="eyebrow mb-2">When</div>

              <div className="flex flex-wrap items-center gap-1.5">
                {PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => applyPreset(item)}
                    aria-pressed={preset === item.id}
                    className={`${CHIP_BASE} ${preset === item.id ? CHIP_ACTIVE : CHIP_IDLE}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
                <DateField value={date} onChange={editDate} ariaLabel="Scheduled date" />
                <TimeField value={time} onChange={editTime} ariaLabel="Scheduled time" />
              </div>

              {/* The one line that says, in words, what the two fields add up
                  to. Without it the dialog never confirms the moment it is
                  about to commit to. */}
              <div className="mt-2 flex items-center gap-2 rounded-card bg-white/2 px-3 py-2">
                {!when || whenProblem ? (
                  <>
                    <AlertTriangle size="0.875rem" strokeWidth={1.8} className="shrink-0 text-alert" />
                    <span className="text-xs text-alert">{whenProblem}</span>
                  </>
                ) : (
                  <>
                    <Clock3 size="0.875rem" strokeWidth={1.8} className="shrink-0 text-faint" />
                    <span className="text-xs text-muted">
                      Sends {absoluteLabel(when)}
                      <span className="text-faint"> · {relativeLabel(when)}</span>
                    </span>
                  </>
                )}
              </div>
            </section>
          </>
        ) : (
          <p className="rounded-card border border-white/8 bg-white/2 px-3 py-2.5 text-sm text-muted">
            Write a message in the composer, then use the clock button to choose when to send it.
          </p>
        )}

        {notice && <p className="text-sm text-done">{notice}</p>}
        {error && <p className="text-sm text-alert">{error}</p>}

        <section className="border-t border-white/6 pt-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="eyebrow">Scheduled</span>
            {scheduled.length > 0 && (
              <span className="rounded-full bg-white/6 px-2 py-0.5 text-xs tabular-nums text-muted">
                {scheduled.length}
              </span>
            )}
          </div>

          {loading ? (
            <p className="py-2 text-sm text-faint">Loading…</p>
          ) : scheduled.length === 0 ? (
            <p className="py-2 text-sm text-faint">Nothing queued for this conversation.</p>
          ) : (
            // Capped so a long queue can't push the dialog past a short
            // viewport — the Modal shell itself does not scroll, and giving the
            // body a scroll box would clip the date/time popovers.
            <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
              {scheduled.map((item) => (
                <ScheduledRow
                  key={item.id}
                  item={item}
                  deleting={deletingId === item.id}
                  onRemove={() => void removeScheduled(item.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}

function ScheduledRow({
  item,
  deleting,
  onRemove,
}: {
  item: ScheduledMessage
  deleting: boolean
  onRemove: () => void
}) {
  const failed = item.status === 'failed'
  const at = new Date(item.scheduledFor)
  return (
    <li className="flex items-start gap-2.5 rounded-card border border-white/6 bg-white/2 px-3 py-2.5">
      {failed ? (
        <AlertTriangle size="0.9375rem" strokeWidth={1.8} className="mt-0.5 shrink-0 text-alert" />
      ) : (
        <Clock3 size="0.9375rem" strokeWidth={1.8} className="mt-0.5 shrink-0 text-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-sm text-text">{item.body}</p>
        {/* A failure keeps the intended time visible — the old row replaced it
            with the error, which lost the one detail needed to reschedule. */}
        <p className="mt-1 text-xs text-faint">
          {absoluteLabel(at)}
          {!failed && ` · ${relativeLabel(at)}`}
        </p>
        {failed && (
          <p className="mt-1 text-xs text-alert">{item.lastError || 'Delivery failed'}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={deleting}
        aria-label="Remove scheduled message"
        title="Remove scheduled message"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/6 hover:text-alert disabled:opacity-40"
      >
        {deleting ? (
          <Loader2 size="0.875rem" strokeWidth={2.2} className="animate-spin" />
        ) : (
          <Trash2 size="0.875rem" strokeWidth={1.8} />
        )}
      </button>
    </li>
  )
}
