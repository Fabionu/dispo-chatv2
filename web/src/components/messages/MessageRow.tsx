import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { Copy, Forward, MoreHorizontal, Pin, Reply } from 'lucide-react'
import type { Attachment, GroupType } from '../../lib/types'
import AttachmentBlock from '../attachments/AttachmentBlock'
import MessageActionsPanel from './MessageActionsPanel'
import ReadReceipts, { type Reader } from './ReadReceipts'
import ReplyQuote from './ReplyQuote'
import { DELETE_WINDOW_MS, formatTime } from './messageUtils'
import DayDivider from './DayDivider'
import UnreadDivider from './UnreadDivider'
import { Attribution, ThreadAction, ThreadActions, ThreadStamp } from '../thread/threadChrome'
import Avatar from '../Avatar'
import { renderBody } from './messageBody'
import { buildMessageActions } from './messageActionItems'
import type { LocalMessage } from './types'
import type { MessageStyle } from '../../lib/messageStyle'

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
// Grouping controls the ATTRIBUTION ROW as well as the spacing, which is the
// opposite of what it did before author photos existed.
//
// The old rule was that every message keeps its own label, on the reasoning
// that in a layout with no avatars the label is the only thing identifying a
// message at all — suppress it and you have an unexplained second block of text
// under the first. That reasoning was sound while the head of a run was itself
// only a small label. It stops holding once the head carries a FACE: a
// burst then opens with a photo, a name and a clock, and the messages under it
// are visibly the same person still talking.
//
// So the head of a burst pays for the tile with its extra height, and every
// follow-up gets that height back and more by dropping the row entirely. A
// follow-up keeps the row only when it still has live state to report — see
// `hasLiveMeta` — and its clock moves to the hover strip either way.
const GROUP_WINDOW_MS = 7 * 60 * 1000

