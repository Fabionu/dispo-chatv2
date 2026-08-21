import { useState } from 'react'
import { ArrowLeft, Check, Mail } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import {
  AUTH_LINK,
  AuthAside,
  AuthButton,
  AuthHeading,
  AuthNotice,
  AuthShell,
} from './authChrome'

// The step after signup (and after signing in with an unverified address).
// Rendered BY the sign-in page in place of the form, so it goes through the
// SAME AuthShell — the identity column, the seam and the form column's measure
// never move, only the contents of that column change. That is the whole reason
// the shell is a shared component: a card or a differently-centred block here
// would make the flow look like it jumped to another screen when it only
// swapped one column.
export default function VerificationNotice({
  email,
  emailSent,
  onBack,
}: {
  email: string
  emailSent: boolean
  onBack: () => void
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(emailSent)
  const [error, setError] = useState<string | null>(null)

  async function resend() {
    setSending(true)
    setError(null)
    try {
      await api.emailVerification.resend(email)
      setSent(true)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'too_many_requests'
          ? 'Too many attempts. Please wait a few minutes.'
          : err instanceof ApiError && err.code === 'email_not_configured'
            ? 'Email delivery is not configured yet. Contact your administrator.'
            : 'The email could not be sent. Please try again.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <AuthShell>
      {/* A square hairline box, not a filled disc. The state marker is the
          glyph and its colour; the box is only there to give it an edge, the
          way every other box in the app gets one. */}
      <div className="mb-6 flex h-11 w-11 items-center justify-center border border-line">
        {sent ? (
          <Check size="1.25rem" strokeWidth={1.8} className="text-done" />
        ) : (
          <Mail size="1.25rem" strokeWidth={1.8} className="text-muted" />
        )}
      </div>

      <AuthHeading eyebrow="Verify email" title="Check your email">
        We sent a confirmation link to <span className="font-medium text-text">{email}</span>. The
        link is valid for 24 hours.
      </AuthHeading>

      {!sent && (
        <div className="mt-4">
          <AuthNotice>The first delivery did not complete. You can retry below.</AuthNotice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <AuthNotice live>{error}</AuthNotice>
        </div>
      )}

      <div className="mt-7">
        <AuthButton type="button" onClick={() => void resend()} busy={sending} busyLabel="Sending…">
          {sent ? 'Resend confirmation email' : 'Try sending again'}
        </AuthButton>
      </div>

      <AuthAside>
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex items-center gap-1.5 ${AUTH_LINK}`}
        >
          <ArrowLeft size="0.8125rem" strokeWidth={2.2} /> Back to sign in
        </button>
      </AuthAside>
    </AuthShell>
  )
}
