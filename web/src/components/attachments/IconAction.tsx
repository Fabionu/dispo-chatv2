import type { ReactNode } from 'react'

// Shared icon-only action controls for the attachment preview surfaces (image
// lightbox, PDF shell, document card). Every button is a uniform 36×36 square
// with NO visible text — just a lucide glyph — and a themed hover tooltip that
// names the action. Tooltips are CSS-only (group-hover), so they match the dark
// theme instead of the browser's native title bubble, while `aria-label` keeps
// the control accessible. A native `title` is kept as a no-JS/long-hover
// backstop only.

const BTN =
  'h-9 w-9 inline-flex items-center justify-center rounded-btn border border-white/[0.14] ' +
  'text-text hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent ' +
  'transition-colors no-underline'

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
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={BTN}
      >
        {children}
      </button>
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
      <a href={href} download={download} aria-label={label} title={label} className={BTN}>
        {children}
      </a>
      <Tooltip label={label} side={tooltipSide} />
    </span>
  )
}
