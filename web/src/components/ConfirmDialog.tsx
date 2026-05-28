import Modal from './Modal'

type Props = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  // 'alert' paints the confirm button in the destructive warm-red; 'default'
  // uses the standard primary.
  tone?: 'default' | 'alert'
  onConfirm: () => void
  onCancel: () => void
}

// Small yes/no confirmation built on the shared Modal shell. Used to guard
// destructive, hard-to-undo actions (e.g. deleting a message).
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button
            onClick={onCancel}
            className="text-[12px] font-medium rounded-btn px-3 py-1.5 border border-white/[0.14] text-text hover:bg-white/[0.04] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`text-[12px] font-semibold rounded-btn px-3 py-1.5 transition-colors ${
              tone === 'alert'
                ? 'bg-alert text-bg hover:bg-alert/90'
                : 'bg-text text-bg hover:bg-text/90'
            }`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-muted leading-[1.55]">{message}</p>
    </Modal>
  )
}
