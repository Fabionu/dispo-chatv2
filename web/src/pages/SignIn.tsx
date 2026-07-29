import { useState } from 'react'
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import AppMark from '../components/AppMark'
import VerificationNotice from '../components/auth/VerificationNotice'

type Tab = 'signin' | 'signup'

export default function SignIn() {
  const { refresh } = useAuth()
  const [tab, setTab] = useState<Tab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [keep, setKeep] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verification, setVerification] = useState<{
    email: string
    emailSent: boolean
  } | null>(null)

  function switchTab(next: Tab) {
    setTab(next)
    setError(null)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      if (tab === 'signin') {
        const res = await fetch('/api/auth/signin', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
            email?: string
          }
          if (body.error === 'email_not_verified') {
            setVerification({ email: body.email ?? email.trim().toLowerCase(), emailSent: true })
            return
          }
          setError(
            body.error === 'invalid_credentials'
              ? 'Incorrect email or password.'
              : 'Something went wrong. Try again.',
          )
          return
        }
      } else {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, displayName, companyName }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(
            body.error === 'email_taken'
              ? 'An account with that email already exists.'
              : body.error === 'weak_password'
                ? 'Password must be at least 8 characters.'
                : body.error === 'invalid_input'
                  ? 'Check that all fields are filled in.'
                  : 'Something went wrong. Try again.',
          )
          return
        }
        const body = (await res.json()) as {
          verificationRequired: true
          email: string
          emailSent: boolean
        }
        setVerification({ email: body.email, emailSent: body.emailSent })
        return
      }
      await refresh()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setSubmitting(false)
      void keep
    }
  }

  const isSignIn = tab === 'signin'

  if (verification) {
    return (
      <VerificationNotice
        email={verification.email}
        emailSent={verification.emailSent}
        onBack={() => {
          setVerification(null)
          setTab('signin')
          setPassword('')
        }}
      />
    )
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bg text-text">
      <AuthBackdrop />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="mx-auto flex w-full max-w-[72rem] items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
          <Brand />
          <span className="hidden text-xs font-medium uppercase tracking-eyebrow text-faint sm:block">
            Transport operations
          </span>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-4 sm:px-6 sm:py-5 lg:py-3">
          <section className="relative w-full max-w-[28rem] overflow-hidden rounded-panel border border-white/10 bg-rail shadow-modal">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent" />

            <div className="p-4 sm:p-5">
              <div className="mb-5 grid grid-cols-2 gap-1 rounded-card border border-white/6 bg-bg/80 p-1">
                <FlowTab active={isSignIn} onClick={() => switchTab('signin')}>
                  Sign in
                </FlowTab>
                <FlowTab active={!isSignIn} onClick={() => switchTab('signup')}>
                  Create workspace
                </FlowTab>
              </div>

              <div className="mb-5">
                <div className="eyebrow mb-2 text-muted">
                  {isSignIn ? 'Workspace access' : 'New workspace'}
                </div>
                <h1 className="text-4xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
                  {isSignIn ? 'Welcome back' : 'Create your workspace'}
                </h1>
                <p className="mt-1.5 text-base leading-[1.125rem] text-muted">
                  {isSignIn
                    ? 'Sign in with your company account to continue to Dispo-chat.'
                    : 'Set up your company workspace and create the first administrator account.'}
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-3">
                {!isSignIn && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id="companyName"
                      label="Company name"
                      value={companyName}
                      onChange={setCompanyName}
                      placeholder="Your company"
                      autoComplete="organization"
                      icon={Building2}
                      required
                    />
                    <Field
                      id="displayName"
                      label="Your name"
                      value={displayName}
                      onChange={setDisplayName}
                      placeholder="Full name"
                      autoComplete="name"
                      icon={User}
                      required
                    />
                  </div>
                )}

                <Field
                  id="email"
                  label="Work email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="name@company.com"
                  autoComplete="email"
                  icon={Mail}
                  required
                />

                <div>
                  <label className={LABEL_CLASS} htmlFor="password">
                    Password
                  </label>
                  <div className="group relative">
                    <LockKeyhole
                      size="0.9375rem"
                      strokeWidth={1.7}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint transition-colors group-focus-within:text-text"
                    />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isSignIn ? 'Enter your password' : 'At least 8 characters'}
                      autoComplete={isSignIn ? 'current-password' : 'new-password'}
                      required
                      className={`${FIELD_CLASS} pl-10 pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-faint transition-colors hover:text-text focus-visible:outline-none focus-visible:text-text"
                    >
                      {showPassword ? (
                        <EyeOff size="0.9375rem" strokeWidth={1.7} />
                      ) : (
                        <Eye size="0.9375rem" strokeWidth={1.7} />
                      )}
                    </button>
                  </div>
                  {!isSignIn && password.length > 0 && <StrengthMeter password={password} />}
                </div>

                {isSignIn && (
                  <label className="flex cursor-pointer select-none items-center gap-2.5 pt-0.5 text-sm text-muted">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={keep}
                      onChange={(e) => setKeep(e.target.checked)}
                    />
                    Keep me signed in on this device
                  </label>
                )}

                {error && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-card border border-alert/30 bg-alert/[0.07] px-3.5 py-2.5 text-base text-alert"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="group flex w-full items-center justify-center gap-2 rounded-btn bg-text px-4 py-2.5 text-base font-semibold text-bg transition-colors hover:bg-text/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-rail disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 size="0.9375rem" strokeWidth={2.2} className="animate-spin" />
                  ) : (
                    <ArrowRight
                      size="0.9375rem"
                      strokeWidth={2.2}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  )}
                  {submitting
                    ? isSignIn
                      ? 'Signing in…'
                      : 'Creating workspace…'
                    : isSignIn
                      ? 'Sign in'
                      : 'Create workspace'}
                </button>
              </form>

              <p className="mt-5 text-center text-sm text-muted">
                {isSignIn ? 'Need a workspace?' : 'Already have an account?'}{' '}
                <button
                  type="button"
                  onClick={() => switchTab(isSignIn ? 'signup' : 'signin')}
                  className="font-semibold text-text underline-offset-4 transition-opacity hover:opacity-80 hover:underline"
                >
                  {isSignIn ? 'Create one' : 'Sign in'}
                </button>
              </p>
            </div>
          </section>
        </main>

        <footer className="flex items-center justify-center gap-2 px-5 py-3 text-xs text-faint">
          <ShieldCheck size="0.8125rem" strokeWidth={1.6} />
          <span>Secure workspace access</span>
        </footer>
      </div>
    </div>
  )
}

function AuthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--color-wash) / 0.025) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-wash) / 0.025) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(circle at center, black, transparent 75%)',
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/2 blur-[110px]" />
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <AppMark size={30} />
      <div>
        <div className="text-lg font-semibold leading-none tracking-[-0.01em]">
          Dispo-chat
        </div>
        <div className="mt-1 text-2xs uppercase tracking-eyebrow text-faint sm:hidden">
          Transport operations
        </div>
      </div>
    </div>
  )
}

function FlowTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-btn px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
        active ? 'bg-white/10 text-text' : 'text-faint hover:text-muted'
      }`}
    >
      {children}
    </button>
  )
}

