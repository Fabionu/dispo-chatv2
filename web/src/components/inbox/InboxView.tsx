import { lazy, Suspense, useState } from 'react'
import { ChevronRight, Route } from 'lucide-react'
import { PaneLoader } from '../LazyFallback'

// The Route planner pulls in the whole HERE map stack (@here/flexpolyline, the
// HERE SDK loader, truck presets). Code-split so none of it ships in the initial
// bundle — it loads only when the user opens the tool.
const RoutePlanner = lazy(() => import('./RoutePlanner'))

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
    return (
      <Suspense fallback={<PaneLoader className="h-full" />}>
        <RoutePlanner onBack={() => setTool(null)} />
      </Suspense>
    )
  }

  return (
    <>
      <header className="h-[var(--header-height)] flex flex-col justify-center px-5 shrink-0">
        <div className="text-[0.9375rem] font-semibold tracking-[-0.2px] leading-tight">Workspace</div>
        <div className="text-[0.75rem] text-muted leading-tight mt-0.5">Operational tools for {workspaceName}.</div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-[57.5rem] mx-auto flex flex-col gap-4">
          {/* Auto-fill grid leaves room for future tools to flow in alongside. */}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr))]">
            <ToolCard
              icon={<Route size="1.625rem" strokeWidth={1.5} />}
              title="Route planner"
              subtitle="Truck routing, distance and ETA"
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
      className="group flex items-center gap-3 rounded-panel border border-white/[0.06] bg-white/[0.015] px-4 py-3.5 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-active">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.875rem] font-semibold tracking-[-0.2px]">{title}</span>
        <span className="mt-0.5 block text-[0.75rem] leading-[1.5] text-muted">{subtitle}</span>
      </span>
      <ChevronRight
        size="1rem"
        strokeWidth={1.7}
        className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
      />
    </button>
  )
}
