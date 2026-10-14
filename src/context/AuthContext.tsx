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
    // Initial check
    setUser(pb.authStore.record)
    setToken(pb.authStore.token)
    setIsLoading(false)

    // Listen to changes
    const unsubscribe = pb.authStore.onChange((newToken, newRecord) => {
      setToken(newToken)
      setUser(newRecord)
    })

    return () => {
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
      if (pb.authStore.isValid && pb.authStore.record) {
        const fresh = await pb.collection('users').getOne(pb.authStore.record.id)
        setUser(fresh)
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

  const userRole: UserRole = (user?.role as UserRole) || 'user'
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