const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-muted'
const FIELD_CLASS =
  'w-full rounded-card border border-white/8 bg-bg/75 px-3 py-2.5 text-base text-text outline-none transition-colors placeholder:text-faint hover:border-white/16 focus:border-white/20 focus:bg-bg'

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  type = 'text',
  autoComplete,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  icon: typeof Mail
  type?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={id}>
        {label}
      </label>
      <div className="group relative">
        <Icon
          size="0.9375rem"
          strokeWidth={1.7}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint transition-colors group-focus-within:text-text"
        />
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={`${FIELD_CLASS} pl-10`}
        />
      </div>
    </div>
  )
}

function passwordStrength(password: string): { score: number; label: string } {
  let raw = 0
  if (password.length >= 8) raw++
  if (password.length >= 12) raw++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) raw++
  if (/\d/.test(password)) raw++
  if (/[^A-Za-z0-9]/.test(password)) raw++
  const score = Math.min(4, Math.max(1, raw))
  const label = password.length < 8 ? 'Too short' : ['', 'Weak', 'Fair', 'Good', 'Strong'][score]
  return { score, label }
}

function StrengthMeter({ password }: { password: string }) {
  const tooShort = password.length < 8
  const { score, label } = passwordStrength(password)
  const fillClass = tooShort
    ? 'bg-alert'
    : score >= 4
      ? 'bg-done'
      : score >= 2
        ? 'bg-active'
        : 'bg-alert'
  const textClass = tooShort
    ? 'text-alert'
    : score >= 4
      ? 'text-done'
      : score >= 2
        ? 'text-active'
        : 'text-alert'
  const filled = tooShort ? 1 : score

  return (
    <div className="mt-2.5">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index < filled ? fillClass : 'bg-white/8'
            }`}
          />
        ))}
      </div>
      <div className={`mt-1.5 text-xs ${textClass}`}>Password strength: {label}</div>
    </div>
  )
}
