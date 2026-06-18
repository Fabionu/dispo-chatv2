import { useState } from 'react'
import { Route } from 'lucide-react'
import RoutePlanner from './RoutePlanner'

type Props = {
  workspaceName: string
}

// The Inbox / workspace home — reached by clicking the sidebar company header.
// It's an operational tools area: a grid of large tool cards. Selecting a tool
// opens its dedicated workspace in place (replacing the chat area), with a back
// action returning here. Today the only tool is the HERE "Route planner".
export default function InboxView({ workspaceName }: Props) {
  const [tool, setTool] = useState<'route' | null>(null)

  if (tool === 'route') {
    return <RoutePlanner onBack={() => setTool(null)} />
  }

  return (
    <>
      <header className="h-[var(--header-height)] flex flex-col justify-center px-5 shrink-0">
        <div className="text-[15px] font-semibold tracking-[-0.2px] leading-tight">Workspace</div>
        <div className="text-[12px] text-muted leading-tight mt-0.5">Operational tools for {workspaceName}.</div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-[920px] mx-auto flex flex-col gap-4">
          {/* Auto-fill grid leaves room for future tools to flow in alongside. */}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            <ToolCard
              icon={<Route size={26} strokeWidth={1.5} />}
              title="Route planner"
              subtitle="Truck routing, distance and ETA with HERE"
              onClick={() => setTool('route')}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function ToolCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3.5 rounded-card border border-white/[0.08] bg-white/[0.02] p-5 text-left transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span className="h-11 w-11 flex items-center justify-center rounded-full bg-white/[0.04] text-active transition-colors group-hover:bg-white/[0.06]">
        {icon}
      </span>
      <span className="block">
        <span className="block text-[14px] font-semibold tracking-[-0.2px]">{title}</span>
        <span className="block text-[12px] text-muted mt-1 leading-[1.5]">{subtitle}</span>
      </span>
    </button>
  )
}
