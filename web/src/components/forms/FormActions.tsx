import { Check, Loader2 } from 'lucide-react'

// ── Save / Cancel ───────────────────────────────────────────────────────────
// The SAME pair everywhere a value is committed — inline field editors, the
// stop editor, any future full form. Two shapes of the same recipe:
//
//   'icons'  a circular ✓ / ✕ pair that sits INSIDE a field's right edge
//            (the inline row editors)
//   'buttons' labelled buttons for a form footer (FormFooter below)
//
// Save is disabled while there is nothing to save or the form is invalid, and
// it OWNS the busy state: once pressed it shows a spinner and cannot be pressed
// again, which is what prevents a double submit. After a successful save it
// flashes a check for a moment so the commit is acknowledged without a toast.

export type SaveState = 'idle' | 'saving' | 'saved'

export function FormActions({
  onSave,
  onCancel,
  state = 'idle',
  /** Nothing changed / the value is invalid → Save is unavailable. */
  disabled = false,
  /** Names the thing being saved, for the accessible labels. */
  label,
}: {
  onSave: () => void
  onCancel: () => void
  state?: SaveState
  disabled?: boolean
  label: string
}) {
  const busy = state === 'saving'
  return (
    <>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || busy}
        aria-label={`Save ${label}`}
        title={disabled ? 'No changes to save' : 'Save'}
        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-text text-bg
                   transition-colors hover:bg-text/90
                   disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {busy ? (
          <Loader2 size="0.8125rem" strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Check size="0.8125rem" strokeWidth={2.4} />
        )}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label={`Cancel editing ${label}`}
        title="Cancel"
        className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-muted
                   transition-colors hover:text-text hover:bg-white/6 disabled:opacity-40
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <CancelGlyph />
      </button>
    </>
  )
}

function CancelGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="0.8125rem" height="0.8125rem" fill="none" aria-hidden>
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  )
}

// Footer variant for multi-field forms: labelled buttons, right-aligned, able to
// stick to the bottom of a long scrolling panel so Save is always reachable.
export function FormFooter({
  onSave,
  onCancel,
  state = 'idle',
  disabled = false,
  saveLabel = 'Save',
  sticky = false,
}: {
  onSave: () => void
  onCancel: () => void
  state?: SaveState
  disabled?: boolean
  saveLabel?: string
  sticky?: boolean
}) {
  const busy = state === 'saving'
  return (
    <div
      className={`flex items-center justify-end gap-2 ${
        sticky
          ? 'sticky bottom-0 -mx-4 mt-3 border-t border-line bg-panel px-4 py-2.5'
          : 'mt-3'
      }`}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="h-8 px-3 rounded-btn text-base font-medium text-muted transition-colors
                   hover:text-text hover:bg-white/6 disabled:opacity-40
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || busy}
        title={disabled ? 'No changes to save' : undefined}
        className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-btn bg-text text-bg text-base font-semibold
                   transition-colors hover:bg-text/90
                   disabled:opacity-40 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {busy && (
          <Loader2 size="0.8125rem" strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" />
        )}
        {state === 'saved' && !busy && <Check size="0.8125rem" strokeWidth={2.4} />}
        {saveLabel}
      </button>
    </div>
  )
}
