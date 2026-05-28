import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { IncomingMessage, Message } from '../lib/types'
import type { LocalMessage } from '../components/messages/types'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'

// Session-level, in-memory message cache. Keyed by group id so switching back
// to a previously opened (or prefetched) conversation renders instantly while
// the latest messages are revalidated in the background — stale-while-
// revalidate. Nothing is persisted to disk; the cache lives for the tab.
export type Thread = {
  messages: LocalMessage[]
  nextCursor: string | null
  // True once a full latest-page fetch (or prefetch) has completed at least
  // once. Drives whether a freshly opened group shows the blocking loader.
  loaded: boolean
  // A background refresh is in flight.
  revalidating: boolean
}

type Threads = Record<string, Thread>

export type MessageCache = {
  threads: Threads
  hasThread: (groupId: string) => boolean
  // Seed / replace a thread from a fresh latest-page fetch (sets nextCursor +
  // marks loaded). Merges with anything already there so in-flight optimistic
  // messages and socket arrivals aren't lost.
  setThreadMessages: (groupId: string, messages: Message[], nextCursor: string | null) => void
  // Background revalidation: fold the latest page into the existing thread
  // without touching nextCursor (we keep whatever older boundary pagination
  // reached).
  mergeThreadMessages: (groupId: string, incoming: Message[]) => void
  // Pagination: prepend an older page and move the older boundary deeper.
  prependOlderMessages: (groupId: string, older: Message[], nextCursor: string | null) => void
  upsertMessage: (groupId: string, message: LocalMessage) => void
  patchMessage: (groupId: string, id: string, patch: Partial<LocalMessage>) => void
  // Swap an optimistic message (fromId) for the server's real one.
  replaceMessage: (groupId: string, fromId: string, message: LocalMessage) => void
  removeMessage: (groupId: string, id: string) => void
  setRevalidating: (groupId: string, value: boolean) => void
  // Revoke + strip the local blob previews in a thread (call on chat unmount).
  clearThreadPreviews: (groupId: string) => void
  // Background-load a group's latest page if it isn't already cached/loading.
  prefetch: (groupId: string) => void
}

const EMPTY_THREAD: Thread = {
  messages: [],
  nextCursor: null,
  loaded: false,
  revalidating: false,
}

// Merge two cached versions of the SAME message id (e.g. our folded local copy
// + a later server echo / revalidate). Server payloads don't carry the
// client-only fields, so preserve `localId` and any attachment `localPreviewUrl`
// from the version we already had — otherwise the just-sent image would lose its
// flicker-free local preview on the next merge.
function mergeSameId(prev: LocalMessage, next: LocalMessage): LocalMessage {
  const merged: LocalMessage = { ...prev, ...next, localId: next.localId ?? prev.localId }
  if (prev.attachments && merged.attachments) {
    merged.attachments = merged.attachments.map((a, i) => {
      const pa = prev.attachments![i]
      return pa?.localPreviewUrl && !a.localPreviewUrl
        ? { ...a, localPreviewUrl: pa.localPreviewUrl }
        : a
    })
  }
  return merged
}

// Fold an optimistic message into its real server echo: keep the optimistic
// `localId` (so React reuses the same row across reconcile — no remount/flash)
// and carry its local image blob onto the real attachment as `localPreviewUrl`
// so the just-sent image keeps showing the already-decoded local bytes instead
// of refetching the server URL.
function foldOptimistic(real: LocalMessage, optimistic: LocalMessage): LocalMessage {
  const blob = optimistic.attachments?.find((a) => a.url?.startsWith('blob:'))?.url
  return {
    ...real,
    localId: optimistic.localId ?? real.localId,
    attachments:
      blob && real.attachments
        ? real.attachments.map((a, i) =>
            i === 0 && a.mimeType.startsWith('image/') ? { ...a, localPreviewUrl: blob } : a,
          )
        : real.attachments,
  }
}

