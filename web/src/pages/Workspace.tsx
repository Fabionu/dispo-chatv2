import { useState } from 'react'
import {
  Box,
  ChevronDown,
  Hash,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Truck,
} from 'lucide-react'
import type { User, Workspace as WorkspaceT } from '../auth/AuthContext'

type Props = {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}

export default function Workspace({ user, workspace, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="h-screen w-full flex bg-bg text-text overflow-hidden">
      {/* Left rail */}
      <aside className="w-[260px] shrink-0 bg-rail border-r border-white/[0.05] flex flex-col">
        {/* Workspace switcher */}
        <button
          className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors text-left"
          onClick={() => {
            /* workspace settings later */
          }}
        >
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

        {/* Quick search */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-chip border border-white/[0.06] bg-white/[0.02]">
            <Search size={12} strokeWidth={1.6} className="text-faint" />
            <input
              placeholder="Jump to…"
              className="bg-transparent text-[12.5px] flex-1 outline-none placeholder:text-faint"
            />
            <kbd className="font-mono text-[10px] text-faint border border-white/[0.06] rounded px-1">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Channel groups — placeholder structure */}
        <nav className="flex-1 overflow-y-auto px-2 pt-3 space-y-5">
          <ChannelGroup label="Offers & Quotes" icon={<MessageSquare size={11} />}>
            <EmptyHint>No offers yet. Create your first group →</EmptyHint>
          </ChannelGroup>

          <ChannelGroup label="Vehicles & Trips" icon={<Truck size={11} />}>
            <EmptyHint>No trips yet. Add a vehicle to get started.</EmptyHint>
          </ChannelGroup>

          <ChannelGroup label="Direct messages" icon={<Hash size={11} />}>
            <EmptyHint>No direct messages.</EmptyHint>
          </ChannelGroup>
        </nav>

        {/* User menu */}
        <div className="relative border-t border-white/[0.05]">
          {menuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 rounded-card border border-white/[0.08] bg-surface overflow-hidden">
              <MenuItem icon={<Settings size={13} strokeWidth={1.6} />} onClick={() => {}}>
                Workspace settings
              </MenuItem>
              <MenuItem
                icon={<LogOut size={13} strokeWidth={1.6} />}
                onClick={() => {
                  setMenuOpen(false)
                  void onSignOut()
                }}
              >
                Sign out
              </MenuItem>
            </div>
          )}

          <button
            onClick={() => setMenuOpen((v) => !v)}
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
              className={`text-muted shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 flex items-center justify-between px-5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2 text-muted text-[12.5px]">
            <span className="eyebrow">Inbox</span>
          </div>
          <button className="flex items-center gap-1.5 text-[12px] text-text border border-white/[0.12] rounded-chip px-2.5 py-1 hover:bg-white/[0.03] transition-colors">
            <Plus size={12} strokeWidth={1.8} />
            New group
          </button>
        </header>

        {/* Empty state */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="h-12 w-12 rounded-card border border-white/[0.08] bg-white/[0.015] flex items-center justify-center mb-5">
            <MessageSquare size={18} strokeWidth={1.4} className="text-muted" />
          </div>
          <h2 className="text-[18px] font-semibold tracking-[-0.2px] mb-2">
            Welcome, {firstName(user.displayName)}.
          </h2>
          <p className="text-muted text-[13px] max-w-[420px] mb-6 leading-[1.55]">
            This is your dispatcher workspace for {workspace.name}. Create a group for each load you
            broker, or a channel for each vehicle on the road. Conversations stay tied to the
            shipment.
          </p>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 bg-text text-bg font-semibold text-[12.5px] rounded-btn px-3.5 py-2 hover:bg-text/90 transition-colors">
              <Plus size={13} strokeWidth={2} />
              Create your first group
            </button>
            <button className="text-[12.5px] text-muted border border-white/[0.12] rounded-btn px-3.5 py-2 hover:text-text hover:bg-white/[0.03] transition-colors">
              Invite a colleague
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

function ChannelGroup({
  label,
  icon,
  children,
}: {
  label: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-faint">{icon}</span>
          <span className="eyebrow">{label}</span>
        </div>
        <button
          className="text-faint hover:text-text transition-colors"
          title={`Create ${label.toLowerCase()}`}
        >
          <Plus size={12} strokeWidth={1.8} />
        </button>
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('').toUpperCase() || '?'
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}
