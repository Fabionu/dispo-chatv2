import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { ICON_ACTION_SMALL } from './HeaderIconButton'

type Props = {
  label: string
  value?: string | null
  /** When false (or no onSave), the row is display-only — no edit affordance. */
  editable?: boolean
  /** Blocks saving an empty value (e.g. a name). */
  required?: boolean
  /** Render a textarea instead of a single-line input. */
  multiline?: boolean
  placeholder?: string
  /** Small right-aligned note in the label row (e.g. "Set by an admin"). */
  hint?: string
  /** Persist just this field. Resolves on success (row closes), rejects to
   *  keep the row open with a retryable error. */
  onSave?: (value: string) => Promise<void>
}

// One information row that edits in place. Read by default — a muted label over
// a clean value with a hairline divider. Editable rows reveal a pencil on hover/
// focus; clicking it swaps just THIS row into an input with its own Save/Cancel,
// so fields are changed individually rather than through a single form mode.
// Empty values show a muted "Not set" placeholder, never an input box.
export default function EditableRow({
  label,
  value,
  editable = false,
  required = false,
  multiline = false,
  placeholder,
  hint,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  const current = value ?? ''
  const canEdit = editable && Boolean(onSave)
  const has = Boolean(current && current.trim())

  // Focus the field when entering edit mode.
  useEffect(() => {
    if (editing) {
      const el = inputRef.current
      el?.focus()
      // Put the caret at the end rather than selecting everything.
      const len = el?.value.length ?? 0
      el?.setSelectionRange(len, len)
    }
  }, [editing])

  function start() {
    setDraft(current)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function commit() {
    const next = draft.trim()
    if (required && !next) {
      setError(`${label} is required.`)
      return
    }
    if (next === current.trim()) {
      // No change — just close.
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave!(next)
      setEditing(false)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void commit()
    }
  }

  if (editing) {
    return (
      <div className="py-2 border-b border-white/[0.03] last:border-0">
        <label className="block text-[0.6875rem] text-faint mb-1">
          {label}
          {required && <span className="text-faint"> *</span>}
        </label>
        {/* Integrated edit control: a single pill-shaped field whose radius matches
            the circular Save/Cancel buttons that sit inside its right edge,
            vertically centered. The input's own right padding keeps long text
            from sliding under the buttons. */}
        <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] pr-0.5 transition-colors focus-within:border-white/[0.12] focus-within:bg-white/[0.05]">
          {multiline ? (
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={placeholder}
              className="flex-1 min-w-0 resize-none bg-transparent pl-4 pr-1 py-2 text-[0.78125rem] text-text placeholder:text-faint outline-none"
            />
          ) : (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="flex-1 min-w-0 bg-transparent pl-4 pr-1 py-2 text-[0.78125rem] text-text placeholder:text-faint outline-none"
            />
          )}
          <button
            onClick={() => void commit()}
            disabled={saving}
            aria-label={`Save ${label}`}
            title="Save"
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-text text-bg hover:bg-text/90 disabled:opacity-50 transition-colors"
          >
            <Check size="0.875rem" strokeWidth={2.2} />
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            aria-label={`Cancel editing ${label}`}
            title="Cancel"
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
          >
            <X size="0.875rem" strokeWidth={2} />
          </button>
        </div>
        {error && <div className="text-[0.6875rem] text-alert mt-1">{error}</div>}
      </div>
    )
  }

  return (
    <div className="group py-2 border-b border-white/[0.03] last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.6875rem] text-faint">{label}</span>
        {hint && <span className="text-[0.625rem] text-faint shrink-0">{hint}</span>}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <div className={`flex-1 text-[0.78125rem] break-words ${has ? 'text-text' : 'text-faint'}`}>
          {has ? current : 'Not set'}
        </div>
        {canEdit && (
          <button
            onClick={start}
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
            className={`${ICON_ACTION_SMALL} shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all`}
          >
            <Pencil size="0.75rem" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  )
}
