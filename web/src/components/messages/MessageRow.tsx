import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Attachment, GroupType } from '../../lib/types'
import AttachmentBlock from '../attachments/AttachmentBlock'
import MessageActionsMenu, { type MessageAction } from './MessageActionsMenu'
import ReplyQuote from './ReplyQuote'
import { DELETE_WINDOW_MS, formatDay, formatTime, initials } from './messageUtils'
import type { LocalMessage } from './types'

type Props = {
  message: LocalMessage
  mine: boolean
  prev?: LocalMessage
  groupType: GroupType
  highlighted: boolean
  onRetry: (localId: string, body: string, file: File | null) => void
  showTimestamp: boolean
  onActivateAttachment: (attachment: Attachment) => void
  onImageLoad: () => void
  onReply: (m: LocalMessage) => void
  onEdit: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onReplyPrivately: (m: LocalMessage) => void
  onSendPrivate: (m: LocalMessage) => void
  onDeleteForMe: (m: LocalMessage) => void
  onDeleteForEveryone: (m: LocalMessage) => void
  onJumpToMessage: (messageId: string) => void
}

export default function MessageRow({
  message,
  mine,
  prev,
  groupType,
  highlighted,
  onRetry,
  showTimestamp,
  onActivateAttachment,
  onImageLoad,
  onReply,
  onEdit,
  onForward,
  onReplyPrivately,
  onSendPrivate,
  onDeleteForMe,
  onDeleteForEveryone,
  onJumpToMessage,
}: Props) {
  // Collapse the author line when the previous message is from the same
  // author within a couple of minutes — keeps bursts readable.
  const sameAuthorAsPrev =
    prev !== undefined &&
    prev.authorId === message.authorId &&
    new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < 4 * 60 * 1000

  const showDayDivider =
    prev === undefined ||
    new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  const failed = message.failed === true
  const pending = message.pending === true
  const deleted = Boolean(message.deletedAt)
  const edited = Boolean(message.editedAt) && !deleted
  const forwarded = message.forwarded === true && !deleted
  const hasImageAttachment =
    !deleted && Boolean(message.attachments?.some((a) => a.mimeType.startsWith('image/')))
  // Optimistic + failed bubbles aren't real messages yet, so they shouldn't
  // expose the menu. Deleted placeholders shouldn't either.
  const canShowActions = !deleted && !pending && !failed
  const canEdit = mine && !deleted && !pending && !failed
  const withinDeleteWindow =
    Date.now() - new Date(message.createdAt).getTime() < DELETE_WINDOW_MS
  const canDeleteForEveryone = mine && !deleted && !pending && !failed && withinDeleteWindow
  // The private-DM actions only make sense for someone else's message inside a
  // group conversation — in a 1:1 the "private" chat would be this same one.
  const canMessagePrivately = !mine && groupType === 'vehicle'
  // In a direct (1:1) conversation the peer is identified by the header, so
  // per-message avatars and author labels are redundant — drop them and let
  // incoming bubbles sit flush to the left.
  const showAuthorChrome = !mine && groupType === 'vehicle'

  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 78% keeps bubbles narrower than the column on small screens; the absolute
  // 640px cap keeps them comfortably readable when the column gets wider on
  // 2K+ monitors. CSS min() picks whichever is smaller at the current width.
  // Font size comes from --chat-msg-font-size so it scales with the display.
  // max-w lives on the row so the trigger overlay can hug the bubble without
  // breaking the alignment math.
  const rowMaxW = 'max-w-[min(78%,640px)]'
  const bubbleBase =
    'px-3 pt-1.5 pb-1 text-[length:var(--chat-msg-font-size)] leading-[1.5] flex flex-col text-text transition-shadow duration-500'
  const deletedSkin = mine
    ? 'bg-white/[0.02] border border-white/[0.06] text-muted italic rounded-[7px] rounded-br-[2px]'
    : 'bg-white/[0.02] border border-white/[0.06] text-muted italic rounded-[7px] rounded-bl-[2px]'
  const bubbleSkin = deleted
    ? deletedSkin
    : mine
      ? failed
        ? 'bg-[#222225] border border-alert/50 rounded-[7px] rounded-br-[2px]'
        : 'bg-[#222225] border border-white/[0.06] rounded-[7px] rounded-br-[2px]'
      : 'bg-surface border border-white/[0.08] rounded-[7px] rounded-bl-[2px]'
  // Subtle, theme-warm pulse applied when this row is the target of a
  // jump-to-original. Clears after ~1.8s back in ChatView.
  const highlightSkin = highlighted ? 'ring-2 ring-active/60' : ''

  const actions: MessageAction[] = [
    { label: 'Reply', onClick: () => onReply(message) },
    { label: 'Forward', onClick: () => onForward(message) },
    ...(canMessagePrivately
      ? [
          { label: 'Reply privately', onClick: () => onReplyPrivately(message) },
          { label: 'Send message in private', onClick: () => onSendPrivate(message) },
        ]
      : []),
    ...(mine ? [{ label: 'Edit', onClick: () => onEdit(message), disabled: !canEdit }] : []),
    { label: 'Delete for me', onClick: () => onDeleteForMe(message) },
    ...(mine
      ? [
          {
            label: 'Delete for everyone',
            onClick: () => onDeleteForEveryone(message),
            disabled: !canDeleteForEveryone,
            tone: 'alert' as const,
          },
        ]
      : []),
  ]

  return (
    <>
      {showDayDivider && (
        <div className="flex items-center gap-3 py-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="eyebrow">{formatDay(message.createdAt)}</span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      )}
      <div
        data-message-id={message.id}
        className={`flex ${sameAuthorAsPrev ? 'mt-0.5' : 'mt-2.5'}`}
      >
        {showAuthorChrome && (
          <div className="w-9 mr-2.5 shrink-0">
            {!sameAuthorAsPrev && (
              <div className="h-9 w-9 rounded-full bg-active/30 border border-active/40 flex items-center justify-center text-[11.5px] font-semibold uppercase font-mono">
                {initials(message.authorName)}
              </div>
            )}
          </div>
        )}
        <div className={`flex-1 min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {showAuthorChrome && !sameAuthorAsPrev && (
            <div className="text-[11px] text-muted mb-1 px-1">{message.authorName}</div>
          )}
          {/* Group wrapper for hover-reveal of the actions chevron. Width
              is capped here so the trigger hugs the bubble's edge. */}
          <div className={`group relative ${rowMaxW}`}>
            <div className={`${bubbleBase} ${bubbleSkin} ${highlightSkin}`}>
              {forwarded && (
                <span className="text-[10.5px] text-muted italic mb-1 leading-none">
                  Forwarded
                </span>
              )}
              {!deleted && message.replyTo && (
                <ReplyQuote replyTo={message.replyTo} onJump={onJumpToMessage} />
              )}
              {!deleted && message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-1">
                  {message.attachments.map((a) => (
                    <AttachmentBlock
                      key={a.id}
                      attachment={a}
                      onActivate={onActivateAttachment}
                      onImageLoad={onImageLoad}
                    />
                  ))}
                </div>
              )}
              {deleted ? (
                <span className="whitespace-pre-wrap break-words">
                  {mine ? 'You deleted this message' : 'This message was deleted'}
                </span>
              ) : (
                message.body && (
                  <span className="whitespace-pre-wrap break-words">{message.body}</span>
                )
              )}
              {(failed || showTimestamp) && !deleted && (
                <span className="text-[10.5px] text-muted leading-none mt-1 self-end flex items-center gap-1">
                  {edited && <span className="italic">edited</span>}
                  {failed ? 'Failed' : formatTime(message.createdAt)}
                </span>
              )}
            </div>

            {/* Faint corner glow behind the chevron. A radial gradient
                anchored at the top-right corner fades out in every direction
                with no visible bounding box — unlike a linear gradient,
                which leaves its leading edges visible as a square. */}
            {canShowActions && (
              <div
                style={{
                  background: hasImageAttachment
                    ? 'radial-gradient(circle at top right, rgba(0,0,0,0.55), transparent 65%)'
                    : 'radial-gradient(circle at top right, rgba(0,0,0,0.35), transparent 70%)',
                }}
                className={`absolute top-0 right-0 h-14 w-20 pointer-events-none transition-opacity ${
                  menuOpen
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                }`}
              />
            )}

            {/* Minimal hover-revealed actions trigger — just the chevron,
                no border or fill. The gradient above carries the legibility. */}
            {canShowActions && (
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`absolute top-1 right-1.5 h-5 w-5 flex items-center justify-center text-muted hover:text-text transition-opacity ${
                  menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                }`}
              >
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
            )}

            {menuOpen && triggerRef.current && (
              <MessageActionsMenu
                anchorEl={triggerRef.current}
                actions={actions}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
          {failed && mine && message.localId && (
            <button
              onClick={() => onRetry(message.localId!, message.body, message.pendingFile ?? null)}
              className="text-[10.5px] text-alert hover:text-text transition-colors mt-1 px-1"
            >
              Tap to retry
            </button>
          )}
        </div>
      </div>
    </>
  )
}
