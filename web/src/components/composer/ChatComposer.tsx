import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUp, Bold, Italic } from 'lucide-react'
import type { GroupMember, ReplyToPreview } from '../../lib/types'
import { DOC_ACCEPT, IMAGE_ACCEPT, fileError } from '../attachments/attachmentUtils'
import ComposerContextRow from '../messages/ComposerContextRow'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'
import AttachMenu from './AttachMenu'
import MentionPicker from './MentionPicker'
import TripMentionPicker from './TripMentionPicker'

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

  // When provided, the composer's add (+) menu shows a "Trip" option. Wired only
  // for vehicle rooms (the parent gates on type + manage permission); omitting it
  // hides the option, e.g. in DMs.
  onAddTrip?: () => void

  replyContext: ReplyToPreview | null
  onCancelReply: () => void

  editContext: EditContext | null
  onCancelEdit: () => void

  onSend: () => void

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

  // Floating input bar: a wide capsule on the `composer` tone,
  // one step lighter than the grey chat area (`bg`) so it reads as a calm,
  // distinct input surface. It sits inside ChatView's transparent overlay (which
  // lets messages scroll behind); the solid fill + its rounded shape define it
  // against the chat area. Its full radius follows the circular add/send controls
  // while the hairline border brightens gently on focus. `relative` anchors the
  // mention picker.
  return (
    <div className="relative rounded-full border border-white/[0.06] bg-composer shadow-[0_3px_12px_rgba(0,0,0,0.22)] transition-colors focus-within:border-white/[0.12]">
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
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] z-20 flex items-center gap-0.5 rounded-chip border border-white/[0.12] bg-surface-2 px-1 py-1 shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
          <FormatButton label="Bold" shortcut="Ctrl/Cmd+B" onClick={() => applyFormat('*')}>
            <Bold size="0.9375rem" strokeWidth={2.4} />
          </FormatButton>
          <FormatButton label="Italic" shortcut="Ctrl/Cmd+I" onClick={() => applyFormat('_')}>
            <Italic size="0.9375rem" strokeWidth={2.2} />
          </FormatButton>
          {/* Downward caret so it reads as a tooltip anchored to the input. */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px h-2 w-2 rotate-45 border-r border-b border-white/[0.12] bg-surface-2" />
        </div>
      )}
      {replyContext && (
        <ComposerContextRow
          tone="reply"
          label={`Replying to ${replyContext.authorName}`}
          snippet={
            replyContext.deleted
              ? '(deleted message)'
              : replyContext.body || (replyContext.hasAttachments ? 'Attachment' : '')
          }
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
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={`${IMAGE_ACCEPT},${DOC_ACCEPT}`}
          onChange={onPickFile}
          className="hidden"
        />
        <AttachMenu disabled={Boolean(editContext)} onPickKind={pickKind} onAddTrip={onAddTrip} />
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
          rows={1}
          placeholder={editContext ? 'Edit message…' : placeholder}
          className="flex-1 min-w-0 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] px-2 py-1.5"
        />
        <button
          onClick={onSend}
          disabled={disabled}
          aria-label={editContext ? 'Save edit' : 'Send message'}
          className={`h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 flex items-center justify-center rounded-full transition-colors ${
            disabled
              ? 'bg-white/[0.07] text-faint cursor-default'
              : 'bg-text text-bg hover:bg-white'
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
      className="h-7 w-7 flex items-center justify-center rounded-[0.1875rem] text-muted hover:text-text hover:bg-white/[0.08] transition-colors"
    >
      {children}
    </button>
  )
}

export default ChatComposer
