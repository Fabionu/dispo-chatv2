import { useState } from 'react'
import { Box, Lock } from 'lucide-react'

type Tab = 'signin' | 'signup'

export default function SignIn() {
  const [tab, setTab] = useState<Tab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [keep, setKeep] = useState(true)
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
      window.location.reload()
    } catch {
      setError('Network error.')
    } finally {
      setSubmitting(false)
      void keep
    }
  }

  const isSignIn = tab === 'signin'

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-bg text-text">
      {/* LEFT — form */}
      <section className="relative flex flex-col px-8 sm:px-12 lg:px-16 py-8">
        {/* top bar */}
        <div className="flex items-center gap-6 text-[13px]">
          <button className="text-text hover:text-text/80 transition-colors">Help</button>
          <button className="text-muted hover:text-text transition-colors">EN</button>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-[440px] w-full mx-auto py-12">
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
          <h1 className="text-[22px] font-semibold tracking-[-0.2px] mb-2">
            {isSignIn ? 'Sign in to your account' : 'Create your workspace'}
          </h1>
          <p className="text-muted text-[13px] mb-7">
            {isSignIn
              ? 'Use your company email to access the dispatcher workspace.'
              : 'Set up a workspace for your transport company. You become the first admin.'}
          </p>

          {/* test account note — only on sign-in */}
          {isSignIn && (
            <div className="rounded-btn border border-dashed border-white/[0.12] px-4 py-3 mb-6">
              <div className="eyebrow mb-1.5">Test account</div>
              <div className="font-mono text-[12.5px] leading-5 text-text/90">
                maroonyelnats@yahoo.com
                <br />
                123
              </div>
            </div>
          )}

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
              placeholder="dispatch@optima-logistics.eu"
              autoComplete="email"
              required
            />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12.5px] text-text" htmlFor="password">
                  Password
                </label>
                {isSignIn && (
                  <button
                    type="button"
                    className="text-[12px] text-muted hover:text-text transition-colors"
                  >
                    Forgot?
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignIn ? '••••••••••••' : 'At least 8 characters'}
                autoComplete={isSignIn ? 'current-password' : 'new-password'}
                required
                className="w-full bg-transparent border border-white/[0.08] rounded-btn px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-white/[0.22] transition-colors"
              />
            </div>

            {isSignIn && (
              <label className="flex items-center gap-2.5 pt-1 text-[13px] text-text cursor-pointer select-none">
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
              <div className="text-[12.5px] text-alert border border-alert/30 bg-alert/5 rounded-btn px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 bg-text text-bg font-semibold text-[13.5px] py-3 rounded-btn hover:bg-text/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting
                ? isSignIn
                  ? 'Signing in…'
                  : 'Creating workspace…'
                : isSignIn
                  ? 'Sign in'
                  : 'Create workspace'}
            </button>
          </form>

          <p className="text-center text-[12.5px] text-muted mt-6">
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
        <div className="flex items-center justify-center gap-2 text-[11.5px] text-muted">
          <Lock size={11} strokeWidth={1.5} />
          <span>Encrypted connection · SOC 2 Type II · GDPR compliant</span>
        </div>
      </section>

      {/* RIGHT — marketing */}
      <section className="relative hidden lg:flex flex-col aurora border-l border-white/[0.05] px-14 py-10">
        {/* logo */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-card border border-white/[0.1] bg-white/[0.03] flex items-center justify-center">
            <Box size={18} strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-[17px] font-semibold tracking-[-0.2px]">Dispo-chat</div>
            <div className="eyebrow mt-0.5">Transport operations</div>
          </div>
        </div>

        {/* hero */}
        <div className="flex-1 flex flex-col justify-center max-w-[640px]">
          <div className="eyebrow mb-5">Dispatcher workspace</div>
          <h2 className="text-[44px] leading-[1.08] font-semibold tracking-[-0.6px] mb-6">
            One workspace for every shipment, driver, and partner.
          </h2>
          <p className="text-muted text-[15px] leading-[1.55] max-w-[520px]">
            Coordinate orders, exchange quotes, and follow each load through every milestone — from
            confirmation to POD.
          </p>

          {/* live stats */}
          <div className="mt-10 max-w-[560px] rounded-card border border-white/[0.08] bg-white/[0.015] px-6 py-5">
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
        <div className="flex items-center justify-between text-[12px] text-muted">
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
      <label className="block text-[12.5px] text-text mb-1.5" htmlFor={id}>
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
        className="w-full bg-transparent border border-white/[0.08] rounded-btn px-3 py-2.5 text-[13.5px] focus:outline-none focus:border-white/[0.22] transition-colors"
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
      className={`relative pb-3 text-[14px] transition-colors ${
        active ? 'text-text font-semibold' : 'text-muted hover:text-text font-medium'
      }`}
    >
      {children}
      {active && <span className="absolute left-0 right-0 -bottom-px h-[1.5px] bg-text" />}
    </button>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-[26px] leading-none font-semibold tabular-nums">{value}</div>
      <div className="eyebrow mt-2">{label}</div>
    </div>
  )
}
