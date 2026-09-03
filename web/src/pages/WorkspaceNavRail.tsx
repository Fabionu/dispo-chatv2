import {
  LayoutGrid,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react'

type Props = {
  collapsed: boolean
  chatActive: boolean
  workspaceActive: boolean
  settingsActive: boolean
  onToggleSidebar: () => void
  onOpenChat: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
}

// Persistent, icon-only application navigation. It is deliberately narrower
// than the conversation sidebar and stays in place when that sidebar collapses,
// so the main destinations never disappear with the current sidebar view.
//
// It is not a card: it shares the app's one field colour and is drawn from the
// sidebar beside it by the single hairline on its right edge.
export default function WorkspaceNavRail({
  collapsed,
  chatActive,
  workspaceActive,
  settingsActive,
  onToggleSidebar,
  onOpenChat,
  onOpenWorkspace,
  onOpenSettings,
}: Props) {
  return (
    <aside
      aria-label="Main navigation"
      className="w-full min-w-0 overflow-hidden flex flex-col items-center gap-1 bg-bg border-r px-1.5 py-2.5"
    >
      <CollapseButton collapsed={collapsed} onClick={onToggleSidebar} />

      <div className="my-1 h-px w-5 bg-line" aria-hidden="true" />

      {/* Chat is the way BACK to the conversation list. Every other rail
          destination replaces that list with a drill-in panel (Account,
          Profile, Company, Settings) or swaps the main pane for the workspace
          inbox, and the only route back was the panel's own header arrow —
          which does not exist from the inbox at all. This is the one nav entry
          whose job is to return you to the list, so it leaves the open
          conversation alone and only restores the rail's own view. */}
      <NavButton
        icon={MessagesSquare}
        label="Chat"
        active={chatActive}
        onClick={onOpenChat}
      />

      <NavButton
        icon={LayoutGrid}
        label="Workspace"
        active={workspaceActive}
        onClick={onOpenWorkspace}
      />
      <div className="flex-1" />

      <NavButton
        icon={Settings}
        label="Settings"
        active={settingsActive}
        onClick={onOpenSettings}
      />
    </aside>
  )
}

function CollapseButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean
  onClick: () => void
}) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      onClick={onClick}
      className="rounded-btn relative flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors hover:bg-white/8 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <PanelLeftClose
        size="1.0625rem"
        strokeWidth={1.75}
        className={`absolute transition-[opacity,transform] duration-200 ease-out ${
          collapsed ? '-rotate-45 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
      />
      <PanelLeftOpen
        size="1.0625rem"
        strokeWidth={1.75}
        className={`absolute transition-[opacity,transform] duration-200 ease-out ${
          collapsed ? 'rotate-0 scale-100 opacity-100' : 'rotate-45 scale-75 opacity-0'
        }`}
      />
    </button>
  )
}

function NavButton({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`rounded-btn flex h-9 w-9 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active
          ? 'bg-white/10 text-text'
          : 'text-muted hover:bg-white/8 hover:text-text'
      }`}
    >
      <Icon size="1.0625rem" strokeWidth={1.75} />
    </button>
  )
}
