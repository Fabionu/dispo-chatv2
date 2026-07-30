import {
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react'

type Props = {
  collapsed: boolean
  workspaceActive: boolean
  settingsActive: boolean
  onToggleSidebar: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
}

// Persistent, icon-only application navigation. It is deliberately narrower
// than the conversation sidebar and stays in place when that sidebar collapses,
// so the main destinations never disappear with the current sidebar view.
export default function WorkspaceNavRail({
  collapsed,
  workspaceActive,
  settingsActive,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSettings,
}: Props) {
  return (
    <aside
      aria-label="Main navigation"
      className="w-full min-w-0 overflow-hidden flex flex-col items-center gap-1 bg-chat rounded-panel border border-white/8 px-1.5 py-2.5"
    >
      <CollapseButton collapsed={collapsed} onClick={onToggleSidebar} />

      <div className="my-1 h-px w-5 bg-white/8" aria-hidden="true" />

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
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
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
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
        active
          ? 'bg-white/10 text-text'
          : 'text-muted hover:bg-white/8 hover:text-text'
      }`}
    >
      <Icon size="1.0625rem" strokeWidth={1.75} />
    </button>
  )
}
