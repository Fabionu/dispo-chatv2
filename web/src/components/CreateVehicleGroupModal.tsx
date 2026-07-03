import { useEffect, useState } from 'react'
import type { Group, WorkspaceMember } from '../lib/types'
import { api } from '../lib/api'
import Modal from './Modal'

type Props = {
  onClose: () => void
  onCreated: (group: Group) => void
}

export default function CreateVehicleGroupModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [tractorPlate, setTractorPlate] = useState('')
  const [trailerPlate, setTrailerPlate] = useState('')
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.workspace
      .members()
      .then((r) => setMembers(r.members))
      .catch(() => {})
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
      setError('Give the group a name.')
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
      setError('Could not create the group. Try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="New vehicle chat"
      subtitle="A permanent channel for one truck, reused across every trip and load."
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="text-[0.78125rem] text-muted hover:text-text border border-white/[0.12] rounded-btn px-3 py-1.5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="text-[0.78125rem] font-semibold bg-text text-bg rounded-btn px-3.5 py-1.5 hover:bg-text/90 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create group'}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <ModalField label="Group name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Truck B-123-ABC"
            className="modal-input"
          />
        </ModalField>

        <div className="grid grid-cols-2 gap-3">
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

        {members.length > 0 && (
          <div>
            <div className="eyebrow mb-2">Add members</div>
            <div className="max-h-40 overflow-y-auto rounded-btn border border-white/[0.06] divide-y divide-white/[0.04]">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggleMember(m.id)}
                  />
                  <span className="text-[0.78125rem] flex-1 truncate">{m.displayName}</span>
                  <span className="text-[0.6875rem] text-faint capitalize">{m.role}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <div className="text-[0.75rem] text-alert">{error}</div>}
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
