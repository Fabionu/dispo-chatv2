import { useEffect, useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api, ApiError } from '../lib/api'
import AppMark from '../components/AppMark'

type State = 'confirming' | 'success' | 'expired' | 'invalid' | 'error'

export default function EmailVerification({ token }: { token: string }) {
  const { refresh } = useAuth()
  const [state, setState] = useState<State>('confirming')

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    api.emailVerification
      .confirm(token)
      .then(() => {
        if (cancelled) return
        setState('success')
        timer = window.setTimeout(() => {
          window.history.replaceState({}, '', '/')
          void refresh()
        }, 900)
      })
      .catch((err) => {
        if (cancelled) return
        setState(
          err instanceof ApiError && err.code === 'verification_expired'
            ? 'expired'
            : err instanceof ApiError && err.code === 'verification_invalid'
              ? 'invalid'
              : 'error',
        )
      })
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [refresh, token])

  const failed = state === 'expired' || state === 'invalid' || state === 'error'
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="mx-auto flex w-full max-w-[72rem] items-center gap-3 px-5 py-5 sm:px-8">
        <AppMark size={30} />
        <span className="text-lg font-semibold">Dispo-chat</span>
      </header>
      <main className="flex min-h-[calc(100vh-74px)] items-center justify-center px-5 pb-20">
        <section className="w-full max-w-[27rem] rounded-panel border border-line bg-rail p-6 text-center">
          <div
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full border ${
              failed
                ? 'border-alert/30 bg-alert/[0.08] text-alert'
                : 'border-line bg-white/4'
            }`}
          >
            {state === 'confirming' ? (
              <Loader2 size="1.25rem" className="animate-spin" />
            ) : state === 'success' ? (
              <Check size="1.25rem" className="text-done" />
            ) : (
              <TriangleAlert size="1.25rem" />
            )}
          </div>
          <h1 className="mt-5 text-3xl font-semibold">
            {state === 'confirming'
              ? 'Confirming your email…'
              : state === 'success'
                ? 'Email confirmed'
                : state === 'expired'
                  ? 'This link has expired'
                  : state === 'invalid'
                    ? 'This link is not valid'
                    : 'Could not confirm your email'}
          </h1>
          <p className="mt-2 text-base leading-[1.5] text-muted">
            {state === 'success'
              ? 'Your account is active. Opening your workspace…'
              : state === 'expired'
                ? 'Return to sign in and request a new confirmation email.'
                : state === 'invalid'
                  ? 'The link may be incomplete or it was replaced by a newer one.'
                  : state === 'error'
                    ? 'Please try the link again or return to sign in.'
                    : 'This will only take a moment.'}
          </p>
          {failed && (
            <a
              href="/"
              className="mt-5 inline-flex h-10 items-center justify-center rounded-btn bg-text px-5 text-base font-semibold text-bg"
            >
              Go to sign in
            </a>
          )}
        </section>
      </main>
    </div>
  )
}

