import { useEffect, useId, useRef, useState } from 'react'
import { Lock, Pencil } from 'lucide-react'
import { ICON_ACTION_SMALL } from '../HeaderIconButton'
import { FieldError, OptionalMark } from './FieldError'
import { FormActions, type SaveState } from './FormActions'
import { FIELD_LABEL, FIELD_ROW, FIELD_VALUE, fieldClass } from './fieldStyles'

export type EditableFieldProps = {
  label: string
  value?: string | null
  /** Read-only unless BOTH this and onSave are given — which is where each
   *  panel's permission rule lands (own profile / company admin / group
   *  manager). A locked field never renders a disabled-looking input. */
  editable?: boolean
  required?: boolean
  /** Marks a field the user may leave blank (quiet label suffix). */
  optional?: boolean
  /** Control shape. `select` needs `options`. */
  control?: 'input' | 'textarea' | 'select'
  /** Native input type for `control: 'input'` (text / tel / url / number …). */
  type?: string
  options?: ReadonlyArray<{ value: string; label: string }>
  placeholder?: string
  /** Small note on the label line — why a field is locked, how to format it. */
  hint?: string
  /** Return a message to block the save, or null when the value is acceptable.
   *  Runs on every keystroke so Save is disabled while the value is invalid. */
  validate?: (value: string) => string | null
  /** Persist just this field. Resolve → the row closes; reject → the row STAYS
   *  open with the user's text intact and a retryable error. */
  onSave?: (value: string) => Promise<void>
}

// ── One information row that edits in place ─────────────────────────────────
// Read by default: a muted label over a clean value. Editable rows reveal a
// pencil on hover/focus; clicking it swaps THIS row into a control with its own
// Save/Cancel, so fields are changed individually rather than through one
// all-or-nothing form mode.
//
// The states the row can be in, all visible without reading code:
//   read      label + value ("Not set" when empty), pencil on hover
//   locked    read, plus a small lock glyph and the reason as a hint
//   editing   control + Save/Cancel; Save is DISABLED until something actually
//             changed and the value validates
//   saving    control locked, Save spins, a second press is impossible
//   saved     Save flashes a check, then the row closes
//   invalid   alert edge + the message under the control
//   error     the save failed: the row stays open, the text is kept, retry
//   discard   cancelling with unsaved edits arms an inline confirm first
export default function EditableField({
  label,
  value,
  editable = false,
  required = false,
  optional = false,
  control = 'input',
  type = 'text',
  options,
  placeholder,
  hint,
  validate,
  onSave,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null)
  const errorId = useId()

  const current = value ?? ''
  const canEdit = editable && Boolean(onSave)
  const has = Boolean(current && current.trim())
  const displayValue = control === 'select' && has
    ? options?.find((o) => o.value === current)?.label ?? current
    : current

  // Dirty + validity drive whether Save is available at all.
  const dirty = draft.trim() !== current.trim()
  const requiredError = required && !draft.trim() ? `${label} is required.` : null
  const validationError = requiredError ?? (validate ? validate(draft) : null)
  // A validation message shows only once the user has actually touched the
  // value — opening an empty required field shouldn't greet them with an error.
  const shownError = saveError ?? (dirty ? validationError : null)
  const canSave = dirty && !validationError && state !== 'saving'

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    el?.focus()
    // Caret at the end rather than selecting everything.
    if (el && 'setSelectionRange' in el && control !== 'select') {
      const len = el.value?.length ?? 0
      try {
        el.setSelectionRange(len, len)
      } catch {
        /* number/date inputs reject setSelectionRange — harmless */
      }
    }
  }, [editing, control])

  function start() {
    setDraft(current)
    setSaveError(null)
    setConfirmDiscard(false)
    setState('idle')
    setEditing(true)
  }

  function close() {
    setEditing(false)
    setSaveError(null)
    setConfirmDiscard(false)
    setState('idle')
  }

  // Cancelling with unsaved edits arms an inline confirm instead of silently
  // dropping what was typed; a clean field closes straight away.
  function cancel() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    close()
  }

  async function commit() {
    if (!canSave || !onSave) return
    setState('saving')
    setSaveError(null)
    try {
      await onSave(draft.trim())
      setState('saved')
      // Let the check register, then close. The row is unmounted-safe: closing
      // is the only thing this timer does.
      window.setTimeout(close, 450)
    } catch {
      // Keep the user's text so nothing has to be retyped.
      setState('idle')
      setSaveError('Could not save. Try again.')
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (e.key === 'Enter' && (control !== 'textarea' || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void commit()
    }
  }

  if (editing) {
    const invalid = Boolean(shownError)
    const commonProps = {
      ref: inputRef as never,
      id: `${errorId}-control`,
      value: draft,
      onKeyDown,
      disabled: state === 'saving',
      'aria-invalid': invalid || undefined,
      'aria-describedby': invalid ? errorId : undefined,
      'aria-label': label,
    }

    return (
      <div className={FIELD_ROW}>
        <label htmlFor={`${errorId}-control`} className={`${FIELD_LABEL} mb-1 flex items-baseline gap-1.5`}>
          <span>
            {label}
            {required && <span className="text-faint"> *</span>}
          </span>
          {optional && !required && <OptionalMark />}
        </label>

        {control === 'textarea' ? (
          <textarea
            {...commonProps}
            rows={2}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            className={fieldClass({ invalid, multiline: true })}
          />
        ) : control === 'select' ? (
          <select
            {...commonProps}
            onChange={(e) => setDraft(e.target.value)}
            className={`${fieldClass({ invalid })} cursor-pointer`}
          >
            <option value="">Not set</option>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...commonProps}
            type={type}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            className={fieldClass({ invalid })}
          />
        )}

        <FieldError id={errorId}>{shownError}</FieldError>

        {/* Actions sit UNDER the control, identically for input, textarea and
            select — the one layout that works for every control type. */}
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          {confirmDiscard && (
            <span className="mr-auto text-xs leading-tight text-muted">Discard changes?</span>
          )}
          <FormActions
            label={label}
            state={state}
            disabled={!canSave}
            onSave={() => void commit()}
            onCancel={cancel}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`group ${FIELD_ROW}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${FIELD_LABEL} flex items-baseline gap-1.5`}>
          {label}
          {optional && !required && <OptionalMark />}
        </span>
        {hint && (
          <span className="shrink-0 inline-flex items-center gap-1 text-2xs text-faint">
            {!editable && <Lock size="0.625rem" strokeWidth={2} aria-hidden />}
            {hint}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <div className={`flex-1 ${FIELD_VALUE} ${has ? 'text-text' : 'text-faint'}`}>
          {has ? displayValue : 'Not set'}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={start}
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
            className={`${ICON_ACTION_SMALL} shrink-0 opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 focus:opacity-100`}
          >
            <Pencil size="0.75rem" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  )
}
