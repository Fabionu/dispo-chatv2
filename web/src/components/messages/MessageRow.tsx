import { Fragment, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Copy,
  Download,
  Forward,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
} from 'lucide-react'
import type { Attachment, GroupMember, GroupType, Mention } from '../../lib/types'
import { splitBodyByMentions } from '../../lib/mentions'
import AttachmentBlock from '../attachments/AttachmentBlock'
import { downloadAttachment } from '../attachments/attachmentUtils'
import MessageActionsMenu, { type MessageAction } from './MessageActionsMenu'
import ReadReceipts from './ReadReceipts'
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
  // Conversation members — the source for my-message read receipts (each
  // member's lastReadAt vs this message's createdAt).
  members: GroupMember[]
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
  members,
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
  // Attachments with a real, fetchable URL — excludes just-sent blob: previews
  // (optimistic sends) and known-missing objects, so Download is never offered
  // before a downloadable file actually exists on the server.
  const downloadable = canShowActions
    ? (message.attachments ?? []).filter(
        (a) => a.url && !a.url.startsWith('blob:') && !a.missing,
      )
    : []
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

  // Read-receipt readers: everyone in the conversation except me (the author).
  // Drives the sent-message checkmarks — fully read when ALL of them have seen
  // it (a single peer in a DM, all members in a group). Only computed for my
  // own messages; empty otherwise.
  const readers = mine
    ? members
        .filter((m) => m.id !== currentUserId)
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          hasAvatar: m.hasAvatar,
          lastReadAt: m.lastReadAt,
        }))
    : []

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
  const rowMaxW = 'max-w-[min(78%,660px)]'
  // Media (image/doc) messages use a tight 4px frame so the attachment nearly
  // fills the bubble instead of floating inside a thick coloured margin; text-
  // only messages keep a comfortable-but-compact padding. Caption text and the
  // meta footer re-add a small inset on media bubbles (see below).
  const bubblePad = hasAttachment ? 'p-1' : 'px-3 pt-1.5 pb-1'
  const bubbleBase = `${bubblePad} text-[length:var(--chat-msg-font-size)] leading-[1.45] flex flex-col text-[#F4F1EC] transition-[box-shadow,border-color] duration-500`
  const deletedSkin = mine
    ? 'bg-white/[0.02] border border-white/[0.04] text-muted italic rounded-[8px] rounded-br-[3px]'
    : 'bg-white/[0.02] border border-white/[0.04] text-muted italic rounded-[8px] rounded-bl-[3px]'
  // Minimal flat skins: darker neutral greys — incoming a touch darker than my
  // own so the two read apart without any colour tint. A faint matching border,
  // no shadow. The bubble itself never changes on hover; only the actions
  // affordance reveals.
  const bubbleSkin = deleted
    ? deletedSkin
    : mine
      ? failed
        ? 'bg-[#1C1C1F] border border-alert/50 rounded-[8px] rounded-br-[3px]'
        : 'bg-[#1C1C1F] border border-[#2A2A2E] rounded-[8px] rounded-br-[3px]'
      : 'bg-[#141416] border border-[#1F1F22] rounded-[8px] rounded-bl-[3px]'
  // Subtle, theme-warm pulse applied when this row is the target of a
  // jump-to-original. Clears after ~1.8s back in ChatView.
  const highlightSkin = highlighted ? 'ring-2 ring-active/60' : ''

  const iconSize = 14
  const actions: MessageAction[] = [
    { label: 'Reply', onClick: () => onReply(message), icon: <Reply size={iconSize} strokeWidth={1.8} /> },
    {
      label: pinned ? 'Unpin message' : 'Pin message',
      onClick: () => (pinned ? onUnpin(message) : onPin(message)),
      icon: pinned ? (
        <PinOff size={iconSize} strokeWidth={1.8} />
      ) : (
        <Pin size={iconSize} strokeWidth={1.8} />
      ),
    },
    {
      label: 'Copy',
      onClick: () => onCopy(message),
      disabled: !canCopy,
      icon: <Copy size={iconSize} strokeWidth={1.8} />,
    },
    { label: 'Forward', onClick: () => onForward(message), icon: <Forward size={iconSize} strokeWidth={1.8} /> },
    // Download sits with Copy/Forward, before the delete group. Only present
    // when the message has at least one server-backed attachment. One file →
    // direct download; multiple → each is downloaded in turn.
    ...(downloadable.length > 0
      ? [
          {
            label: 'Download',
            onClick: () => downloadable.forEach((a) => downloadAttachment(a)),
            icon: <Download size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
    ...(canMessagePrivately
      ? [
          {
            label: 'Reply privately',
            onClick: () => onReplyPrivately(message),
            icon: <Reply size={iconSize} strokeWidth={1.8} />,
          },
          {
            label: 'Send private message',
            onClick: () => onSendPrivate(message),
            icon: <MessageCircle size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
    ...(mine
      ? [
          {
            label: 'Edit',
            onClick: () => onEdit(message),
            disabled: !canEdit,
            icon: <Pencil size={iconSize} strokeWidth={1.8} />,
          },
        ]
      : []),
    {
      label: 'Delete for me',
      onClick: () => onDeleteForMe(message),
      tone: 'alert' as const,
      separator: true,
      icon: <Trash2 size={iconSize} strokeWidth={1.8} />,
    },
    ...(mine
      ? [
          {
            label: 'Delete for everyone',
            onClick: () => onDeleteForEveryone(message),
            disabled: !canDeleteForEveryone,
            tone: 'alert' as const,
            icon: <Trash2 size={iconSize} strokeWidth={1.8} />,
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
                <div className="flex flex-col gap-1 mb-0.5">
                  {message.attachments.map((a, i) => (
                    <AttachmentBlock
                      // Index key keeps the block (and its <img>) mounted across
                      // the optimistic→real swap, so the blob preview persists.
                      key={i}
                      attachment={a}
                      uploading={pending}
                      priority={imagePriority}
                      // Captioned: this image is sent with a text body, so it
                      // gets wider thumbnail bounds to sit visually with the
                      // caption instead of floating narrow above wide text.
                      captioned={Boolean(message.body)}
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
                    // On text-only bubbles pr-7 reserves the top-right corner for
                    // the actions chevron so wrapping text never runs under it. On
                    // media bubbles the chevron sits over the image (not the
                    // caption), so the caption just gets a small inset back from
                    // the tight media frame. Timestamp is NOT inline — it's the
                    // footer row below.
                    <span
                      className={`whitespace-pre-wrap break-words font-medium tracking-normal ${
                        hasAttachment ? 'px-1.5 pt-0.5' : canShowActions ? 'pr-7' : ''
                      }`}
                    >
                      {renderBody(message.body, message.mentions, currentUserId)}
                    </span>
                  )}
                  {/* Subtle footer row: the time (and `edited`) on their own line,
                      aligned to the bubble's bottom-right corner — below the
                      text/caption (or the media in an attachment-only bubble) and
                      diagonally clear of the top-right chevron. */}
                  <span
                    className={`self-end inline-flex items-center gap-1 whitespace-nowrap text-[10.5px] leading-none text-[#8F8A98] select-none mt-0.5 -mb-0.5 ${
                      hasAttachment ? '-mr-0.5' : '-mr-1.5'
                    }`}
                  >
                    {meta}
                    {/* Read checkmarks — only on my own sent messages. Clicking
                        opens the receipts popover (who's seen it + when). Hidden
                        for failed sends (the "Failed" marker stands in). */}
                    {mine && !failed && (
                      <ReadReceipts
                        others={readers}
                        createdAt={message.createdAt}
                        pending={pending}
                      />
                    )}
                  </span>
                </>
              )}
            </div>

            {/* Minimal hover-revealed actions trigger. On text bubbles it's a
                bare muted chevron. On media/document bubbles it becomes a small
                circular, translucent-dark button (like a native media control)
                so the glyph stays legible on bright or dark images — no
                rectangular patch or gradient edge. */}
            {canShowActions && (
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setMenu((m) => (m === 'chevron' ? null : 'chevron'))}
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`absolute top-1 right-1 z-10 flex items-center justify-center transition duration-200 ${
                  hasAttachment
                    ? `h-6 w-6 rounded-full border border-white/[0.08] backdrop-blur-sm text-white ${
                        menuOpen ? 'bg-black/[0.55]' : 'bg-black/[0.38] hover:bg-black/[0.55]'
                      }`
                    : 'h-5 w-5 text-text'
                } ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
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
