import { ArrowLeft, Check, Plus } from 'lucide-react'
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
// Keeping a tool open in a tab (user, 2026-10-15): the + pins the tool to the
// workspace's tab strip, so leaving it for a chat is not leaving it behind.
export type ToolPin = { pinned: boolean; onToggle: () => void }

type Props = {
  title: string
  onBack: () => void
  pin?: ToolPin
}

export default function ToolHeader({ title, onBack, pin }: Props) {
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
      {pin && (
        <button
          type="button"
          onClick={pin.onToggle}
          aria-pressed={pin.pinned}
          aria-label={pin.pinned ? `Remove ${title} from tabs` : `Keep ${title} open in a tab`}
          title={pin.pinned ? 'Open in a tab — click to remove' : 'Keep open in a tab'}
          className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} ${pin.pinned ? 'text-text' : ''}`}
        >
          {pin.pinned ? <Check size="1.0625rem" strokeWidth={2} /> : <Plus size="1.125rem" strokeWidth={1.9} />}
        </button>
      )}
    </header>
  )
}
