import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  ChevronDown,
  CircleUser,
  LogOut,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-react'
import type { User, Workspace as WorkspaceT } from '../auth/AuthContext'
import type {
  Connection,
  ConnectionsResponse,
  ConnectionUser,
  Group,
  IncomingMessage,
  ReplyToPreview,
} from '../lib/types'
import { groupHasUnread, groupLabel, tractorPlate } from '../lib/types'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useMessageCache } from '../hooks/useMessageCache'
import ChatView from '../components/ChatView'
import ConnectionRequestView from '../components/connections/ConnectionRequestView'
import ConnectionRequestsSection from '../components/connections/ConnectionRequestsSection'
import AppMark from '../components/AppMark'
import CreateVehicleGroupModal from '../components/CreateVehicleGroupModal'
import NewMessageModal from '../components/NewMessageModal'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

type NewGroupKind = 'vehicle' | 'direct'

// What the main pane is currently showing. A group chat, a pending request,
// or nothing (the empty state).
type Selection =
  | { kind: 'group'; id: string }
  | { kind: 'request'; id: string }
  | null

const EMPTY_CONNECTIONS: ConnectionsResponse = {
  accepted: [],
  pendingReceived: [],
  pendingSent: [],
}

function byRecent(a: Group, b: Group): number {
  const at = a.lastMessageAt ?? a.createdAt
  const bt = b.lastMessageAt ?? b.createdAt
  return bt.localeCompare(at)
}

