import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, RefreshCw, X } from 'lucide-react'
import {
  DOC_ACCEPT,
  DocIcon,
  IMAGE_ACCEPT,
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
  formatBytes,
} from './attachmentUtils'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'

type Props = {
  /** The staged file awaiting confirmation. */
  file: File
  /** Caption seeded from whatever the user had already typed in the composer. */
  initialCaption: string
  /** Swap the staged file for another one (validated here, applied by parent). */
  onReplace: (file: File) => void
  /** Dismiss without sending. The parent restores the composer state. */
  onCancel: () => void
  /** Confirm: send the file together with the (trimmed) caption. */
  onSend: (caption: string) => void
}

// WhatsApp-style pre-send preview. Opens after the user picks a file, BEFORE
// anything is sent: it shows the attachment large (image / inline PDF / a big
// document card), carries a multi-line caption input, and only on "Send" does
// the parent run the existing optimistic send. Esc / the X / Cancel all close
// without sending; the backdrop intentionally does NOT close, so a typed
// caption can't be lost by a stray click.
export default function AttachmentSendPreviewModal({
  file,
  initialCaption,
  onReplace,
  onCancel,
  onSend,
}: Props) {
  const [caption, setCaption] = useState(initialCaption)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  useComposerAutosize(textareaRef, caption)

  const isImage = file.type.startsWith('image/')
  const isPdf = file.type === 'application/pdf'

  // Local object URL for instant preview (images + inline PDFs). Revoked when
  // the file changes (replace) or the modal unmounts so we never leak blobs.
  const objectUrl = useMemo(() => {
    if (!isImage && !isPdf) return null
    return URL.createObjectURL(file)
  }, [file, isImage, isPdf])
  useEffect(() => {
    if (!objectUrl) return
    return () => URL.revokeObjectURL(objectUrl)
  }, [objectUrl])

  // Esc cancels.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Focus the caption on open so the user can type immediately.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function pickReplace() {
    replaceInputRef.current?.click()
  }

  function onReplacePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    const img = picked.type.startsWith('image/')
    const cap = img ? MAX_IMAGE_BYTES : MAX_DOC_BYTES
    if (picked.size > cap) {
      setError(img ? 'Image too large (max 10MB).' : 'File too large (max 25MB).')
      return
    }
    setError(null)
    onReplace(picked)
  }

  function submit() {
    onSend(caption.trim())
  }

  // Enter sends; Shift+Enter inserts a newline (matches the composer).
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Send ${file.name}`}
      className="fixed inset-0 z-50 bg-black/85 flex flex-col p-4"
    >
      <input
        ref={replaceInputRef}
        type="file"
        accept={`${IMAGE_ACCEPT},${DOC_ACCEPT}`}
        onChange={onReplacePicked}
        className="hidden"
      />

      {/* Top bar: filename + replace/close. */}
      <div className="flex items-center justify-between gap-3 px-2 py-1.5 shrink-0">
        <div className="text-[12.5px] text-text truncate flex-1 min-w-0">{file.name}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={pickReplace}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] text-[12px] transition-colors"
          >
            <RefreshCw size={13} strokeWidth={1.6} />
            Replace
          </button>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="h-8 w-8 inline-flex items-center justify-center rounded-btn border border-white/[0.14] text-text hover:bg-white/[0.04] transition-colors"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Preview area. */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {isImage && objectUrl ? (
          <img
            src={objectUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-card"
          />
        ) : isPdf && objectUrl ? (
          <iframe
            src={objectUrl}
            title={file.name}
            className="w-full h-full max-w-[820px] border-0 rounded-card bg-bg"
          />
        ) : (
          <DocCard file={file} />
        )}
      </div>

      {/* Caption + send. */}
      <div className="shrink-0 pt-3">
        {error && (
          <div className="text-[11.5px] text-alert mb-1.5 text-center">{error}</div>
        )}
        <div className="mx-auto w-full max-w-[820px] rounded-card border border-white/[0.14] bg-white/[0.045] focus-within:border-white/[0.24] focus-within:bg-white/[0.06] transition-colors flex items-end gap-2 px-3.5 py-2.5">
          <textarea
            ref={textareaRef}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Add a caption…"
            className="flex-1 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] py-1"
          />
          <button
            onClick={submit}
            aria-label="Send attachment"
            className="h-7 w-7 shrink-0 flex items-center justify-center rounded-chip bg-text text-bg transition-opacity"
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  )
}

// Large document card for non-previewable files: prominent icon, filename,
// extension + size. Mirrors the post-send attachment styling but bigger.
function DocCard({ file }: { file: File }) {
  const ext = file.name.includes('.')
    ? file.name.split('.').pop()!.toUpperCase()
    : 'FILE'
  return (
    <div className="w-full max-w-[360px] rounded-card border border-white/[0.10] bg-surface px-6 py-8 flex flex-col items-center text-center">
      <div className="h-16 w-16 rounded-card border border-white/[0.10] bg-white/[0.03] flex items-center justify-center mb-4">
        <DocIcon mime={file.type} size={30} className="text-muted" />
      </div>
      <div className="text-[13px] text-text font-medium truncate max-w-full">{file.name}</div>
      <div className="text-[11.5px] text-muted mt-1">
        {ext} · {formatBytes(file.size)}
      </div>
    </div>
  )
}
