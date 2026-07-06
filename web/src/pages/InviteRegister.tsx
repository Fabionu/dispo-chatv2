import { useEffect, useState } from 'react'
import { Box, Building2, Eye, EyeOff, Loader2, Lock, TriangleAlert } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { api, ApiError } from '../lib/api'
import type { InviteValidation } from '../lib/types'

type Props = { token: string }

// Public registration via a company invite link. Mirrors the SignIn visual
// language (near-black form surface) but is a single, focused column. The
// company is fixed by the link, so the field is prefilled and read-only — the
// user only chooses who they are and a password. On success the account is
// created, the session cookie is set, and we drop the invite path so the auth
// gate renders the workspace.
export default function InviteRegister({ token }: Props) {
  const { refresh } = useAuth()
  const [validation, setValidation] = useState<InviteValidation | null>(null)
  const [checking, setChecking] = useState(true)

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.invite
      .validate(token)
      .then((v) => !cancelled && setValidation(v))
      .catch(() => !cancelled && setValidation({ status: 'invalid' }))
      .finally(() => !cancelled && setChecking(false))
    return () => {
      cancelled = true
    }
  }, [token])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await api.invite.accept(token, { email, password, displayName })
      // Account created + signed in (cookie set). Drop the invite path and let
      // the auth gate swap to the workspace.
      window.history.replaceState({}, '', '/')
      await refresh()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invite_used' || err.code === 'invite_expired' || err.code === 'invite_invalid') {
          // The link died between validation and submit — show the dead-link state.
          setValidation({ status: err.code === 'invite_used' ? 'used' : err.code === 'invite_expired' ? 'expired' : 'invalid' })
        } else {
          setError(
            err.code === 'email_taken'
              ? 'An account with that email already exists in this company.'
              : err.code === 'weak_password'
                ? 'Password must be at least 8 characters.'
                : err.code === 'too_many_requests'
                  ? 'Too many attempts. Try again in a little while.'
                  : err.code === 'invalid_input'
                    ? 'Check that all fields are filled in.'
                    : 'Something went wrong. Try again.',
          )
        }
      } else {
        setError('Network error.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-bg text-text flex flex-col">
      <div className="px-8 sm:px-12 lg:px-16 py-8 flex items-center gap-3">
        <div className="h-9 w-9 rounded-card border border-white/[0.1] bg-white/[0.03] flex items-center justify-center">
          <Box size="1.0625rem" strokeWidth={1.5} />
        </div>
        <div className="text-[0.9375rem] font-semibold tracking-[-0.2px]">Dispo-chat</div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
        <div className="w-full max-w-[26.25rem]">
          {checking ? (
            <div className="flex items-center justify-center gap-2 text-muted text-[0.8125rem] py-16">
              <Loader2 size="1rem" className="animate-spin" /> Checking invite…
            </div>
          ) : validation?.status === 'valid' ? (
            <>
              <h1 className="text-[1.375rem] font-semibold tracking-[-0.2px] mb-2">Join your team</h1>
              <p className="text-muted text-[0.8125rem] mb-7">
                Create your account to join{' '}
                <span className="text-text font-medium">{validation.companyName}</span> on Dispo-chat.
              </p>

              <form onSubmit={onSubmit} className="space-y-4">
                {/* Company — fixed by the invite, shown read-only so the user
                    knows exactly which company they're joining. */}
                <div>
                  <label className="block text-[0.78125rem] text-text mb-1.5">Company</label>
                  <div className="flex items-center gap-2 w-full bg-white/[0.03] border border-white/[0.08] rounded-btn px-3 py-2.5 text-[0.84375rem] text-muted">
                    <Building2 size="0.9375rem" strokeWidth={1.6} className="text-faint shrink-0" />
                    <span className="truncate">{validation.companyName}</span>
                  </div>
                </div>

                <Field
                  id="displayName"
                  label="Full name"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Maria Stancu"
                  autoComplete="name"
                  required
                />
                <Field
                  id="email"
                  label="Work email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="Type your email…"
                  autoComplete="email"
                  required
                />

                <div>
                  <label className="block text-[0.78125rem] text-text mb-1.5" htmlFor="password">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      required
                      className="w-full bg-transparent border border-white/[0.08] rounded-btn pl-3 pr-10 py-2.5 text-[0.84375rem] focus:outline-none focus:border-white/[0.22] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-faint hover:text-text transition-colors"
                    >
                      {showPassword ? <EyeOff size="0.9375rem" strokeWidth={1.6} /> : <Eye size="0.9375rem" strokeWidth={1.6} />}
                    </button>
                  </div>
                </div>

                <Field
                  id="confirm"
                  label="Confirm password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={setConfirm}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  required
                />

                {error && (
                  <div className="text-[0.78125rem] text-alert border border-alert/30 bg-alert/5 rounded-btn px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 bg-text text-bg font-semibold text-[0.84375rem] py-3 rounded-btn hover:bg-text/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 size="0.9375rem" strokeWidth={2.2} className="animate-spin" />}
                  {submitting ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            </>
          ) : (
            <DeadLink status={validation?.status ?? 'invalid'} />
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-[0.71875rem] text-muted pb-8">
        <Lock size="0.6875rem" strokeWidth={1.5} />
        <span>Encrypted connection · SOC 2 Type II · GDPR compliant</span>
      </div>
    </div>
  )
}

// Clean dead-link state for used / expired / invalid tokens.
function DeadLink({ status }: { status: 'used' | 'expired' | 'invalid' }) {
  const copy = {
    used: {
      title: 'This invite has already been used',
      body: 'Each invite link works only once. Ask your company admin for a new link.',
    },
    expired: {
      title: 'This invite link has expired',
      body: 'Invite links expire 15 minutes after they’re created. Ask your company admin for a fresh one.',
    },
    invalid: {
      title: 'This invite link isn’t valid',
      body: 'The link may be incomplete or mistyped. Ask your company admin to send it again.',
    },
  }[status]

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 h-11 w-11 rounded-full border border-alert/30 bg-alert/10 flex items-center justify-center text-alert">
        <TriangleAlert size="1.25rem" strokeWidth={1.8} />
      </div>
      <h1 className="text-[1.1875rem] font-semibold tracking-[-0.2px] mb-2">{copy.title}</h1>
      <p className="text-muted text-[0.8125rem] leading-[1.55] mb-6">{copy.body}</p>
      <a
        href="/"
        className="inline-flex items-center justify-center bg-text text-bg font-semibold text-[0.8125rem] px-5 py-2.5 rounded-btn hover:bg-text/90 transition-colors"
      >
        Go to sign in
      </a>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-[0.78125rem] text-text mb-1.5" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full bg-transparent border border-white/[0.08] rounded-btn px-3 py-2.5 text-[0.84375rem] focus:outline-none focus:border-white/[0.22] transition-colors"
      />
    </div>
  )
}
