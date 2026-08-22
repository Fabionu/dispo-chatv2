import { useEffect, type MouseEvent, type ReactNode } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import Avatar from '../Avatar'
import PreviewActionBar from './PreviewActionBar'
import { formatBytes, typeLabel } from './attachmentUtils'
import { formatDay, formatTime } from '../messages/messageUtils'
import { renderBody } from '../messages/messageBody'

// ── The attachment preview shell ────────────────────────────────────────────
// Every preview surface — the image lightbox, the PDF shell, the document card,
// and each of them again inside a chat-window tab — is now the SAME three-part
// frame, and only the middle part differs:
//
//   WHO SENT IT   avatar · name · when, then the actions (reply, forward, open
//                 in tab, download, close).
//   THE STAGE     the picture, the rasterised page, or the type glyph.
//   WHAT THEY SAID  the message the file was sent with, when there was one.
//
// That ordering is the WhatsApp reading order, and it exists because a file in
// a dispatch room is rarely self-explanatory: a CMR scan means one thing from
// the driver at the ramp and another from the office, and "this is the corrected
// one, ignore the first" is IN the message, not in the filename. Before this the
// preview showed the filename and nothing else — the two things that gave the
// file its meaning were left behind in the thread the moment you opened it.
//
// Two shapes, one layout:
//   overlay=true   a fullscreen dialog over the app (image / document opened
//                  from a bubble).
//   overlay=false  a surface that fills the chat pane (the inline PDF shell and
//                  every preview shown inside a workspace tab).
//
// The overlay is drawn on the FIELD (`bg-bg`), not on a black scrim. The scrim
// was a light-theme bug as much as a design one: `text-text` is near-black in
// light mode, so the old banner printed a dark filename onto an 85%-black
// backdrop. One field colour and hairline seams is also simply what the rest of
// the app does — see the note at the top of tailwind.config.js.
type Props = {
  attachment: Attachment
  message: LocalMessage
  /** Whose view this is: decides "You" vs the sender's name, and highlights an
   *  @-mention of the reader inside the caption exactly as the bubble does. */
  currentUserId: string
  onReply: (m: LocalMessage) => void
  onForward: (m: LocalMessage) => void
  onClose: () => void
  /** Pins this attachment as a chat-window tab. Omitted when the surface IS a
   *  tab (nothing to re-open). */
  onOpenInTab?: () => void
  /** Fullscreen dialog over the app, vs. a surface filling the chat pane. */
  overlay?: boolean
  /** Esc closes. Off inside a workspace tab, where the tab's own × owns
   *  dismissal and a global Esc would clash with the chat's handlers. */
  closeOnEsc?: boolean
  /** The stage. Callers own its sizing — every one of them is `flex-1 min-h-0`
   *  so the header and caption keep their height and the stage takes the rest. */
  children: ReactNode
}

export default function AttachmentPreviewShell({
  attachment,
  message,
  currentUserId,
  onReply,
  onForward,
  onClose,
  onOpenInTab,
  overlay = false,
  closeOnEsc = false,
  children,
}: Props) {
  useEffect(() => {
    if (!closeOnEsc) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeOnEsc, onClose])

  const mine = message.authorId === currentUserId
  const senderName = mine ? 'You' : message.authorName || 'Member'
  // A deleted message keeps no body — don't print the tombstone as a caption.
  const caption = message.deletedAt ? '' : message.body.trim()
  // Clicks on the chrome must never reach the backdrop handler below.
  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <div
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label={`${attachment.originalName} from ${senderName}`}
      className={
        overlay
          ? 'fixed inset-0 z-50 flex flex-col bg-bg'
          : 'flex-1 min-h-0 flex flex-col bg-bg'
      }
      // Clicking the field around the stage dismisses the overlay, the way a
      // lightbox is expected to. The stage content stops propagation itself.
      onClick={overlay ? onClose : undefined}
    >
      {/* ── Who sent it ─────────────────────────────────────────────────────
          Header height is the app's toolbar height, so opening a preview keeps
          the seam it replaced on the same line instead of shifting the window.
          Identity first, actions last; the identity column truncates so a long
          filename can never push the actions off a narrow pane. */}
      <header
        onClick={stop}
        className="shrink-0 flex h-[var(--header-height)] items-center gap-2.5 border-b border-line px-3"
      >
        {/* The avatar identifies the AUTHOR, so its initials fallback is fed
            the author's real name even when the label beside it reads "You" —
            otherwise my own uploads sit under a disc marked "Y". */}
        <Avatar
          userId={message.authorId}
          name={message.authorName || senderName}
          size={30}
          fallback="initials"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="truncate text-base font-medium text-text">{senderName}</span>
            <span className="eyebrow eyebrow-time shrink-0">
              {formatDay(message.createdAt)} {formatTime(message.createdAt)}
            </span>
          </div>
          {/* The file's own identity, one step quieter than the person's: the
              name it was uploaded under, then type · size — the same wording
              AttachmentIdentity uses on the send preview and the document card,
              so a file is never described two different ways. */}
          {/* `gap-1` carries the space around the first separator: these are
              flex items, and a leading space inside one is collapsed away. */}
          <div className="mt-0.5 flex min-w-0 items-baseline gap-1 text-xs text-faint">
            <span className="truncate">{attachment.originalName}</span>
            <span className="shrink-0 tabular-nums">
              · {typeLabel(attachment.originalName, attachment.mimeType)} ·{' '}
              {formatBytes(attachment.byteSize)}
            </span>
          </div>
        </div>
        <PreviewActionBar
          attachment={attachment}
          message={message}
          onReply={onReply}
          onForward={onForward}
          onClose={onClose}
          onOpenInTab={onOpenInTab}
        />
      </header>

      {children}

      {/* ── What they said ──────────────────────────────────────────────────
          The message the file travelled with, rendered by the SAME renderer the
          bubble uses — mentions stay highlighted (including one addressed to the
          reader) and *bold* / _italic_ still apply, so the caption reads here
          exactly as it does in the thread. Held to the thread measure and
          centred under the stage; a long one scrolls inside its own band rather
          than eating the picture. */}
      {caption && (
        <div onClick={stop} className="shrink-0 border-t border-line px-4 py-3">
          <p className="mx-auto max-h-[7.5rem] max-w-thread overflow-y-auto whitespace-pre-wrap break-words text-[length:var(--chat-msg-font-size)] font-[number:var(--msg-body-weight)] leading-[1.6] text-text">
            {renderBody(caption, message.mentions, currentUserId)}
          </p>
        </div>
      )}
    </div>
  )
}
