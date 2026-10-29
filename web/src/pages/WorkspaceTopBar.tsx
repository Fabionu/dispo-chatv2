import { useEffect, useRef, type ReactNode } from 'react'
import { LayoutGrid, MessagesSquare, PanelLeftClose, PanelLeftOpen, Truck, X } from 'lucide-react'
import Avatar from '../components/Avatar'
import { useTravellingMarker } from '../components/useTravellingMarker'
import { UnreadBadge, unreadLabel } from './sidebarBits'

// One open tab in the bar. A conversation (a vehicle room or a person) or a
// workspace tool the user pinned from the workspace home.
export type TopTab = {
  key: string
  label: string
  kind: 'vehicle' | 'person' | 'tool'
  /** Tool tabs bring their own glyph. */
  icon?: ReactNode
  /** Person tabs draw the peer's picture. */
  person?: { id: string; name: string; hasAvatar?: boolean; avatarVersion?: string | null }
  unread?: number
}

type Props = {
  collapsed: boolean
  onToggleSidebar: () => void
  chatActive: boolean
  workspaceActive: boolean
  onOpenChat: () => void
  onOpenWorkspace: () => void
  tabs: TopTab[]
  /** Key of the tab whose content the main pane is showing ('' for none). */
  activeKey: string
  onSelectTab: (key: string) => void
  onCloseTab: (key: string) => void
  me: { id: string; name: string; hasAvatar?: boolean; avatarVersion?: string | null }
  /** The signed-in user's availability colour, or null (drivers have none). */
  statusColor: string | null
  accountOpen: boolean
  onAccountOpenChange: (open: boolean) => void
  /** The account window's content, shown under the photo while open. */
  account: ReactNode
}

// The app's top bar (user, 2026-10-29 canvas — it replaced the left nav rail).
// App navigation sits at the two ends: collapse / Chat / Workspace on the left,
// the account on the right. Between them, every OPEN conversation or pinned
// tool is a tab, so the place you are working is always one click away however
// the sidebar is filtered, scrolled or drilled into.
//
// The account is the user's photo alone. Company and Settings no longer have
// buttons of their own: they live in the account window it opens, which hangs
// from the photo like any popover (Escape or a press outside closes it).
export default function WorkspaceTopBar({
  collapsed,
  onToggleSidebar,
  chatActive,
  workspaceActive,
  onOpenChat,
  onOpenWorkspace,
  tabs,
  activeKey,
  onSelectTab,
  onCloseTab,
  me,
  statusColor,
  accountOpen,
  onAccountOpenChange,
  account,
}: Props) {
  // The same travelling underline as the rail's filter bar and the chat's tool
  // tabs, sitting on the bar's bottom hairline under the live tab.
  const { trackRef, rect } = useTravellingMarker(`${activeKey}|${tabs.length}`, '[data-top-tab="active"]')

  const accountRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!accountOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onAccountOpenChange(false)
    }
    function onPointerDown(e: MouseEvent) {
      if (accountRef.current?.contains(e.target as Node)) return
      onAccountOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [accountOpen, onAccountOpenChange])

  const collapseLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  return (
    <header
      aria-label="Main navigation"
      className="workspace-topbar relative z-30 flex h-[3.25rem] min-w-0 items-center gap-1 border-b border-line bg-bg px-3"
    >
      <BarButton label={collapseLabel} onClick={onToggleSidebar} ariaExpanded={!collapsed}>
        {collapsed ? (
          <PanelLeftOpen size="1.125rem" strokeWidth={1.75} />
        ) : (
          <PanelLeftClose size="1.125rem" strokeWidth={1.75} />
        )}
      </BarButton>
      <BarButton label="Chat" active={chatActive} onClick={onOpenChat}>
        <MessagesSquare size="1.125rem" strokeWidth={1.75} />
      </BarButton>
      <BarButton label="Workspace" active={workspaceActive} onClick={onOpenWorkspace}>
        <LayoutGrid size="1.125rem" strokeWidth={1.75} />
      </BarButton>

      {tabs.length > 0 && <span aria-hidden className="mx-1.5 h-[1.375rem] w-px shrink-0 bg-line" />}

      {/* The tabs scroll sideways when there are more than fit; the track
          inside is content-width so the underline is measured in the same
          frame it is drawn in (see ChatToolTabs for the same arrangement). */}
      <div className="h-full min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <div ref={trackRef} role="tablist" aria-label="Open tabs" className="relative flex h-full min-w-max items-center gap-0.5">
          {tabs.map((tab) => (
            <BarTab
              key={tab.key}
              tab={tab}
              active={tab.key === activeKey}
              onSelect={() => onSelectTab(tab.key)}
              onClose={() => onCloseTab(tab.key)}
            />
          ))}
          {rect && (
            <span
              aria-hidden
              // Sits ON the bar's bottom hairline (-1px), inset from the tab's
              // rounded corners; only x travels.
              className="travelling-marker pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-t-sm bg-text motion-reduce:transition-none"
              style={{
                width: Math.max(0, rect.w - 20),
                transform: `translateX(${rect.x + 10}px)`,
              }}
            />
          )}
        </div>
      </div>

      <div ref={accountRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => onAccountOpenChange(!accountOpen)}
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
          aria-label={`Account — ${me.name}`}
          title="Account"
          className={`rounded-btn relative flex h-9 w-9 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            accountOpen ? 'bg-white/10' : 'hover:bg-white/8'
          }`}
        >
          <span className={`block rounded-full ${accountOpen ? 'ring-2 ring-text/80' : ''}`}>
            <Avatar
              userId={me.id}
              name={me.name}
              size={28}
              hasAvatar={me.hasAvatar}
              version={me.avatarVersion}
              fallback="initials"
            />
          </span>
          {statusColor && (
            <span
              aria-hidden
              className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg"
              style={{ backgroundColor: statusColor }}
            />
          )}
        </button>
        {accountOpen && (
          <div
            role="dialog"
            aria-label="Account"
            className="panel-fade-in absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[23.75rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
          >
            {account}
          </div>
        )}
      </div>
    </header>
  )
}

