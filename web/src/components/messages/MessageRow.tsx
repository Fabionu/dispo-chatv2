import { Fragment, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Pin } from 'lucide-react'
import type { Attachment, GroupType, Mention } from '../../lib/types'
import { splitBodyByMentions } from '../../lib/mentions'
import AttachmentBlock from '../attachments/AttachmentBlock'
import MessageActionsMenu, { type MessageAction } from './MessageActionsMenu'
import ReplyQuote from './ReplyQuote'
import { DELETE_WINDOW_MS, formatDay, formatTime } from './messageUtils'
import Avatar from '../Avatar'
import type { LocalMessage } from './types'

// Render a message body with @-mentions highlighted. Tokenized into plain-text
// and mention segments (never HTML) so user input is always escaped by React.
// A mention of the current user gets a stronger-but-subtle chip; others are a
// quiet accent-coloured token.
function renderBody(
  body: string,
  mentions: Mention[] | undefined,
  currentUserId: string,
): ReactNode {
  const segments = splitBodyByMentions(body, mentions)
  if (segments.length === 1 && !segments[0].mention) return body
  return segments.map((seg, i) => {
    if (!seg.mention) return <Fragment key={i}>{seg.text}</Fragment>
    const isMe = seg.mention.userId === currentUserId
    return (
      <span
        key={i}
        className={
          isMe
            ? 'rounded px-0.5 font-semibold text-active bg-active/15'
            : 'font-medium text-active'
        }
      >
        {seg.text}
      </span>
    )
  })
}

