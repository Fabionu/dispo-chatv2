import { useState } from 'react'
import { ArrowLeft, Check, Loader2, Mail } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import AppMark from '../AppMark'

// The step after signup (and after signing in with an unverified address).
// Rendered BY the sign-in page in place of the form, so it shares that page's
// language exactly: same centred 26rem column on the bare canvas, same brand
// row, same button metrics. It deliberately has no card — a panel here would
// make the flow look like it jumped to a different screen when it only swapped
// the column's contents.
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
    <div className="relative min-h-screen w-full bg-bg text-text">
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <main className="w-full max-w-[26rem]">
          <div className="mb-9 flex items-center gap-2.5">
            <AppMark size={30} />
            <span className="text-2xl font-semibold tracking-[-0.01em]">Dispo-chat</span>
          </div>

          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white/4">
            {sent ? (
              <Check size="1.25rem" strokeWidth={1.8} className="text-done" />
            ) : (
              <Mail size="1.25rem" strokeWidth={1.8} className="text-muted" />
            )}
          </div>

          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.03em]">
            Check your email
          </h1>
          <p className="mt-2 text-lg leading-normal text-muted">
            We sent a confirmation link to <span className="font-medium text-text">{email}</span>.
            The link is valid for 24 hours.
          </p>

          {!sent && (
            <p className="mt-4 rounded-card border border-alert/30 bg-alert/6 px-3 py-2.5 text-base text-alert">
              The first delivery did not complete. You can retry below.
            </p>
          )}
          {error && (
            <p role="alert" aria-live="polite" className="mt-4 text-base text-alert">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={sending}
            onClick={() => void resend()}
            className="mt-7 flex h-10 w-full items-center justify-center gap-2 rounded-btn bg-text text-lg font-semibold text-bg transition-colors hover:bg-text/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? 'Sending…' : sent ? 'Resend confirmation email' : 'Try sending again'}
            {sending && <Loader2 size="0.9375rem" strokeWidth={2.2} className="animate-spin" />}
          </button>

          <p className="mt-8 border-t border-line pt-5 text-base text-muted">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 font-semibold text-text underline-offset-4 transition-opacity hover:underline hover:opacity-80 focus-visible:underline focus-visible:outline-none"
            >
              <ArrowLeft size="0.8125rem" strokeWidth={2.2} /> Back to sign in
            </button>
          </p>
        </main>
      </div>
    </div>
  )
}
