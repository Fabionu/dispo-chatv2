import { useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, Palette } from 'lucide-react'
import { useViewMode, setViewMode, type ViewMode } from '../../lib/viewMode'

type Props = { onBack: () => void }

// The settings categories. Today just Appearance; new ones (Notifications,
// Members, Integrations …) drop in as another CategoryCard + detail view.
type Category = 'appearance'

// Workspace settings as a sidebar drawer — consistent with "My profile" /
// "Company profile" (replaces the conversation list; the chat stays on the
// right) and rendered inside the sidebar card so it shares the same shell.
//
// Two-level, category-based UX: the FIRST screen lists settings CATEGORIES as
// cards; clicking one opens that category's DETAIL view. Holds APP/DISPLAY
// preferences ONLY — never personal profile fields (those live in "My
// profile"). Each setting is a device-local pref persisted in localStorage by
// its lib module — toggling in a detail view applies live.
export default function WorkspaceSettingsPanel({ onBack }: Props) {
  // Which category's detail is open (null = the category list). Local UI state;
  // no routing needed — the drawer is a self-contained master/detail.
  const [category, setCategory] = useState<Category | null>(null)

  // ── Detail: Appearance ─────────────────────────────────────────────────────
  if (category === 'appearance') {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader
          title="Appearance"
          onBack={() => setCategory(null)}
          backLabel="Back to Workspace settings"
        />
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <AppearanceSettings />
        </div>
      </div>
    )
  }

  // ── Category list ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Workspace settings" onBack={onBack} backLabel="Back to inbox" />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-2.5">
        <CategoryCard
          icon={<Palette size={16} strokeWidth={1.8} />}
          title="Appearance"
          description="Conversation list density."
          onClick={() => setCategory('appearance')}
        />
      </div>
    </div>
  )
}

// Drawer header — matches the rail's header height, with a back affordance. The
// back target differs per level (list → inbox, detail → list), so it's passed
// in along with an accessible label.
function PanelHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string
  onBack: () => void
  backLabel: string
}) {
  return (
    <div className="h-[var(--header-height)] flex items-center gap-2 px-3 border-b border-white/[0.05] shrink-0">
      <button
        onClick={onBack}
        aria-label={backLabel}
        className="h-8 w-8 flex items-center justify-center rounded-chip text-muted hover:text-text hover:bg-white/[0.04] transition-colors shrink-0"
      >
        <ArrowLeft size={16} strokeWidth={1.8} />
      </button>
      <span className="text-[13px] font-semibold">{title}</span>
    </div>
  )
}

// A settings CATEGORY entry on the list screen: a subtle bordered card with a
// leading glyph, a title + short description, and a trailing chevron. Brightens
// on hover so it reads as tappable, while staying compact and native to the
// dark theme.
function CategoryCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-card border border-white/[0.07] bg-white/[0.015] px-3 py-3 text-left transition-colors hover:bg-white/[0.03] hover:border-white/[0.12]"
    >
      <span className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[7px] border border-white/[0.06] bg-white/[0.02] text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-text leading-tight">{title}</span>
        <span className="block text-[11.5px] text-faint mt-0.5 leading-[1.4]">{description}</span>
      </span>
      <ChevronRight size={16} strokeWidth={1.8} className="shrink-0 text-faint" />
    </button>
  )
}

// Appearance detail content. Kept deliberately calm: a short muted lead-in, then
// ONE light card grouping the display controls under a quiet "Conversation
// layout" heading. Settings are separated by generous spacing rather than
// dividers, so nothing competes. Subscribes to the prefs only while mounted.
function AppearanceSettings() {
  const viewMode = useViewMode()

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-faint leading-[1.5]">
        Personalize how conversations look on this device.
      </p>

      <div className="rounded-card border border-white/[0.06] bg-white/[0.015] px-4 py-4">
        <div className="text-[11.5px] text-muted mb-4">Conversation layout</div>
        <div className="space-y-5">
          <SettingBlock
            label="List density"
            description="Choose how much space each conversation uses."
          >
            <Segmented
              value={viewMode}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'normal', label: 'Normal' },
              ]}
              onChange={(v) => setViewMode(v as ViewMode)}
            />
          </SettingBlock>
        </div>
      </div>
    </div>
  )
}

// One setting inside a section: a clean label + short description stacked over
// its control. No borders or dividers of its own — spacing alone sets it apart.
function SettingBlock({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="text-[13px] text-text leading-tight">{label}</div>
      <div className="text-[11.5px] text-faint mt-0.5 leading-[1.4]">{description}</div>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

// A light segmented control: a quietly recessed track with a soft accent-tinted
// pill for the active option — clear, but calmer than a fully-filled button.
// The setting's label/description live in the SettingBlock above it.
function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-[8px] bg-black/20 p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`h-7 px-3.5 rounded-[6px] text-[12px] transition-colors ${
              active
                ? 'bg-active/15 text-active font-semibold'
                : 'text-muted hover:text-text hover:bg-white/[0.03]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