// Dedupe by id (later wins, fields merged); reconcile any pending optimistic
// message with its real server echo (same author + body) by folding the
// optimistic's stable key + local preview onto the real one and dropping the
// optimistic; keep the list sorted by createdAt ascending (stable).
function normalize(list: LocalMessage[], currentUserId: string): LocalMessage[] {
  const byId = new Map<string, LocalMessage>()
  for (const m of list) {
    const prev = byId.get(m.id)
    byId.set(m.id, prev ? mergeSameId(prev, m) : m)
  }
  let out = Array.from(byId.values())

  const optimistic = out.filter((m) => m.pending && m.authorId === currentUserId)
  if (optimistic.length) {
    const folded = new Set<string>()
    out = out.map((m) => {
      if (m.pending || m.authorId !== currentUserId) return m
      const opt = optimistic.find((o) => !folded.has(o.id) && o.body === m.body)
      if (!opt) return m
      folded.add(opt.id)
      return foldOptimistic(m, opt)
    })
    out = out.filter((m) => !folded.has(m.id))
  }

  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return out
}

// Revoke any blob: object URL hanging off a message's attachments.
function revokeMessageBlobs(m: LocalMessage) {
  for (const a of m.attachments ?? []) {
    if (a.localPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.localPreviewUrl)
    if (a.url?.startsWith('blob:')) URL.revokeObjectURL(a.url)
  }
}

const Ctx = createContext<MessageCache | null>(null)

