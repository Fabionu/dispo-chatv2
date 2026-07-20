import { api, ApiError } from '../lib/api'
import type { Attachment, GroupMember, ReplyToPreview } from '../lib/types'
import type { LocalMessage } from '../components/messages/types'
import { resolveMentionIds } from '../lib/mentions'
import { devlog } from '../lib/devlog'
import { useMessageCache } from './useMessageCache'

// The optimistic send pipeline extracted from ChatView: build the optimistic
// bubble (incl. the local blob preview for images), pin the viewport, upsert,
// POST, then reconcile with the server message — or mark the bubble failed so
// it can be retried. Behavior is a pure move from ChatView; the composer-state
// orchestration (clearing text/reply/draft) stays in ChatView's thin `send` /
// `sendPendingFile` wrappers, which call `sendBody` with everything resolved.
type Options = {
  groupId: string
  currentUserId: string
  // Current roster — used to resolve optimistic mention highlights.
  members: GroupMember[]
  // useChatScroll's "force the viewport to the bottom on the next insert".
  pinToBottomNext: () => void
  onError: (msg: string) => void
}

export function useSendMessage({
  groupId,
  currentUserId,
  members,
  pinToBottomNext,
  onError,
}: Options) {
  const cache = useMessageCache()

  async function sendBody(
    body: string,
    attachedFile: File | null,
    replyTo: ReplyToPreview | null,
    mentionUserIds: string[] = [],
  ) {
    if (!body && !attachedFile) return
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Optimistic mentions: highlight the typed @Names immediately, before the
    // server echoes the canonical list back.
    const optimisticMentions = mentionUserIds.length
      ? members
          .filter((m) => mentionUserIds.includes(m.id))
          .map((m) => ({ userId: m.id, displayName: m.displayName }))
      : undefined

    // For images, show the local blob URL on the optimistic bubble so the
    // user sees their picture immediately. For documents, we still preview
    // a card with name/size — no URL needed until the server returns one.
    const isImg = attachedFile?.type.startsWith('image/') ?? false
    // One decoded blob URL, used for BOTH the optimistic bubble (via
    // localPreviewUrl) and carried onto the real message by foldOptimistic (via
    // url). Same src string before/after the optimistic→real swap → the image
    // never refetches from the server, so there's no post-upload reload flicker.
    const blobUrl = attachedFile && isImg ? URL.createObjectURL(attachedFile) : ''
    const optimisticAttachment: Attachment | null = attachedFile
      ? {
          id: `${localId}-att`,
          originalName: attachedFile.name,
          mimeType: attachedFile.type,
          byteSize: attachedFile.size,
          url: blobUrl,
          ...(isImg ? { localPreviewUrl: blobUrl } : {}),
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
      replyTo: replyTo,
      mentions: optimisticMentions,
    }
    // Pin BEFORE inserting so the layout effect for this very insert forces the
    // viewport to the bottom — the user sees their own message (and an image's
    // reserved box) immediately, not after the upload completes. The upsert is
    // synchronous and the upload below is async (fetch), so React paints the
    // optimistic bubble before any network work — no manual defer needed.
    pinToBottomNext()
    cache.upsertMessage(groupId, optimistic)
    devlog('optimistic insert', { localId, hasFile: Boolean(attachedFile) })

    try {
      devlog('upload start', { localId, hasFile: Boolean(attachedFile) })
      const res = await api.groups.postMessage(
        groupId,
        body,
        attachedFile,
        replyTo?.id ?? null,
        mentionUserIds,
      )
      devlog('upload finished → replaceMessage', { localId })
      // replaceMessage swaps the optimistic for the real one (or drops it if
      // the socket already delivered the real message), carrying the local
      // blob preview onto the real attachment so the image doesn't flicker.
      // The blob is revoked later — on conversation unmount or message removal.
      cache.replaceMessage(groupId, localId, res.message)
    } catch (err) {
      cache.patchMessage(groupId, localId, { pending: false, failed: true })
      if (err instanceof ApiError) {
        if (err.code === 'too_many_requests') {
          onError('Slow down — too many messages.')
        } else if (err.code === 'image_too_large' || err.code === 'file_too_large') {
          onError('That file is too large.')
        }
      }
    }
  }

  // Re-send a failed optimistic bubble: drop it and run the same pipeline again.
  function retry(localId: string, body: string, attachedFile: File | null) {
    cache.removeMessage(groupId, localId)
    void sendBody(body, attachedFile, null, resolveMentionIds(body, members))
  }

  return { sendBody, retry }
}
