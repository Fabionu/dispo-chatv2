import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Paperclip,
  X,
} from 'lucide-react'
import type { Attachment, Group, IncomingMessage, Message } from '../lib/types'
import { groupLabel } from '../lib/types'
import { api, ApiError } from '../lib/api'
import { getSocket } from '../lib/socket'
import ImagePreviewModal from './attachments/ImagePreviewModal'
import InlinePdfPreview from './attachments/InlinePdfPreview'

type Props = {
  group: Group
  currentUserId: string
  onRead: (groupId: string) => void
}

// A message that may not have hit the server yet. `localId` is the temporary
// id we render under until the API returns the real message; `pending` /
// `failed` drive the bubble's visual state. `pendingFile` lets the retry
// flow re-upload the same file without forcing the user to re-pick it.
type LocalMessage = Message & {
  localId?: string
  pending?: boolean
  failed?: boolean
  pendingFile?: File
}

// Allowed attachment types — split by category so the user can pick which
// kind of file the OS picker should narrow to. The server's allowlist is the
// union of both.
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const DOC_ACCEPT =
  'application/pdf,' +
  'application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'text/csv,text/plain'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_DOC_BYTES = 25 * 1024 * 1024

export default function ChatView({ group, currentUserId, onRead }: Props) {
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const [pdfAttachment, setPdfAttachment] = useState<Attachment | null>(null)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const attachMenuRef = useRef<HTMLDivElement>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  // When prepending older messages we must keep the viewport anchored — we
  // record scrollHeight before the prepend and restore the delta after.
  const prependAnchorRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Local preview URL for the staged file. Recomputes when the file changes;
  // revoked on cleanup so we don't leak blobs. Used both as the composer
  // thumbnail and as the optimistic bubble's image source until the server
  // returns the canonical /api/attachments/... URL.
  const filePreviewUrl = useMemo(() => {
    if (!file || !file.type.startsWith('image/')) return null
    return URL.createObjectURL(file)
  }, [file])
  useEffect(() => {
    if (!filePreviewUrl) return
    return () => URL.revokeObjectURL(filePreviewUrl)
  }, [filePreviewUrl])

  // Auto-grow the composer textarea: reset to auto so we can shrink, then
  // pin to the content's scrollHeight. CSS max-height clamps the growth at
  // ~6 lines; once we hit that, the textarea's own overflow takes over.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const markRead = useCallback(() => {
    api.groups
      .markRead(group.id)
      .then(() => onRead(group.id))
      .catch(() => {})
  }, [group.id, onRead])

  // Initial history load. `key={group.id}` on the parent remounts this
  // component per group, so this runs fresh each time.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.groups
      .messages(group.id)
      .then((res) => {
        if (cancelled) return
        setMessages(res.messages)
        setNextCursor(res.nextCursor)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    markRead()
    return () => {
      cancelled = true
    }
  }, [group.id, markRead])

  // Live messages for this group.
  useEffect(() => {
    const socket = getSocket()
    function onNew(msg: IncomingMessage) {
      if (msg.groupId !== group.id) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        // If this is the server echo of one of our own pending optimistic
        // messages, replace by matching body so the bubble doesn't briefly
        // double up before the POST response arrives.
        if (msg.authorId === currentUserId) {
          const idx = prev.findIndex(
            (m) => m.pending && m.authorId === currentUserId && m.body === msg.body,
          )
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = msg
            return next
          }
        }
        return [...prev, msg]
      })
      markRead()
    }
    socket.on('message:new', onNew)
    return () => {
      socket.off('message:new', onNew)
    }
  }, [group.id, currentUserId, markRead])

  // Scroll management. After the initial load jump to the newest message;
  // after a live message only follow if the user was already at the bottom;
  // after a prepend, restore the prior anchor so the view doesn't jump.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependAnchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchorRef.current
      prependAnchorRef.current = null
      return
    }
    if (loading) return
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    nearBottomRef.current = distanceFromBottom < 120
    // 240px keeps the button from flickering right at the edge: it lights up
    // only once the user has scrolled meaningfully away from the latest.
    setShowScrollDown(distanceFromBottom > 240)
  }

  function scrollToBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    nearBottomRef.current = true
    setShowScrollDown(false)
  }

  // Images change row height *after* their <img> finishes loading, so the
  // initial scroll-on-append isn't enough. If the user was at the bottom
  // when the message arrived, we re-pin them after every image load. If
  // they've intentionally scrolled up to read older messages, we leave
  // their view alone.
  const handleImageLoaded = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Decide what an attachment click does based on its mime. Images open the
  // image lightbox, PDFs open the PDF preview overlay, everything else
  // triggers a programmatic download — no anchor leaving the app.
  const activateAttachment = useCallback((a: Attachment) => {
    if (!a.url) return
    if (a.mimeType.startsWith('image/')) {
      setPreviewAttachment(a)
    } else if (a.mimeType === 'application/pdf') {
      setPdfAttachment(a)
    } else {
      const link = document.createElement('a')
      link.href = a.url
      link.download = a.originalName
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
  }, [])

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await api.groups.messages(group.id, nextCursor)
      const el = scrollRef.current
      prependAnchorRef.current = el ? el.scrollHeight : null
      setMessages((prev) => [...res.messages, ...prev])
      setNextCursor(res.nextCursor)
    } finally {
      setLoadingOlder(false)
    }
  }

  // Optimistic send. The bubble appears instantly under a temporary localId
  // and is reconciled when the server returns (or the socket echoes first).
  // The composer never blocks: the user can keep typing the next message.
  async function sendBody(body: string, attachedFile: File | null) {
    if (!body && !attachedFile) return
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // For images, show the local blob URL on the optimistic bubble so the
    // user sees their picture immediately. For documents, we still preview
    // a card with name/size — no URL needed until the server returns one.
    const optimisticAttachment: Attachment | null = attachedFile
      ? {
          id: `${localId}-att`,
          originalName: attachedFile.name,
          mimeType: attachedFile.type,
          byteSize: attachedFile.size,
          url: attachedFile.type.startsWith('image/')
            ? URL.createObjectURL(attachedFile)
            : '',
        }
      : null

    const optimistic: LocalMessage = {
      id: localId,
      localId,
      authorId: currentUserId,
      authorName: '',
      body,
      createdAt: new Date().toISOString(),
      pending: true,
      attachments: optimisticAttachment ? [optimisticAttachment] : undefined,
      pendingFile: attachedFile ?? undefined,
    }
    setMessages((prev) => [...prev, optimistic])
    nearBottomRef.current = true

    try {
      const res = await api.groups.postMessage(group.id, body, attachedFile)
      setMessages((prev) => {
        // If the socket beat the POST and already added the real message,
        // drop the optimistic. Otherwise swap it in place.
        if (prev.some((m) => m.id === res.message.id)) {
          return prev.filter((m) => m.id !== localId)
        }
        return prev.map((m) => (m.id === localId ? res.message : m))
      })
      // Revoke the optimistic blob URL — the bubble now uses the server URL.
      if (optimisticAttachment?.url.startsWith('blob:')) {
        URL.revokeObjectURL(optimisticAttachment.url)
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, pending: false, failed: true } : m)),
      )
      if (err instanceof ApiError) {
        if (err.code === 'too_many_requests') {
          setError('Slow down — too many messages.')
        } else if (err.code === 'image_too_large' || err.code === 'file_too_large') {
          setError('That file is too large.')
        }
      }
    }
  }

  function send() {
    const body = text.trim()
    const f = file
    if (!body && !f) return
    setText('')
    setFile(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    void sendBody(body, f)
  }

  function retry(localId: string, body: string, attachedFile: File | null) {
    setMessages((prev) => prev.filter((m) => m.id !== localId))
    void sendBody(body, attachedFile)
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (!picked) return
    const isImage = picked.type.startsWith('image/')
    const cap = isImage ? MAX_IMAGE_BYTES : MAX_DOC_BYTES
    if (picked.size > cap) {
      setError(isImage ? 'Image too large (max 10MB).' : 'File too large (max 25MB).')
      e.target.value = ''
      return
    }
    setFile(picked)
    setError(null)
  }

  function removeFile() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // The paperclip opens a small popover so the user picks which kind of
  // file to attach; the OS picker is then narrowed accordingly (so a
  // "Photos" pick doesn't surface PDFs and vice-versa).
  function pickKind(accept: string) {
    setAttachMenuOpen(false)
    const input = fileInputRef.current
    if (!input) return
    input.accept = accept
    input.click()
  }

  // Outside-click + Esc close for the attach menu.
  useEffect(() => {
    if (!attachMenuOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (attachMenuRef.current && !attachMenuRef.current.contains(t)) {
        setAttachMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAttachMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [attachMenuOpen])

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const subtitle =
    group.type === 'vehicle'
      ? group.meta.trip ?? `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`
      : (group.directPeer?.workspace ?? 'Direct message')

  return (
    <>
      {/* Header */}
      <header className="h-[var(--header-height)] flex items-center justify-between px-5 border-b border-white/[0.06] bg-rail shrink-0">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold truncate">{groupLabel(group)}</div>
          <div className="text-[11px] text-muted truncate">{subtitle}</div>
        </div>
        {group.type === 'vehicle' && group.meta.plate && (
          <span className="font-mono text-[11px] text-muted border border-white/[0.08] rounded-chip px-2 py-0.5 shrink-0">
            {group.meta.plate}
          </span>
        )}
      </header>

      {pdfAttachment ? (
        <InlinePdfPreview
          attachment={pdfAttachment}
          onClose={() => setPdfAttachment(null)}
        />
      ) : (
        <>
      {/* Messages — wrapped in a relative container so the floating
          scroll-to-latest button can overlay the scroll area without
          scrolling along with the content. */}
      <div className="flex-1 flex flex-col relative min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto w-full xl:max-w-[1280px] 2xl:max-w-[1440px] min-[1700px]:max-w-[1560px]">
          {loading ? (
            <div className="text-[12px] text-faint">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-[12.5px] text-faint">No messages yet. Say something.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {nextCursor && (
                <div className="flex justify-center pb-3">
                  <button
                    onClick={loadOlder}
                    disabled={loadingOlder}
                    className="text-[11.5px] text-muted hover:text-text border border-white/[0.10] rounded-chip px-3 py-1 transition-colors disabled:opacity-50"
                  >
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              )}
              {messages.map((m, i) => {
                const next = messages[i + 1]
                // Hide the timestamp on any message that's immediately
                // followed by another from the same sender within the same
                // calendar minute. Only the last message of such a run keeps
                // its timestamp, like WhatsApp.
                const lastInMinuteGroup =
                  !next ||
                  next.authorId !== m.authorId ||
                  minuteKey(next.createdAt) !== minuteKey(m.createdAt)
                return (
                  <MessageRow
                    key={m.id}
                    message={m}
                    mine={m.authorId === currentUserId}
                    prev={messages[i - 1]}
                    onRetry={retry}
                    showTimestamp={lastInMinuteGroup}
                    onActivateAttachment={activateAttachment}
                    onImageLoad={handleImageLoaded}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to latest messages"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-surface border border-white/[0.10] text-text hover:bg-surface-2 hover:border-white/[0.20] flex items-center justify-center transition-colors shadow-[0_4px_14px_rgba(0,0,0,0.55)]"
          >
            <ArrowDown size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="px-5 pb-4 pt-1 shrink-0">
        <div className="mx-auto w-full xl:max-w-[1280px] 2xl:max-w-[1440px] min-[1700px]:max-w-[1560px]">
          {error && <div className="text-[11.5px] text-alert mb-1.5">{error}</div>}
          <div className="rounded-card border border-white/[0.08] bg-white/[0.02] focus-within:border-white/[0.16] transition-colors">
            {file && (
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
              <div className="relative shrink-0" ref={attachMenuRef}>
                <button
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  aria-label="Attach"
                  aria-haspopup="menu"
                  aria-expanded={attachMenuOpen}
                  className={`h-7 w-7 flex items-center justify-center rounded-chip transition-colors ${
                    attachMenuOpen
                      ? 'text-text bg-white/[0.06]'
                      : 'text-muted hover:text-text hover:bg-white/[0.04]'
                  }`}
                >
                  <Paperclip size={15} strokeWidth={1.8} />
                </button>
                {attachMenuOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-[calc(100%+6px)] left-0 w-[180px] rounded-card border border-white/[0.08] bg-surface overflow-hidden z-20 py-1"
                  >
                    <AttachMenuItem
                      icon={<ImageIcon size={14} strokeWidth={1.6} />}
                      onClick={() => pickKind(IMAGE_ACCEPT)}
                    >
                      Photos
                    </AttachMenuItem>
                    <AttachMenuItem
                      icon={<FileText size={14} strokeWidth={1.6} />}
                      onClick={() => pickKind(DOC_ACCEPT)}
                    >
                      Documents
                    </AttachMenuItem>
                  </div>
                )}
              </div>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={1}
                placeholder={`Message ${groupLabel(group)}`}
                className="flex-1 bg-transparent text-[length:var(--chat-msg-font-size)] leading-[1.5] outline-none resize-none placeholder:text-faint overflow-y-auto max-h-[9em] py-1"
              />
              <button
                onClick={send}
                disabled={!text.trim() && !file}
                aria-label="Send message"
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-chip bg-text text-bg transition-opacity disabled:opacity-30"
              >
                <ArrowUp size={15} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </div>
      </div>

        </>
      )}

      {previewAttachment && (
        <ImagePreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </>
  )
}

function MessageRow({
  message,
  mine,
  prev,
  onRetry,
  showTimestamp,
  onActivateAttachment,
  onImageLoad,
}: {
  message: LocalMessage
  mine: boolean
  prev?: LocalMessage
  onRetry: (localId: string, body: string, file: File | null) => void
  showTimestamp: boolean
  onActivateAttachment: (attachment: Attachment) => void
  onImageLoad: () => void
}) {
  // Collapse the author line when the previous message is from the same
  // author within a couple of minutes — keeps bursts readable.
  const sameAuthorAsPrev =
    prev !== undefined &&
    prev.authorId === message.authorId &&
    new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < 4 * 60 * 1000

  const showDayDivider =
    prev === undefined ||
    new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  const failed = message.failed === true

  // 78% keeps bubbles narrower than the column on small screens; the absolute
  // 640px cap keeps them comfortably readable when the column gets wider on
  // 2K+ monitors. CSS min() picks whichever is smaller at the current width.
  // Font size comes from --chat-msg-font-size so it scales with the display.
  const bubbleBase =
    'max-w-[min(78%,640px)] px-3 pt-1.5 pb-1 text-[length:var(--chat-msg-font-size)] leading-[1.5] flex flex-col text-text'
  const bubbleSkin = mine
    ? failed
      ? 'bg-[#222225] border border-alert/50 rounded-[7px] rounded-br-[2px]'
      : 'bg-[#222225] border border-white/[0.06] rounded-[7px] rounded-br-[2px]'
    : 'bg-surface border border-white/[0.08] rounded-[7px] rounded-bl-[2px]'

  return (
    <>
      {showDayDivider && (
        <div className="flex items-center gap-3 py-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="eyebrow">{formatDay(message.createdAt)}</span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>
      )}
      <div className={`flex ${sameAuthorAsPrev ? 'mt-0.5' : 'mt-2.5'}`}>
        {!mine && (
          // Fixed-width avatar slot: shows the initials circle on the first
          // message of a burst, stays empty (but reserved) on grouped follow-ups
          // so bubbles stay aligned under the avatar.
          <div className="w-9 mr-2.5 shrink-0">
            {!sameAuthorAsPrev && (
              <div className="h-9 w-9 rounded-full bg-active/30 border border-active/40 flex items-center justify-center text-[11.5px] font-semibold uppercase font-mono">
                {initials(message.authorName)}
              </div>
            )}
          </div>
        )}
        <div className={`flex-1 min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {!mine && !sameAuthorAsPrev && (
            <div className="text-[11px] text-muted mb-1 px-1">{message.authorName}</div>
          )}
          <div className={`${bubbleBase} ${bubbleSkin}`}>
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-1">
                {message.attachments.map((a) => (
                  <AttachmentBlock
                    key={a.id}
                    attachment={a}
                    onActivate={onActivateAttachment}
                    onImageLoad={onImageLoad}
                  />
                ))}
              </div>
            )}
            {message.body && (
              <span className="whitespace-pre-wrap break-words">{message.body}</span>
            )}
            {(failed || showTimestamp) && (
              <span className="text-[10.5px] text-muted leading-none mt-1 self-end">
                {failed ? 'Failed' : formatTime(message.createdAt)}
              </span>
            )}
          </div>
          {failed && mine && message.localId && (
            <button
              onClick={() =>
                onRetry(message.localId!, message.body, message.pendingFile ?? null)
              }
              className="text-[10.5px] text-alert hover:text-text transition-colors mt-1 px-1"
            >
              Tap to retry
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}

// Truncate to the minute (UTC ms / 60000) so two messages with different
// seconds within the same calendar minute compare equal. Used to collapse
// timestamps inside bursts.
function minuteKey(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 60000)
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Pick a sensible lucide icon for a document's mime type. Keeps the surface
// modest — three buckets is enough until we add previewing.
function DocIcon({ mime }: { mime: string }) {
  if (mime === 'application/pdf' || mime === 'text/plain') {
    return <FileText size={15} strokeWidth={1.6} className="text-muted" />
  }
  if (
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return <FileSpreadsheet size={15} strokeWidth={1.6} className="text-muted" />
  }
  if (mime.startsWith('image/')) {
    return <ImageIcon size={15} strokeWidth={1.6} className="text-muted" />
  }
  return <FileIcon size={15} strokeWidth={1.6} className="text-muted" />
}

// In-bubble attachment renderer. Every attachment is a themed button — the
// parent's `onActivate` callback decides what to do (image → lightbox,
// pdf → preview overlay, other → download). No raw <a target="_blank">
// anywhere, so attachments don't look like browser links.
//
// The optimistic path may pass a blob URL — that just works for images and
// renders a card without a working action for docs (button is disabled
// until the real URL arrives a beat later via the server reconcile).
function AttachmentBlock({
  attachment,
  onActivate,
  onImageLoad,
}: {
  attachment: Attachment
  onActivate: (a: Attachment) => void
  onImageLoad: () => void
}) {
  const isImage = attachment.mimeType.startsWith('image/')
  const isPdf = attachment.mimeType === 'application/pdf'
  const hasUrl = Boolean(attachment.url)

  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onActivate(attachment)}
        aria-label={`Open ${attachment.originalName}`}
        className="block p-0 border-0 bg-transparent cursor-zoom-in"
      >
        <img
          src={attachment.url}
          alt={attachment.originalName}
          onLoad={onImageLoad}
          className="max-w-full max-h-[320px] rounded-card border border-white/[0.08] object-contain bg-bg"
        />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onActivate(attachment)}
      disabled={!hasUrl}
      aria-label={isPdf ? `Preview ${attachment.originalName}` : `Download ${attachment.originalName}`}
      className="flex items-center gap-2.5 rounded-card border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 max-w-[360px] hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-default transition-colors text-left"
    >
      <div className="h-9 w-9 rounded-chip border border-white/[0.10] bg-white/[0.03] flex items-center justify-center shrink-0">
        <DocIcon mime={attachment.mimeType} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-text truncate">{attachment.originalName}</div>
        <div className="text-[10.5px] text-muted">{formatBytes(attachment.byteSize)}</div>
      </div>
      {hasUrl && (
        isPdf ? (
          <Eye size={14} strokeWidth={1.6} className="text-muted shrink-0" />
        ) : (
          <Download size={14} strokeWidth={1.6} className="text-muted shrink-0" />
        )
      )}
    </button>
  )
}

function AttachMenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-white/[0.03] transition-colors text-left"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  )
}

// In-composer preview row. Sits above the textarea inside the composer card
// and reserves a remove-button so the user can drop the staged file before
// sending.
function ComposerAttachmentPreview({
  file,
  previewUrl,
  onRemove,
}: {
  file: File
  previewUrl: string | null
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.06]">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={file.name}
          className="h-10 w-10 rounded-chip object-cover shrink-0 border border-white/[0.10]"
        />
      ) : (
        <div className="h-10 w-10 rounded-chip border border-white/[0.10] bg-white/[0.03] flex items-center justify-center shrink-0">
          <DocIcon mime={file.type} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-text truncate">{file.name}</div>
        <div className="text-[10.5px] text-muted">{formatBytes(file.size)}</div>
      </div>
      <button
        onClick={onRemove}
        aria-label="Remove attachment"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors"
      >
        <X size={13} strokeWidth={1.8} />
      </button>
    </div>
  )
}
