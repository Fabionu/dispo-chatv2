import { AuthProvider, useAuth } from './auth/AuthContext'
import SignIn from './pages/SignIn'
import Workspace from './pages/Workspace'
import Spinner from './components/Spinner'
import { MessageCacheProvider } from './hooks/useMessageCache'

function Gate() {
  const auth = useAuth()

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

  return (
    <MessageCacheProvider userId={auth.user.id}>
      <Workspace user={auth.user} workspace={auth.workspace} onSignOut={auth.signOut} />
    </MessageCacheProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
