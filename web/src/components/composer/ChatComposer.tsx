import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUp, Bold, Clock3, Italic } from 'lucide-react'
import type { GroupMember, ReplyToPreview } from '../../lib/types'
import { DOC_ACCEPT, IMAGE_ACCEPT, fileError } from '../attachments/attachmentUtils'
import ComposerContextRow from '../messages/ComposerContextRow'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'
import { useActiveComposerEffect } from '../../lib/animations'
import AttachMenu from './AttachMenu'
import MentionPicker from './MentionPicker'
import TripMentionPicker from './TripMentionPicker'

// The ONE typography string the textarea and its ink mirror both wear. Size,
// leading and padding have to be identical between the two layers or the
// visible glyphs and the real caret stop agreeing — so they are stated once
// here rather than twice in the JSX.
const COMPOSER_TYPE = 'text-[length:var(--chat-msg-font-size)] leading-[1.5] px-2 py-1'

export type EditContext = { id: string; originalBody: string }

export type ChatComposerHandle = {
  focus: () => void
}

type Props = {
  placeholder: string

  text: string
  onTextChange: (v: string) => void

  // Members of the current conversation — the source for the @-mention picker.
  members: GroupMember[]

  // The room's active trip/order, when one exists — enables the `#reference`
  // trip-mention suggestion. Undefined in DMs or rooms without a trip, which
  // disables the `#` trigger entirely.
  activeTrip?: { reference: string; subtitle?: string }

  // A picked file is not staged inline anymore — it's handed straight to the
  // parent, which opens the pre-send preview modal.
  onFilePicked: (file: File) => void

  // When provided, the composer's add (+) menu shows an "Add trip" option. The
  // parent either opens the current vehicle room directly or presents a room
  // chooser when the conversation itself is not vehicle-scoped.
  onAddTrip?: () => void

  replyContext: ReplyToPreview | null
  onCancelReply: () => void

  editContext: EditContext | null
  onCancelEdit: () => void

  onSend: () => void
  onSchedule: () => void

  // Surfaces a per-file validation error to the parent (e.g. "Image too
  // large"). Kept here so the composer owns the size policy.
  onFileError: (msg: string) => void
  onClearError: () => void
}

// An active mention being typed: where the trigger char sits and the text typed
// after it (used to filter members / match the trip reference).
type MentionState = { anchor: number; query: string }

const MAX_PICKER_RESULTS = 6

// Find an active mention immediately left of the caret: the trigger char (`@`
// for members, `#` for the trip) at the start of input or after whitespace,
// with no whitespace between it and the caret.
function detectMention(value: string, caret: number, trigger: '@' | '#'): MentionState | null {
  let i = caret - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === trigger) {
      const before = i > 0 ? value[i - 1] : ''
      if (i === 0 || /\s/.test(before)) return { anchor: i, query: value.slice(i + 1, caret) }
      return null
    }
    // A mention token can't contain whitespace — bail once we hit some.
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

