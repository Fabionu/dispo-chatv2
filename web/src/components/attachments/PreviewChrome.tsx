import { useLayoutEffect, useRef, useState } from 'react'
import type { Attachment } from '../../lib/types'
import type { LocalMessage } from '../messages/types'
import { formatDay, formatTime } from '../messages/messageUtils'
import { renderBody } from '../messages/messageBody'
import { formatBytes, typeLabel } from './attachmentUtils'

// ── Preview chrome ──────────────────────────────────────────────────────────
// The two things every attachment preview was missing: WHO sent it, and WHAT
// they said with it.
//
// Opening a picture used to drop you into a file viewer. The header named the
// file — `IMG_20260824_141233.jpg` — which is the one fact about a photo nobody
// needs, and the message it arrived with disappeared entirely. A photo of a
// damaged pallet is not a file; it is somebody telling you something, and the
// sentence under it ("third pallet, the one for Rotterdam") is usually the part
// that matters. The thread had it. The preview threw it away, so reading it
// meant closing the preview.
//
// So a preview now carries the message's own attribution. The file's identity
// steps down to where it belongs: a mono meta line under the name.
//
// It does NOT reuse the timeline's `Attribution` component, though it did at
// first. That component is tuned to sit ABOVE A BODY — a muted name over a faint
// time, deliberately quiet so the words underneath carry the row. A preview
// header has no body under it; the identity IS the content of that row, and
// borrowing the thread's quiet tones made a header nobody could read against a
// bright photo. The vocabulary is kept (a name, then a mono meta line); the
// tones are a header's.
//
// No avatar, deliberately. The 2026-08-20 rework took avatars out of the
// timeline and out of the rail; the name IS the identity here, and reintroducing
// a face in the one surface that never had one would make the lightbox the odd
// screen out rather than a continuation of the thread behind it.

