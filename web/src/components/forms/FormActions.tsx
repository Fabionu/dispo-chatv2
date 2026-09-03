import { Check, Loader2 } from 'lucide-react'

// ── Save / Cancel ───────────────────────────────────────────────────────────
// The SAME pair everywhere a value is committed. Two SIZES of one recipe, not
// two designs:
//
//   FormActions  h-7, for an inline row editor (EditableField, the stop editor)
//   FormFooter   h-8, for a form footer, optionally stuck to a scrolling panel
//
// Save is disabled while there is nothing to save or the value is invalid, and
// it OWNS the busy state: once pressed it shows a spinner and cannot be pressed
// again, which is what prevents a double submit. After a successful save it
// flashes a check for a moment so the commit is acknowledged without a toast.
//
// ── Why these are LABELLED buttons (reworked 2026-09-03) ────────────────────
// This pair used to be a filled circular ✓ beside a bare ✕, and the user asked
// for it to be reworked. Four things were wrong with it, and they are worth
// keeping on file because each one is a trap that is easy to walk back into:
//
//   1. The ✓ was the app's last `rounded-full` hover target. In a UI where every
//      other control is a 6px rounded square it read as borrowed from somewhere
//      else — the same objection that squared the icon buttons in the first
//      place.
//   2. The pair was LOPSIDED: a heavy filled disc next to a weightless glyph,
//      for two actions that are peers. The primary should lead on FILL, which it
//      still does; it should not also be the only one with a shape.
//   3. Both were icon-only, while FormFooter — the same commit, in this same
//      file — spelled out "Cancel" and "Save". The app had two vocabularies for
//      one action, and the unlabelled one was the one used most.
//   4. A bare ✓ does not say what it commits. `title` is not a label: it is
//      invisible until hover and absent on touch.
//
// So: the two are now the same buttons FormFooter uses, one step smaller. One
// commit vocabulary in the app, and nothing here that a footer does not already
// do.
//
// The LAYOUT was not the problem and did not change — the pair still sits under
// the control, which is the one arrangement that works for an input, a textarea
// and a select alike (putting a ✓ inside a field's right edge does not).

export type SaveState = 'idle' | 'saving' | 'saved'

// Shared button metrics. The only difference between the two sizes is the step:
// h-7/text-sm inline, h-8/text-base in a footer.
const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-btn font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'
const BTN_QUIET = 'text-muted hover:text-text hover:bg-white/6'
// The app's single destructive treatment: alert text, quiet alert-tinted hover.
// Never a filled/bright button.
const BTN_DANGER = 'text-alert hover:bg-alert/10'
const BTN_PRIMARY = 'bg-text text-bg font-semibold hover:bg-text/90'

export function FormActions({
  onSave,
  onCancel,
  state = 'idle',
  /** Nothing changed / the value is invalid → Save is unavailable. */
  disabled = false,
  /** Names the thing being saved, for the accessible labels. */
  label,
  /**
   * Second press of Cancel confirms. The button RELABELS to "Discard" in the
   * alert tone rather than a separate "Discard changes?" line appearing beside
   * it: the question and the control that answers it are then the same object,
   * it costs no layout, and the destructive step is the one that has to be
   * aimed at twice.
   */
  confirmDiscard = false,
}: {
  onSave: () => void
  onCancel: () => void
  state?: SaveState
  disabled?: boolean
  label: string
  confirmDiscard?: boolean
}) {
  const busy = state === 'saving'
  return (
    <>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label={
          confirmDiscard ? `Discard changes to ${label}` : `Cancel editing ${label}`
        }
        className={`h-7 px-2.5 text-sm ${BTN_BASE} ${confirmDiscard ? BTN_DANGER : BTN_QUIET}`}
      >
        {confirmDiscard ? 'Discard' : 'Cancel'}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || busy}
        aria-label={`Save ${label}`}
        title={disabled ? 'No changes to save' : undefined}
        className={`h-7 px-3 text-sm ${BTN_BASE} ${BTN_PRIMARY}`}
      >
        {busy && (
          <Loader2
            size="0.8125rem"
            strokeWidth={2.4}
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {state === 'saved' && !busy && <Check size="0.8125rem" strokeWidth={2.4} />}
        Save
      </button>
    </>
  )
}

// Footer variant for multi-field forms: the same two buttons a step larger,
// right-aligned, able to stick to the bottom of a long scrolling panel so Save
// is always reachable.
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
        className={`h-8 px-3 text-base ${BTN_BASE} ${BTN_QUIET}`}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || busy}
        title={disabled ? 'No changes to save' : undefined}
        className={`h-8 px-3.5 text-base ${BTN_BASE} ${BTN_PRIMARY}`}
      >
        {busy && (
          <Loader2
            size="0.8125rem"
            strokeWidth={2.4}
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {state === 'saved' && !busy && <Check size="0.8125rem" strokeWidth={2.4} />}
        {saveLabel}
      </button>
    </div>
  )
}
