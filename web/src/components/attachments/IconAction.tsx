import type { ReactNode } from 'react'
import HeaderIconButton, {
  ICON_ACTION_BASE,
  ICON_ACTION_IDLE,
} from '../HeaderIconButton'

// Shared icon-only action controls for the attachment preview surfaces (image
// lightbox, image/PDF/document preview modals, the shared action bar). Every
// control is the SAME borderless 36×36 button as the conversation header and
// the send preview modal — the visual style lives once in HeaderIconButton
// (ICON_ACTION_*), and both variants here reuse it so nothing drifts:
//   • IconButton — delegates straight to HeaderIconButton.
//   • IconLink   — an <a> (for native downloads), which can't be a <button>, so
//                  it reuses the same base + idle classes.
// Each adds a themed hover tooltip (CSS-only, group-hover) that names the
// action and matches the dark theme instead of the browser's native title
// bubble; `aria-label`/`title` keep the control accessible.

type TooltipSide = 'top' | 'bottom'

function Tooltip({ label, side = 'bottom' }: { label: string; side?: TooltipSide }) {
  const pos =
    side === 'top'
      ? 'bottom-[calc(100%+6px)]'
      : 'top-[calc(100%+6px)]'
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${pos} z-10 whitespace-nowrap rounded-chip border border-white/[0.10] bg-surface px-2 py-1 text-[11px] text-text opacity-0 transition-opacity duration-100 group-hover:opacity-100`}
      style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.55)' }}
    >
      {label}
    </span>
  )
}

type ButtonProps = {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  tooltipSide?: TooltipSide
}

export function IconButton({ label, onClick, children, disabled, tooltipSide }: ButtonProps) {
  return (
    <span className="group relative inline-flex">
      <HeaderIconButton label={label} onClick={onClick} disabled={disabled}>
        {children}
      </HeaderIconButton>
      <Tooltip label={label} side={tooltipSide} />
    </span>
  )
}

type LinkProps = {
  label: string
  href: string
  download?: string
  children: ReactNode
  tooltipSide?: TooltipSide
}

export function IconLink({ label, href, download, children, tooltipSide }: LinkProps) {
  return (
    <span className="group relative inline-flex">
      <a
        href={href}
        download={download}
        aria-label={label}
        title={label}
        className={`${ICON_ACTION_BASE} ${ICON_ACTION_IDLE} no-underline`}
      >
        {children}
      </a>
      <Tooltip label={label} side={tooltipSide} />
    </span>
  )
}
