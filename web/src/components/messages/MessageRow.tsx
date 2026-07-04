import { memo, useRef, useState } from 'react'
import { ChevronDown, Pin } from 'lucide-react'
import type { Attachment, GroupType } from '../../lib/types'
import AttachmentBlock from '../attachments/AttachmentBlock'
import MessageActionsMenu from './MessageActionsMenu'
import ReadReceipts, { type Reader } from './ReadReceipts'
import ReplyQuote from './ReplyQuote'
import { DELETE_WINDOW_MS, formatTime } from './messageUtils'
import DayDivider from './DayDivider'
import Avatar from '../Avatar'
import { useMessageDisplay } from '../../lib/messageDisplay'
import { renderBody } from './messageBody'
import { buildMessageActions } from './messageActionItems'
import type { LocalMessage } from './types'

// Consecutive messages from the same author within this window are grouped (one
// author header, then plain rows / tight bubbles). A new group also starts on an
// author change, a system row, or a date divider. ~7 min reads as "same burst".
const GROUP_WINDOW_MS = 7 * 60 * 1000

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
  // into !sameAuthorAsPrev) or whenever a date divider precedes this row.
  // Drives the author chrome (avatar + name), group spacing, and the bubble
  // corner grouping in BOTH display styles.
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
  const rowMaxW = 'max-w-[min(78%,41.25rem)]'
  // Media (image/doc) messages use a tight 4px frame so the attachment nearly
  // fills the bubble instead of floating inside a thick coloured margin; text-
  // only messages keep a comfortable-but-compact padding. Caption text and the
  // meta footer re-add a small inset on media bubbles (see below).
  const bubblePad = hasAttachment ? 'p-1' : 'px-3 pt-1.5 pb-1'
  const bubbleBase = `${bubblePad} text-[length:var(--chat-msg-font-size)] leading-[1.45] flex flex-col text-[#F5F5F5] transition-[box-shadow,border-color] duration-500`
  // Corner shape: an 8px rounded rectangle (matching the app's small-radius
  // language — no pills) with a tighter 3px "tail" on the sender-side bottom
  // corner as the directional cue. Inside a same-author run the top corner on
  // that side also tightens, so consecutive bubbles read as one stacked group.
  const grouped = !startNewGroup
  const shapeMine = `rounded-[0.5rem] rounded-br-[0.1875rem]${grouped ? ' rounded-tr-[0.25rem]' : ''}`
  const shapeOther = `rounded-[0.5rem] rounded-bl-[0.1875rem]${grouped ? ' rounded-tl-[0.25rem]' : ''}`
  const deletedSkin = `bg-white/[0.02] text-muted italic ${mine ? shapeMine : shapeOther}`
  // Minimal flat skins on the neutral chat surface (`bg` #181818): incoming a
  // quiet neutral lift (`surface` grey), my own a slightly lighter grey warmed
  // toward the `active` accent — tinted, never bright, so ownership reads at a
  // glance while the timeline stays calm. Borderless, no shadow. The bubble
  // itself never changes on hover; only the actions affordance reveals.
  // (Failed sends keep an alert border as their error cue.)
  const bubbleSkin = deleted
    ? deletedSkin
    : mine
      ? failed
        ? `bg-[#383028] border border-alert/50 ${shapeMine}`
        : `bg-[#383028] ${shapeMine}`
      : `bg-[#262626] ${shapeOther}`
  // Subtle, theme-warm pulse applied when this row is the target of a
  // jump-to-original. Clears after ~1.8s back in ChatView.
  const highlightSkin = highlighted ? 'ring-2 ring-active/60' : ''

  const actions = buildMessageActions({
    message,
    pinned,
    canCopy,
    downloadable,
    canMessagePrivately,
    mine,
    canEdit,
    canDeleteForEveryone,
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
  })

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
  // only subtly (warmer name + read ticks) — never by alignment
  // or a bubble. Per-message time trails the body on the row's end (faint, never
  // in the header, never above the text). A single subtle dropdown chevron
  // reveals on hover, ATTACHED to the content: for text it sits just after the
  // last line (before the time/ticks); for attachment-only messages it sits to
  // the RIGHT of the media (never below it). It opens the full actions menu;
  // right-click opens the same menu — both reuse the same handlers.
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
          <span className="text-[0.625rem] text-faint italic opacity-0 transition-opacity group-hover/msg:opacity-100">
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
        {/* Time is always visible (no hover-reveal) so the log is scannable
            without hovering each row. */}
        <span className="text-[0.625rem] text-faint tabular-nums">
          {time}
        </span>
      </span>
    )

    // Actions chevron — sits inline AFTER the message text but BEFORE the
    // trailing timestamp / read-ticks (the metaCluster). Icon-only, no chrome;
    // revealed on this row's hover/focus. Always mounted (opacity-only) so
    // revealing it never reflows the line. Clicking opens the full actions menu;
    // right-click on the row opens the same menu. Null for rows that don't
    // expose actions (pending / failed / deleted) — they show no chevron.
    const actionsTrigger = canShowActions ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenu((m) => (m === 'chevron' ? null : 'chevron'))}
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`shrink-0 flex items-center justify-center text-faint transition hover:text-text leading-none pb-[2px] ${
          menuOpen
            ? 'opacity-100 text-text'
            : 'opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <ChevronDown size="0.9375rem" strokeWidth={1.8} />
      </button>
    ) : null

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
          className={`relative pl-1.5 pr-2 ${startNewGroup ? 'mt-4' : 'mt-0.5'}`}
        >
          {/* Row layout: avatar gutter · content column. The chevron does NOT
              live up here next to the avatar/name — it sits INSIDE the content
              column, in a gutter on the message block (below the author header),
              so it aligns with the message text row and never shifts the avatar,
              name, or body. MY OWN messages are a bare right-aligned text block:
              no avatar and no author header (right alignment alone marks
              ownership, WhatsApp-style), so the text stays the visual anchor and
              the row keeps the plain no-bubble structure. */}
          <div className={`flex items-start gap-2.5 ${mine ? 'justify-end' : ''}`}>
            {/* Avatar gutter (incoming only) — avatar at a group start; empty
                (indent) on following rows so the group stays visually anchored.
                My own rows have no gutter at all: the block hugs the right edge
                with only the row/column padding keeping it off the pane edge. */}
            {!mine && (
              <div className="w-8 shrink-0 pt-0.5">
                {startNewGroup && (
                  <Avatar userId={message.authorId} name={authorLabel} size={32} />
                )}
              </div>
            )}

            {/* Content column — left-aligned for others, right-aligned (items-end)
                for my own messages, capped for readability either way. Carries
                the hover/jump highlight + `group/msg` so the affordances
                (background, chevron, trailing time) reveal ONLY when the cursor
                is over the actual content, not the empty horizontal space that
                fills the rest of the row. It hugs its content (no `flex-1`) so
                the highlight never stretches past the text; `-mx-1.5 px-1.5`
                gives the pill breathing room without shifting the content. */}
            <div
              className={`group/msg min-w-0 flex flex-col ${
                mine ? 'items-end' : 'items-start'
              } max-w-[42.5rem] -mx-1.5 px-1.5 rounded-btn transition-colors duration-500 ${
                highlighted ? 'bg-active/10' : 'hover:bg-white/[0.02]'
              }`}
            >
              {/* Author header: just the name — incoming messages only. My own
                  rows carry no name (the right alignment is the ownership cue),
                  so the text block stays the anchor. Kept clean — NO chevron and
                  NO timestamp ever live on this row. It sits at the content-left
                  edge, sharing its x with the chevron gutter below it. */}
              {startNewGroup && !mine && (
                <div className="flex items-center gap-1.5 mb-0.5 leading-none">
                  <span className="text-[0.84375rem] font-semibold text-text">{authorLabel}</span>
                </div>
              )}

              {/* Message block — reply quote / pins / attachments / body, all
                  aligned under the author name on the row's own side (left for
                  others, right for mine; no indent). The actions chevron is NOT
                  a separate gutter: it's rendered inline at the END of the text
                  row, right after the body and just before the trailing
                  timestamp / read-ticks (see metaCluster usages below), so it
                  follows the text without interrupting reading. */}
              <div className={`min-w-0 w-full flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  {!deleted && message.replyTo && (
                    <ReplyQuote replyTo={message.replyTo} onJump={onJumpToMessage} />
                  )}
                  {pinned && (
                    <span className="flex items-center gap-1 text-[0.65625rem] text-active mb-0.5 leading-none">
                      <Pin size="0.625rem" strokeWidth={2} className="fill-current" /> Pinned
                    </span>
                  )}
                  {forwarded && (
                    <span className="block text-[0.65625rem] text-muted italic mb-0.5 leading-none">Forwarded</span>
                  )}

                  {!deleted && message.attachments && message.attachments.length > 0 && (
                    // Media + (for attachment-ONLY messages) the actions chevron
                    // on the media's OUTER-FLOW side, top-aligned — never below
                    // it: to the right of the media on incoming rows, mirrored to
                    // the left on my right-aligned rows (so it never collides
                    // with the chat edge). Captioned attachments omit the chevron
                    // here; it rides the caption's text row instead (see the body
                    // branch below), so there's never a duplicate.
                    <div className={`flex items-start gap-1.5 my-1 max-w-full ${mine ? 'flex-row-reverse' : ''}`}>
                      <div className="flex flex-col gap-1 min-w-0">
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
                        {/* Attachment-only: time/ticks sit in the bottom-RIGHT
                            corner under the media (right-aligned to the image's
                            edge), matching the bubble layout — not on a left row
                            below. Captioned attachments keep their meta inline
                            with the caption (body branch below). */}
                        {!message.body && (
                          <div className="flex justify-end -mt-0.5">{metaCluster}</div>
                        )}
                      </div>
                      {!message.body && <div className="pt-0.5">{actionsTrigger}</div>}
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
                      <span className="shrink-0 text-[0.625rem] text-faint tabular-nums leading-none select-none pb-[2px] opacity-0 transition-opacity group-hover/msg:opacity-100">
                        {time}
                      </span>
                    </div>
                  ) : message.body ? (
                    // Text (or image caption): chevron + trailing time/ticks flow
                    // INLINE at the very end of the text — NOT as a flex sibling —
                    // so on a wrapped message they trail the LAST line instead of
                    // floating off at the row's right edge. They're two separate
                    // inline boxes with DIFFERENT vertical anchors:
                    //   • the chevron uses align-text-top so it sits level with the
                    //     TOP of the text line;
                    //   • the time/ticks use align-bottom so they stay in the
                    //     bottom corner (on the text baseline) as before.
                    // A ~4px lead keeps each attached; both stay one-piece (nowrap).
                    <div className="max-w-full text-[length:var(--chat-plain-font-size)] leading-[1.55] text-[#F5F5F5] whitespace-pre-wrap break-words">
                      {renderBody(message.body, message.mentions, currentUserId)}
                      {actionsTrigger && (
                        // Collapsed to zero width when the row isn't hovered, so
                        // the trailing time/ticks tuck right up against the text.
                        // On hover it expands (animated) to make room for the
                        // chevron, nudging the meta over — space is only reserved
                        // for the arrow while it's actually shown.
                        <span className="inline-flex align-text-top overflow-hidden max-w-0 ml-0 group-hover/msg:max-w-[1.25rem] group-hover/msg:ml-1 transition-[max-width,margin] duration-200 ease-out">
                          {actionsTrigger}
                        </span>
                      )}
                      <span className="inline-flex items-end align-bottom ml-1 whitespace-nowrap">
                        {metaCluster}
                      </span>
                    </div>
                  ) : null}

                  {failed && mine && message.localId && (
                    <button
                      onClick={() => onRetry(message.localId!, message.body, message.pendingFile ?? null)}
                      className="block text-[0.65625rem] text-alert hover:text-text transition-colors mt-0.5"
                    >
                      Tap to retry
                    </button>
                  )}
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
        className={`flex ${startNewGroup ? 'mt-3' : 'mt-0.5'}`}
      >
        {/* Avatar gutter — incoming vehicle-group messages only (a DM's peer is
            identified by the header, and my own side stays clean). The avatar
            renders once per author run (day-divider aware); follow-up rows keep
            the empty gutter so the group stays visually anchored. */}
        {showAuthorChrome && (
          <div className="w-9 mr-2.5 shrink-0">
            {startNewGroup && (
              <Avatar userId={message.authorId} name={message.authorName} size={36} />
            )}
          </div>
        )}
        <div className={`flex-1 min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {showAuthorChrome && startNewGroup && (
            <div className="text-[0.6875rem] text-muted mb-1 px-1 leading-none">{message.authorName}</div>
          )}
          {/* Group wrapper for hover-reveal of the actions chevron. Width is
              capped here so the trigger hugs the bubble's edge. The chevron is
              a flex SIBLING on the bubble's outer-flow side (right of incoming,
              left of mine — mirrored by flex-row-reverse) so it never covers
              text or media and reveals without any layout shift (always
              mounted, opacity-only). Right-click anywhere on the bubble opens
              the same actions menu at the cursor. */}
          <div
            className={`group relative ${rowMaxW} flex items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}
            onContextMenu={(e) => {
              if (!canShowActions) return
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            <div className={`min-w-0 ${bubbleBase} ${bubbleSkin} ${highlightSkin}`}>
              {pinned && (
                <span className="flex items-center gap-1 text-[0.65625rem] text-active mb-1 leading-none">
                  <Pin size="0.625rem" strokeWidth={2} className="fill-current" />
                  Pinned
                </span>
              )}
              {forwarded && (
                <span className="text-[0.65625rem] text-muted italic mb-1 leading-none">
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
                    // The actions chevron lives OUTSIDE the bubble, so text
                    // needs no reserved corner. Captions on media bubbles get a
                    // small inset back from the tight media frame. Timestamp is
                    // NOT inline — it's the footer row below.
                    <span
                      className={`whitespace-pre-wrap break-words font-medium tracking-normal ${
                        hasAttachment ? 'px-1.5 pt-0.5' : ''
                      }`}
                    >
                      {renderBody(message.body, message.mentions, currentUserId)}
                    </span>
                  )}
                  {/* Subtle footer row: the time (and `edited`) on their own line,
                      tucked into the bubble's bottom-right corner — below the
                      text/caption (or the media in an attachment-only bubble). */}
                  <span
                    className={`self-end inline-flex items-center gap-1 whitespace-nowrap text-[0.65625rem] leading-none text-faint select-none mt-0.5 -mb-0.5 ${
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

            {/* Minimal hover-revealed actions trigger — a bare muted chevron
                riding the bubble's outer edge (see the wrapper comment). One
                affordance for text AND media bubbles: it never sits over the
                content, so no translucent patch is needed. */}
            {canShowActions && (
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setMenu((m) => (m === 'chevron' ? null : 'chevron'))}
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-faint transition duration-200 hover:text-text hover:bg-white/[0.04] ${
                  menuOpen
                    ? 'opacity-100 text-text'
                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
              >
                <ChevronDown size="0.9375rem" strokeWidth={1.8} />
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
              className="text-[0.65625rem] text-alert hover:text-text transition-colors mt-1 px-1"
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
