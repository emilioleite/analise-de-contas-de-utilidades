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
  login: (email: string, password: string) => Promise<RecordModel>
  logout: () => void
  refreshUser: () => Promise<void>
  updateProfileName: (name: string) => Promise<void>
  requestPasswordReset: (email?: string) => Promise<{ error: any }>
  deactivateAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<RecordModel | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    // Listen to reactive authStore changes (login, logout, token refresh)
    const unsubscribe = pb.authStore.onChange((newToken, newRecord) => {
      if (isMounted) {
        setToken(newToken || null)
        setUser(newRecord || null)
      }
    })

    // Re-hydrate session from backend on mount:
    // Ensures role, status and permissions are strictly up-to-date even if the local
    // storage snapshot was saved before schema updates or role assignment.
    // Prevents rendering stale cached admin data when switching accounts.
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        setIsLoading(false)
      }
    }, 6000)

    const rehydrateSession = async () => {
      if (!pb.authStore.isValid || !pb.authStore.token) {
        // Clear any orphaned or invalid auth data
        pb.authStore.clear()
        if (isMounted) {
          setUser(null)
          setToken(null)
          setIsLoading(false)
        }
        clearTimeout(safetyTimeout)
        return
      }

      try {
        // First try authRefresh to validate the token and get the refreshed record
        const authData = await pb
          .collection('users')
          .authRefresh()
          .catch(() => null)

        if (isMounted && authData?.record) {
          // Explicitly save the fresh record to PocketBase authStore
          pb.authStore.save(authData.token, authData.record)
          setUser(authData.record)
          setToken(authData.token)
        } else if (pb.authStore.record?.id) {
          // If authRefresh did not return a record but token might still be usable, fallback to getOne
          const fresh = await pb
            .collection('users')
            .getOne(pb.authStore.record.id)
            .catch(() => null)
          if (isMounted && fresh) {
            pb.authStore.save(pb.authStore.token, fresh)
            setUser(fresh)
            setToken(pb.authStore.token)
          } else if (isMounted) {
            pb.authStore.clear()
            setUser(null)
            setToken(null)
          }
        } else if (isMounted) {
          pb.authStore.clear()
          setUser(null)
          setToken(null)
        }
      } catch (err) {
        console.warn('Erro durante reidratação de sessão:', err)
        if (isMounted) {
          pb.authStore.clear()
          setUser(null)
          setToken(null)
        }
      } finally {
        clearTimeout(safetyTimeout)
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    rehydrateSession()

    return () => {
      isMounted = false
      clearTimeout(safetyTimeout)
      unsubscribe()
    }
  }, [])

  const login = async (email: string, password: string): Promise<RecordModel> => {
    // 1. Purge any leftover or stale auth state prior to issuing the new auth request
    pb.authStore.clear()
    setUser(null)
    setToken(null)

    // 2. Perform authentication with credentials
    const authData = await pb.collection('users').authWithPassword(email.trim(), password)

    // 3. Atomically save and apply fresh session data
    pb.authStore.save(authData.token, authData.record)
    setUser(authData.record)
    setToken(authData.token)
    setIsLoading(false)

    return authData.record
  }

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
        login,
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