type Props = {
  message: LocalMessage
  mine: boolean
  // The viewing user — used to highlight mentions of *me* more strongly.
  currentUserId: string
  prev?: LocalMessage
  groupType: GroupType
  highlighted: boolean
  onRetry: (localId: string, body: string, file: File | null) => void
  // This row is among the newest in the thread — load its image attachments
  // eagerly so recent pictures appear together with the conversation.
  imagePriority: boolean
  // Opens a preview with the parent message as context, so the preview's
  // Reply/Forward act on the whole message (not just the raw file).
  onActivateAttachment: (message: LocalMessage, attachment: Attachment) => void
  onImageLoad: () => void
  onCopy: (m: LocalMessage) => void
  onPin: (m: LocalMessage) => void
  onUnpin: (m: LocalMessage) => void
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
  currentUserId,
  prev,
  groupType,
  highlighted,
  onRetry,
  imagePriority,
  onActivateAttachment,
  onImageLoad,
  onCopy,
  onPin,
  onUnpin,
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
  // author within a couple of minutes — keeps bursts readable. A system
  // activity row in between breaks the run, so the author chrome reappears.
  const sameAuthorAsPrev =
    prev !== undefined &&
    prev.kind !== 'system' &&
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
  const pinned = Boolean(message.pinnedAt) && !deleted
  // Copy lifts the text body; disabled for attachment-only messages.
  const canCopy = !deleted && Boolean(message.body)
  // Any attachment (image OR document) means the chevron can sit over media,
  // so it needs the readability patch behind it.
  const hasAttachment = !deleted && (message.attachments?.length ?? 0) > 0
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

  // The actions menu is opened two ways: from the chevron (anchored under it)
  // or by right-clicking the bubble (anchored at the cursor). One state covers
  // both — 'chevron' or a {x,y} cursor point, else null (closed).
  const [menu, setMenu] = useState<'chevron' | { x: number; y: number } | null>(null)
  const menuOpen = menu !== null
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
    {
      label: pinned ? 'Unpin message' : 'Pin message',
      onClick: () => (pinned ? onUnpin(message) : onPin(message)),
    },
    { label: 'Copy', onClick: () => onCopy(message), disabled: !canCopy },
    { label: 'Forward', onClick: () => onForward(message) },
    ...(canMessagePrivately
      ? [
          { label: 'Reply privately', onClick: () => onReplyPrivately(message) },
          { label: 'Send private message', onClick: () => onSendPrivate(message) },
        ]
      : []),
    ...(mine ? [{ label: 'Edit', onClick: () => onEdit(message), disabled: !canEdit }] : []),
    {
      label: 'Delete for me',
      onClick: () => onDeleteForMe(message),
      tone: 'alert' as const,
      separator: true,
    },
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

  // Subtle bubble-corner meta: optional `edited` tag then the time (or a
  // `Failed` marker). Rendered two ways below — tucked into the last line of a
  // text bubble (WhatsApp-style float), or on its own right-aligned line under
  // an attachment-only bubble.
  const meta = (
    <>
      {edited && <span className="italic">edited</span>}
      {failed ? <span className="not-italic text-alert">Failed</span> : formatTime(message.createdAt)}
    </>
  )

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
              <Avatar userId={message.authorId} name={message.authorName} size={36} />
            )}
          </div>
        )}
        <div className={`flex-1 min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {showAuthorChrome && !sameAuthorAsPrev && (
            <div className="text-[11px] text-muted mb-1 px-1 leading-none">{message.authorName}</div>
          )}
          {/* Group wrapper for hover-reveal of the actions chevron. Width
              is capped here so the trigger hugs the bubble's edge. Right-click
              anywhere on the bubble opens the same actions menu at the cursor. */}
          <div
            className={`group relative ${rowMaxW}`}
            onContextMenu={(e) => {
              if (!canShowActions) return
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            <div className={`${bubbleBase} ${bubbleSkin} ${highlightSkin}`}>
              {pinned && (
                <span className="flex items-center gap-1 text-[10.5px] text-active mb-1 leading-none">
                  <Pin size={10} strokeWidth={2} className="fill-current" />
                  Pinned
                </span>
              )}
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
                  {message.attachments.map((a, i) => (
                    <AttachmentBlock
                      // Index key keeps the block (and its <img>) mounted across
                      // the optimistic→real swap, so the blob preview persists.
                      key={i}
                      attachment={a}
                      uploading={pending}
                      priority={imagePriority}
                      onActivate={(a) => onActivateAttachment(message, a)}
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
                <>
                  {message.body && (
                    // pr-5 reserves the top-right corner for the actions chevron
                    // so wrapping text never runs underneath it. The timestamp is
                    // NOT inline — it lives on its own footer row below.
                    <span
                      className={`whitespace-pre-wrap break-words ${canShowActions ? 'pr-5' : ''}`}
                    >
                      {renderBody(message.body, message.mentions, currentUserId)}
                    </span>
                  )}
                  {/* Subtle footer row: the time (and `edited`) on their own line,
                      aligned to the bubble's bottom-right corner — below the
                      text/caption (or the media in an attachment-only bubble) and
                      diagonally clear of the top-right chevron. */}
                  <span className="self-end inline-flex items-center gap-1 whitespace-nowrap text-[10.5px] leading-none text-muted select-none mt-0.5">
                    {meta}
                  </span>
                </>
              )}
            </div>

            {/* Readability patch behind the chevron — a bubble-coloured (not
                black) radial wash anchored in the top-right corner. It's nearly
                solid right under the chevron and fades to transparent toward the
                centre, so it reads as part of the bubble rather than a harsh
                overlay. Colour matches the bubble: my darker bubble (#222225)
                vs others' surface (#141416). Rounded to follow the bubble's
                top-right corner. Only over media (image/document) for legibility. */}
            {canShowActions && hasAttachment && (
              <div
                style={{
                  background: mine
                    ? 'radial-gradient(circle at top right, rgba(34,34,37,0.96), rgba(34,34,37,0.72) 38%, rgba(34,34,37,0) 76%)'
                    : 'radial-gradient(circle at top right, rgba(20,20,22,0.96), rgba(20,20,22,0.72) 38%, rgba(20,20,22,0) 76%)',
                }}
                className={`absolute top-0 right-0 h-11 w-14 rounded-tr-[7px] pointer-events-none transition-opacity duration-200 ${
                  menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                }`}
              />
            )}

            {/* Minimal hover-revealed actions trigger — just the chevron, a
                quiet muted glyph with no background or strong colour jump. */}
            {canShowActions && (
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setMenu((m) => (m === 'chevron' ? null : 'chevron'))}
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`absolute top-1 right-1 h-5 w-5 flex items-center justify-center text-text transition-opacity duration-200 ${
                  menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                }`}
              >
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
            )}

            {menuOpen && (menu !== 'chevron' || triggerRef.current) && (
              <MessageActionsMenu
                anchorEl={menu === 'chevron' ? triggerRef.current : undefined}
                anchorPoint={menu !== 'chevron' && menu ? menu : undefined}
                actions={actions}
                onClose={() => setMenu(null)}
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
