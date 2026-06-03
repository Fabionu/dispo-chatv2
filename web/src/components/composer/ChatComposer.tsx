import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUp, Smile } from 'lucide-react'
import type { GroupMember, ReplyToPreview } from '../../lib/types'
import { DOC_ACCEPT, IMAGE_ACCEPT, fileError } from '../attachments/attachmentUtils'
import ComposerContextRow from '../messages/ComposerContextRow'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'
import AttachMenu from './AttachMenu'
import MentionPicker from './MentionPicker'

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

  // A picked file is not staged inline anymore — it's handed straight to the
  // parent, which opens the pre-send preview modal.
  onFilePicked: (file: File) => void

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

// An active @-mention being typed: where the `@` sits and the text typed after
// it (used to filter members).
type MentionState = { anchor: number; query: string }

const MAX_PICKER_RESULTS = 6

// Find an active mention immediately left of the caret: an `@` at the start of
// input or after whitespace, with no whitespace between it and the caret.
function detectMention(value: string, caret: number): MentionState | null {
  let i = caret - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === '@') {
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
    onFilePicked,
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

  const [mention, setMention] = useState<MentionState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

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

  // Restore the caret after a mention insert (the value is controlled, so we
  // can only set selection once React has applied the new text).
  useEffect(() => {
    const pos = pendingCaretRef.current
    if (pos == null) return
    pendingCaretRef.current = null
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
  }, [text])

  // Drop a stale picker when the textarea empties (e.g. after send).
  useEffect(() => {
    if (!text && mention) setMention(null)
  }, [text, mention])

  useImperativeHandle(ref, () => ({
    focus() {
      textareaRef.current?.focus()
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
    setMention(members.length ? detectMention(value, caret) : null)
    setActiveIndex(0)
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const disabled = editContext
    ? !text.trim() || text.trim() === editContext.originalBody
    : !text.trim()

  return (
    <div className="relative rounded-[14px] border border-white/[0.12] bg-white/[0.04] focus-within:border-white/[0.20] focus-within:bg-white/[0.05] transition-colors">
      {pickerOpen && (
        <MentionPicker
          members={matches}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={selectMember}
        />
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
      {/* Minimal input bar: paperclip · textarea · emoji · send. All controls
          share --composer-size and bottom-align so the bar stays tidy as the
          textarea autogrows. */}
      <div className="flex items-end gap-1 px-2 py-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept={`${IMAGE_ACCEPT},${DOC_ACCEPT}`}
          onChange={onPickFile}
          className="hidden"
        />
        <AttachMenu disabled={Boolean(editContext)} onPickKind={pickKind} />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={editContext ? 'Edit message…' : placeholder}
          className="flex-1 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] px-1.5 py-1.5"
        />
        {/* Emoji — not wired up yet; shown disabled so the bar matches the
            minimal layout without faking behaviour. */}
        <button
          type="button"
          disabled
          aria-label="Emoji (coming soon)"
          title="Emoji (coming soon)"
          className="h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 flex items-center justify-center rounded-full text-faint cursor-default"
        >
          <Smile size={16} strokeWidth={1.8} />
        </button>
        <button
          onClick={onSend}
          disabled={disabled}
          aria-label={editContext ? 'Save edit' : 'Send message'}
          className="h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 flex items-center justify-center rounded-full bg-text text-bg hover:bg-text/90 transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-text"
        >
          <ArrowUp size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
})

export default ChatComposer
