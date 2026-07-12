import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { GroupMember } from '../../lib/types'
import Avatar from '../Avatar'

type Props = {
  // The room's members — the ONLY people who can be assigned. The server also
  // re-validates membership on save, so a non-member can never be persisted.
  members: GroupMember[]
  // Currently-assigned driver user ids (already normalised/deduped by the caller).
  assignedIds: string[]
  canManage: boolean
  // Persist the new assignment. Rejects on failure so the control can surface a
  // retryable error and roll its optimistic state back.
  onSave: (ids: string[]) => Promise<void>
}

// Structured "assigned drivers" field for the vehicle-room Info tab. Replaces the
// old free-text note with a real member picker: managers open a popover of the
// room's members (drivers surfaced first) and toggle who drives, shown back as
// compact avatar chips. The selection writes `trip.assignedDriverIds` — the REAL
// user ids the mobile driver API filters on — so this is an OPERATIONAL room/trip
// assignment and does NOT change anyone's company role. Non-managers see the
// chips read-only.
export default function AssignedDrivers({ members, assignedIds, canManage, onSave }: Props) {
  const [open, setOpen] = useState(false)
  // Local selection while the picker is open — committed as ONE save on close so
  // assigning several people logs a single combined activity row, and an
  // unchanged edit collapses to a no-op.
  const [draft, setDraft] = useState<string[]>(assignedIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // The assigned members STILL in the room, in the room's driver-first order. Ids
  // whose member has since left are dropped from view (the server likewise drops
  // them on the next save), so a removed driver never lingers as a stale chip.
  const byId = new Map(members.map((m) => [m.id, m]))
  const assignedMembers = assignedIds
    .map((id) => byId.get(id))
    .filter((m): m is GroupMember => Boolean(m))

  // Drivers first (the intended assignees), then everyone else; each group
  // alphabetical so the picker is stable and scannable.
  const ordered = [...members].sort((a, b) => {
    const ad = a.userRole === 'driver' ? 0 : 1
    const bd = b.userRole === 'driver' ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.displayName.localeCompare(b.displayName)
  })

  function openPicker() {
    setDraft(assignedIds)
    setError(false)
    setOpen(true)
  }

  // Persist the draft if it differs from what's stored, then close. Shared by the
  // "Done" button, an outside click and Escape — a single commit path keeps the
  // activity log clean and dedupes an unchanged edit into a no-op.
  async function commit() {
    setOpen(false)
    const before = new Set(assignedIds)
    const changed = draft.length !== before.size || draft.some((id) => !before.has(id))
    if (!changed) return
    setSaving(true)
    setError(false)
    try {
      await onSave(draft)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  // Quick-remove a chip (managers) — an immediate save, independent of the picker.
  async function removeOne(id: string) {
    if (!assignedIds.includes(id)) return
    setSaving(true)
    setError(false)
    try {
      await onSave(assignedIds.filter((x) => x !== id))
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  function toggleDraft(id: string) {
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))
  }

  // Commit on an outside click or Escape while the picker is open. Escape is
  // captured and stopped so it closes ONLY the picker, not the whole panel
  // (GroupInfoPanel also closes on Escape). Re-registered whenever the draft
  // changes so the handlers always commit the latest selection.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) void commit()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        void commit()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, assignedIds])

  return (
    <div ref={rootRef} className="relative py-2 border-b border-white/[0.03] last:border-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="block text-[0.6875rem] text-faint">Assigned drivers</label>
        {canManage && (
          <button
            type="button"
            onClick={() => (open ? void commit() : openPicker())}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-muted hover:text-text transition-colors"
          >
            <Plus size="0.75rem" strokeWidth={1.9} />
            {assignedMembers.length ? 'Edit' : 'Assign'}
          </button>
        )}
      </div>

      {/* Selected drivers as compact avatar chips. */}
      {assignedMembers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {assignedMembers.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] border border-white/[0.06] pl-1 pr-2 py-0.5"
            >
              <Avatar userId={m.id} name={m.displayName} size={18} />
              <span className="text-[0.71875rem] text-text max-w-[9rem] truncate">
                {m.displayName}
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void removeOne(m.id)}
                  disabled={saving}
                  aria-label={`Remove ${m.displayName}`}
                  className="text-faint hover:text-alert transition-colors disabled:opacity-50"
                >
                  <X size="0.6875rem" strokeWidth={2} />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[0.71875rem] text-faint">No driver assigned</div>
      )}

      {error && <div className="text-[0.6875rem] text-alert mt-1">Could not save. Try again.</div>}

      {/* Member picker popover (managers only). A custom multi-select — never a
          browser <select> — of the room's members, each a toggle with avatar. */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-card border border-white/[0.1] bg-rail shadow-[0_12px_32px_rgba(0,0,0,0.5)] p-1">
          {members.length === 0 ? (
            <div className="text-[0.71875rem] text-faint px-2 py-3 text-center">
              No members to assign yet.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5">
              {ordered.map((m) => {
                const on = draft.includes(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleDraft(m.id)}
                    aria-pressed={on}
                    className={`flex items-center gap-2 h-10 px-2 rounded-btn text-left transition-colors ${
                      on ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <Avatar userId={m.id} name={m.displayName} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.78125rem] text-text truncate">
                        {m.displayName}
                      </span>
                      {m.userRole === 'driver' && (
                        <span className="block text-[0.625rem] text-faint leading-tight">Driver</span>
                      )}
                    </span>
                    <span
                      className={`h-5 w-5 shrink-0 flex items-center justify-center rounded-full border transition-colors ${
                        on ? 'bg-text text-bg border-transparent' : 'border-white/[0.16] text-transparent'
                      }`}
                    >
                      <Check size="0.75rem" strokeWidth={2.4} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex justify-end px-1 pt-1 pb-0.5">
            <button
              type="button"
              onClick={() => void commit()}
              className="h-7 px-3 rounded-btn bg-white/[0.08] text-text text-[0.71875rem] font-medium hover:bg-white/[0.12] transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
