import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useViewMode, setViewMode, type ViewMode } from '../../lib/viewMode'
import { useMessageDisplay, setMessageDisplay, type MessageDisplay } from '../../lib/messageDisplay'

type Props = { onBack: () => void }

// Workspace settings as a sidebar drawer — consistent with "My profile" /
// "Company profile" (replaces the conversation list; the chat stays on the
// right) and rendered inside the sidebar card so it shares the same shell.
//
// Holds APP/DISPLAY preferences ONLY — never personal profile fields (those
// live in "My profile"). Organised into titled SECTIONS so new groups
// (Notifications, Members, Integrations, …) can be dropped in without
// restructuring. Today there's just Appearance; we don't render empty
// placeholder sections. Each setting is a device-local pref persisted in
// localStorage by its lib module — toggling here applies live.
export default function WorkspaceSettingsPanel({ onBack }: Props) {
  const viewMode = useViewMode()
  const messageDisplay = useMessageDisplay()

  return (
    <div className="flex flex-col h-full">
      {/* Header — matches the rail's header height, with a back affordance. */}
      <div className="h-[var(--header-height)] flex items-center gap-2 px-3 border-b border-white/[0.05] shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to inbox"
          className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors shrink-0"
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
        <span className="text-[13px] font-semibold">Workspace settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <Section
          title="Appearance"
          description="How the app looks on this device. Saved in this browser."
        >
          <Segmented
            label="Conversation view"
            hint="Row size in the conversation list."
            value={viewMode}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'normal', label: 'Normal' },
            ]}
            onChange={(v) => setViewMode(v as ViewMode)}
          />
          <Segmented
            label="Message display"
            hint="How messages are shown inside a conversation."
            value={messageDisplay}
            options={[
              { value: 'bubble', label: 'Bubble view' },
              { value: 'plain', label: 'Plain stream view' },
            ]}
            onChange={(v) => setMessageDisplay(v as MessageDisplay)}
          />
        </Section>
      </div>
    </div>
  )
}

// A settings SECTION: an eyebrow title, an optional one-line description, then
// its controls grouped in a subtle card. The shared shell keeps every future
// section visually consistent — add another <Section> and it lines up.
function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section>
      <div className="eyebrow mb-1">{title}</div>
      {description && <p className="text-[11.5px] text-faint mb-2">{description}</p>}
      <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-3">
        {children}
      </div>
    </section>
  )
}

// A labelled segmented control: a setting label + hint over a small pill group.
// The active option uses the primary accent; the rest are quiet until hovered.
function Segmented({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="text-[12.5px] text-text">{label}</div>
      {hint && <div className="text-[11px] text-faint mb-2 mt-0.5">{hint}</div>}
      <div className="inline-flex gap-0.5 rounded-btn border border-white/[0.1] p-0.5">
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`h-7 px-3 rounded-[6px] text-[12px] transition-colors ${
                active
                  ? 'bg-active text-bg font-semibold'
                  : 'text-muted hover:text-text hover:bg-white/[0.04]'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
