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
  // Background-load a group's latest page if it isn't already cached/loading.
  prefetch: (groupId: string) => void
}

const EMPTY_THREAD: Thread = {
  messages: [],
  nextCursor: null,
  loaded: false,
  revalidating: false,
}

// Dedupe by id (later wins, fields merged), drop pending optimistic messages
// the server has already echoed (a real message from us with the same body
// exists), and keep the list sorted by createdAt ascending (stable).
function normalize(list: LocalMessage[], currentUserId: string): LocalMessage[] {
  const byId = new Map<string, LocalMessage>()
  for (const m of list) {
    const prev = byId.get(m.id)
    byId.set(m.id, prev ? { ...prev, ...m } : m)
  }
  let out = Array.from(byId.values())
  const echoedBodies = new Set(
    out.filter((m) => !m.pending && m.authorId === currentUserId).map((m) => m.body),
  )
  out = out.filter((m) => !(m.pending && m.authorId === currentUserId && echoedBodies.has(m.body)))
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return out
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
        // If the socket already delivered the real message, just drop the
        // optimistic placeholder; otherwise swap it in place.
        const hasReal = t.messages.some((m) => m.id === message.id)
        const list = hasReal
          ? t.messages.filter((m) => m.id !== fromId)
          : t.messages.map((m) => (m.id === fromId ? message : m))
        return { ...t, messages: normalize(list, userIdRef.current) }
      })
    },
    [update],
  )

  const removeMessage = useCallback(
    (groupId: string, id: string) => {
      update(groupId, (t) => {
        if (!t.messages.some((m) => m.id === id)) return t
        return { ...t, messages: t.messages.filter((m) => m.id !== id) }
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
