import { useEffect } from 'react'
import { Check, CheckCheck, Clock3, X } from 'lucide-react'
import Avatar from '../Avatar'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'
import type { LocalMessage } from './types'
import type { Reader } from './ReadReceipts'
import { formatDay, formatTime } from './messageUtils'

type Props = {
  message: LocalMessage
  others: Reader[]
  onOpenProfile: (userId: string, name: string) => void
  onClose: () => void
}

const ACCENT = '#D8A47F'

function seenAt(iso: string): string {
  const day = formatDay(iso)
  const time = formatTime(iso)
  return day === 'Today' ? `Today at ${time}` : `${day} at ${time}`
}

// Comfortable right-side replacement for the old receipts popover. It shares
// the same desktop in-flow / narrow-screen drawer behavior as the profile and
// group-info panels, so the chat reflows instead of being covered by a tiny list.
export default function ReadReceiptsPanel({ message, others, onOpenProfile, onClose }: Props) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const created = new Date(message.createdAt).getTime()
  const seen = others
    .filter((reader) => reader.lastReadAt && new Date(reader.lastReadAt).getTime() >= created)
    .sort((a, b) => (a.lastReadAt! < b.lastReadAt! ? -1 : 1))
  const notSeen = others.filter(
    (reader) => !(reader.lastReadAt && new Date(reader.lastReadAt).getTime() >= created),
  )
  const preview =
    message.body?.trim() ||
    (message.attachments?.length
      ? `${message.attachments.length} attachment${message.attachments.length === 1 ? '' : 's'}`
      : 'Message')

  return (
    <>
      <div className="fixed inset-0 z-40 xl:hidden" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Read receipts"
        className="fixed top-0 right-0 bottom-0 z-40 flex w-full max-w-[25rem] flex-col bg-rail shadow-[-16px_0_48px_rgba(0,0,0,0.4)]
                   xl:static xl:z-auto xl:w-[clamp(22.5rem,26vw,26.25rem)] xl:max-w-none xl:shrink-0 xl:overflow-hidden xl:rounded-panel xl:shadow-none"
      >
        <div className="h-[var(--header-height)] flex shrink-0 items-center justify-between px-4">
          <span className="text-[0.8125rem] font-semibold">Read receipts</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close read receipts"
            className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} shrink-0`}
          >
            <X size="1.125rem" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-5">
          <div className="mb-5 rounded-card bg-white/[0.025] px-3.5 py-3">
            <div className="line-clamp-3 text-[0.78125rem] leading-[1.5] text-text">{preview}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[0.65625rem] text-muted">
              <Clock3 size="0.75rem" strokeWidth={1.8} />
              Sent {formatDay(message.createdAt).toLowerCase()} at {formatTime(message.createdAt)}
            </div>
          </div>

          <ReceiptSection
            title={`Seen by ${seen.length}`}
            icon={<CheckCheck size="0.875rem" strokeWidth={2} style={{ color: ACCENT }} />}
            readers={seen}
            seen
            onOpenProfile={onOpenProfile}
          />
          {notSeen.length > 0 && (
            <ReceiptSection
              title="Not seen yet"
              icon={<Check size="0.875rem" strokeWidth={2} className="text-muted" />}
              readers={notSeen}
              onOpenProfile={onOpenProfile}
            />
          )}
        </div>
      </aside>
    </>
  )
}

function ReceiptSection({
  title,
  icon,
  readers,
  seen,
  onOpenProfile,
}: {
  title: string
  icon: React.ReactNode
  readers: Reader[]
  seen?: boolean
  onOpenProfile: (userId: string, name: string) => void
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-2 px-1">
        {icon}
        <span className="text-[0.6875rem] font-semibold uppercase tracking-badge text-muted">
          {title}
        </span>
      </div>
      <div className="overflow-hidden rounded-card bg-white/[0.018] divide-y divide-white/[0.04]">
        {readers.length === 0 ? (
          <div className="px-3 py-4 text-center text-[0.71875rem] text-muted">Nobody yet</div>
        ) : (
          readers.map((reader) => (
            <button
              key={reader.id}
              type="button"
              onClick={() => onOpenProfile(reader.id, reader.displayName)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
            >
              <Avatar userId={reader.id} name={reader.displayName} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium text-text">
                  {reader.displayName}
                </span>
                <span className="mt-0.5 block truncate text-[0.6875rem] text-muted">
                  {seen && reader.lastReadAt ? seenAt(reader.lastReadAt) : 'Waiting to be seen'}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
