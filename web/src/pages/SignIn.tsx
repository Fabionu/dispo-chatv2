import { useState } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import VerificationNotice from '../components/auth/VerificationNotice'
import {
  AUTH_FIELD,
  AUTH_LABEL,
  AUTH_LINK,
  AuthAside,
  AuthButton,
  AuthField,
  AuthHeading,
  AuthNotice,
  AuthShell,
} from '../components/auth/authChrome'

type Tab = 'signin' | 'signup'

// ── Sign in / Create workspace ──────────────────────────────────────────────
// The signed-out page, drawn in the app's own geometry: an identity column and
// a form column split by one hairline, which is the rail↔thread seam you land
// on the moment you get in. The shell, the field recipe and the rest of the
// vocabulary live in components/auth/authChrome so this file is only the flow.
//
// Two decisions carried over from the previous pass, both still right:
//
//   No card. A `rail`-toned panel on black was never a container anybody read
//   as one, and the rework has no tone steps left to build it from anyway.
//
//   ONE flow switch, at the bottom. The old segmented tab strip duplicated the
//   bottom link — two controls, same job, opposite ends of the same surface.
//   The bottom line is the survivor: it sits where you end up after reading the
//   form, which is when "I don't have a workspace" actually occurs to you. What
//   the tab strip was also doing — saying which flow you are in — is now the
//   eyebrow above the heading, at the cost of one line and no control.
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
    <AuthShell>
      <AuthHeading
        eyebrow={isSignIn ? 'Sign in' : 'New workspace'}
        title={isSignIn ? 'Welcome back' : 'Create your workspace'}
      >
        {isSignIn
          ? 'Sign in to continue to your workspace.'
          : 'Set up your company workspace and the first administrator account.'}
      </AuthHeading>

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        {!isSignIn && (
          <div className="grid gap-4 sm:grid-cols-2">
            <AuthField
              id="companyName"
              label="Company name"
              value={companyName}
              onChange={setCompanyName}
              placeholder="Your company"
              autoComplete="organization"
              required
            />
            <AuthField
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

        <AuthField
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
          <label className={AUTH_LABEL} htmlFor="password">
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
              className={`${AUTH_FIELD} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-faint transition-colors hover:text-text focus-visible:text-text focus-visible:outline-none"
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

        {error && <AuthNotice live>{error}</AuthNotice>}

        <AuthButton
          busy={submitting}
          busyLabel={isSignIn ? 'Signing in…' : 'Creating workspace…'}
          trailing={
            <ArrowRight
              size="0.9375rem"
              strokeWidth={2.2}
              className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          }
        >
          {isSignIn ? 'Sign in' : 'Create workspace'}
        </AuthButton>
      </form>

      <AuthAside>
        {isSignIn ? 'Need a workspace?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => switchTab(isSignIn ? 'signup' : 'signin')}
          className={AUTH_LINK}
        >
          {isSignIn ? 'Create one' : 'Sign in'}
        </button>
      </AuthAside>
    </AuthShell>
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

// Four square segments and one readout. The segments used to be pills on a
// `white/8` wash; they are squared like every other corner in the app now, and
// the empty ones are drawn in `line` — the same hairline colour as the field
// they sit under, so an unfilled segment reads as the track rather than as a
// fifth tone.
//
// The readout is spelled out rather than given `.eyebrow`: that class sets a
// colour of its own, and at equal specificity a `text-alert` utility
// beside it wins or loses on file order (see the `.filter-tab-active` note in
// index.css). Spelling the recipe out keeps the state colour unambiguous.
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
            className={`h-1 flex-1 transition-colors motion-reduce:transition-none ${
              index < filled ? fillClass : 'bg-line'
            }`}
          />
        ))}
      </div>
      <div
        className={`mt-2 text-[length:var(--msg-label-size)] font-medium ${textClass}`}
      >
        Strength · {label}
      </div>
    </div>
  )
}
