import { useState } from 'react'
import { ArrowLeft, Check, Loader2, Mail } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import AppMark from '../AppMark'

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
      <header className="mx-auto flex w-full max-w-[72rem] items-center px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <AppMark size={30} />
          <span className="text-lg font-semibold">Dispo-chat</span>
        </div>
      </header>
      <main className="flex min-h-[calc(100vh-74px)] items-center justify-center px-5 pb-20">
        <section className="w-full max-w-[27rem] rounded-panel border border-white/10 bg-rail p-6 text-center shadow-modal">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/4">
            {sent ? <Check size="1.25rem" className="text-done" /> : <Mail size="1.25rem" />}
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.025em]">
            Check your email
          </h1>
          <p className="mt-2 text-base leading-[1.5] text-muted">
            We sent a confirmation link to <span className="font-medium text-text">{email}</span>.
            The link is valid for 24 hours.
          </p>
          {!sent && (
            <p className="mt-3 rounded-card border border-alert/25 bg-alert/[0.06] px-3 py-2 text-sm text-alert">
              The first delivery did not complete. You can retry below.
            </p>
          )}
          {error && <p className="mt-3 text-sm text-alert">{error}</p>}
          <button
            type="button"
            disabled={sending}
            onClick={() => void resend()}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-btn bg-text text-base font-semibold text-bg disabled:opacity-60"
          >
            {sending && <Loader2 size="0.875rem" className="animate-spin" />}
            {sending ? 'Sending…' : sent ? 'Resend confirmation email' : 'Try sending again'}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
          >
            <ArrowLeft size="0.8125rem" /> Back to sign in
          </button>
        </section>
      </main>
    </div>
  )
}

