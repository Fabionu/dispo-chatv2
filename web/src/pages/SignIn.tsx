import { useState } from 'react'
import { Box, Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

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

  function clearForm() {
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
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-[#181818] text-text">
      {/* LEFT — form. Sits directly on the near-black page, so the sign-in
          details read on a full-black surface. Pinned to the same near-black as
          the `bg` chat surface (#181818) so the login background matches the app
          and the `rail` marketing card floats a step lighter on top. */}
      <section className="relative flex flex-col px-8 sm:px-12 lg:px-16 py-8">
        {/* top bar */}
        <div className="flex items-center gap-6 text-[0.8125rem]">
          <button className="text-text hover:text-text/80 transition-colors">Help</button>
          <button className="text-muted hover:text-text transition-colors">EN</button>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-[27.5rem] w-full mx-auto py-12">
          {/* tabs */}
          <div className="flex items-center gap-6 border-b border-white/[0.08] mb-10">
            <TabButton
              active={isSignIn}
              onClick={() => {
                setTab('signin')
                clearForm()
              }}
            >
              Sign in
            </TabButton>
            <TabButton
              active={!isSignIn}
              onClick={() => {
                setTab('signup')
                clearForm()
              }}
            >
              Create workspace
            </TabButton>
          </div>

          {/* heading */}
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.2px] mb-2">
            {isSignIn ? 'Sign in to your account' : 'Create your workspace'}
          </h1>
          <p className="text-muted text-[0.8125rem] mb-7">
            {isSignIn
              ? 'Use your company email to access the dispatcher workspace.'
              : 'Set up a workspace for your transport company. You become the first admin.'}
          </p>

          {/* form */}
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
              placeholder="Type your email..."
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
                  placeholder="Type your password..."
                  autoComplete={isSignIn ? 'current-password' : 'new-password'}
                  required
                  className="w-full bg-transparent border border-white/[0.08] rounded-btn pl-3 pr-10 py-2.5 text-[0.84375rem] focus:outline-none focus:border-white/[0.22] transition-colors"
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
              <label className="flex items-center gap-2.5 pt-1 text-[0.8125rem] text-text cursor-pointer select-none">
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
              {submitting
                ? isSignIn
                  ? 'Signing in…'
                  : 'Creating workspace…'
                : isSignIn
                  ? 'Sign in'
                  : 'Create workspace'}
            </button>
          </form>

          <p className="text-center text-[0.78125rem] text-muted mt-6">
            {isSignIn ? (
              <>
                Need a workspace?{' '}
                <button
                  onClick={() => {
                    setTab('signup')
                    clearForm()
                  }}
                  className="text-text font-semibold hover:underline underline-offset-4"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setTab('signin')
                    clearForm()
                  }}
                  className="text-text font-semibold hover:underline underline-offset-4"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        {/* footer */}
        <div className="flex items-center justify-center gap-2 text-[0.71875rem] text-muted">
          <Lock size="0.6875rem" strokeWidth={1.5} />
          <span>Encrypted connection · SOC 2 Type II · GDPR compliant</span>
        </div>
      </section>

      {/* RIGHT — marketing. The details/stats live inside a card that uses the
          SIDEBAR surface (`rail`), so it floats as a lighter-grey panel on the
          near-black page. The section provides the surrounding black gutter so
          the card reads as visually detached. */}
      <section className="relative hidden lg:flex p-6">
        <div className="flex-1 flex flex-col bg-rail border border-white/[0.08] rounded-panel px-14 py-10">
        {/* logo */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-card border border-white/[0.1] bg-white/[0.03] flex items-center justify-center">
            <Box size="1.125rem" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[1.0625rem] font-semibold tracking-[-0.2px]">Dispo-chat</div>
            <div className="eyebrow mt-0.5">Transport operations</div>
          </div>
        </div>

        {/* hero */}
        <div className="flex-1 flex flex-col justify-center max-w-[40rem]">
          <div className="eyebrow mb-5">Dispatcher workspace</div>
          <h2 className="text-[2.75rem] leading-[1.08] font-semibold tracking-[-0.6px] mb-6">
            One workspace for every shipment, driver, and partner.
          </h2>
          <p className="text-muted text-[0.9375rem] leading-[1.55] max-w-[32.5rem]">
            Coordinate orders, exchange quotes, and follow each load through every milestone — from
            confirmation to POD.
          </p>

          {/* live stats */}
          <div className="mt-10 max-w-[35rem] rounded-card border border-white/[0.08] bg-white/[0.015] px-6 py-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-done" />
              <span className="eyebrow">Live · 19 May 2026</span>
            </div>
            <div className="grid grid-cols-4 gap-6">
              <Stat value="24" label="Active loads" />
              <Stat value="17" label="In transit" />
              <Stat value="4" label="At loading" />
              <Stat value="3" label="Delivered" />
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between text-[0.75rem] text-muted">
          <span>© 2026 Dispo-chat</span>
          <div className="flex items-center gap-6">
            <a className="hover:text-text transition-colors" href="#">
              Privacy
            </a>
            <a className="hover:text-text transition-colors" href="#">
              Terms
            </a>
            <a className="hover:text-text transition-colors" href="#">
              Status
            </a>
          </div>
        </div>
        </div>
      </section>
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

function TabButton({
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
      onClick={onClick}
      type="button"
      className={`relative pb-3 text-[0.875rem] transition-colors ${
        active ? 'text-text font-semibold' : 'text-muted hover:text-text font-medium'
      }`}
    >
      {children}
      {active && <span className="absolute left-0 right-0 -bottom-px h-[1.5px] bg-text" />}
    </button>
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-[1.625rem] leading-none font-semibold tabular-nums">{value}</div>
      <div className="eyebrow mt-2">{label}</div>
    </div>
  )
}
