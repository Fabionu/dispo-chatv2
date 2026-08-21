import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Copy, Forward, MoreHorizontal, Pin, Reply } from 'lucide-react'
import type { Attachment, GroupType } from '../../lib/types'
import AttachmentBlock from '../attachments/AttachmentBlock'
import MessageActionsPanel from './MessageActionsPanel'
import ReadReceipts, { type Reader } from './ReadReceipts'
import ReplyQuote from './ReplyQuote'
import { DELETE_WINDOW_MS, formatTime } from './messageUtils'
import DayDivider from './DayDivider'
import { Attribution, ThreadAction, ThreadActions } from '../thread/threadChrome'
import { renderBody } from './messageBody'
import { buildMessageActions } from './messageActionItems'
import type { LocalMessage } from './types'

// Message body type — the same for EVERY message, whoever sent it.
//
// Incoming bodies used to step back to `muted`. That came from the design
// reference, where the grey speaker is an assistant and the bright one is you;
// in a vehicle room with six dispatchers in it, it only made everyone else's
// words look secondary to your own. Ownership is carried by SIDE (left rule vs
// right) and by the rule's weight — it does not need to dim anybody.
//
// The weight is a TOKEN, not a `font-light` here, because it has to differ per
// theme: near-white text on black blooms and wants 300, dark text on white is
// eaten into and wants 400. Hardcoding the dark theme's answer is what made the
// light theme's thread read as washed out. See --msg-body-weight in index.css
// for the optics. Bold emphasis still lands — renderRichText's <strong> is 700.
const BODY_TYPE = 'font-[number:var(--msg-body-weight)] text-text'

// How recent a message must be, AT THE MOMENT ITS ROW FIRST MOUNTS, to read as
// "just arrived" and play the entrance animation.
//
// This is the whole trick, and it is deliberately a timestamp check rather than
// a list diff: opening a conversation mounts a page of rows at once, and
// animating those would make every thread open with a wave of fading text. A
// row animates only if the message it carries is seconds old — true for
// something I just sent (the optimistic row is stamped client-side at send
// time) and for something that just arrived over the socket, false for history.
//
// The row's key is `localId ?? id` (see ChatView), stable across the
// optimistic→real reconcile, so a confirmed send does NOT remount and therefore
// cannot play the animation a second time.
const FRESH_WINDOW_MS = 4000

// ── Batch stagger ───────────────────────────────────────────────────────────
// Rows that mount in the SAME commit form a burst and animate 60ms apart — a
// socket backlog after a reconnect, or several messages from one author landing
// together. React mounts them in list order, so a shared counter is all the
// ordering we need; each row only ever knows about itself.
//
// The window is deliberately tiny. 50ms means "the same paint", not "recently":
// two messages arriving a second apart are two arrivals, not a burst, and the
// second must not sit behind a delay the reader has no way to explain.
const BURST_WINDOW_MS = 50
// Past ~300ms a burst stops reading as one arrival and starts looking like the
// app is loading slowly, so later rows in a long batch share the last step.
const MAX_STAGGER_STEPS = 5

let burstAt = 0
let burstIndex = 0

function claimStaggerStep(): number {
  const now = Date.now()
  if (now - burstAt > BURST_WINDOW_MS) burstIndex = 0
  burstAt = now
  return Math.min(burstIndex++, MAX_STAGGER_STEPS)
}

// Consecutive messages from the same author within this window read as one
// burst. A new group also starts on an author change, a system row, or a date
// divider. ~7 min reads as "same burst".
//
// Grouping now controls SPACING ONLY. Every message keeps its own attribution
// row, because in this layout the label is what identifies a message at all —
// suppress it on a follow-up and that message has no author, no time and no
// visible owner, just an unexplained second block of text under the first.
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
  // Colour for this row's left rule, identifying WHICH of the room's members
  // sent it (see lib/authorColor.ts). Supplied only where it carries
  // information: someone else's message, in a room with more than two people.
  // Undefined everywhere else, which leaves the neutral `line` rule in place.
  ruleColor?: string
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
  // Opens this message's delivery/read roster in the chat's right-side panel.
  onOpenReadReceipts: (message: LocalMessage) => void
  // Open the read-only user-details panel for a message author (avatar click).
  onOpenProfile: (userId: string, name: string) => void
  // The room's active trip reference — `#<reference>` tokens in the body render
  // as clickable trip mentions that open the Trip tab. Undefined in DMs / rooms
  // without a trip, where the token stays plain text.
  tripRef?: string
  onOpenTrip?: () => void
}

