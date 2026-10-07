import { useEffect, useState } from 'react'
import {
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  Show,
  SignIn,
  SignUp,
  useAuth,
} from '@clerk/react'
import { AppProvider } from '../context/AppContext'
import {
  canLoadApplication,
  clearAuthTokenGetter,
  setAuthTokenGetter,
  tenantStateKey,
} from './apiClient'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function SessionBridge({ children }) {
  const auth = useAuth()

  if (canLoadApplication(auth)) {
    setAuthTokenGetter(() => auth.getToken())
  }

  useEffect(() => {
    return () => clearAuthTokenGetter()
  }, [])

  if (!canLoadApplication(auth)) {
    return (
      <div className="auth-screen">
        <p>Loading…</p>
      </div>
    )
  }

  return <AppProvider key={tenantStateKey(auth.userId)}>{children}</AppProvider>
}

function SignInScreen() {
  const [mode, setMode] = useState('sign-in')

  return (
    <div className="auth-screen">
      <h1 className="auth-screen__title">Delm8 Ads Analyser</h1>
      <p className="auth-screen__text">
        Create an account or sign in. A new account gets its own organisation.
      </p>
      {mode === 'sign-up' ? <SignUp routing="hash" /> : <SignIn routing="hash" withSignUp />}
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')}
      >
        {mode === 'sign-up' ? 'Already have an account? Sign in' : 'Create an account'}
      </button>
    </div>
  )
}

export default function AuthGate({ children }) {
  if (!publishableKey) {
    return (
      <div className="auth-screen">
        <p>Sign-in is not configured.</p>
      </div>
    )
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkLoading>
        <div className="auth-screen">
          <p>Loading…</p>
        </div>
      </ClerkLoading>
      <ClerkFailed>
        <div className="auth-screen">
          <p>Sign-in could not be loaded.</p>
        </div>
      </ClerkFailed>
      <ClerkLoaded>
        <Show when="signed-out">
          <SignInScreen />
        </Show>
        <Show when="signed-in">
          <SessionBridge>{children}</SessionBridge>
        </Show>
      </ClerkLoaded>
    </ClerkProvider>
  )
}