function BarButton({
  label,
  active = false,
  ariaExpanded,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  ariaExpanded?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      className={`rounded-btn flex h-9 w-9 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active ? 'bg-white/10 text-text' : 'text-muted hover:bg-white/8 hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// One tab: its kind's glyph, the label, an unread count when there is news,
// and a close ×. The tab itself is the selecting control; the × is a separate
// button so closing never selects first.
function BarTab({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: TopTab
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const unread = !active && (tab.unread ?? 0) > 0 ? tab.unread! : 0
  return (
    <div
      data-top-tab={active ? 'active' : undefined}
      className={`group/tab flex h-9 max-w-[13.75rem] shrink-0 items-center gap-1 rounded-btn pl-3 pr-1 transition-colors ${
        active ? 'bg-white/8 text-text' : 'text-muted hover:bg-white/6 hover:text-text'
      }`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <span className="flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center">
          {tab.kind === 'vehicle' ? (
            <Truck size="1.0625rem" strokeWidth={1.75} />
          ) : tab.kind === 'person' && tab.person ? (
            <Avatar
              userId={tab.person.id}
              name={tab.person.name}
              size={18}
              hasAvatar={tab.person.hasAvatar}
              version={tab.person.avatarVersion}
              fallback="initials"
            />
          ) : (
            tab.icon
          )}
        </span>
        <span className={`min-w-0 truncate text-base font-medium ${tab.kind === 'vehicle' ? 'tabular-nums' : ''}`}>
          {tab.label}
        </span>
        {unread > 0 && (
          <UnreadBadge size="tab" label={`${unread} unread`}>
            {unreadLabel(unread)}
          </UnreadBadge>
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${tab.label}`}
        title="Close tab"
        className={`rounded-btn flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center text-faint transition-colors hover:bg-white/8 hover:text-text focus-visible:opacity-100 ${
          active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'
        }`}
      >
        <X size="0.8125rem" strokeWidth={2.2} />
      </button>
    </div>
  )
}
