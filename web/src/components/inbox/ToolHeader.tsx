import { ArrowLeft } from 'lucide-react'
import { ICON_ACTION_BASE, ICON_ACTION_IDLE } from '../HeaderIconButton'

// The bar over every workspace tool — Route planner, Restriction calculator,
// Fleet status: a back arrow and the tool's name, nothing else.
//
// It sits on --tool-header-height (44px at 1920), not --header-height (72px).
// The tall token exists so the main-pane header lines up with the sidebar
// switcher and has room for a thread's identity tile; a tool has neither — it
// replaces the whole chat area, so there is no seam beside it to meet — and at
// 72px the bar was a band of nothing above the content (user, 2026-09-12:
// "much thinner", then the same for the other modules).
//
// The subtitle the calculator and fleet view used to carry under the title
// ("Driving bans, rests and the arrival they add up to") is gone with the
// height: two lines don't fit 44px, and the tool card on the workspace home
// already says what each tool covers in exactly those words. One component so
// the three bars cannot drift apart again (they had: 36px vs 32px buttons,
// 1.25rem vs 1rem arrows, px-4 vs px-5).
type Props = {
  title: string
  onBack: () => void
}

export default function ToolHeader({ title, onBack }: Props) {
  return (
    <header className="h-[var(--tool-header-height)] flex items-center gap-3 px-4 shrink-0">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to workspace"
        className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} -ml-1`}
      >
        <ArrowLeft size="1.25rem" strokeWidth={1.8} />
      </button>
      <div className="min-w-0 text-xl font-semibold tracking-[-0.2px] leading-tight truncate">
        {title}
      </div>
    </header>
  )
}
