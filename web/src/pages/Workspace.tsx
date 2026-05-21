import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, ChevronDown, LogOut, MessageSquare, Plus, Search, Settings } from 'lucide-react'
import type { User, Workspace as WorkspaceT } from '../auth/AuthContext'
import type { Group, IncomingMessage } from '../lib/types'
import { groupHasUnread, groupLabel } from '../lib/types'
import { api } from '../lib/api'
import { getSocket } from '../lib/socket'
import ChatView from '../components/ChatView'
import CreateVehicleGroupModal from '../components/CreateVehicleGroupModal'
import NewDirectMessageModal from '../components/NewDirectMessageModal'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

type NewGroupKind = 'vehicle' | 'direct'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const userMenuRef = useRef<HTMLDivElement>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)

  const refreshGroups = useCallback(async () => {
    const { groups } = await api.groups.list()
    setGroups([...groups].sort(byRecent))
  }, [])

  useEffect(() => {
    refreshGroups().finally(() => setLoadingGroups(false))
  }, [refreshGroups])

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
        const updated: Group = { ...prev[idx], lastMessageAt: msg.createdAt }
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
  }, [refreshGroups])

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

  // After a modal creates (or finds) a group, refresh and open it.
  async function handleCreated(groupId: string) {
    setModal(null)
    await refreshGroups()
    setSelectedId(groupId)
  }

  // Patch a single group's lastReadAt locally so the unread dot clears
  // without a full refetch.
  const markGroupRead = useCallback((groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, lastReadAt: new Date().toISOString() } : g,
      ),
    )
  }, [])

  const vehicleGroups = useMemo(() => groups.filter((g) => g.type === 'vehicle'), [groups])
  const directGroups = useMemo(() => groups.filter((g) => g.type === 'direct'), [groups])
  const selected = useMemo(
    () => groups.find((g) => g.id === selectedId) ?? null,
    [groups, selectedId],
  )

  return (
    <div className="h-screen w-full flex bg-bg text-text overflow-hidden">
      {/* Left rail */}
      <aside className="w-[288px] shrink-0 bg-rail border-r border-white/[0.05] flex flex-col">
        {/* Workspace switcher */}
        <button className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors text-left">
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
            <kbd className="font-mono text-[10px] text-faint shrink-0">⌘K</kbd>
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
                <CreateMenuItem label="Vehicle group" onClick={() => startCreate('vehicle')} />
                <CreateMenuItem label="Direct message" onClick={() => startCreate('direct')} />
              </div>
            )}
          </div>
        </div>

        {/* Group list */}
        <nav className="flex-1 overflow-y-auto px-2 pt-3 pb-2 space-y-6">
          {loadingGroups ? (
            <div className="px-2 text-[11.5px] text-faint">Loading…</div>
          ) : (
            <>
              <ChannelGroup label="Vehicles & trips">
                {vehicleGroups.length === 0 ? (
                  <EmptyHint>No trips yet.</EmptyHint>
                ) : (
                  vehicleGroups.map((g) => (
                    <GroupRow
                      key={g.id}
                      group={g}
                      selected={g.id === selectedId}
                      onClick={() => setSelectedId(g.id)}
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
                      selected={g.id === selectedId}
                      onClick={() => setSelectedId(g.id)}
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
        {selected ? (
          <ChatView
            key={selected.id}
            group={selected}
            currentUserId={user.id}
            onRead={markGroupRead}
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
        <NewDirectMessageModal onClose={() => setModal(null)} onCreated={handleCreated} />
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
      <header className="h-12 flex items-center px-5 border-b border-white/[0.06] shrink-0">
        <span className="eyebrow">Inbox</span>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="h-12 w-12 rounded-card border border-white/[0.08] bg-white/[0.015] flex items-center justify-center mb-5">
          <MessageSquare size={18} strokeWidth={1.4} className="text-muted" />
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
  const unread = !selected && groupHasUnread(group)
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
      <span className={`flex-1 truncate text-[13px] ${unread ? 'text-text font-medium' : ''}`}>
        {groupLabel(group)}
      </span>
      {group.type === 'vehicle' && group.meta.plate && (
        <span className="font-mono text-[10px] text-faint shrink-0">{group.meta.plate}</span>
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}