export function MessageCacheProvider({
  userId,
  children,
}: {
  userId: string
  children: ReactNode
}) {
  const [threads, setThreads] = useState<Threads>({})

  // Latest values mirrored into refs so the stable callbacks below can read
  // current state without being torn down/recreated on every change.
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const prefetchingRef = useRef<Set<string>>(new Set())

  const update = useCallback((groupId: string, fn: (t: Thread) => Thread) => {
    setThreads((prev) => {
      const current = prev[groupId] ?? EMPTY_THREAD
      const next = fn(current)
      if (next === current) return prev
      return { ...prev, [groupId]: next }
    })
  }, [])

  const setThreadMessages = useCallback(
    (groupId: string, messages: Message[], nextCursor: string | null) => {
      update(groupId, (t) => ({
        ...t,
        messages: normalize([...t.messages, ...(messages as LocalMessage[])], userIdRef.current),
        nextCursor,
        loaded: true,
      }))
    },
    [update],
  )

  const mergeThreadMessages = useCallback(
    (groupId: string, incoming: Message[]) => {
      update(groupId, (t) => ({
        ...t,
        messages: normalize([...t.messages, ...(incoming as LocalMessage[])], userIdRef.current),
      }))
    },
    [update],
  )

  const prependOlderMessages = useCallback(
    (groupId: string, older: Message[], nextCursor: string | null) => {
      update(groupId, (t) => ({
        ...t,
        messages: normalize([...(older as LocalMessage[]), ...t.messages], userIdRef.current),
        nextCursor,
      }))
    },
    [update],
  )

  const upsertMessage = useCallback(
    (groupId: string, message: LocalMessage) => {
      update(groupId, (t) => ({
        ...t,
        messages: normalize([...t.messages, message], userIdRef.current),
      }))
    },
    [update],
  )

  const patchMessage = useCallback(
    (groupId: string, id: string, patch: Partial<LocalMessage>) => {
      update(groupId, (t) => {
        if (!t.messages.some((m) => m.id === id)) return t
        return { ...t, messages: t.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }
      })
    },
    [update],
  )

  const replaceMessage = useCallback(
    (groupId: string, fromId: string, message: LocalMessage) => {
      update(groupId, (t) => {
        const optimistic = t.messages.find((m) => m.id === fromId)
        // Carry the optimistic's stable key + local image preview onto the real
        // message so the row reconciles in place with no flicker.
        const real = optimistic ? foldOptimistic(message, optimistic) : message
        // If the socket already delivered the real message, just drop the
        // optimistic placeholder; otherwise swap it in place.
        const hasReal = t.messages.some((m) => m.id === message.id)
        const list = hasReal
          ? t.messages.filter((m) => m.id !== fromId)
          : t.messages.map((m) => (m.id === fromId ? real : m))
        return { ...t, messages: normalize(list, userIdRef.current) }
      })
    },
    [update],
  )

  const removeMessage = useCallback(
    (groupId: string, id: string) => {
      update(groupId, (t) => {
        const target = t.messages.find((m) => m.id === id)
        if (!target) return t
        revokeMessageBlobs(target)
        return { ...t, messages: t.messages.filter((m) => m.id !== id) }
      })
    },
    [update],
  )

  // Revoke + strip all local blob previews in a thread. Called when the chat
  // view unmounts (group switch / sign out): freed bytes that the just-sent
  // images no longer need, and on a later revisit the rows fall back to the
  // server URL.
  const clearThreadPreviews = useCallback(
    (groupId: string) => {
      update(groupId, (t) => {
        let touched = false
        const messages = t.messages.map((m) => {
          if (!m.attachments?.some((a) => a.localPreviewUrl)) return m
          touched = true
          return {
            ...m,
            attachments: m.attachments.map((a) => {
              if (a.localPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.localPreviewUrl)
              return a.localPreviewUrl ? { ...a, localPreviewUrl: undefined } : a
            }),
          }
        })
        return touched ? { ...t, messages } : t
      })
    },
    [update],
  )

  const setRevalidating = useCallback(
    (groupId: string, value: boolean) => {
      update(groupId, (t) => (t.revalidating === value ? t : { ...t, revalidating: value }))
    },
    [update],
  )

  const hasThread = useCallback((groupId: string) => Boolean(threadsRef.current[groupId]?.loaded), [])

  const prefetch = useCallback(
    (groupId: string) => {
      if (threadsRef.current[groupId]?.loaded) return
      if (prefetchingRef.current.has(groupId)) return
      prefetchingRef.current.add(groupId)
      api.groups
        .messages(groupId)
        .then((res) => setThreadMessages(groupId, res.messages, res.nextCursor))
        .catch(() => {})
        .finally(() => prefetchingRef.current.delete(groupId))
    },
    [setThreadMessages],
  )

  // Global live updates. Mounted once for the session, so the cache stays
  // fresh for every group — selected or not.
  useEffect(() => {
    const socket = getSocket()
    function onNew(msg: IncomingMessage) {
      upsertMessage(msg.groupId, msg as LocalMessage)
    }
    function onEdited(p: { id: string; groupId: string; body: string; editedAt: string }) {
      patchMessage(p.groupId, p.id, { body: p.body, editedAt: p.editedAt })
    }
    function onDeleted(p: {
      id: string
      groupId: string
      deletedAt: string
      deletedBy: string
    }) {
      patchMessage(p.groupId, p.id, {
        body: '',
        attachments: [],
        deletedAt: p.deletedAt,
        deletedBy: p.deletedBy,
      })
    }
    function onHidden(p: { groupId: string; id: string }) {
      removeMessage(p.groupId, p.id)
    }
    socket.on('message:new', onNew)
    socket.on('message:edited', onEdited)
    socket.on('message:deleted', onDeleted)
    socket.on('message:hidden', onHidden)
    return () => {
      socket.off('message:new', onNew)
      socket.off('message:edited', onEdited)
      socket.off('message:deleted', onDeleted)
      socket.off('message:hidden', onHidden)
    }
  }, [upsertMessage, patchMessage, removeMessage])

  const value = useMemo<MessageCache>(
    () => ({
      threads,
      hasThread,
      setThreadMessages,
      mergeThreadMessages,
      prependOlderMessages,
      upsertMessage,
      patchMessage,
      replaceMessage,
      removeMessage,
      setRevalidating,
      clearThreadPreviews,
      prefetch,
    }),
    [
      threads,
      hasThread,
      setThreadMessages,
      mergeThreadMessages,
      prependOlderMessages,
      upsertMessage,
      patchMessage,
      replaceMessage,
      removeMessage,
      setRevalidating,
      clearThreadPreviews,
      prefetch,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMessageCache(): MessageCache {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMessageCache must be used within MessageCacheProvider')
  return ctx
}