// The full composer block. Owns the textarea, attach menu, file input, the
// in-band reply/edit context rows, and the @-mention picker. The parent
// (ChatView) owns the underlying text state and the send logic.
const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  {
    placeholder,
    text,
    onTextChange,
    members,
    activeTrip,
    onFilePicked,
    onAddTrip,
    replyContext,
    onCancelReply,
    editContext,
    onCancelEdit,
    onSend,
    onSchedule,
    onFileError,
    onClearError,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Caret position to restore after a programmatic insert (mention selection),
  // applied once the controlled value has updated.
  const pendingCaretRef = useRef<number | null>(null)
  // Selection range to restore after a programmatic edit (bold/italic wrap), so
  // the just-formatted text stays highlighted and the format bar stays open.
  const pendingSelectionRef = useRef<[number, number] | null>(null)

  const [mention, setMention] = useState<MentionState | null>(null)
  // A `#` trip mention being typed (vehicle rooms with an active trip only).
  const [tripMention, setTripMention] = useState<MentionState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Whether a non-empty selection exists in the textarea — drives the floating
  // bold/italic format bar above the input.
  const [hasSelection, setHasSelection] = useState(false)

  // ── Ink: newly typed characters fade in ───────────────────────────────────
  // A <textarea> has no per-character DOM, so the characters that animate are
  // NOT the textarea's — they belong to a mirror layer drawn over it while the
  // textarea's own glyphs are transparent. Everything below exists to keep the
  // two layers indistinguishable; if any of it drifts, you get ghosting.
  //
  //   `animFrom`  index of the first character still animating; null = at rest.
  //               Only a pure APPEND arms it. A delete, a mid-string edit or a
  //               programmatic replace (mention insert, edit-message load) sets
  //               it back to null, because in those cases the tail's absolute
  //               indices shift and every span would remount and re-animate.
  //   the KEY     each animating character is keyed by its ABSOLUTE index, so a
  //               character that is already on screen keeps its finished
  //               animation while only the newly-typed one mounts and runs.
  //               That is what makes fast typing look like a wave instead of a
  //               strobe — no shared timer, no stagger to get wrong.
  //   `composing` IME and dead keys (á, ä, ș — this app's users type all three)
  //               draw their pre-edit INSIDE the textarea, where the mirror
  //               cannot see it. While composing, the real text goes visible
  //               and the mirror hides, so composing never types blind.
  // Which effect is live — the stored choice, already silenced if interface
  // animations are off (see lib/animations). It decides what DOM exists: the
  // ink mirror is a real element and the pulse is another, so neither is
  // rendered at all unless it is the selected one.
  const effect = useActiveComposerEffect()
  // Live pulses. A LIST, not a counter: each keystroke adds a wave that runs its
  // own animation to completion and then removes itself (`onAnimationEnd`), so
  // typing sends overlapping ripples instead of yanking one line back to the
  // middle. The first version remounted a single element per keystroke, which
  // meant the faster you typed the less it ever travelled.
  //
  // Capped at 6. At typing speed three or four are usually alive at once; the
  // cap only bites during a key-repeat burst, where dropping the oldest — which
  // is by then almost transparent — is invisible.
  const [pulses, setPulses] = useState<number[]>([])
  const pulseIdRef = useRef(0)
  const pulseTimersRef = useRef<number[]>([])
  const [animFrom, setAnimFrom] = useState<number | null>(null)
  const [composing, setComposing] = useState(false)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const prevTextRef = useRef(text)
  const settleRef = useRef<number | null>(null)

  useEffect(() => {
    const prev = prevTextRef.current
    prevTextRef.current = text
    const appended = text.length > prev.length && text.startsWith(prev)
    // The pulse fires on any GROWTH, including a paste: it marks "something was
    // added", where the ink marks which characters those were.
    if (effect === 'pulse' && text.length > prev.length) {
      pulseIdRef.current += 1
      const id = pulseIdRef.current
      setPulses((list) => [...list, id].slice(-6))
      // A TIMER retires the wave, not `animationend`. A browser does not advance
      // animations in a background tab, so `animationend` never fires there —
      // every keystroke typed while the tab is hidden would stay mounted (the
      // cap bounds it at 6) and then all run at once the moment you came back.
      // A timeout fires regardless of visibility, so the composer is clean when
      // you return to it.
      const timer = window.setTimeout(() => {
        setPulses((list) => list.filter((x) => x !== id))
        pulseTimersRef.current = pulseTimersRef.current.filter((t) => t !== timer)
      }, 520)
      pulseTimersRef.current.push(timer)
    }
    if (effect !== 'ink' || !appended) {
      if (settleRef.current) window.clearTimeout(settleRef.current)
      settleRef.current = null
      setAnimFrom(null)
      return
    }
    // First keystroke of a burst arms the window at the old length; the rest of
    // the burst extends it rather than resetting it, so nothing already lit
    // starts over.
    if (settleRef.current === null) setAnimFrom(prev.length)
    else window.clearTimeout(settleRef.current)
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null
      setAnimFrom(null)
    }, 400)
  }, [text, effect])

  // Leaving the pulse effect (or turning animations off) drops any wave still
  // in flight; without this they would hang at their last frame, because an
  // unmounted-from-view element never fires `animationend`.
  useEffect(() => {
    if (effect !== 'pulse') setPulses([])
  }, [effect])

  useEffect(() => () => {
    pulseTimersRef.current.forEach(window.clearTimeout)
    pulseTimersRef.current = []
  }, [])

  useEffect(() => () => {
    if (settleRef.current) window.clearTimeout(settleRef.current)
  }, [])

  // The mirror has to sit on the textarea's CONTENT box, not its border box:
  // once the text passes `max-h-[9em]` the textarea grows a 10px scrollbar and
  // its line-breaking width changes. Matching `clientWidth` (which excludes it)
  // is what keeps the two from wrapping differently, and the scroll offset has
  // to follow for the same reason.
  useEffect(() => {
    const ta = textareaRef.current
    const mirror = mirrorRef.current
    if (!ta || !mirror) return
    const sync = () => {
      mirror.style.width = `${ta.clientWidth}px`
      mirror.scrollTop = ta.scrollTop
    }
    sync()
    ta.addEventListener('scroll', sync)
    const ro = new ResizeObserver(sync)
    ro.observe(ta)
    return () => {
      ta.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [text])

  useComposerAutosize(textareaRef, text)

  // Members matching the active query (case-insensitive substring), prefix
  // matches first. Mentions are disabled while editing.
  const matches = useMemo(() => {
    if (!mention || editContext) return []
    const q = mention.query.toLowerCase()
    return members
      .filter((m) => m.displayName.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.displayName.toLowerCase().startsWith(q) ? 0 : 1
        const bp = b.displayName.toLowerCase().startsWith(q) ? 0 : 1
        return ap - bp || a.displayName.localeCompare(b.displayName)
      })
      .slice(0, MAX_PICKER_RESULTS)
  }, [mention, members, editContext])

  const pickerOpen = mention !== null && matches.length > 0

  // The trip suggestion shows while the typed `#query` is a prefix of the active
  // trip's reference (case-insensitive; a bare `#` matches too). Like member
  // mentions, disabled while editing.
  const tripOpen =
    !pickerOpen &&
    !editContext &&
    tripMention !== null &&
    activeTrip !== undefined &&
    activeTrip.reference.toLowerCase().startsWith(tripMention.query.toLowerCase())

  // Restore the caret/selection after a programmatic edit — a mention insert
  // (collapsed caret) or a bold/italic wrap (a range). The value is controlled,
  // so selection can only be set once React has applied the new text.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const range = pendingSelectionRef.current
    if (range) {
      pendingSelectionRef.current = null
      el.focus()
      el.setSelectionRange(range[0], range[1])
      setHasSelection(range[1] > range[0])
      return
    }
    const pos = pendingCaretRef.current
    if (pos == null) return
    pendingCaretRef.current = null
    el.focus()
    el.setSelectionRange(pos, pos)
  }, [text])

  // Drop a stale picker when the textarea empties (e.g. after send).
  useEffect(() => {
    if (!text && mention) setMention(null)
    if (!text && tripMention) setTripMention(null)
  }, [text, mention, tripMention])

  useImperativeHandle(ref, () => ({
    focus() {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      // Land the caret at the END of the current value — so a restored draft
      // (and an edited message body) continues where the text stops rather than
      // at the start. Harmless for an empty field (end === 0).
      const end = el.value.length
      el.setSelectionRange(end, end)
    },
  }))

  function pickKind(accept: string) {
    const input = fileInputRef.current
    if (!input) return
    input.accept = accept
    input.click()
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    // Reset the input immediately so picking the same file again still fires
    // a change event (the staged file now lives in the preview modal).
    e.target.value = ''
    if (!picked) return
    const err = fileError(picked)
    if (err) {
      onFileError(err)
      return
    }
    onClearError()
    onFilePicked(picked)
  }

  // Paste an image straight into the composer (e.g. a screenshot from the
  // clipboard). We only intercept image files — text paste falls through to the
  // textarea untouched. The pasted image goes through the same pre-send preview
  // as a picked/dropped one. Documents are not paste-able (drag-and-drop those).
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const err = fileError(file)
        if (err) {
          onFileError(err)
          return
        }
        onClearError()
        onFilePicked(file)
        return
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    onTextChange(value)
    const caret = e.target.selectionStart ?? value.length
    setMention(members.length ? detectMention(value, caret, '@') : null)
    setTripMention(activeTrip ? detectMention(value, caret, '#') : null)
    setActiveIndex(0)
    // Typing collapses any selection — hide the format bar.
    setHasSelection((e.target.selectionEnd ?? 0) > (e.target.selectionStart ?? 0))
  }

  // Replace the `@query` span with `@Display Name ` and close the picker.
  function selectMember(member: GroupMember) {
    if (!mention) return
    const el = textareaRef.current
    const caret = el?.selectionStart ?? text.length
    const insert = `@${member.displayName} `
    const next = text.slice(0, mention.anchor) + insert + text.slice(caret)
    onTextChange(next)
    pendingCaretRef.current = mention.anchor + insert.length
    setMention(null)
  }

  // Replace the `#query` span with `#Reference ` and close the trip suggestion.
  function selectTrip() {
    if (!tripMention || !activeTrip) return
    const el = textareaRef.current
    const caret = el?.selectionStart ?? text.length
    const insert = `#${activeTrip.reference} `
    const next = text.slice(0, tripMention.anchor) + insert + text.slice(caret)
    onTextChange(next)
    pendingCaretRef.current = tripMention.anchor + insert.length
    setTripMention(null)
  }

  // Track whether there's a non-empty selection so the format bar shows only
  // while text is highlighted.
  function syncSelection() {
    const el = textareaRef.current
    if (!el) return
    setHasSelection((el.selectionEnd ?? 0) > (el.selectionStart ?? 0))
  }

  // Wrap the current selection in a formatting marker (* for bold, _ for italic)
  // — the same syntax rendered in message bubbles. No-op without a selection.
  // Re-selects the wrapped inner text so the bar stays open and the change reads
  // clearly; toggling again would nest, which the renderer handles.
  function applyFormat(marker: '*' | '_') {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (end <= start) return
    const next = text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end)
    onTextChange(next)
    // Keep the original text selected (now shifted right by one marker char).
    pendingSelectionRef.current = [start + 1, end + 1]
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // While the picker is open, hijack navigation keys.
    if (pickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMember(matches[activeIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    // Trip suggestion: a single row, so only select/dismiss keys are hijacked.
    if (tripOpen) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectTrip()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTripMention(null)
        return
      }
    }
    // Ctrl/Cmd+B / +I wrap the selection in bold / italic markers.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') {
        e.preventDefault()
        applyFormat('*')
        return
      }
      if (k === 'i') {
        e.preventDefault()
        applyFormat('_')
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const disabled = editContext
    ? !text.trim() || text.trim() === editContext.originalBody
    : !text.trim()

  // The input: a drawn rectangle, opaque, floating over the bottom of the
  // message list. It used to be a capsule defined by a tone step, which no
  // longer exists — so the hairline does the whole job, and brightens to
  // `line-2` while the field has focus. The fill has to be solid even though
  // it matches the field: the thread scrolls UNDER this. `relative` anchors the
  // mention picker.
  return (
    <div className="chat-composer relative border bg-bg transition-colors focus-within:border-strong">
      {/* The pulses ride the COMPOSER's border, not the textarea's box, which is
          why they are mounted here and not down in the input. Each is keyed by
          its own id so React never reuses one element for two waves — reuse is
          exactly what would restart an animation instead of starting a second.
          The list is empty until the first keystroke, so opening a conversation
          never flashes. */}
      {effect === 'pulse' &&
        pulses.map((id) => (
          <span key={id} aria-hidden="true" className="composer-pulse" />
        ))}
      {pickerOpen && (
        <MentionPicker
          members={matches}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={selectMember}
        />
      )}
      {tripOpen && activeTrip && (
        <TripMentionPicker
          reference={activeTrip.reference}
          subtitle={activeTrip.subtitle}
          onSelect={selectTrip}
        />
      )}
      {/* Floating format bar — a small tooltip above the input that appears while
          text is selected, offering Bold / Italic. Buttons use onMouseDown +
          preventDefault so clicking them doesn't blur the textarea (which would
          drop the selection before the wrap runs). Hidden while the @-mention
          picker is open to avoid stacking two popovers. */}
      {hasSelection && !pickerOpen && !tripOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] z-20 flex items-center gap-0.5 border bg-surface px-1 py-1 shadow-overlay">
          <FormatButton label="Bold" shortcut="Ctrl/Cmd+B" onClick={() => applyFormat('*')}>
            <Bold size="0.9375rem" strokeWidth={2.4} />
          </FormatButton>
          <FormatButton label="Italic" shortcut="Ctrl/Cmd+I" onClick={() => applyFormat('_')}>
            <Italic size="0.9375rem" strokeWidth={2.2} />
          </FormatButton>
          {/* Downward caret so it reads as a tooltip anchored to the input. */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px h-2 w-2 rotate-45 border-r border-b bg-surface" />
        </div>
      )}
      {replyContext && (
        <ComposerContextRow
          tone="reply"
          label={`Replying to ${replyContext.authorName}`}
          snippet={
            replyContext.deleted
              ? '(deleted message)'
              : replyContext.body ||
                replyContext.attachment?.originalName ||
                (replyContext.hasAttachments ? 'Attachment' : '')
          }
          attachment={replyContext.attachment}
          onCancel={onCancelReply}
        />
      )}
      {editContext && (
        <ComposerContextRow
          tone="edit"
          label="Editing message"
          snippet={editContext.originalBody}
          onCancel={onCancelEdit}
        />
      )}
      {/* Minimal input bar: add (+) · textarea · send. The controls share
          --composer-size and are vertically centred against the textarea, so
          they stay aligned with the middle of the input whether it's one line or
          grown to several (items-center tracks the textarea's height). */}
      <div className="composer-bar flex items-center gap-1.5 px-1.5 py-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept={`${IMAGE_ACCEPT},${DOC_ACCEPT}`}
          onChange={onPickFile}
          className="hidden"
        />
        <AttachMenu disabled={Boolean(editContext)} onPickKind={pickKind} onAddTrip={onAddTrip} />
        {/* The textarea and its mirror share ONE typography string
             (COMPOSER_TYPE). That is not tidiness — it is the correctness
             condition: any difference in size, leading, padding or wrapping
             between the two puts the visible glyphs somewhere the caret isn't. */}
        <div className="relative flex-1 min-w-0">
          {effect === 'ink' && (
          <div
            ref={mirrorRef}
            aria-hidden="true"
            className={`composer-ink-layer ${COMPOSER_TYPE} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words ${
              composing ? 'invisible' : ''
            }`}
          >
            {animFrom === null ? (
              text
            ) : (
              <>
                {text.slice(0, animFrom)}
                {Array.from(text.slice(animFrom)).map((ch, i) => (
                  <span key={animFrom + i} className="composer-ink">
                    {ch}
                  </span>
                ))}
              </>
            )}
          </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onSelect={syncSelection}
            onMouseUp={syncSelection}
            onKeyUp={syncSelection}
            onBlur={() => setHasSelection(false)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            rows={1}
            placeholder={editContext ? 'Edit message…' : placeholder}
            // `relative` keeps it over the mirror so it still takes the pointer.
            // The glyphs are transparent, never the caret and never a selection
            // (see .composer-input::selection in index.css).
            className={`composer-input ${COMPOSER_TYPE} relative block w-full bg-transparent outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] ${
              effect === 'ink' && !composing ? 'text-transparent' : ''
            }`}
          />
        </div>
        <button
          type="button"
          onClick={onSchedule}
          aria-label="Schedule message"
          title="Schedule message"
          className={`rounded-btn h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 items-center justify-center text-muted hover:bg-white/6 hover:text-text transition-colors ${
            editContext ? 'hidden' : 'flex'
          }`}
        >
          <Clock3 size="1rem" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={disabled}
          aria-label={editContext ? 'Save edit' : 'Send message'}
          // The fill IS the state. With nothing to send the button is undrawn —
          // no box, no wash, just a faint arrow sitting in the bar; the moment
          // there's text it fills solid and becomes the one filled control in
          // the thread, which is what makes it read as the primary action
          // without a colour. It used to keep a hairline while disabled, so the
          // empty state looked like an outlined button that had been switched
          // off rather than an action that isn't available yet.
          className={`rounded-btn h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 flex items-center justify-center transition-colors ${
            disabled ? 'text-faint cursor-default' : 'bg-text text-bg hover:bg-white'
          }`}
        >
          <ArrowUp size="1rem" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
})

// One button in the floating format bar. onMouseDown preventDefault keeps the
// textarea focused and its selection intact through the click.
function FormatButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${shortcut})`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded-btn h-7 w-7 flex items-center justify-center text-muted hover:text-text hover:bg-white/8 transition-colors"
    >
      {children}
    </button>
  )
}

export default ChatComposer