// ── Identity ────────────────────────────────────────────────────────────────
// Sender, when, and (in the modal) which file. Sits on the left of the preview's
// top bar with the action bar on its right.
export function PreviewIdentity({
  attachment,
  message,
  // The tab surface puts the filename in the TAB LABEL, so repeating it here
  // would be the same string twice on one screen. Modals have no tab, so they
  // keep it.
  showFile = true,
}: {
  attachment: Attachment
  message: LocalMessage
  showFile?: boolean
}) {
  const at = message.createdAt
  return (
    <div className="min-w-0 flex-1">
      {/* The sender, at full text weight. This is the line the whole rework
          exists for, so it gets the brightest ink the theme has rather than the
          timeline's `muted` — over a photo, muted grey on a dark strip is the
          first thing to disappear. */}
      <div className="truncate text-base font-medium text-text" title={message.authorName}>
        {message.authorName}
      </div>
      {/* Meta: when, and (modal only) which file.

          Written with the mono tokens directly instead of the `.eyebrow` class.
          `.eyebrow` is a LABEL recipe — uppercase, tracked, and `faint` — and all
          three are wrong here. Faint is ~3.5:1 on the black strip, which is what
          made this line vanish; uppercase rewrites a filename into a string the
          user cannot match against their own folder (`.jpeg` is not `.JPEG`);
          and the tracking spaces out a value that is read whole. Mono is the one
          part of the recipe that belongs, so it is the one part kept. */}
      <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[length:var(--msg-label-size)] text-muted">
        {at && (
          // Day AND clock, unlike the thread's bare `14:32`. In the timeline the
          // day is carried by the DayDivider you scrolled past to get here; a
          // preview has no such context — it can be opened from a tab days later,
          // in a different conversation — so it has to say the day itself.
          <span className="shrink-0 uppercase tabular-nums">
            {formatDay(at)} · {formatTime(at)}
          </span>
        )}
        {showFile && (
          <span className="min-w-0 truncate" title={attachment.originalName}>
            <span className="text-faint">· </span>
            {attachment.originalName}
            <span className="uppercase text-faint">
              {' · '}
              {typeLabel(attachment.originalName, attachment.mimeType)} ·{' '}
              {formatBytes(attachment.byteSize)}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

// Lines of caption shown before it is cut off. Three is about the length of a
// dispatch note ("third pallet, the one for Rotterdam — driver says the wrap was
// already torn when he loaded"); past that it is a message that wants reading in
// the thread, and the picture should keep the room.
//
// Written out as a literal class, not `line-clamp-${n}`: Tailwind's JIT builds
// its stylesheet by scanning source text for complete class names, so an
// interpolated one is never generated and the clamp silently does nothing.
const CLAMP = 'line-clamp-3'

// ── Caption ─────────────────────────────────────────────────────────────────
// The message body that came with the attachment, under the stage.
//
// Rendered through the thread's own `renderBody`, so @mentions highlight exactly
// as they do in the timeline — a preview is not a place where being named at
// stops counting. Returns null when the attachment was sent without a body,
// which is the common case; nothing reserves height for a caption that isn't
// there.
export function PreviewCaption({
  message,
  currentUserId,
  variant = 'modal',
}: {
  message: LocalMessage
  currentUserId: string
  // The three surfaces a preview is drawn on, which are genuinely three and not
  // one with a flag:
  //   modal — over the black backdrop, inset by the dialog's own p-4. Needs the
  //           stronger fill to hold against black.
  //   pane  — the PDF shell, which is NOT an overlay: it replaces the message
  //           list inside the chat pane, so it sits on the app field and keeps
  //           the shell's own mx-3 gutter and lighter fill.
  //   tab   — a chat-window tab, edge to edge. No fill at all; a hairline is how
  //           this app separates regions on the field.
  variant?: 'modal' | 'pane' | 'tab'
}) {
  const body = message.body?.trim() ?? ''
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const textRef = useRef<HTMLDivElement>(null)

  // Does the caption actually need a More toggle? Measured rather than guessed
  // from character count — the answer depends on the pane's width, which changes
  // with the window and with the sidebar.
  //
  // Deliberately NOT re-measured while expanded: expanding removes the clamp, so
  // scrollHeight collapses to clientHeight and the element would report "fits",
  // taking the Less button away with it and stranding the reader in a long
  // caption they can't close.
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [body, expanded])

  if (!body) return null

  return (
    <div
      // OPAQUE, not a tint. This strip used to be `bg-white/6` over a
      // translucent backdrop, which meant the conversation underneath — sidebar
      // rows, the composer, the header — came through at roughly 14% and sat
      // *inside* the caption's own line boxes. Two texts occupying the same
      // pixels is not a contrast problem that a brighter ink can fix; the strip
      // has to actually stop the light. `bg-bg` is the app's one field colour,
      // so the strip is a solid piece of the app laid over the photo, and the
      // hairline is what gives it an edge against a backdrop it now matches.
      className={`shrink-0 border-line px-3.5 py-2.5 ${
        variant === 'modal'
          ? 'mt-2 rounded-card border bg-bg'
          : variant === 'pane'
            ? 'mx-3 mb-2 rounded-card border bg-bg'
            : 'border-t bg-bg'
      }`}
      // The caption is text on a surface the user may want to select and copy;
      // clicks must not reach the backdrop's close handler.
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={textRef}
        // Same body treatment as the timeline: the message weight token and the
        // 62ch measure, so a caption reads as the message it is rather than as
        // a caption style invented for this screen.
        //
        // Expanding swaps the clamp for a SCROLL CAP rather than for nothing.
        // The caption strip is shrink-0 and the stage is flex-1, so an unbounded
        // caption takes its height straight out of the picture — expanding a
        // long note would squeeze the image toward zero, which is the opposite
        // of what someone opening a preview asked for. A third of the viewport
        // is enough to read a long note in, and the rest scrolls.
        className={`max-w-body whitespace-pre-wrap break-words text-base leading-[1.55] font-[number:var(--msg-body-weight)] text-text ${
          expanded ? 'max-h-[30vh] overflow-y-auto' : CLAMP
        }`}
      >
        {renderBody(body, message.mentions, currentUserId)}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="eyebrow mt-1.5 transition-colors hover:text-text focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  )
}
