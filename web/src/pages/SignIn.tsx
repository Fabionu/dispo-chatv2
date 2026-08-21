import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import AppMark from '../components/AppMark'
import VerificationNotice from '../components/auth/VerificationNotice'
import { FIELD_EDGE } from '../components/forms/fieldStyles'

type Tab = 'signin' | 'signup'

// ── Sign in / Create workspace ──────────────────────────────────────────────
// One centred column standing directly on the black canvas — no card, no
// segmented tab strip. The page has exactly one job, so it doesn't need chrome
// to say where to look: brand, heading, fields, action, and a single quiet line
// at the bottom to switch flows.
//
// The card was doing nothing the canvas wasn't already doing (a `rail`-toned
// panel on black is a tone step nobody reads as a container here), and the tab
// strip DUPLICATED the bottom switch link — two controls, same job, at opposite
// ends of the same surface. The bottom line is the survivor: it sits where you
// end up after reading the form, which is when "I don't have a workspace"
// actually occurs to you.
//
// Everything is on the shared token scales — the radius scale, the wash scale
// for fill/edge, the type scale, and the app's own field state progression
// (`FIELD_EDGE`), so this page can't drift away from the rest of the app.
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
      // TODO: `keep` is collected but not yet sent — the session cookie's
      // lifetime is fixed server-side. Left wired to the checkbox so the
      // control keeps working the day the API accepts it.
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

      {/* One centred column. `py` rather than a fixed viewport height so the
          taller signup form scrolls on short screens instead of clipping. */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
        <main className="w-full max-w-[26rem]">
          <div className="mb-9 flex items-center gap-2.5">
            <AppMark size={30} />
            <span className="text-2xl font-semibold tracking-[-0.01em]">Dispo-chat</span>
          </div>

          <h1 className="text-4xl font-semibold leading-tight tracking-[-0.03em]">
            {isSignIn ? 'Welcome back' : 'Create your workspace'}
          </h1>
          <p className="mt-2 text-lg leading-normal text-muted">
            {isSignIn
              ? 'Sign in to continue to your workspace.'
              : 'Set up your company workspace and the first administrator account.'}
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            {!isSignIn && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="companyName"
                  label="Company name"
                  value={companyName}
                  onChange={setCompanyName}
                  placeholder="Your company"
                  autoComplete="organization"
                  required
                />
                <Field
                  id="displayName"
                  label="Your name"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Full name"
                  autoComplete="name"
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
              autoFocus
              required
            />

            <div>
              <label className={LABEL_CLASS} htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignIn ? 'Enter your password' : 'At least 8 characters'}
                  autoComplete={isSignIn ? 'current-password' : 'new-password'}
                  required
                  className={`${FIELD_CLASS} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-card text-faint transition-colors hover:text-text focus-visible:text-text focus-visible:outline-none"
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
              <label className="flex w-fit cursor-pointer select-none items-center gap-2.5 text-base text-muted">
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
                className="rounded-card border border-alert/30 bg-alert/6 px-3 py-2.5 text-base text-alert"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="group flex h-10 w-full items-center justify-center gap-2 rounded-btn bg-text text-lg font-semibold text-bg transition-colors hover:bg-text/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? isSignIn
                  ? 'Signing in…'
                  : 'Creating workspace…'
                : isSignIn
                  ? 'Sign in'
                  : 'Create workspace'}
              {submitting ? (
                <Loader2 size="0.9375rem" strokeWidth={2.2} className="animate-spin" />
              ) : (
                <ArrowRight
                  size="0.9375rem"
                  strokeWidth={2.2}
                  className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              )}
            </button>
          </form>

          {/* The ONLY flow switch on the page (the old tab strip did the same
              job at the top). A hairline separates it from the form so it reads
              as an aside, not a third form control. */}
          <p className="mt-8 border-t border-line pt-5 text-base text-muted">
            {isSignIn ? 'Need a workspace?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => switchTab(isSignIn ? 'signup' : 'signin')}
              className="font-semibold text-text underline-offset-4 transition-opacity hover:underline hover:opacity-80 focus-visible:outline-none focus-visible:underline"
            >
              {isSignIn ? 'Create one' : 'Sign in'}
            </button>
          </p>
        </main>
      </div>
    </div>
  )
}

// Faint operational texture: a fine grid fading out toward the edges, with one
// soft pool of light behind the column. Calmer than it needs to be on purpose —
// with the card gone, this is the only thing keeping the canvas from reading as
// an empty black rectangle, and anything louder would compete with the form.
function AuthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--color-wash) / 0.025) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-wash) / 0.025) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(circle at center, black, transparent 72%)',
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/2 blur-[120px]" />
    </div>
  )
}

const LABEL_CLASS = 'eyebrow mb-2 block'
// The app's field recipe (components/forms/fieldStyles) one size step up: same
// radius, same sunken fill, same hairline, and the SAME hover/focus progression
// imported directly — only the control height and text size change, because an
// auth field on a bare canvas is doing more work than a row in a dense panel.
const FIELD_CLASS =
  'w-full min-w-0 h-10 px-3 rounded-card border text-lg text-text ' +
  'placeholder:text-faint/70 outline-none ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ' +
  'motion-reduce:transition-none ' +
  FIELD_EDGE

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  autoFocus,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  autoFocus?: boolean
  required?: boolean
}) {
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        className={FIELD_CLASS}
      />
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
            className={`h-1 flex-1 rounded-full transition-colors motion-reduce:transition-none ${
              index < filled ? fillClass : 'bg-white/8'
            }`}
          />
        ))}
      </div>
      <div className={`mt-1.5 text-xs ${textClass}`}>Password strength: {label}</div>
    </div>
  )
}