function MessageRow({
  message,
  mine,
  currentUserId,
  readers,
  prev,
  conversationStart,
  groupType,
  ruleColor,
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
  onOpenReadReceipts,
  onOpenProfile,
  tripRef,
  onOpenTrip,
}: Props) {
  // Context for renderBody's `#reference` trip tokens — only when the room
  // actually has an active trip and a way to open it.
  const tripCtx = tripRef && onOpenTrip ? { reference: tripRef, onOpen: onOpenTrip } : undefined
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
  const startNewGroup = !sameAuthorAsPrev || showDayDivider

  const failed = message.failed === true
  const pending = message.pending === true
  const deleted = Boolean(message.deletedAt)
  const edited = Boolean(message.editedAt) && !deleted
  const forwarded = message.forwarded === true && !deleted
  const pinned = Boolean(message.pinnedAt) && !deleted
  // Copy lifts the text body; disabled for attachment-only messages.
  const canCopy = !deleted && Boolean(message.body)
  // Optimistic + failed sends aren't real messages yet, so they shouldn't
  // expose the menu. Deleted placeholders shouldn't either.
  const canShowActions = !deleted && !pending && !failed
  // Desktop shortcut: double-clicking the message row starts a reply. Keep
  // controls inside the row (author/profile, attachment preview, reply quote,
  // receipts, actions) independent so their own click behaviour still wins.
  function handleDoubleClick(event: MouseEvent<HTMLElement>) {
    if (!canShowActions) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        'button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
      )
    ) {
      return
    }
    event.preventDefault()
    setMenuOpen(false)
    onReply(message)
  }
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
  // Computed once per mount (useState initialiser, not a render-time
  // expression) so a re-render — a read receipt landing, an edit, the actions
  // opening — can never restart the entrance.
  const [justArrived] = useState(
    () => Date.now() - new Date(message.createdAt).getTime() < FRESH_WINDOW_MS,
  )

  // Stagger is claimed in a LAYOUT EFFECT, never during render: the burst
  // counter is shared mutable state, and touching it from a useState
  // initialiser would make render impure (and double-count under StrictMode,
  // which invokes initialisers twice). A layout effect runs once the node
  // exists but before paint, so the delay class still catches the animation's
  // first frame. The ref guard survives StrictMode's simulated remount.
  //
  // MY OWN send never staggers, even if it lands in the same commit as incoming
  // traffic: it is the direct result of a keypress, and 60ms of hesitation
  // there reads as lag rather than polish.
  const staggerClaimed = useRef(false)
  useLayoutEffect(() => {
    if (staggerClaimed.current || !justArrived || mine) return
    staggerClaimed.current = true
    const step = claimStaggerStep()
    if (step > 0) rowRef.current?.classList.add(`message-enter-${step}`)
  }, [justArrived, mine])

  // The actions open two ways — the MORE button or a right-click on the row —
  // and land in the same place either way: inline under this message. No anchor
  // maths, so one boolean covers both.
  const [menuOpen, setMenuOpen] = useState(false)
  // Keep the strip mounted briefly after close so its fade/lift can finish.
  // Opening still mounts on demand, so closed rows do not retain action DOM.
  const [menuRendered, setMenuRendered] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  // Clicking outside THIS row closes its panel — which also means opening
  // another message's actions collapses this one, without lifting state up
  // through the memo boundary.
  useEffect(() => {
    if (!menuOpen) return
    // globalThis — React's MouseEvent type is imported above and shadows the
    // DOM one this listener actually receives.
    function onDown(e: globalThis.MouseEvent) {
      if (rowRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen) {
      setMenuRendered(true)
      return
    }
    if (!menuRendered) return
    const timer = window.setTimeout(() => setMenuRendered(false), 130)
    return () => window.clearTimeout(timer)
  }, [menuOpen, menuRendered])

  // ── Row chrome ──────────────────────────────────────────────────────────
  // A message is a LABEL, a RULE and an INDENT — never a bubble. Ownership is
  // carried by SIDE: incoming messages hang off a rule on the left of the
  // column, mine off a mirrored rule on the right. COLOUR reinforces it: mine
  // is --color-line-own, the only rule in the app at full contrast — pure white on
  // dark, pure black on light — against the quiet `line` hairline everyone
  // else's hangs from. Body tone does NOT — both sides read at full brightness;
  // see BODY_TYPE above.
  //
  // In a room with a crowd in it that left rule also carries WHOSE message this
  // is, as a hue (see ruleColor). Side answers "is this mine"; the hue answers
  // "is this the same person as the message above" — the question you actually
  // have when six people share a truck. My own rule stays neutral: it is
  // already the only one on the right, and a colour there would put hue on both
  // edges of the column to say something the position has said already.
  //
  // The block is `w-fit`, so the rule hugs the longest line instead of running
  // to the column edge — which is the whole point of putting it on the right
  // for my own messages. Body text inside stays LEFT-aligned either way: a
  // right-aligned paragraph is hard to read, and the block's position already
  // says whose it is.
  //
  // MY OWN block is also a flex column that packs its children to the END. The
  // rule is on the right there, but every child was a plain block filling the
  // block's width, and that width is set by whichever child is widest — usually
  // the attribution row, since `FABIO TOFAN 14:31 ✓✓` is longer than most
  // things anyone types. A short body then sat at the LEFT of that width,
  // measured at 136px from its own rule while every incoming message's text
  // held 21px from theirs. `items-end` makes each child shrink to its content
  // and sit against the rule, so my text hangs off my edge exactly the way
  // theirs hangs off theirs.
  //
  // This is alignment of the BLOCKS, not of the text in them: a paragraph that
  // wraps still sets ragged-right inside its own box, so nothing about reading
  // it changes. Absolutely positioned children (the hover actions, the actions
  // panel) are not flex items and keep their own anchoring.
  // Jump-to-original pulse. A wash, not a ring: there is no shape here to ring.
  // It runs to the row's edges so the highlighted band starts AT the rule.
  // RULE WEIGHT. Structural hairlines in this app are 1px and stay 1px. This
  // rule is not structure though — in a room with a crowd in it it is carrying
  // WHO, in a colour (see ruleColor), and 1px is not enough of it to carry a
  // colour reliably. A 1px border lands on a fractional number of device pixels
  // on most displays (1.5 of them at the 1.5 pixel ratio this was measured on),
  // so a third of the ink ends up in a half-covered pixel that blends with
  // whatever is behind it: toward black that reads as a dimmer version of the
  // hue, toward white it reads as pastel, which is why the light theme lost the
  // colours first.
  //
  // 2px, NOT 1.5px, and the extra half pixel is the whole reason. Widths land
  // on whole device pixels at 2px for every common ratio (1 → 2, 1.5 → 3, 2 →
  // 4), whereas 1.5px is fractional at BOTH 1 and 1.5 — it would add a blurred
  // edge on a plain display that does not have one today. 2px is also a weight
  // this design already speaks: the selected conversation in the rail and the
  // filter tab bar are both 2px of --color-text. Emphasis, not a new idea.
  //
  // EVERY message, including a direct one. This used to be `groupType !==
  // 'direct'`, on the reasoning that a DM's rule carries no colour and could
  // therefore keep the hairline and the quiet. What that missed is the sentence
  // three paragraphs up: at 1px a third of the ink lands in a half-covered
  // device pixel and blends with the field behind it. That argument was made
  // about losing a HUE, but it costs a plain grey rule just as much — and in a
  // DM the rule it is answering is --color-line-own at full contrast, so the
  // pair read as "one person has an edge and the other doesn't". It showed up
  // worst on the light theme, where the surviving ink is grey on white.
  // 2px on both sides restores the symmetry the side-as-ownership idea rests
  // on: same weight, different edge, different colour.
  const highlightSkin = highlighted ? 'bg-active/10' : ''
  const authorLabel = (mine ? message.authorName || 'You' : message.authorName) || 'Member'
  const time = formatTime(message.createdAt)

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

  // The attribution row's trailing slot — the message's own state, spoken in the
  // same mono voice as the name and time beside it. These used to be scattered:
  // a pin tag above the body, `Forwarded` italics under it, `edited` floating in
  // the bubble's corner. They all describe the message rather than say anything,
  // so they belong on the label row, and putting them there is what lets the
  // body below be nothing but the body.
  //
  // Read ticks are the exception that stays a glyph: they carry live delivery
  // state, so they're always visible rather than hover-revealed.
  const attributionTrailing = (
    <>
      {pinned && (
        <span className="eyebrow inline-flex items-center gap-1 text-active">
          <Pin size="0.625rem" strokeWidth={2} className="fill-current" />
          Pinned
        </span>
      )}
      {forwarded && <span className="eyebrow">Forwarded</span>}
      {edited && <span className="eyebrow">Edited</span>}
      {failed && <span className="eyebrow text-alert">Failed</span>}
      {mine && !failed && !deleted && (
        <ReadReceipts
          others={readers ?? []}
          createdAt={message.createdAt}
          pending={pending}
          onOpen={() => onOpenReadReceipts(message)}
        />
      )}
    </>
  )

  return (
    <>
      {showDayDivider && (
        <DayDivider iso={message.createdAt} conversationStart={conversationStart} />
      )}
      <article
        ref={rowRef}
        data-message-id={message.id}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          if (!canShowActions) return
          e.preventDefault()
          // Toggle, so a second right-click on the same message closes the
          // strip. Right-clicking ANOTHER message closes this one first (the
          // outside-mousedown handler above fires before that row's
          // contextmenu), then opens there — one strip open at a time.
          setMenuOpen((open) => !open)
        }}
        // Inline, because the value is per-author data rather than one of a
        // fixed set of states — a utility class per member is not a thing
        // Tailwind can generate. It overrides only the left edge of the
        // `--color-line-msg` set by the class, so every other rule on the row
        // is untouched.
        style={ruleColor && !mine ? { borderLeftColor: ruleColor } : undefined}
        className={`group/msg relative w-fit max-w-full py-0.5 transition-colors duration-500 ${
          mine
            ? 'ml-auto flex flex-col items-end border-r-2 border-[rgb(var(--color-line-own))] pr-[var(--msg-indent)] pl-2'
            : 'mr-auto border-l-2 border-[rgb(var(--color-line-msg))] pl-[var(--msg-indent)] pr-2'
        } ${startNewGroup ? 'mt-7' : 'mt-4'} ${highlightSkin} ${
          justArrived ? 'message-enter' : ''
        }`}
      >
        <Attribution
          name={authorLabel}
          time={time}
          trailing={attributionTrailing}
          alignEnd={mine}
          onNameClick={mine ? undefined : () => onOpenProfile(message.authorId, authorLabel)}
        />

        {!deleted && message.replyTo && (
          <ReplyQuote replyTo={message.replyTo} onJump={onJumpToMessage} neutral={mine} />
        )}

        {!deleted && message.attachments && message.attachments.length > 0 && (
          <div className="my-2 flex max-w-body flex-col gap-1.5">
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

        {/* The body, and nothing else. Capped at --msg-body (62ch) — the cap is
            on the TEXT, not on the row, so an attachment or a data block inside
            the same message can still use the column's full width. */}
        {deleted ? (
          <p className="max-w-body text-[length:var(--chat-plain-font-size)] italic leading-[1.6] text-faint">
            {mine ? 'You deleted this message' : 'This message was deleted'}
          </p>
        ) : message.body ? (
          <div
            className={`max-w-body text-[length:var(--chat-plain-font-size)] leading-[1.6] whitespace-pre-wrap break-words ${BODY_TYPE}`}
          >
            {renderBody(message.body, message.mentions, currentUserId, tripCtx)}
          </div>
        ) : null}

        {failed && mine && message.localId && (
          <button
            onClick={() => onRetry(message.localId!, message.body, message.pendingFile ?? null)}
            className="eyebrow mt-2 block text-alert transition-colors hover:text-text"
          >
            Tap to retry
          </button>
        )}

        {/* Mono uppercase text buttons, invisible until the message is hovered
            or one of them is focused. The three verbs that carry most of the
            traffic are inline; MORE opens the full menu below, so nothing that
            was reachable before stops being reachable. */}
        {canShowActions && (
          <ThreadActions side={mine ? 'right' : 'left'}>
            <ThreadAction icon={Reply} onClick={() => onReply(message)}>
              Reply
            </ThreadAction>
            {canCopy && (
              <ThreadAction icon={Copy} onClick={() => onCopy(message)}>
                Copy
              </ThreadAction>
            )}
            <ThreadAction icon={Forward} onClick={() => onForward(message)}>
              Forward
            </ThreadAction>
            <ThreadAction
              icon={MoreHorizontal}
              title="All message actions"
              onClick={() => setMenuOpen((open) => !open)}
            >
              More
            </ThreadAction>
          </ThreadActions>
        )}

        {/* Absolute for the same reason the action strip is: in flow it would
            stretch the block (and its rule) to the panel's width the moment the
            menu opened. A menu overlaying the message under it is normal; a
            message silently changing shape is not. */}
        {menuRendered && (
          <div
            className={`absolute top-full z-20 ${
              mine ? 'right-[var(--msg-indent)]' : 'left-[var(--msg-indent)]'
            }`}
          >
            <MessageActionsPanel
              actions={actions}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        )}
      </article>
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
    // A plain string, so this is a real comparison — it only changes when the
    // roster does, which is exactly when a row's rule should be repainted.
    a.ruleColor === b.ruleColor &&
    a.highlighted === b.highlighted &&
    a.imagePriority === b.imagePriority &&
    // Active-trip reference — rows re-tokenize their `#ref` trip mentions when
    // the trip changes/clears. onOpenTrip is a callback → intentionally skipped.
    a.tripRef === b.tripRef
  )
}

export default memo(MessageRow, propsEqual)
