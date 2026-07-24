import {
  AuthProvider,
  useAuth,
  type User,
  type Workspace as WorkspaceT,
} from './auth/AuthContext'
import SignIn from './pages/SignIn'
import Workspace from './pages/Workspace'
import InviteRegister from './pages/InviteRegister'
import Spinner from './components/Spinner'
import { MessageCacheProvider } from './hooks/useMessageCache'
import { useEffect } from 'react'
import { syncBrowserNotificationSubscription } from './lib/browserNotifications'

function SignedInWorkspace({
  user,
  workspace,
  onSignOut,
}: {
  user: User
  workspace: WorkspaceT
  onSignOut: () => Promise<void>
}) {
  useEffect(() => {
    void syncBrowserNotificationSubscription()
  }, [user.id])

  return (
    <MessageCacheProvider userId={user.id}>
      <Workspace user={user} workspace={workspace} onSignOut={onSignOut} />
    </MessageCacheProvider>
  )
}

// No router in this app — match the public invite path off the URL. `/invite/<token>`
// renders the registration page regardless of auth state; on success the page
// rewrites the path to `/` and refreshes auth, so the gate below takes over.
function inviteToken(): string | null {
  const m = window.location.pathname.match(/^\/invite\/([^/]+)\/?$/)
  return m ? decodeURIComponent(m[1]) : null
}

function Gate() {
  const auth = useAuth()

  const token = inviteToken()
  if (token) return <InviteRegister token={token} />

  if (auth.status === 'loading') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg">
        <Spinner size={26} label="Loading" />
      </div>
    )
  }

  if (auth.status === 'signed_out') {
    return <SignIn />
  }

  return <SignedInWorkspace user={auth.user} workspace={auth.workspace} onSignOut={auth.signOut} />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
