import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './auth-context'

/** Production Site URL for auth emails — set VITE_APP_URL in Vercel so links never point at localhost. */
function getAppOrigin() {
  const configured = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, '')
  if (configured) return configured
  return window.location.origin
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${getAppOrigin()}/verify` },
    })
    return { data, error }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getAppOrigin()}/reset-password`,
    })
    return { data, error }
  }

  const updatePassword = async (newPassword) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword })
    return { data, error }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, resetPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export { useAuth } from './useAuth'
