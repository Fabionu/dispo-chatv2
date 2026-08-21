import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ImageOff, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import {
  DOC_ACCEPT,
  IMAGE_ACCEPT,
  fileError,
} from './attachmentUtils'
import { useComposerAutosize } from '../../hooks/useComposerAutosize'
import { PdfPagePreview } from './PdfRender'
import {
  AttachmentGlyphStage,
  AttachmentIdentity,
  AttachmentPreviewFrame,
} from './AttachmentPreviewFrame'
import { ICON_ACTION_SMALL } from '../HeaderIconButton'

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

// Pre-send preview. Opens after the user picks a file, BEFORE anything is sent:
// a compact dialog — not a full-screen takeover — holding the bounded preview,
// the file's identity, the caption, and the send action.
//
// Images and documents share one structure (AttachmentPreviewFrame +
// AttachmentIdentity): only the stage content differs, so a PDF and a photo are
// the same dialog at the same size.
//
// Behaviour worth knowing:
//   • Enter inserts a NEWLINE. Sending is the button or Ctrl/Cmd+Enter — a
//     caption is prose, and a stray Enter must never fire the upload.
//   • Escape closes, but a typed caption arms an inline confirm first.
//   • The backdrop never closes: a stray click can't discard a written caption.
//   • Send locks itself the moment it's pressed (spinner, disabled), so the
//     file can't be sent twice.
//   • A failed upload is not handled here — the parent's optimistic send leaves
//     a retryable failed bubble in the thread with the file and caption intact.
export default function AttachmentSendPreviewModal({
  file,
  initialCaption,
  onReplace,
  onCancel,
  onSend,
}: Props) {
  const [caption, setCaption] = useState(initialCaption)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Escape / Cancel with a typed caption arms this instead of closing outright.
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  // The object URL loaded / failed. A failure keeps the FILE staged and shows a
  // clear fallback — losing the selection because a thumbnail failed would be
  // the worse outcome.
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  useComposerAutosize(textareaRef, caption)

  const isImage = file.type.startsWith('image/')
  const isPdf = file.type === 'application/pdf'

  // Local object URL for instant image preview only. Revoked when the file
  // changes (replace) or the dialog unmounts so we never leak blobs.
  const objectUrl = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage])
  useEffect(() => {
    if (!objectUrl) return
    setImageState('loading')
    return () => URL.revokeObjectURL(objectUrl)
  }, [objectUrl])

  const dirty = caption.trim().length > 0

  function requestClose() {
    if (sending) return
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    onCancel()
  }

  // Esc closes (guarded by the discard confirm above).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      requestClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  // Focus the caption on open so the user can type immediately.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function onReplacePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    // The SAME validation the composer, drag-drop and paste all use.
    const message = fileError(picked)
    if (message) {
      setError(message)
      return
    }
    setError(null)
    onReplace(picked)
  }

  function submit() {
    if (sending) return
    setSending(true)
    onSend(caption.trim())
  }

  // Enter is a newline; Ctrl/Cmd+Enter sends. The hint under the field says so.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Send ${file.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Dimmed backdrop — deliberately NOT a click-away, so a typed caption
          can't be lost by a stray click outside the dialog. */}
      <div className="absolute inset-0 bg-black/70" aria-hidden />

      <input
        ref={replaceInputRef}
        type="file"
        accept={`${IMAGE_ACCEPT},${DOC_ACCEPT}`}
        onChange={onReplacePicked}
        className="hidden"
      />

      <div
        className="relative flex w-full max-w-[34rem] max-h-[85vh] flex-col overflow-hidden rounded-modal border border-line bg-panel shadow-modal"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h2 className="text-base font-semibold">Send attachment</h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={sending}
            aria-label="Cancel"
            title="Cancel"
            className={`${ICON_ACTION_SMALL} shrink-0 disabled:opacity-40`}
          >
            <X size="0.9375rem" strokeWidth={2} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
          {/* Stage — bounded in BOTH axes so a very tall screenshot is scaled
              down whole (object-contain) instead of taking over the dialog. */}
          <AttachmentPreviewFrame bleed={isPdf}>
            {isImage && objectUrl ? (
              <>
                <img
                  src={objectUrl}
                  alt={file.name}
                  onLoad={() => setImageState('ready')}
                  onError={() => setImageState('failed')}
                  className={`max-h-[20rem] max-w-full object-contain rounded-chip transition-opacity duration-200 motion-reduce:transition-none ${
                    imageState === 'ready' ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                {imageState === 'loading' && (
                  <span className="absolute inset-0 flex items-center justify-center text-faint">
                    <Loader2
                      size="1.25rem"
                      strokeWidth={2}
                      className="animate-spin motion-reduce:animate-none"
                    />
                  </span>
                )}
                {imageState === 'failed' && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <ImageOff size="1.5rem" strokeWidth={1.6} className="text-faint" />
                    <span className="text-sm leading-snug text-faint">
                      Preview unavailable — the file is still ready to send.
                    </span>
                  </span>
                )}
              </>
            ) : isPdf ? (
              <div className="h-[20rem] w-full">
                <PdfPagePreview
                  file={file}
                  fallback={
                    <AttachmentGlyphStage
                      mimeType={file.type}
                      note="Preview unavailable — the file is still ready to send."
                    />
                  }
                />
              </div>
            ) : (
              <AttachmentGlyphStage mimeType={file.type} />
            )}
          </AttachmentPreviewFrame>

          {/* Identity + the two file-level actions. */}
          <AttachmentIdentity
            name={file.name}
            mimeType={file.type}
            byteSize={file.size}
            trailing={
              <>
                <button
                  type="button"
                  onClick={() => replaceInputRef.current?.click()}
                  disabled={sending}
                  aria-label="Replace file"
                  title="Replace file"
                  className={`${ICON_ACTION_SMALL} disabled:opacity-40`}
                >
                  <RefreshCw size="0.8125rem" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={sending}
                  aria-label="Remove file"
                  title="Remove file"
                  className={`${ICON_ACTION_SMALL} hover:text-alert disabled:opacity-40`}
                >
                  <Trash2 size="0.8125rem" strokeWidth={1.8} />
                </button>
              </>
            }
          />

          {error && (
            <p role="alert" className="text-sm leading-snug text-alert">
              {error}
            </p>
          )}
        </div>

        {/* Caption + send. Same capsule, spacing and circular send control as
            the chat composer, so the two read as one control. */}
        <div className="shrink-0 border-t border-line px-4 pt-2.5 pb-3">
          <div className="rounded-card bg-composer">
            <div className="flex items-end gap-1.5 px-2.5 py-2">
              <textarea
                ref={textareaRef}
                value={caption}
                onChange={(e) => {
                  setCaption(e.target.value)
                  setConfirmDiscard(false)
                }}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={sending}
                aria-label="Caption"
                placeholder="Add a caption…"
                className="flex-1 min-w-0 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[7em] px-2 py-1.5 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={sending}
                aria-label="Send attachment"
                title="Send (Ctrl+Enter)"
                className="h-[var(--composer-size)] w-[var(--composer-size)] shrink-0 flex items-center justify-center rounded-full bg-text text-bg transition-colors hover:bg-white disabled:opacity-60 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                {sending ? (
                  <Loader2
                    size="1rem"
                    strokeWidth={2.2}
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <ArrowUp size="1rem" strokeWidth={2.2} />
                )}
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-faint">
              Enter adds a line · Ctrl+Enter sends
            </span>
            {confirmDiscard && (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted">Discard this caption?</span>
                <button
                  type="button"
                  onClick={onCancel}
                  className="font-semibold text-alert hover:underline underline-offset-2"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                  className="text-muted hover:text-text"
                >
                  Keep
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
