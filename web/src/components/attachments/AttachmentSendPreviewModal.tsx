import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, RefreshCw, X } from 'lucide-react'
import {
  DOC_ACCEPT,
  IMAGE_ACCEPT,
  MAX_DOC_BYTES,
  MAX_IMAGE_BYTES,
} from './attachmentUtils'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'
import DocumentCard from './DocumentCard'
import { PdfPagePreview } from './PdfRender'
import HeaderIconButton from '../HeaderIconButton'

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

  // Local object URL for instant image preview only. Revoked when the file
  // changes (replace) or the modal unmounts so we never leak blobs. Documents
  // and PDFs render as a themed card (no in-modal viewer), so they need no URL.
  const objectUrl = useMemo(() => {
    if (!isImage) return null
    return URL.createObjectURL(file)
  }, [file, isImage])
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

      {/* Top bar: filename + icon-only replace/close (themed tooltips). */}
      <div className="flex items-center justify-between gap-3 px-2 py-1.5 shrink-0">
        <div className="text-[0.78125rem] text-text truncate flex-1 min-w-0">{file.name}</div>
        <div className="flex items-center gap-0.5 shrink-0">
          <HeaderIconButton label="Replace" onClick={pickReplace}>
            <RefreshCw size="1.125rem" strokeWidth={1.8} />
          </HeaderIconButton>
          <HeaderIconButton label="Close" onClick={onCancel}>
            <X size="1.125rem" strokeWidth={1.8} />
          </HeaderIconButton>
        </div>
      </div>

      {/* Preview area. Images render large; PDFs rasterise page 1 with pdf.js so
          the actual document content shows (no browser PDF chrome), falling back
          to the themed card only on a render failure; other documents use the
          card directly. */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden py-2">
        {isImage && objectUrl ? (
          <img
            src={objectUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-card"
          />
        ) : isPdf ? (
          <div className="w-full h-full max-w-[51.25rem] mx-auto">
            <PdfPagePreview
              file={file}
              fallback={
                <div className="w-full h-full flex items-center justify-center">
                  <DocumentCard name={file.name} mimeType={file.type} byteSize={file.size} />
                </div>
              }
            />
          </div>
        ) : (
          <DocumentCard name={file.name} mimeType={file.type} byteSize={file.size} />
        )}
      </div>

      {/* Caption + send. */}
      <div className="shrink-0 pt-3">
        {error && (
          <div className="text-[0.71875rem] text-alert mb-1.5 text-center">{error}</div>
        )}
        {/* Caption bar — the same capsule, spacing, input sizing and circular
            send control as the main ChatComposer. This shared preview handles
            images, PDFs and other documents, so every attachment type keeps the
            composer treatment consistent. */}
        <div className="mx-auto w-full max-w-[51.25rem] rounded-full border border-white/[0.06] bg-composer shadow-[0_3px_12px_rgba(0,0,0,0.22)] transition-colors focus-within:border-white/[0.12]">
          <div className="flex items-center gap-1.5 px-2.5 py-2">
            <textarea
              ref={textareaRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Add a caption…"
              className="flex-1 min-w-0 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] px-2 py-1.5"
            />
            <button
              onClick={submit}
              aria-label="Send attachment"
              className="h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 flex items-center justify-center rounded-full bg-text text-bg transition-colors hover:bg-white"
            >
              <ArrowUp size="1rem" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