export default function Workspace({ user, workspace, onSignOut }: Props) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [modal, setModal] = useState<NewGroupKind | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [selection, setSelection] = useState<Selection>(null)
  const [connections, setConnections] = useState<ConnectionsResponse>(EMPTY_CONNECTIONS)
  // A quote to seed a DM's composer with, set when a DM is opened via "Reply
  // privately". Scoped to a group id so it only seeds that conversation.
  const [pendingReply, setPendingReply] = useState<{
    groupId: string
    reply: ReplyToPreview
  } | null>(null)

  const userMenuRef = useRef<HTMLDivElement>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)
  // Mirror the currently-open group id into a ref so the socket handler (set up
  // once) can tell whether an arriving message belongs to the open chat without
  // re-subscribing on every selection change.
  const openGroupId = selection?.kind === 'group' ? selection.id : null
  const openGroupIdRef = useRef(openGroupId)
  openGroupIdRef.current = openGroupId

  const { prefetch } = useMessageCache()

  const refreshGroups = useCallback(async () => {
    const { groups } = await api.groups.list()
    setGroups([...groups].sort(byRecent))
  }, [])

  useEffect(() => {
    refreshGroups().finally(() => setLoadingGroups(false))
  }, [refreshGroups])

  // Warm the cache for the few most-recent conversations once the rail is up,
  // so opening them is instant. Lightweight + idempotent: prefetch skips groups
  // already cached or in flight, and runs in the background without blocking.
  useEffect(() => {
    if (loadingGroups) return
    for (const g of groups.slice(0, 3)) prefetch(g.id)
  }, [loadingGroups, groups, prefetch])

  // Socket: keep the rail in sync. A new message bumps its group to the top
  // (and marks it unread unless it's the open one). A new group prompts a
  // refetch — cheap, and avoids partial state.
  useEffect(() => {
    const socket = getSocket()

    function onMessageNew(msg: IncomingMessage) {
      setGroups((prev) => {
        const idx = prev.findIndex((g) => g.id === msg.groupId)
        if (idx === -1) {
          void refreshGroups()
          return prev
        }
        // Bump unread only for messages from others landing in a group that
        // isn't the one currently open (the open one gets marked read).
        const bumpUnread =
          msg.authorId !== user.id && openGroupIdRef.current !== msg.groupId
        const updated: Group = {
          ...prev[idx],
          lastMessageAt: msg.createdAt,
          unreadCount: (prev[idx].unreadCount ?? 0) + (bumpUnread ? 1 : 0),
        }
        const next = prev.filter((_, i) => i !== idx)
        next.unshift(updated)
        return next
      })
    }
    function onGroupAdded() {
      void refreshGroups()
    }

    socket.on('message:new', onMessageNew)
    socket.on('group:added', onGroupAdded)
    return () => {
      socket.off('message:new', onMessageNew)
      socket.off('group:added', onGroupAdded)
    }
  }, [refreshGroups, user.id])

  // Connections: load once, then refetch whenever a connection event fires.
  // Refetching (rather than patching) keeps the three buckets consistent.
  const refreshConnections = useCallback(async () => {
    setConnections(await api.connections.list())
  }, [])

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  useEffect(() => {
    const socket = getSocket()
    const onChange = () => void refreshConnections()
    socket.on('connection:requested', onChange)
    socket.on('connection:accepted', onChange)
    socket.on('connection:declined', onChange)
    return () => {
      socket.off('connection:requested', onChange)
      socket.off('connection:accepted', onChange)
      socket.off('connection:declined', onChange)
    }
  }, [refreshConnections])

  // Close menus on outside click / Esc.
  useEffect(() => {
    if (!userMenuOpen && !newMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) {
        setUserMenuOpen(false)
      }
      if (newMenuOpen && newMenuRef.current && !newMenuRef.current.contains(t)) {
        setNewMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setUserMenuOpen(false)
        setNewMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen, newMenuOpen])

  function startCreate(kind: NewGroupKind) {
    setNewMenuOpen(false)
    setModal(kind)
  }

  // Drop the given group into local state immediately, select it, and
  // reconcile against the server in the background. This is what makes new
  // chats appear instantly even on slow connections — the rail and main
  // pane don't wait for the follow-up GET /groups round trip.
  const openGroupOptimistically = useCallback(
    (group: Group) => {
      setGroups((prev) => {
        if (prev.some((g) => g.id === group.id)) return prev
        return [group, ...prev].sort(byRecent)
      })
      setSelection({ kind: 'group', id: group.id })
      void refreshGroups()
    },
    [refreshGroups],
  )

  function handleCreated(group: Group) {
    setModal(null)
    openGroupOptimistically(group)
  }

  // Open (or create) a DM with an accepted connection. Used after accepting
  // a request, so the natural next step (talk to them) is one click closer.
  const openDirectFor = useCallback(
    async (otherUser: ConnectionUser) => {
      const { group } = await api.groups.createDirect(otherUser.id)
      openGroupOptimistically(
        optimisticDirectGroup(group.id, otherUser),
      )
    },
    [openGroupOptimistically],
  )

  // Navigate to a private DM opened from a message action ("Reply privately"
  // / "Send message in private"). ChatView has already created the group
  // server-side; we drop an optimistic row in and reconcile in the background.
  const openDirectMessage = useCallback(
    (
      info: { groupId: string; peerId: string; peerName: string },
      reply?: ReplyToPreview,
    ) => {
      const now = new Date().toISOString()
      openGroupOptimistically({
        id: info.groupId,
        type: 'direct',
        name: null,
        description: null,
        meta: {},
        lastMessageAt: null,
        lastReadAt: now,
        createdAt: now,
        memberCount: 2,
        unreadCount: 0,
        directPeer: { id: info.peerId, name: info.peerName, workspace: null },
      })
      setPendingReply(reply ? { groupId: info.groupId, reply } : null)
    },
    [openGroupOptimistically],
  )

  async function handleAccepted(otherUser: ConnectionUser) {
    await refreshConnections()
    await openDirectFor(otherUser)
  }

  async function handleDeclined() {
    await refreshConnections()
    setSelection(null)
  }

  // Patch a single group's lastReadAt + clear its unread counter locally so the
  // badge clears without a full refetch.
  const markGroupRead = useCallback((groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, lastReadAt: new Date().toISOString(), unreadCount: 0 }
          : g,
      ),
    )
  }, [])

  const vehicleGroups = useMemo(() => groups.filter((g) => g.type === 'vehicle'), [groups])
  const directGroups = useMemo(() => groups.filter((g) => g.type === 'direct'), [groups])
  const pendingReceived = connections.pendingReceived

  const selectedGroup = useMemo<Group | null>(() => {
    if (selection?.kind !== 'group') return null
    return groups.find((g) => g.id === selection.id) ?? null
  }, [groups, selection])

  const selectedRequest = useMemo<Connection | null>(() => {
    if (selection?.kind !== 'request') return null
    return pendingReceived.find((c) => c.id === selection.id) ?? null
  }, [pendingReceived, selection])

  return (
    <div className="h-screen w-full flex bg-bg text-text overflow-hidden">
      {/* Left rail */}
      <aside className="w-[var(--sidebar-width)] shrink-0 bg-rail border-r border-white/[0.08] flex flex-col">
        {/* Workspace switcher */}
        <button className="h-[var(--header-height)] flex items-center gap-2.5 px-4 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors text-left">
          <div className="h-7 w-7 rounded-chip border border-white/[0.1] bg-white/[0.03] flex items-center justify-center shrink-0">
            <Box size={14} strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold truncate">{workspace.name}</div>
            <div className="eyebrow truncate" style={{ fontSize: 9.5 }}>
              {workspace.slug}
            </div>
          </div>
          <ChevronDown size={14} className="text-muted shrink-0" strokeWidth={1.6} />
        </button>

        {/* Quick search + create */}
        <div className="px-3 pt-3 pb-2 flex items-center gap-1.5">
          <label
            htmlFor="rail-search"
            className="flex-1 h-8 flex items-center gap-2 px-2.5 rounded-chip border border-white/[0.06] bg-white/[0.02] focus-within:border-white/[0.16] hover:border-white/[0.10] transition-colors cursor-text"
          >
            <Search size={12} strokeWidth={1.6} className="text-faint shrink-0" />
            <input
              id="rail-search"
              placeholder="Jump to…"
              className="bg-transparent text-[12.5px] flex-1 outline-none placeholder:text-faint min-w-0"
            />
          </label>

          <div className="relative shrink-0" ref={newMenuRef}>
            <button
              onClick={() => setNewMenuOpen((v) => !v)}
              aria-label="Create a new conversation"
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
              className={`h-8 w-8 flex items-center justify-center rounded-chip border transition-colors ${
                newMenuOpen
                  ? 'border-white/[0.16] bg-white/[0.05] text-text'
                  : 'border-white/[0.06] bg-white/[0.02] text-muted hover:text-text hover:border-white/[0.10]'
              }`}
            >
              <Plus size={14} strokeWidth={1.8} />
            </button>

            {newMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+6px)] w-[200px] rounded-card border border-white/[0.08] bg-surface overflow-hidden z-20 py-1"
              >
                <CreateMenuItem label="Vehicle chat" onClick={() => startCreate('vehicle')} />
                <CreateMenuItem label="Search for a connection" onClick={() => startCreate('direct')} />
              </div>
            )}
          </div>
        </div>

        {/* Group + requests list */}
        <nav className="flex-1 overflow-y-auto px-2 pt-2 pb-2 space-y-6">
          {loadingGroups ? (
            <div className="px-2 text-[11.5px] text-faint">Loading…</div>
          ) : (
            <>
              <ConnectionRequestsSection
                pendingReceived={pendingReceived}
                selectedId={selection?.kind === 'request' ? selection.id : null}
                onSelect={(id) => setSelection({ kind: 'request', id })}
              />

              <ChannelGroup label="Vehicles">
                {vehicleGroups.length === 0 ? (
                  <EmptyHint>
                    Create a vehicle chat to coordinate loads, documents, and updates over time.
                  </EmptyHint>
                ) : (
                  vehicleGroups.map((g) => (
                    <GroupRow
                      key={g.id}
                      group={g}
                      selected={selection?.kind === 'group' && selection.id === g.id}
                      onClick={() => setSelection({ kind: 'group', id: g.id })}
                    />
                  ))
                )}
              </ChannelGroup>

              <ChannelGroup label="Direct messages">
                {directGroups.length === 0 ? (
                  <EmptyHint>No direct messages.</EmptyHint>
                ) : (
                  directGroups.map((g) => (
                    <GroupRow
                      key={g.id}
                      group={g}
                      selected={selection?.kind === 'group' && selection.id === g.id}
                      onClick={() => setSelection({ kind: 'group', id: g.id })}
                    />
                  ))
                )}
              </ChannelGroup>
            </>
          )}
        </nav>

        {/* User menu */}
        <div className="relative border-t border-white/[0.05]" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 rounded-card border border-white/[0.08] bg-surface overflow-hidden">
              <MenuItem icon={<Settings size={13} strokeWidth={1.6} />} onClick={() => {}}>
                Workspace settings
              </MenuItem>
              <MenuItem
                icon={<LogOut size={13} strokeWidth={1.6} />}
                onClick={() => {
                  setUserMenuOpen(false)
                  void onSignOut()
                }}
              >
                Sign out
              </MenuItem>
            </div>
          )}

          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 px-3 py-3 hover:bg-white/[0.02] transition-colors text-left"
          >
            <div className="h-7 w-7 rounded-full bg-active/30 border border-active/40 flex items-center justify-center shrink-0 text-[11px] font-semibold uppercase font-mono">
              {initials(user.displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium truncate">{user.displayName}</div>
              <div className="text-[11px] text-muted truncate capitalize">{user.role}</div>
            </div>
            <ChevronDown
              size={13}
              strokeWidth={1.6}
              className={`text-muted shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {selectedGroup ? (
          <ChatView
            key={selectedGroup.id}
            group={selectedGroup}
            currentUserId={user.id}
            onRead={markGroupRead}
            onOpenDirectMessage={openDirectMessage}
            initialReplyContext={
              pendingReply?.groupId === selectedGroup.id ? pendingReply.reply : null
            }
            onConsumeInitialReply={() => setPendingReply(null)}
          />
        ) : selectedRequest ? (
          <ConnectionRequestView
            key={selectedRequest.id}
            connection={selectedRequest}
            onAccepted={handleAccepted}
            onDeclined={handleDeclined}
          />
        ) : (
          <EmptyState
            firstName={firstName(user.displayName)}
            workspaceName={workspace.name}
            onCreate={() => startCreate('vehicle')}
          />
        )}
      </main>

      {/* Modals */}
      {modal === 'vehicle' && (
        <CreateVehicleGroupModal onClose={() => setModal(null)} onCreated={handleCreated} />
      )}
      {modal === 'direct' && (
        <NewMessageModal onClose={() => setModal(null)} onOpenGroup={handleCreated} />
      )}
    </div>
  )
}

function EmptyState({
  firstName,
  workspaceName,
  onCreate,
}: {
  firstName: string
  workspaceName: string
  onCreate: () => void
}) {
  return (
    <>
      <header className="h-[var(--header-height)] flex items-center px-5 border-b border-white/[0.06] bg-rail shrink-0">
        <span className="eyebrow">Inbox</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="h-12 w-12 rounded-card border border-white/[0.08] bg-white/[0.015] flex items-center justify-center mb-5">
          <AppMark size={30} />
        </div>
        <h2 className="text-[18px] font-semibold tracking-[-0.2px] mb-2">Welcome, {firstName}.</h2>
        <p className="text-muted text-[13px] max-w-[420px] mb-6 leading-[1.55]">
          This is your dispatcher workspace for {workspaceName}. Create a group for a vehicle on
          the road, or start a direct message with a teammate.
        </p>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 bg-text text-bg font-semibold text-[12.5px] rounded-btn px-3.5 py-2 hover:bg-text/90 transition-colors"
        >
          <Plus size={13} strokeWidth={2} />
          Create your first group
        </button>
      </div>
    </>
  )
}

function GroupRow({
  group,
  selected,
  onClick,
}: {
  group: Group
  selected: boolean
  onClick: () => void
}) {
  // Selecting a group clears its indicator immediately (it's about to be read).
  // Prefer the precise server count; fall back to the timestamp-based flag when
  // the API didn't send a count (older server) so the dot never disappears.
  const hasCount = typeof group.unreadCount === 'number'
  const unreadCount = selected ? 0 : group.unreadCount ?? 0
  const unread = selected ? false : hasCount ? unreadCount > 0 : groupHasUnread(group)
  // Leading type glyph: a single contact for DMs, a multi-contact group glyph
  // for vehicle conversations. Kept subtle (faint) so the conversation name
  // stays the focus.
  const TypeIcon = group.type === 'direct' ? CircleUser : Users
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-chip text-left transition-colors ${
        selected
          ? 'bg-white/[0.06] text-text'
          : 'text-muted hover:bg-white/[0.025] hover:text-text'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${unread ? 'bg-active' : 'bg-transparent'}`}
      />
      <TypeIcon
        size={17}
        strokeWidth={1.6}
        className={`shrink-0 ${unread ? 'text-muted' : 'text-faint'}`}
      />
      <span className={`flex-1 truncate text-[13px] ${unread ? 'text-text font-medium' : ''}`}>
        {groupLabel(group)}
      </span>
      {group.type === 'vehicle' && tractorPlate(group) && (
        <span className="font-mono text-[10px] text-faint shrink-0">{tractorPlate(group)}</span>
      )}
      {unread && hasCount && unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread`}
          className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-active text-bg text-[10.5px] font-semibold leading-none flex items-center justify-center"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

function ChannelGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 mb-1.5">
        <span className="eyebrow">{label}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] text-faint px-2 py-1 leading-[1.45]">{children}</div>
}

function MenuItem({
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
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] hover:bg-white/[0.03] transition-colors text-left"
    >
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  )
}

function CreateMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className="w-full px-3 py-2 text-[12.5px] hover:bg-white/[0.03] transition-colors text-left"
    >
      {label}
    </button>
  )
}

// Shape an optimistic direct-message Group from what we already know about
// the other user, so the rail can render the row before the server confirms.
// `refreshGroups()` will replace this with the canonical record.
function optimisticDirectGroup(id: string, other: ConnectionUser): Group {
  const now = new Date().toISOString()
  return {
    id,
    type: 'direct',
    name: null,
    description: null,
    meta: {},
    lastMessageAt: null,
    lastReadAt: now,
    createdAt: now,
    memberCount: 2,
    unreadCount: 0,
    directPeer: { id: other.id, name: other.displayName, workspace: other.workspace.name },
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}
