import { useEffect, useState } from 'react'
import { Loader2, Users } from 'lucide-react'
import type { Group, WorkspaceMember } from '../lib/types'
import { api } from '../lib/api'
import Avatar from './Avatar'
import Modal from './Modal'

type Props = {
  onClose: () => void
  onCreated: (group: Group) => void
}

// Create a vehicle ROOM — the product's operational wording (one permanent
// room per truck, reused across trips and loads). Copy here says "room"
// everywhere; the backend group/vehicle objects and API calls are untouched.
export default function CreateVehicleGroupModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [tractorPlate, setTractorPlate] = useState('')
  const [trailerPlate, setTrailerPlate] = useState('')
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.workspace
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => {})
      .finally(() => setMembersLoaded(true))
  }, [])

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (!name.trim()) {
      setError('Give the room a name.')
      return
    }
    setSubmitting(true)
    setError(null)
    const nameTrim = name.trim()
    const tractorTrim = tractorPlate.trim()
    const trailerTrim = trailerPlate.trim()
    try {
      const { group } = await api.groups.createVehicle({
        name: nameTrim,
        tractorPlate: tractorTrim || undefined,
        trailerPlate: trailerTrim || undefined,
        memberIds: [...selected],
      })
      const now = new Date().toISOString()
      // Build an optimistic Group from the form fields so the rail can
      // render the row before refreshGroups() catches up.
      onCreated({
        id: group.id,
        type: 'vehicle',
        name: nameTrim,
        description: null,
        meta: {
          ...(tractorTrim ? { tractorPlate: tractorTrim } : {}),
          ...(trailerTrim ? { trailerPlate: trailerTrim } : {}),
        },
        lastMessageAt: null,
        lastReadAt: now,
        createdAt: now,
        memberCount: 1 + selected.size,
        unreadCount: 0,
        directPeer: null,
      })
    } catch {
      setError('Could not create the room. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="New vehicle room"
      subtitle="A permanent room for one truck, reused across every trip and load."
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="h-8 px-3 text-[0.78125rem] text-muted hover:text-text border border-white/[0.12] rounded-btn transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="h-8 px-3.5 text-[0.78125rem] font-semibold bg-text text-bg rounded-btn hover:bg-text/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 size="0.8125rem" strokeWidth={2.2} className="animate-spin" />}
            {submitting ? 'Creating…' : 'Create room'}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <ModalField label="Room name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Truck B-123-ABC"
            className="modal-input"
          />
        </ModalField>

        {/* Plates sit side-by-side where there's width, stack cleanly when the
            modal is squeezed on narrow screens. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ModalField label="Tractor reg. number">
            <input
              value={tractorPlate}
              onChange={(e) => setTractorPlate(e.target.value)}
              placeholder="B-123-ABC"
              className="modal-input font-mono"
            />
          </ModalField>
          <ModalField label="Trailer reg. number">
            <input
              value={trailerPlate}
              onChange={(e) => setTrailerPlate(e.target.value)}
              placeholder="B-456-XYZ"
              className="modal-input font-mono"
            />
          </ModalField>
        </div>

        {/* Members — avatar-led rows in a quiet card list; the checkbox is the
            project's custom one and the whole row toggles. Rendered only after
            the fetch settles so the section doesn't flash between states. */}
        {membersLoaded && (
          <div>
            <div className="eyebrow mb-2">Add members</div>
            {members.length > 0 ? (
              <div className="max-h-44 overflow-y-auto rounded-card border border-white/[0.06] py-1">
                {members.map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer transition-colors ${
                      selected.has(m.id) ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <Avatar userId={m.id} name={m.displayName} size={26} />
                    <span className="text-[0.78125rem] text-text flex-1 truncate">
                      {m.displayName}
                    </span>
                    <span className="text-[0.6875rem] text-faint capitalize shrink-0">{m.role}</span>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggleMember(m.id)}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-white/[0.06] px-3 py-4 flex flex-col items-center text-center">
                <div className="h-8 w-8 rounded-full border border-white/[0.06] bg-white/[0.03] flex items-center justify-center mb-2">
                  <Users size="0.875rem" strokeWidth={1.6} className="text-faint" />
                </div>
                <p className="text-[0.75rem] text-muted">No one else to add yet</p>
                <p className="text-[0.6875rem] text-faint mt-0.5">
                  You can invite members to the room later.
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-[0.75rem] text-alert border border-alert/30 bg-alert/5 rounded-card px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ModalField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[0.75rem] text-text mb-1.5">
        {label}
        {required && <span className="text-faint"> *</span>}
      </label>
      {children}
    </div>
  )
}
