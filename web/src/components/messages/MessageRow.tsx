import { Fragment, memo, useRef, useState, type ReactNode } from 'react'
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
import type { Attachment, GroupType, Mention } from '../../lib/types'
import { splitBodyByMentions } from '../../lib/mentions'
import { renderRichText } from '../../lib/richText'
import AttachmentBlock from '../attachments/AttachmentBlock'
import { downloadAttachment } from '../attachments/attachmentUtils'
import MessageActionsMenu, { type MessageAction } from './MessageActionsMenu'
import ReadReceipts, { type Reader } from './ReadReceipts'
import ReplyQuote from './ReplyQuote'
import { DELETE_WINDOW_MS, formatTime } from './messageUtils'
import DayDivider from './DayDivider'
import Avatar from '../Avatar'
import { useMessageDisplay } from '../../lib/messageDisplay'
import type { LocalMessage } from './types'

// Consecutive messages from the same author within this window are grouped (one
// author header, then plain rows / tight bubbles). A new group also starts on an
// author change, a system row, or a date divider. ~7 min reads as "same burst".
const GROUP_WINDOW_MS = 7 * 60 * 1000

// Render a message body with @-mentions highlighted and *bold* / _italic_ inline
// formatting applied. Tokenized into plain-text and mention segments (never HTML)
// so user input is always escaped by React; the plain segments additionally run
// through renderRichText for bold/italic. A mention of the current user gets a
// stronger-but-subtle chip; others are a quiet accent-coloured token.
function renderBody(
  body: string,
  mentions: Mention[] | undefined,
  currentUserId: string,
): ReactNode {
  const segments = splitBodyByMentions(body, mentions)
  if (segments.length === 1 && !segments[0].mention) return renderRichText(body)
  return segments.map((seg, i) => {
    if (!seg.mention) return <Fragment key={i}>{renderRichText(seg.text, `s${i}-`)}</Fragment>
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
  // Read-receipt readers for MY sent messages — every member except me, each
  // carrying their lastReadAt marker (compared against this message's createdAt
  // inside ReadReceipts). Supplied — and changing — ONLY for my own messages;
  // left undefined for incoming ones so they don't re-render when the roster's
  // read state advances. Derived once per render in ChatView and shared by all
  // of my rows, so its reference is stable unless the roster actually changes.
  readers?: Reader[]
  prev?: LocalMessage
  // True when this is the very first message of the whole thread (no older page
  // to load) — the day divider then reads "Conversation started · <date>".
  conversationStart?: boolean
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

function MessageRow({
  message,
  mine,
  currentUserId,
  readers,
  prev,
  conversationStart,
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
    new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS

  const showDayDivider =
    prev === undefined ||
    new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  // A group starts on an author change / time gap / system break (all folded
  // into !sameAuthorAsPrev) or whenever a date divider precedes this row. Drives
  // the plain-stream author header; the bubble view uses sameAuthorAsPrev only.
  const startNewGroup = !sameAuthorAsPrev || showDayDivider

  // Which message timeline style to render — 'bubble' (classic) or 'plain' (the
  // no-bubble grouped operational-log stream). Reads live via a <html> attribute
  // so toggling re-renders every row without ChatView prop changes.
  const display = useMessageDisplay()

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
    ? 'bg-white/[0.02] text-muted italic rounded-[8px] rounded-br-[3px]'
    : 'bg-white/[0.02] text-muted italic rounded-[8px] rounded-bl-[3px]'
  // Minimal flat skins: darker neutral greys — incoming a touch darker than my
  // own so the two read apart without any colour tint. Borderless, no shadow.
  // The bubble itself never changes on hover; only the actions affordance
  // reveals. (Failed sends keep an alert border as their error cue.)
  const bubbleSkin = deleted
    ? deletedSkin
    : mine
      ? failed
        ? 'bg-[#1C1C1F] border border-alert/50 rounded-[8px] rounded-br-[3px]'
        : 'bg-[#1C1C1F] rounded-[8px] rounded-br-[3px]'
      : 'bg-[#141416] rounded-[8px] rounded-bl-[3px]'
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

  // ── Plain stream (no-bubble, grouped "operational log") ────────────────────
  // Slack/Discord-style work-log: every group is LEFT-aligned with the SAME
  // structure regardless of author — including my own. A group start shows the
  // avatar (in a fixed left gutter) + author name; following rows in the group
  // are bare text indented under that gutter. Ownership of my messages is marked
  // only subtly (warmer name + a "You" chip + read ticks) — never by alignment
  // or a bubble. Per-message time trails the body on the row's end (faint, never
  // in the header, never above the text). A single subtle dropdown chevron
  // reveals in the reserved left gutter on hover and opens the full actions
  // menu; right-click opens the same menu — both reuse the same handlers.
  if (display === 'plain') {
    const authorLabel = message.authorName || 'Member'
    const time = formatTime(message.createdAt)
    // Trailing meta cluster, a flex sibling at the END of the message (close on
    // short messages, at the row end on long ones) — never at the viewport edge,
    // the author header, or above the text. Order: optional `edited`, then my
    // read ticks, then the time. The ticks stay visible (delivery/read state);
    // the time and `edited` reveal only on THIS row's hover. Both stay mounted
    // (opacity-only) so the cluster's width is constant — hovering never reflows.
    const metaCluster = (
      <span className="inline-flex items-center gap-1 shrink-0 leading-none select-none pb-[2px]">
        {edited && (
          <span className="text-[10px] text-faint italic opacity-0 transition-opacity group-hover/msg:opacity-100">
            edited
          </span>
        )}
        {mine && !failed && !deleted && (
          <ReadReceipts
            others={readers ?? []}
            createdAt={message.createdAt}
            pending={pending}
            align="right"
          />
        )}
        <span className="text-[10px] text-faint tabular-nums opacity-0 transition-opacity group-hover/msg:opacity-100">
          {time}
        </span>
      </span>
    )

    return (
      <>
        {showDayDivider && (
          <DayDivider iso={message.createdAt} conversationStart={conversationStart} />
        )}
        <div
          data-message-id={message.id}
          onContextMenu={(e) => {
            if (!canShowActions) return
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          className={`group/msg relative pl-1.5 pr-2 rounded-md transition-colors duration-500 ${
            startNewGroup ? 'mt-4' : 'mt-0.5'
          } ${highlighted ? 'bg-active/10' : 'hover:bg-white/[0.02]'}`}
        >
          {/* Row layout: avatar gutter · content column. The chevron does NOT
              live up here next to the avatar/name — it sits INSIDE the content
              column, in a gutter on the message block (below the author header),
              so it aligns with the message text row and never shifts the avatar,
              name, or body. */}
          <div className="flex items-start gap-2.5">
            {/* Avatar gutter — avatar only at a group start; empty (indent) on
                following rows so the group stays visually anchored. */}
            <div className="w-8 shrink-0 pt-0.5">
              {startNewGroup && (
                <Avatar userId={message.authorId} name={authorLabel} size={32} />
              )}
            </div>

            {/* Content column — always left-aligned, capped for readability. */}
            <div className="min-w-0 flex-1 flex flex-col items-start max-w-[680px]">
              {/* Author header: name (+ subtle "You" chip for mine). Kept clean —
                  NO chevron and NO timestamp ever live on this row. It sits at
                  the content-left edge, sharing its x with the chevron gutter
                  below it. */}
              {startNewGroup && (
                <div className="flex items-center gap-1.5 mb-0.5 leading-none">
                  <span
                    className={`text-[13.5px] font-semibold ${mine ? 'text-active' : 'text-text'}`}
                  >
                    {authorLabel}
                  </span>
                  {mine && (
                    <span className="rounded border border-white/[0.1] px-1 py-px text-[9px] uppercase tracking-[0.06em] leading-none text-faint">
                      You
                    </span>
                  )}
                </div>
              )}

              {/* Message block: chevron gutter + message content. The chevron
                  gutter sits at the content-left edge (under the author name) and
                  the body indents past it — so the chevron lands on the MESSAGE
                  TEXT row, aligned to its first line, never the author row. Its
                  fixed width means the body never shifts when it reveals. */}
              <div className="flex items-start gap-1.5 w-full">
                {/* Actions trigger — icon-only, revealed on this row's hover/
                    focus. No background, border, shadow or rounded box — just a
                    muted glyph that brightens on hover. Clicking opens the full
                    actions menu (reply / forward / edit / delete / pin / copy …);
                    right-click still opens it too. */}
                <div className="w-4 shrink-0 pt-0.5 flex justify-center">
                  {canShowActions && (
                    <button
                      ref={triggerRef}
                      type="button"
                      onClick={() => setMenu((m) => (m === 'chevron' ? null : 'chevron'))}
                      aria-label="Message actions"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className={`flex items-center justify-center text-faint transition hover:text-text ${
                        menuOpen
                          ? 'opacity-100 text-text'
                          : 'opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100'
                      }`}
                    >
                      <ChevronDown size={15} strokeWidth={1.8} />
                    </button>
                  )}
                </div>

                {/* Message content sub-column — reply quote / pins / attachments
                    / body, all indented past the chevron gutter so they align
                    with each other. */}
                <div className="min-w-0 flex-1 flex flex-col items-start">
                  {!deleted && message.replyTo && (
                    <ReplyQuote replyTo={message.replyTo} onJump={onJumpToMessage} />
                  )}
                  {pinned && (
                    <span className="flex items-center gap-1 text-[10.5px] text-active mb-0.5 leading-none">
                      <Pin size={10} strokeWidth={2} className="fill-current" /> Pinned
                    </span>
                  )}
                  {forwarded && (
                    <span className="block text-[10.5px] text-muted italic mb-0.5 leading-none">Forwarded</span>
                  )}

                  {!deleted && message.attachments && message.attachments.length > 0 && (
                    <div className="flex flex-col gap-1 my-1 max-w-full">
                      {message.attachments.map((a, i) => (
                        <AttachmentBlock
                          key={i}
                          attachment={a}
                          uploading={pending}
                          priority={imagePriority}
                          captioned={Boolean(message.body)}
                          onActivate={(a) => onActivateAttachment(message, a)}
                          onImageLoad={onImageLoad}
                        />
                      ))}
                    </div>
                  )}

                  {/* Body + trailing time on the same row (items-end keeps the
                      time on the body's last line). Deleted → muted italic with
                      the time still trailing; attachment-only → time on its own
                      trailing row. */}
                  {deleted ? (
                    <div className="flex items-end gap-2 max-w-full">
                      <span className="min-w-0 text-[length:var(--chat-plain-font-size)] text-muted italic">
                        {mine ? 'You deleted this message' : 'This message was deleted'}
                      </span>
                      <span className="shrink-0 text-[10px] text-faint tabular-nums leading-none select-none pb-[2px] opacity-0 transition-opacity group-hover/msg:opacity-100">
                        {time}
                      </span>
                    </div>
                  ) : message.body ? (
                    <div className="flex items-end gap-2 max-w-full">
                      <span className="min-w-0 text-[length:var(--chat-plain-font-size)] leading-[1.55] text-[#F4F1EC] whitespace-pre-wrap break-words">
                        {renderBody(message.body, message.mentions, currentUserId)}
                      </span>
                      {metaCluster}
                    </div>
                  ) : message.attachments && message.attachments.length > 0 ? (
                    <div className="flex max-w-full">{metaCluster}</div>
                  ) : null}

                  {failed && mine && message.localId && (
                    <button
                      onClick={() => onRetry(message.localId!, message.body, message.pendingFile ?? null)}
                      className="block text-[10.5px] text-alert hover:text-text transition-colors mt-0.5"
                    >
                      Tap to retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {menuOpen && (menu !== 'chevron' || triggerRef.current) && (
            <MessageActionsMenu
              anchorEl={menu === 'chevron' ? triggerRef.current : undefined}
              anchorPoint={menu !== 'chevron' && menu ? menu : undefined}
              actions={actions}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {showDayDivider && (
        <DayDivider iso={message.createdAt} conversationStart={conversationStart} />
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
                        others={readers ?? []}
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

// Careful memo comparison. We compare only the DATA props that affect this
// row's output: the message + its predecessor (for the author-run / day-divider
// logic), who's viewing, the readers list (my-message receipts), and the
// presentational flags. The callback props are intentionally NOT compared —
// they're effectively stable for a given message (each one acts on the `message`
// passed at call time), so re-rendering just because ChatView handed down a new
// closure identity is pure waste. The big win: incoming rows get `readers ===
// undefined` on both sides and so DON'T re-render when the roster's read state
// advances — only my own sent rows update their checkmarks live.
function propsEqual(a: Props, b: Props): boolean {
  return (
    a.message === b.message &&
    a.prev === b.prev &&
    a.conversationStart === b.conversationStart &&
    a.mine === b.mine &&
    a.currentUserId === b.currentUserId &&
    a.readers === b.readers &&
    a.groupType === b.groupType &&
    a.highlighted === b.highlighted &&
    a.imagePriority === b.imagePriority
  )
}

export default memo(MessageRow, propsEqual)
