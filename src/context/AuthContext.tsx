import React, { createContext, useContext, useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { RecordModel } from 'pocketbase'
import { UserRole, UserStatus } from '@/types/entities'

interface AuthContextType {
  user: RecordModel | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  userRole: UserRole
  userStatus: UserStatus
  logout: () => void
  refreshUser: () => Promise<void>
  updateProfileName: (name: string) => Promise<void>
  requestPasswordReset: (email?: string) => Promise<{ error: any }>
  deactivateAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<RecordModel | null>(pb.authStore.record)
  const [token, setToken] = useState<string | null>(pb.authStore.token)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    // Initial sync from local auth store snapshot
    setUser(pb.authStore.record)
    setToken(pb.authStore.token)

    // Listen to reactive authStore changes (login, logout, token refresh)
    const unsubscribe = pb.authStore.onChange((newToken, newRecord) => {
      if (isMounted) {
        setToken(newToken)
        setUser(newRecord)
      }
    })

    // Re-hydrate session from backend on mount:
    // Ensures role, status and permissions are strictly up-to-date even if the local
    // storage snapshot was saved before schema updates or role assignment.
    const rehydrateSession = async () => {
      if (!pb.authStore.isValid || !pb.authStore.token) {
        if (isMounted) setIsLoading(false)
        return
      }

      try {
        // First try authRefresh to validate the token and get the refreshed record
        const authData = await pb.collection('users').authRefresh()
        if (isMounted && authData?.record) {
          setUser(authData.record)
          setToken(authData.token)
        }
      } catch (refreshErr) {
        // If authRefresh failed (e.g. token expired), verify if we can still fetch the user record or clear
        try {
          if (pb.authStore.record?.id) {
            const fresh = await pb.collection('users').getOne(pb.authStore.record.id)
            if (isMounted) {
              // Update authStore with fresh data while preserving valid token
              pb.authStore.save(pb.authStore.token, fresh)
              setUser(fresh)
            }
          }
        } catch {
          // Token is truly invalid or revoked; clear stale credentials
          if (isMounted && !pb.authStore.isValid) {
            pb.authStore.clear()
            setUser(null)
            setToken(null)
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    rehydrateSession()

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
    setToken(null)
  }

  const refreshUser = async () => {
    try {
      if (pb.authStore.isValid && pb.authStore.token) {
        try {
          const authData = await pb.collection('users').authRefresh()
          if (authData?.record) {
            setUser(authData.record)
            setToken(authData.token)
            return
          }
        } catch (_) {
          // Fallback to getOne if authRefresh is not permitted
        }

        if (pb.authStore.record?.id) {
          const fresh = await pb.collection('users').getOne(pb.authStore.record.id)
          pb.authStore.save(pb.authStore.token, fresh)
          setUser(fresh)
        }
      } else {
        setUser(pb.authStore.record)
      }
    } catch (_) {
      setUser(pb.authStore.record)
    }
    setToken(pb.authStore.token)
  }

  const updateProfileName = async (name: string) => {
    if (!user) throw new Error('Usuário não logado')
    const updated = await pb.collection('users').update(user.id, { name })
    pb.authStore.save(pb.authStore.token, updated)
    setUser(updated)
  }

  const requestPasswordReset = async (targetEmail?: string) => {
    const emailToSend = targetEmail || user?.email
    if (!emailToSend) return { error: new Error('E-mail não fornecido') }
    try {
      await pb.collection('users').requestPasswordReset(emailToSend)
      return { error: null }
    } catch (error) {
      return { error }
    }
  }

  const deactivateAccount = async () => {
    if (!user) throw new Error('Usuário não logado')
    await pb.collection('users').update(user.id, { status: 'inactive' })
    logout()
  }

  // Case-insensitive & normalized role check: 'admin' or 'administrator'
  const rawRole = (user?.role || '').toString().trim().toLowerCase()
  const userRole: UserRole = rawRole === 'admin' || rawRole === 'administrator' ? 'admin' : 'user'
  const userStatus: UserStatus = (user?.status as UserStatus) || 'active'
  const isAdmin = userRole === 'admin'

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        isAdmin,
        userRole,
        userStatus,
        logout,
        refreshUser,
        updateProfileName,
        requestPasswordReset,
        deactivateAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de AuthProvider')
  }
  return context
}
