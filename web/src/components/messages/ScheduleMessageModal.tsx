import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, Trash2 } from 'lucide-react'
import Modal from '../Modal'
import { DateField, TimeField } from '../DateTimeField'
import { api, ApiError } from '../../lib/api'
import { getSocket } from '../../lib/socket'
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

function readableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

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
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

  function chooseQuick(minutes: number) {
    const next = roundedFuture(minutes)
    setDate(dateValue(next))
    setTime(timeValue(next))
    setError(null)
  }

  async function schedule() {
    const when = parseLocalDateTime(date, time)
    if (!body) {
      setError('Write a message before scheduling it.')
      return
    }
    if (!when) {
      setError('Choose a valid date and time.')
      return
    }
    if (when.getTime() < Date.now() + 10_000) {
      setError('Choose a time in the future.')
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
      setNotice(`Message scheduled for ${readableDate(result.scheduledMessage.scheduledFor)}.`)
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
      subtitle={`Choose when this message should be sent to ${groupName}.`}
      onClose={onClose}
    >
      <div className="space-y-4">
        {body ? (
          <section className="space-y-3">
            <div className="rounded-card border border-white/8 bg-white/2 px-3.5 py-3">
              <p className="text-base text-text whitespace-pre-wrap break-words line-clamp-4">{body}</p>
              {replyToMessageId && (
                <p className="mt-2 text-xs text-muted">This will be sent as a reply.</p>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Date</label>
                <DateField value={date} onChange={setDate} ariaLabel="Scheduled date" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Time</label>
                <TimeField value={time} onChange={setTime} ariaLabel="Scheduled time" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => chooseQuick(30)}
                className="rounded-full border border-white/8 px-3 py-1.5 text-sm text-muted hover:bg-white/6 hover:text-text transition-colors"
              >
                In 30 minutes
              </button>
              <button
                type="button"
                onClick={() => chooseQuick(24 * 60)}
                className="rounded-full border border-white/8 px-3 py-1.5 text-sm text-muted hover:bg-white/6 hover:text-text transition-colors"
              >
                In 24 hours
              </button>
            </div>

            <button
              type="button"
              onClick={() => void schedule()}
              disabled={saving}
              className="w-full rounded-btn bg-text px-4 py-2.5 text-base font-semibold text-bg hover:bg-white disabled:opacity-50 transition-colors"
            >
              {saving ? 'Scheduling…' : 'Schedule message'}
            </button>
          </section>
        ) : (
          <p className="rounded-card border border-white/8 bg-white/2 px-3.5 py-3 text-sm text-muted">
            Write a message in the composer, then use the clock button to choose when to send it.
          </p>
        )}

        {notice && <p className="text-sm text-done">{notice}</p>}
        {error && <p className="text-sm text-alert">{error}</p>}

        <section className="border-t border-white/6 pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Scheduled in this conversation</h3>
            {scheduled.length > 0 && (
              <span className="rounded-full bg-white/6 px-2 py-0.5 text-xs text-muted">
                {scheduled.length}
              </span>
            )}
          </div>

          {loading ? (
            <p className="py-3 text-sm text-faint">Loading…</p>
          ) : scheduled.length === 0 ? (
            <p className="py-3 text-sm text-faint">No scheduled messages.</p>
          ) : (
            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {scheduled.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 rounded-card border border-white/6 bg-white/2 px-3 py-2.5"
                >
                  <Clock3
                    size="0.9375rem"
                    strokeWidth={1.8}
                    className={item.status === 'failed' ? 'mt-0.5 text-alert' : 'mt-0.5 text-muted'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-sm text-text">{item.body}</p>
                    <p className={`mt-1 text-xs ${item.status === 'failed' ? 'text-alert' : 'text-faint'}`}>
                      {item.status === 'failed'
                        ? item.lastError || 'Delivery failed'
                        : readableDate(item.scheduledFor)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeScheduled(item.id)}
                    disabled={deletingId === item.id}
                    aria-label="Remove scheduled message"
                    title="Remove scheduled message"
                    className="h-7 w-7 shrink-0 rounded-full text-faint hover:bg-white/6 hover:text-alert disabled:opacity-40 flex items-center justify-center transition-colors"
                  >
                    <Trash2 size="0.875rem" strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