// The author photo at the head of a burst. Design-px; `Avatar` renders it as
// rem, so it tracks --ui-scale like every other sized component — which is why
// --msg-lane is rem too, so the lane and the thing in it grow together.
//
// It sits in the LANE, outside the message's rule, not inline in the label row.
// Inline it had to stay small enough not to dominate an 11px label, and at
// that size a face is a smudge; out here it answers only to the lane, so it can
// be the size a photo needs to be to actually be recognised. 30px against a
// 2.5rem lane leaves 0.625rem of air before the rule.
//
// Top-aligned with the attribution row rather than centred on the message: a
// burst head can be one line or twenty, and a tile that floats to the middle of
// a long one stops pointing at the name it belongs to.
const AUTHOR_TILE_PX = 30

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
  // True for the first message that was unread when the conversation opened.
  // Frozen for the life of the mount — see ChatView.
  unreadStart?: boolean
  groupType: GroupType
  // Which message style is on (lib/messageStyle.ts). Almost everything about
  // the two styles is CSS off a root attribute — this prop exists for the ONE
  // thing CSS cannot do, which is put an element in a different PARENT. In the
  // timeline the clock captions the message from above, beside the name; in the
  // bubble style it sits inside the block's bottom-right corner (user,
  // 2026-09-02), and no rule can move a node between two parents.
  //
  // Read ONCE in ChatView and passed down, never per row: a hundred rows each
  // subscribing to the root attribute is a hundred MutationObservers. Putting
  // it in propsEqual re-renders those hundred rows when the setting changes,
  // which is fine — that is a deliberate once-in-a-while action, not a hot
  // path. (The note in lib/messageStyle.ts used to say a prop was the wrong
  // answer outright; it was overstating the cost of the re-render, and the
  // observers were the real argument.)
  messageStyle: MessageStyle
  // Colour for this row's left rule, identifying WHICH of the room's members
  // sent it (see lib/authorColor.ts). Supplied only where it carries
  // information: someone else's message, in a room with more than two people.
  // Undefined everywhere else, which leaves the neutral `line` rule in place.
  ruleColor?: string
  // Whether this message's author has a profile photo, read from the roster.
  // Passed rather than discovered by letting the <img> 404, so a room full of
  // people who never uploaded one costs no failed requests. Undefined for an
  // author who has left the room and is no longer in the roster — then we ask,
  // which is the old behaviour and the right one for a person we know nothing
  // about.
  authorHasAvatar?: boolean
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
  unreadStart,
  groupType,
  messageStyle,
  ruleColor,
  authorHasAvatar,
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

  // The only branch this prop drives. Everything else that separates the two
  // styles is CSS off the root attribute — see the bubble block in index.css.
  const bubble = messageStyle === 'bubble'

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
  // BURST SPACING IS PADDING, NOT MARGIN. A follow-up carries its gap as `pt-2`
  // INSIDE its own box rather than as a margin above it, because the rule is
  // drawn by the row's border and a margin would break it: three unlabelled
  // bodies hanging off three separate rule stubs read as three orphans, which is
  // exactly the failure the old "every message keeps its label" rule was
  // guarding against. As padding, one border runs the whole height of the gap
  // and the burst reads as one continuous edge. (The message list's own flex gap
  // is 0 for the same reason — see ChatView.) A NEW group keeps its margin,
  // since a break between two speakers is what `mt-7` is for.
  //
  // 8px, and nothing in the gap is allowed to set that number (user,
  // 2026-08-26). It was 20px while the hover action strip was revealed into it,
  // because the strip is ~17px tall and had to fit — which meant the gap between
  // two lines of ONE person's burst was being sized by a control, not by how
  // closely those two lines belong together. The strip no longer reveals on
  // hover (see ThreadAction) and a follow-up's clock moved to the author lane,
  // so the gap answers only to the reading now.
  //
  // THE AUTHOR LANE. An incoming row is pushed right by `--msg-lane` so the
  // burst-head photo and the follow-up stamp have somewhere to hang OUTSIDE the
  // rule — a message keeps its own left edge at the rule, exactly as before, and
  // the lane is empty space beside it. The max-width has to give the lane back,
  // or a full-width child (a wide attachment) would run past the column. My own
  // rows are `ml-auto` against the right edge and have no lane: no tile, and
  // their follow-up clocks stay in the attribution row with their ticks.
  //
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

  // WHO gets a photo. Gated exactly like `ruleColor`, and for the same reason:
  // a face answers "which of the people in this room is talking", and a direct
  // message does not ask that — it has one other person in it and the side of
  // the column has already said which side of the conversation this is. My own
  // rows never carry one either; a portrait of myself on my own words is the
  // one face in a thread that tells nobody anything.
  const showTile = !mine && groupType !== 'direct'

  // What the attribution row still has to say once the name is suppressed.
  //
  // The flags are rare, so the overwhelming majority of follow-ups drop the row
  // outright. My own rows are the standing exception: the delivery ticks are
  // LIVE state and the note on `attributionTrailing` is explicit that those are
  // never hover-revealed, so a burst of my own messages keeps a clock-and-ticks
  // row per message — it just stops repeating my name at me.
  const hasLiveMeta = pinned || forwarded || edited || failed || (mine && !deleted)

  // The photo, drawn square and IN ITS OWN COLOURS.
  //
  // SQUARE because every radius token in this app is 0 and a disc here would be
  // the only rounded object on the screen.
  //
  // FULL COLOUR, always (user, 2026-08-26). It was briefly greyscale-until-hover
  // on the reasoning that a photo is the one filled colour object in a field
  // that has none — but that reasoning protects the field at the expense of the
  // thing the field is now being asked to carry. A desaturated face is a worse
  // face: skin, hi-vis, a company polo and a cab window are most of what makes
  // one photo tell itself apart from another at 30px, and greyscale throws
  // exactly that away. It also made the tile change appearance under the cursor,
  // which reads as a control rather than as a person. Don't reintroduce the
  // filter — the restraint here is the tile's SIZE and its square, unringed
  // edge, not its saturation.
  const authorTile =
    startNewGroup && showTile ? (
      <button
        type="button"
        onClick={() => onOpenProfile(message.authorId, authorLabel)}
        aria-label={`Open ${authorLabel}'s profile`}
        className="msg-author-tile absolute left-[calc(-1*var(--msg-lane))] top-0.5 focus-visible:outline-none focus-visible:opacity-80"
      >
        <Avatar
          userId={message.authorId}
          name={authorLabel}
          hasAvatar={authorHasAvatar}
          size={AUTHOR_TILE_PX}
          shape="square"
          fallback="initials"
          tint={ruleColor}
        />
      </button>
    ) : undefined

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
  // same label voice as the name and time beside it. These used to be scattered:
  // a pin tag above the body, `Forwarded` italics under it, `edited` floating in
  // the bubble's corner. They all describe the message rather than say anything,
  // so they belong on the label row, and putting them there is what lets the
  // body below be nothing but the body.
  //
  // Read ticks are the exception that stays a glyph: they carry live delivery
  // state, so they're always visible rather than hover-revealed.
  // Split in two, because the bubble style puts the TIME between them: flags
  // lead the cluster, the clock sits in the middle, the delivery ticks close it
  // — `Edited · 14:32 ✓✓`. The timeline renders the pair straight through and
  // keeps its clock earlier in the row, beside the name.
  const messageFlags = (
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
    </>
  )

  const deliveryTicks =
    mine && !failed && !deleted ? (
      <ReadReceipts
        others={readers ?? []}
        createdAt={message.createdAt}
        pending={pending}
        onOpen={() => onOpenReadReceipts(message)}
      />
    ) : null

  const attributionTrailing = (
    <>
      {messageFlags}
      {deliveryTicks}
    </>
  )

  return (
    <>
      {showDayDivider && (
        <DayDivider iso={message.createdAt} conversationStart={conversationStart} />
      )}
      {/* After the day break, never before it: the date belongs to the whole
          day below it, while this belongs to the single message under it. */}
      {unreadStart && <UnreadDivider />}
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
        // The hooks the BUBBLE message style reads (lib/messageStyle.ts). They
        // are data attributes rather than more classes in the template below
        // because they are this row's STATE — whose it is, whether it opens a
        // burst, whether it is being pointed at — and the two styles spend those
        // facts differently: the timeline on utilities, the bubble on a block.
        //
        // `|| undefined` so React omits the attribute entirely when false: the
        // CSS selects on presence ([data-own]), and data-own="false" is present.
        data-own={mine || undefined}
        data-head={startNewGroup || undefined}
        data-highlighted={highlighted || undefined}
        // Inline, because the value is per-author data rather than one of a
        // fixed set of states — a utility class per member is not a thing
        // Tailwind can generate. `borderLeftColor` overrides only the left edge
        // of the `--color-line-msg` set by the class, so every other rule on the
        // row is untouched.
        //
        // The same hue also goes out as a VARIABLE, because the two styles spend
        // IT differently too: the timeline paints its rule with it, and the
        // bubble style — which has no rule — paints the author's NAME with it
        // (see index.css). One value, set once, read by whichever style is on,
        // and undefined in a DM or a two-person room where a colour would have
        // nobody to tell apart from nobody.
        style={
          ruleColor && !mine
            ? ({ borderLeftColor: ruleColor, '--author-color': ruleColor } as CSSProperties)
            : undefined
        }
        className={`msg-row group/msg relative w-fit pb-0.5 transition-colors duration-500 ${
          mine
            ? 'ml-auto flex max-w-full flex-col items-end border-r-2 border-[rgb(var(--color-line-own))] pr-[var(--msg-indent)] pl-2'
            : `mr-auto border-l-2 border-[rgb(var(--color-line-msg))] pl-[var(--msg-indent)] pr-2 ${
                showTile
                  ? 'ml-[var(--msg-lane)] max-w-[calc(100%-var(--msg-lane))]'
                  : 'max-w-full'
              }`
        } ${startNewGroup ? 'mt-7 pt-0.5' : 'pt-2'} ${highlightSkin} ${
          justArrived ? 'message-enter' : ''
        }`}
      >
        {/* Both hang in the author lane, outside the rule — never in the gap
            below the message, which is what has to stay tight for a burst to
            read as one person. The tile heads the burst; the stamp is the
            suppressed clock of a follow-up under it, and only for a row that
            drew no attribution at all (a pinned/edited/own one still has its
            clock up there). */}
        {authorTile}
        {/* The lane clock gives a follow-up its time back after the attribution
            row was suppressed. The bubble style has no use for it: every block
            carries its own clock in its corner, so a second one behind a hover
            would be the same fact twice. */}
        {!bubble && !startNewGroup && !hasLiveMeta && showTile && (
          <ThreadStamp>{time}</ThreadStamp>
        )}

        {(bubble ? startNewGroup : startNewGroup || hasLiveMeta) && (
          <Attribution
            // Suppressed on a follow-up. In the TIMELINE the row can still be
            // here without a name — a pinned or edited message inside a burst
            // keeps its flags, and my own keep their ticks — and it then shows
            // the state and the clock rather than the name again. In the bubble
            // style every one of those has moved into the block below, so this
            // row is the NAME or it is nothing.
            name={startNewGroup ? authorLabel : undefined}
            time={bubble ? undefined : time}
            trailing={bubble ? undefined : attributionTrailing}
            alignEnd={mine}
            onNameClick={mine ? undefined : () => onOpenProfile(message.authorId, authorLabel)}
          />
        )}

        {/* The message itself — everything that was SAID, and nothing that
            describes it. In the timeline this wrapper is not in the box tree
            at all (`display: contents`); in the bubble style it IS the bubble,
            which is why the attribution row above stays outside it. */}
        <div className="msg-content">
          {!deleted && message.replyTo && (
            <ReplyQuote replyTo={message.replyTo} onJump={onJumpToMessage} neutral={mine} />
          )}

          {!deleted && message.attachments && message.attachments.length > 0 && (
            <div className="msg-attachments my-2 flex max-w-body flex-col gap-1.5">
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

          {/* The body, and nothing else. Capped at --msg-body (62ch) — the cap
              is on the TEXT, not on the row, so an attachment or a data block
              inside the same message can still use the column's full width. */}
          {deleted ? (
            <p className="msg-body max-w-body text-[length:var(--chat-plain-font-size)] italic leading-[1.6] text-faint">
              {mine ? 'You deleted this message' : 'This message was deleted'}
            </p>
          ) : message.body ? (
            <div
              className={`msg-body max-w-body text-[length:var(--chat-plain-font-size)] leading-[1.6] whitespace-pre-wrap break-words ${BODY_TYPE}`}
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

          {/* The block signs itself off (user, 2026-09-02): state, clock and
              delivery ticks in the bottom-right corner, inside the block, under
              the message. It is what lets a burst follow-up carry its own time
              at no cost — the timeline had to hide that clock out in the lane
              behind a hover, because in a column of bare text a repeated
              timestamp per line is noise. In the corner of a block it is
              somewhere the eye skips until it wants it. */}
          {bubble && (
            <div className="msg-meta">
              {messageFlags}
              <span className="timestamp">{time}</span>
              {deliveryTicks}
            </div>
          )}
        </div>

        {/* Small text buttons, invisible until the message is hovered
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

        {/* Positions itself against this row (which is why the row is
            `relative`): out of flow, on the message's own side, and under the
            message unless the composer leaves it no room there. */}
        {menuRendered && (
          <MessageActionsPanel
            actions={actions}
            open={menuOpen}
            side={mine ? 'right' : 'left'}
            onClose={() => setMenuOpen(false)}
          />
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
    a.unreadStart === b.unreadStart &&
    a.mine === b.mine &&
    a.currentUserId === b.currentUserId &&
    a.readers === b.readers &&
    a.groupType === b.groupType &&
    a.messageStyle === b.messageStyle &&
    // A plain string, so this is a real comparison — it only changes when the
    // roster does, which is exactly when a row's rule should be repainted.
    a.ruleColor === b.ruleColor &&
    a.authorHasAvatar === b.authorHasAvatar &&
    a.highlighted === b.highlighted &&
    a.imagePriority === b.imagePriority &&
    // Active-trip reference — rows re-tokenize their `#ref` trip mentions when
    // the trip changes/clears. onOpenTrip is a callback → intentionally skipped.
    a.tripRef === b.tripRef
  )
}

export default memo(MessageRow, propsEqual)
