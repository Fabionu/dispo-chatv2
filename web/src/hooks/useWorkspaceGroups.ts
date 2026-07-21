import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { api } from '../lib/api'
import type { Group, IncomingMessage } from '../lib/types'
import { groupHasUnread, groupLabel } from '../lib/types'
import { getSocket } from '../lib/socket'
import { byRecent } from '../pages/workspaceUtils'
import { playNotificationSound } from '../lib/notificationSound'
import { showIncomingMessageNotification } from '../lib/browserNotifications'

// The sidebar's conversation-list state, extracted from Workspace: the groups
// array, its socket-driven live sync, and every per-conversation pref action
// (pin/archive/mute/read/unread/delete-for-me). Selection stays owned by
// Workspace — the hook reads the currently-open group through `openGroupIdRef`
// (a render-mirrored ref, so the one-time socket subscription sees the live
// value) and asks Workspace to deselect via `onOpenGroupGone` when the open
// conversation is removed or hidden.
type Options = {
  userId: string
  openGroupIdRef: MutableRefObject<string | null>
  onOpenGroupGone: () => void
  onNotificationOpen?: (groupId: string) => void
}

export function useWorkspaceGroups({
  userId,
  openGroupIdRef,
  onOpenGroupGone,
  onNotificationOpen,
}: Options) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  const refreshGroups = useCallback(async () => {
    try {
      const { groups } = await api.groups.list()
      setGroups([...groups].sort(byRecent))
    } catch (err) {
      // A failed groups fetch must never silently EMPTY the rail (which would
      // hide every conversation + cross-workspace contact and leave the list
      // looking broken). Keep whatever's already shown and surface the error for
      // diagnosis — same graceful-degradation as the contacts roster.
      console.error('Failed to refresh conversations', err)
    }
  }, [])

  useEffect(() => {
    refreshGroups().finally(() => setLoadingGroups(false))
  }, [refreshGroups])

  // Drop a group into local state immediately (rail row appears instantly even
  // on slow connections), then reconcile against the server in the background.
  const insertGroup = useCallback(
    (group: Group) => {
      setGroups((prev) => {
        if (prev.some((g) => g.id === group.id)) return prev
        return [group, ...prev].sort(byRecent)
      })
      void refreshGroups()
    },
    [refreshGroups],
  )

  // Merge a partial update into a single group's record (name / plates / image
  // flag), so an in-chat group-info edit reflects in the header and rail
  // immediately without a refetch.
  const patchGroup = useCallback((groupId: string, partial: Partial<Group>) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...partial } : g)))
  }, [])

  // Patch a single group's lastReadAt + clear its unread counter locally so the
  // badge clears without a full refetch.
  const markGroupRead = useCallback((groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, lastReadAt: new Date().toISOString(), unreadCount: 0, unreadMentionCount: 0 }
          : g,
      ),
    )
  }, [])

  // ── Socket: keep the rail in sync ──────────────────────────────────────────
  // A new message bumps its group to the top (and marks it unread unless it's
  // the open one). A new group prompts a refetch — cheap, and avoids partial
  // state.
  useEffect(() => {
    const socket = getSocket()

    function onMessageNew(msg: IncomingMessage) {
      const targetGroup = groupsRef.current.find((group) => group.id === msg.groupId)
      if (msg.authorId !== userId && !targetGroup?.muted) {
        void playNotificationSound()
        showIncomingMessageNotification({
          title:
            targetGroup?.type === 'vehicle'
              ? `${msg.authorName} · ${groupLabel(targetGroup)}`
              : msg.authorName || 'New message',
          body:
            msg.body.trim() ||
            ((msg.attachments?.length ?? 0) > 0 ? 'Sent an attachment' : 'New message'),
          groupId: msg.groupId,
          onClick: () => onNotificationOpen?.(msg.groupId),
        })
      }
      setGroups((prev) => {
        const idx = prev.findIndex((g) => g.id === msg.groupId)
        if (idx === -1) {
          void refreshGroups()
          return prev
        }
        // Bump unread only for messages from others landing in a group that
        // isn't the one currently open (the open one gets marked read).
        const bumpUnread =
          msg.authorId !== userId && openGroupIdRef.current !== msg.groupId
        // A separate bump for the @-badge: only when this message mentions me.
        const bumpMention =
          bumpUnread && (msg.mentions?.some((m) => m.userId === userId) ?? false)
        const updated: Group = {
          ...prev[idx],
          lastMessageAt: msg.createdAt,
          unreadCount: (prev[idx].unreadCount ?? 0) + (bumpUnread ? 1 : 0),
          unreadMentionCount: (prev[idx].unreadMentionCount ?? 0) + (bumpMention ? 1 : 0),
          // Keep the Normal-view preview live (system rows don't arrive here).
          lastMessage: {
            body: msg.body,
            authorId: msg.authorId,
            authorName: msg.authorName,
            deleted: false,
            hasAttachments: (msg.attachments?.length ?? 0) > 0,
          },
        }
        const next = prev.filter((_, i) => i !== idx)
        next.unshift(updated)
        return next
      })
    }
    // Authoritative unread counters pushed by the server when a delete changed
    // them (delete-for-everyone decrements every member who still had the
    // message unread; delete-for-me decrements just my own, across my devices).
    // We set the exact server values rather than nudging, so the rail badge can
    // never drift. The open conversation shows 0 regardless (selected → 0).
    function onGroupUnread(p: {
      groupId: string
      unreadCount: number
      unreadMentionCount: number
    }) {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === p.groupId
            ? { ...g, unreadCount: p.unreadCount, unreadMentionCount: p.unreadMentionCount }
            : g,
        ),
      )
    }
    function onGroupAdded() {
      void refreshGroups()
    }
    // Removed from a group (kicked by an admin): refresh the rail and, if that
    // group is the one currently open, drop the selection so we don't keep
    // showing a conversation we can no longer access.
    function onGroupRemoved(p: { groupId: string }) {
      if (openGroupIdRef.current === p.groupId) onOpenGroupGone()
      void refreshGroups()
    }
    // Conversation prefs changed on another tab/device (archive/pin/mute, or a
    // "delete for me"). Keep this client in lockstep: a hide drops + deselects
    // the row; otherwise patch the per-user flags in place.
    function onGroupPrefs(p: {
      groupId: string
      archivedAt: string | null
      pinnedAt: string | null
      muted: boolean
      hiddenAt: string | null
    }) {
      if (p.hiddenAt) {
        if (openGroupIdRef.current === p.groupId) onOpenGroupGone()
        setGroups((prev) => prev.filter((g) => g.id !== p.groupId))
        return
      }
      setGroups((prev) =>
        prev.map((g) =>
          g.id === p.groupId
            ? { ...g, archivedAt: p.archivedAt, pinnedAt: p.pinnedAt, muted: p.muted }
            : g,
        ),
      )
    }

    socket.on('message:new', onMessageNew)
    socket.on('group:unread', onGroupUnread)
    socket.on('group:added', onGroupAdded)
    socket.on('group:removed', onGroupRemoved)
    socket.on('group:prefs', onGroupPrefs)
    // Socket events that occurred during an outage cannot be replayed. Once
    // transport recovers, replace the rail with the authoritative snapshot so
    // unread counts, previews, ordering, and membership cannot silently drift.
    socket.io.on('reconnect', refreshGroups)
    return () => {
      socket.off('message:new', onMessageNew)
      socket.off('group:unread', onGroupUnread)
      socket.off('group:added', onGroupAdded)
      socket.off('group:removed', onGroupRemoved)
      socket.off('group:prefs', onGroupPrefs)
      socket.io.off('reconnect', refreshGroups)
    }
    // openGroupIdRef is a stable ref; onOpenGroupGone comes from Workspace as a
    // stable useCallback.
  }, [refreshGroups, userId, openGroupIdRef, onOpenGroupGone, onNotificationOpen])

  // ── Per-conversation row actions (sidebar ⋮ menu) ─────────────────────────
  // Each applies the change OPTIMISTICALLY (patchGroup) for an instant response,
  // then persists it; on failure we refetch the rail to reconcile rather than
  // leave it drifted. All prefs are per-user (group_members, migration 0023).
  const applyPrefs = useCallback(
    async (
      groupId: string,
      optimistic: Partial<Group>,
      body: Partial<{ archived: boolean; pinned: boolean; muted: boolean }>,
    ) => {
      patchGroup(groupId, optimistic)
      try {
        await api.groups.setPrefs(groupId, body)
      } catch {
        void refreshGroups()
      }
    },
    [patchGroup, refreshGroups],
  )

  const togglePin = useCallback(
    (group: Group, pinned: boolean) =>
      void applyPrefs(group.id, { pinnedAt: pinned ? new Date().toISOString() : null }, { pinned }),
    [applyPrefs],
  )
  const toggleArchive = useCallback(
    (group: Group, archived: boolean) =>
      void applyPrefs(
        group.id,
        { archivedAt: archived ? new Date().toISOString() : null },
        { archived },
      ),
    [applyPrefs],
  )
  const toggleMute = useCallback(
    (group: Group, muted: boolean) => void applyPrefs(group.id, { muted }, { muted }),
    [applyPrefs],
  )

  const handleMarkRead = useCallback(
    async (group: Group) => {
      markGroupRead(group.id)
      try {
        await api.groups.markRead(group.id)
      } catch {
        void refreshGroups()
      }
    },
    [markGroupRead, refreshGroups],
  )
  // Mark every conversation read at once (sidebar options menu). Clears all rows
  // optimistically, then persists each previously-unread one; reconciles on
  // failure. No-op when nothing is unread.
  const handleMarkAllRead = useCallback(async () => {
    const unreadIds = groups
      .filter((g) => (g.unreadCount ?? 0) > 0 || groupHasUnread(g))
      .map((g) => g.id)
    if (!unreadIds.length) return
    setGroups((prev) =>
      prev.map((g) => ({ ...g, lastReadAt: new Date().toISOString(), unreadCount: 0, unreadMentionCount: 0 })),
    )
    try {
      await Promise.all(unreadIds.map((id) => api.groups.markRead(id)))
    } catch {
      void refreshGroups()
    }
  }, [groups, refreshGroups])

  const handleMarkUnread = useCallback(
    async (group: Group) => {
      patchGroup(group.id, { unreadCount: Math.max(group.unreadCount ?? 0, 1) })
      try {
        await api.groups.markUnread(group.id)
      } catch {
        void refreshGroups()
      }
    },
    [patchGroup, refreshGroups],
  )
  // "Delete conversation" = delete FOR ME (hidden). Never removes the group or
  // touches anyone else's view; it reappears on the next message. Drop + deselect
  // optimistically, then persist.
  const handleDeleteConversation = useCallback(
    async (group: Group) => {
      if (openGroupIdRef.current === group.id) onOpenGroupGone()
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      try {
        await api.groups.setPrefs(group.id, { hidden: true })
      } catch {
        void refreshGroups()
      }
    },
    [refreshGroups, openGroupIdRef, onOpenGroupGone],
  )

  return {
    groups,
    loadingGroups,
    refreshGroups,
    insertGroup,
    patchGroup,
    markGroupRead,
    togglePin,
    toggleArchive,
    toggleMute,
    handleMarkRead,
    handleMarkAllRead,
    handleMarkUnread,
    handleDeleteConversation,
  }
}
