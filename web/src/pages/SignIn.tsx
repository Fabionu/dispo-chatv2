import { useState } from 'react'
import { Box, Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

type Tab = 'signin' | 'signup'

// Focused, centered auth page — no marketing split, no hero. A subtle brand
// mark above a single panel-styled card (the same rail surface / panel radius
// as the app's shells), with the flow toggle and trust line kept quiet below.
// The form is the page. Auth calls, error mapping, and both flows (sign-in /
// create-workspace) are unchanged.
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
          const body = (await res.json().catch(() => ({}))) as { error?: string }
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
          body: JSON.stringify({
            email,
            password,
            displayName,
            companyName,
          }),
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
      }
      await refresh()
    } catch {
      setError('Network error.')
    } finally {
      setSubmitting(false)
      void keep
    }
  }

  const isSignIn = tab === 'signin'

  return (
    <div className="min-h-screen w-full flex flex-col bg-bg text-text">
      {/* Quiet top chrome — utility actions only, no nav. */}
      <header className="flex items-center justify-end gap-5 px-6 py-4 text-[0.8125rem]">
        <button type="button" className="text-muted hover:text-text transition-colors">
          Help
        </button>
        <button type="button" className="text-muted hover:text-text transition-colors">
          EN
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-[24.5rem]">
          {/* Brand — the same tile + wordmark scale the workspace sidebar uses,
              centered and small so it reads as identity, not a hero. */}
          <div className="flex flex-col items-center mb-7">
            <div className="h-11 w-11 rounded-card border border-white/[0.10] bg-white/[0.03] flex items-center justify-center">
              <Box size="1.25rem" strokeWidth={1.5} />
            </div>
            <div className="mt-3 text-[1rem] font-semibold tracking-[-0.2px]">Dispo-chat</div>
            <div className="eyebrow mt-1.5">Transport operations</div>
          </div>

          {/* Card — the app's panel surface (rail + panel radius), holding just
              the form. */}
          <div className="bg-rail border border-white/[0.08] rounded-panel px-6 py-6 sm:px-7 sm:py-7">
            <h1 className="text-[1.0625rem] font-semibold tracking-[-0.2px]">
              {isSignIn ? 'Sign in' : 'Create your workspace'}
            </h1>
            <p className="text-muted text-[0.8125rem] mt-1 mb-6">
              {isSignIn
                ? 'Use your company email to access the workspace.'
                : 'Set up a workspace for your transport company. You become the first admin.'}
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
              {!isSignIn && (
                <>
                  <Field
                    id="companyName"
                    label="Company name"
                    value={companyName}
                    onChange={setCompanyName}
                    placeholder="Optima Logistics"
                    autoComplete="organization"
                    required
                  />
                  <Field
                    id="displayName"
                    label="Your name"
                    value={displayName}
                    onChange={setDisplayName}
                    placeholder="Maria Stancu"
                    autoComplete="name"
                    required
                  />
                </>
              )}

              <Field
                id="email"
                label="Work email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="name@company.com"
                autoComplete="email"
                required
              />

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[0.78125rem] text-text" htmlFor="password">
                    Password
                  </label>
                  {isSignIn && (
                    <button
                      type="button"
                      className="text-[0.75rem] text-muted hover:text-text transition-colors"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isSignIn ? 'Your password' : 'At least 8 characters'}
                    autoComplete={isSignIn ? 'current-password' : 'new-password'}
                    required
                    className={`${FIELD_CLASS} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-faint hover:text-text transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff size="0.9375rem" strokeWidth={1.6} />
                    ) : (
                      <Eye size="0.9375rem" strokeWidth={1.6} />
                    )}
                  </button>
                </div>
                {/* Strength meter — only while creating a password (signup); on
                    sign-in you're entering an existing one, so it's not shown. */}
                {!isSignIn && password.length > 0 && <StrengthMeter password={password} />}
              </div>

              {isSignIn && (
                <label className="flex items-center gap-2.5 pt-0.5 text-[0.8125rem] text-text cursor-pointer select-none">
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
                <div className="text-[0.78125rem] text-alert border border-alert/30 bg-alert/5 rounded-card px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-1 bg-text text-bg font-semibold text-[0.84375rem] py-2.5 rounded-btn hover:bg-text/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting && (
                  <Loader2 size="0.9375rem" strokeWidth={2.2} className="animate-spin" />
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
          </div>

          {/* Flow toggle — outside the card so the form itself stays single-purpose. */}
          <p className="text-center text-[0.78125rem] text-muted mt-5">
            {isSignIn ? (
              <>
                Need a workspace?{' '}
                <button
                  type="button"
                  onClick={() => switchTab('signup')}
                  className="text-text font-semibold hover:underline underline-offset-4"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchTab('signin')}
                  className="text-text font-semibold hover:underline underline-offset-4"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-2 px-6 py-5 text-[0.71875rem] text-muted">
        <Lock size="0.6875rem" strokeWidth={1.5} />
        <span>Encrypted connection · SOC 2 Type II · GDPR compliant</span>
      </footer>
    </div>
  )
}

// The app's standard field recipe (rounded-card, faint fill, calm focus) — the
// same family as the route planner / trip form inputs, so sign-in doesn't keep
// its own input style.
const FIELD_CLASS =
  'w-full rounded-card border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-[0.84375rem] text-text placeholder:text-faint outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.05]'

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
        className={FIELD_CLASS}
      />
    </div>
  )
}

// Advisory password-strength scoring. Score 1–4 from length + character
// variety. The server still enforces the hard minimum (8 chars); this just
// nudges toward a stronger choice while creating a workspace.
function passwordStrength(pw: string): { score: number; label: string } {
  let raw = 0
  if (pw.length >= 8) raw++
  if (pw.length >= 12) raw++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) raw++
  if (/\d/.test(pw)) raw++
  if (/[^A-Za-z0-9]/.test(pw)) raw++
  const score = Math.min(4, Math.max(1, raw))
  const label = pw.length < 8 ? 'Too short' : ['', 'Weak', 'Fair', 'Good', 'Strong'][score]
  return { score, label }
}

function StrengthMeter({ password }: { password: string }) {
  const tooShort = password.length < 8
  const { score, label } = passwordStrength(password)
  // Themed tiers: alert (warm red) → active (tan) → done (muted green).
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
  // When too short we still light a single segment red as a warning.
  const filled = tooShort ? 1 : score
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < filled ? fillClass : 'bg-white/[0.08]'
            }`}
          />
        ))}
      </div>
      <div className={`mt-1 text-[0.6875rem] ${textClass}`}>Password strength: {label}</div>
    </div>
  )
}
