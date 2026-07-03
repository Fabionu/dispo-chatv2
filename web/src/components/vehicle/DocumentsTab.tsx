import { FileText, Upload } from 'lucide-react'
import { DOCUMENT_TYPES } from '../../lib/vehicleOps'

// Documents tab — STRUCTURE ONLY for now. The app's only file-upload path today
// is message attachments (POST /api/groups/:id/messages, multipart), which are
// chat-scoped, not room-level documents. Rather than fake a saved state or build
// a parallel uploader, this lays out the intended document types and an explicit
// disabled action.
//
// TODO(documents): wire real per-room documents. Reuse the existing attachment
// pipeline (server/src/routes/attachments.ts + middleware/upload.ts: streamed
// upload, storage.saveStream, optional preview job) behind a new
// `group_documents` table (group_id, type, attachment_id, uploaded_by) and a
// `POST /api/groups/:id/documents` route, then list/download them here. Do NOT
// build a separate upload system.
export default function DocumentsTab() {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">Documents</span>
        {/* Disabled on purpose — upload isn't wired yet (see TODO above). Kept
            visible so the capability is discoverable without pretending it works. */}
        <button
          type="button"
          disabled
          title="Document upload is coming soon"
          aria-disabled
          className="inline-flex items-center gap-1 text-[0.71875rem] text-faint cursor-not-allowed"
        >
          <Upload size="0.75rem" strokeWidth={1.8} /> Upload
        </button>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-center">
        <FileText size="1.25rem" strokeWidth={1.6} className="mx-auto text-faint" />
        <div className="text-[0.78125rem] text-muted mt-1.5">No documents yet</div>
        <div className="text-[0.71875rem] text-faint mt-0.5">
          Transport documents for this vehicle will appear here.
        </div>
      </div>

      {/* The document types this room is expected to hold — shown so the
          structure is clear ahead of upload support. */}
      <div className="eyebrow mt-4 mb-1.5">Document types</div>
      <div className="flex flex-wrap gap-1.5">
        {DOCUMENT_TYPES.map((t) => (
          <span
            key={t}
            className="inline-flex items-center rounded-chip border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 text-[0.6875rem] text-muted"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}
