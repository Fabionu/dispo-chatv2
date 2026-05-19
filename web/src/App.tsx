import { AuthProvider, useAuth } from './auth/AuthContext'
import SignIn from './pages/SignIn'
import Workspace from './pages/Workspace'

function Gate() {
  const auth = useAuth()

  if (auth.status === 'loading') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg text-muted text-[12px]">
        <div className="eyebrow">Loading</div>
      </div>
    )
  }

  if (auth.status === 'signed_out') {
    return <SignIn />
  }

  return <Workspace user={auth.user} workspace={auth.workspace} onSignOut={auth.signOut} />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
