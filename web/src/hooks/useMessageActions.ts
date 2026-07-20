import type { Dispatch, SetStateAction } from 'react'
import { api, ApiError } from '../lib/api'
import type { ReplyToPreview } from '../lib/types'
import type { LocalMessage } from '../components/messages/types'
import { toReplyPreview } from '../components/chatViewUtils'
import { useMessageCache } from './useMessageCache'

// Message-level actions extracted from ChatView: copy, pin/unpin, the two
// delete scopes, and the private-DM flows. Each is optimistic where the
// original was — the cache is patched first and reverted on failure — and all
// failure surfaces go through `onError` / `onNotice` so ChatView keeps owning
// the chip/notice UI. Handlers are recreated per render exactly like the
// inline functions they replace; MessageRow's memo comparator deliberately
// ignores callback identity, so this changes nothing about row re-renders.
type Options = {
  groupId: string
  currentUserId: string
  // The pinned-bar state (from usePinnedMessages) — pin/unpin mirror their
  // optimistic patches into it.
  setPinned: Dispatch<SetStateAction<LocalMessage[]>>
  onError: (msg: string) => void
  onClearError: () => void
  onNotice: (msg: string) => void
  // Navigate to (or create) a 1:1 DM — same contract as ChatView's prop.
  onOpenDirectMessage: (
    info: { groupId: string; peerId: string; peerName: string },
    reply?: ReplyToPreview,
  ) => void
}

export function useMessageActions({
  groupId,
  currentUserId,
  setPinned,
  onError,
  onClearError,
  onNotice,
  onOpenDirectMessage,
}: Options) {
  const cache = useMessageCache()

  function copyMessage(m: LocalMessage) {
    if (!m.body) return
    navigator.clipboard
      .writeText(m.body)
      .then(() => onNotice('Copied to clipboard.'))
      .catch(() => onError('Could not copy message.'))
  }

  // Optimistically reflect the pin (bubble indicator via cache + bar) and
  // reconcile with the server's authoritative message; revert on failure.
  async function pinMessage(m: LocalMessage) {
    const stampedAt = new Date().toISOString()
    cache.patchMessage(groupId, m.id, { pinnedAt: stampedAt, pinnedBy: currentUserId })
    setPinned((prev) => [
      { ...m, pinnedAt: stampedAt, pinnedBy: currentUserId },
      ...prev.filter((p) => p.id !== m.id),
    ])
    try {
      const { message } = await api.groups.pin(groupId, m.id)
      cache.patchMessage(groupId, m.id, {
        pinnedAt: message.pinnedAt,
        pinnedBy: message.pinnedBy,
      })
      setPinned((prev) => [
        message as LocalMessage,
        ...prev.filter((p) => p.id !== m.id),
      ])
    } catch {
      cache.patchMessage(groupId, m.id, { pinnedAt: null, pinnedBy: null })
      setPinned((prev) => prev.filter((p) => p.id !== m.id))
      onError('Could not pin message.')
    }
  }

  async function unpinMessage(m: LocalMessage) {
    cache.patchMessage(groupId, m.id, { pinnedAt: null, pinnedBy: null })
    setPinned((prev) => prev.filter((p) => p.id !== m.id))
    try {
      await api.groups.unpin(groupId, m.id)
    } catch {
      cache.patchMessage(groupId, m.id, { pinnedAt: m.pinnedAt, pinnedBy: m.pinnedBy })
      setPinned((prev) =>
        prev.some((p) => p.id === m.id) ? prev : [m, ...prev],
      )
      onError('Could not unpin message.')
    }
  }

  async function deleteForEveryone(m: LocalMessage) {
    const original = { body: m.body, attachments: m.attachments }
    cache.patchMessage(groupId, m.id, {
      body: '',
      attachments: [],
      deletedAt: new Date().toISOString(),
      deletedBy: currentUserId,
    })
    try {
      await api.groups.deleteForEveryone(groupId, m.id)
    } catch {
      cache.patchMessage(groupId, m.id, {
        body: original.body,
        attachments: original.attachments,
        deletedAt: null,
        deletedBy: null,
      })
      onError('Could not delete message.')
    }
  }

  // Hide a single message for the current user only. Optimistically remove it;
  // re-insert (normalize re-sorts it back into place) if the request fails.
  async function deleteForMe(m: LocalMessage) {
    cache.removeMessage(groupId, m.id)
    try {
      await api.groups.deleteForMe(groupId, m.id)
    } catch {
      cache.upsertMessage(groupId, m)
      onError('Could not delete message.')
    }
  }

  // Open (or reuse) a private DM with a message's author. Connection rules are
  // enforced server-side by createDirect. When `reply` is passed (from "Reply
  // privately") the quote is carried into the destination DM's composer.
  async function openPrivate(m: LocalMessage, reply?: ReplyToPreview) {
    onClearError()
    try {
      const { group: dm } = await api.groups.createDirect(m.authorId)
      onOpenDirectMessage({ groupId: dm.id, peerId: m.authorId, peerName: m.authorName }, reply)
    } catch (err) {
      onError(
        err instanceof ApiError && err.code === 'connection_required'
          ? 'Connect with this person before messaging.'
          : 'Could not open a private conversation.',
      )
    }
  }

  // "Reply privately": open a DM with the author and carry the quoted message
  // as reply context. If the DM already exists this just navigates to it with
  // the composer pre-seeded.
  function replyPrivately(m: LocalMessage) {
    void openPrivate(m, toReplyPreview(m))
  }

  // "Send message in private": same DM, no quote.
  function sendPrivate(m: LocalMessage) {
    void openPrivate(m)
  }

  return {
    copyMessage,
    pinMessage,
    unpinMessage,
    deleteForEveryone,
    deleteForMe,
    replyPrivately,
    sendPrivate,
  }
}
