import { forwardRef, useImperativeHandle, useMemo, useRef, useEffect } from 'react'
import { ArrowUp } from 'lucide-react'
import type { ReplyToPreview } from '../../lib/types'
import {
  DOC_ACCEPT,
  IMAGE_ACCEPT,
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
} from '../attachments/attachmentUtils'
import ComposerAttachmentPreview from '../attachments/ComposerAttachmentPreview'
import ComposerContextRow from '../messages/ComposerContextRow'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'
import AttachMenu from './AttachMenu'

export type EditContext = { id: string; originalBody: string }

export type ChatComposerHandle = {
  focus: () => void
}

type Props = {
  placeholder: string

  text: string
  onTextChange: (v: string) => void

  file: File | null
  onFileChange: (file: File | null) => void

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

// The full composer block. Owns the textarea, attach menu, file input, and
// the in-band reply/edit context rows. The parent (ChatView) owns the
// underlying state and the send logic.
const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  {
    placeholder,
    text,
    onTextChange,
    file,
    onFileChange,
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

  useComposerAutosize(textareaRef, text)

  // Image preview URL for the staged file. Memoized + revoked on cleanup
  // so we don't leak blobs.
  const filePreviewUrl = useMemo(() => {
    if (!file || !file.type.startsWith('image/')) return null
    return URL.createObjectURL(file)
  }, [file])
  useEffect(() => {
    if (!filePreviewUrl) return
    return () => URL.revokeObjectURL(filePreviewUrl)
  }, [filePreviewUrl])

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
    if (!picked) return
    const isImage = picked.type.startsWith('image/')
    const cap = isImage ? MAX_IMAGE_BYTES : MAX_DOC_BYTES
    if (picked.size > cap) {
      onFileError(isImage ? 'Image too large (max 10MB).' : 'File too large (max 25MB).')
      e.target.value = ''
      return
    }
    onFileChange(picked)
    onClearError()
  }

  function removeFile() {
    onFileChange(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const disabled = editContext
    ? !text.trim() || text.trim() === editContext.originalBody
    : !text.trim() && !file

  return (
    <div className="rounded-card border border-white/[0.08] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors">
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
      {file && !editContext && (
        <ComposerAttachmentPreview
          file={file}
          previewUrl={filePreviewUrl}
          onRemove={removeFile}
        />
      )}
      <div className="flex items-end gap-2 px-3 py-2">
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
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={editContext ? 'Edit message…' : placeholder}
          className="flex-1 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] py-1"
        />
        <button
          onClick={onSend}
          disabled={disabled}
          aria-label={editContext ? 'Save edit' : 'Send message'}
          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-chip bg-text text-bg transition-opacity disabled:opacity-30"
        >
          <ArrowUp size={15} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
})

export default ChatComposer
