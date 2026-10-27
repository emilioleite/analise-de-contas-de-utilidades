import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
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
  ensureValidSession: () => Promise<boolean>
  updateProfileName: (name: string) => Promise<void>
  requestPasswordReset: (email?: string) => Promise<{ error: any }>
  deactivateAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<RecordModel | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const ensureValidSessionRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))

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
      // Se tiver token salvo (mesmo com token expiry aproximando), preservar localmente
      if (!pb.authStore.token) {
        if (isMounted) {
          setUser(null)
          setToken(null)
          setIsLoading(false)
        }
        clearTimeout(safetyTimeout)
        return
      }

      // Pre-populate sync state immediately from local authStore so UI renders without flash
      if (isMounted && pb.authStore.record) {
        setUser(pb.authStore.record)
        setToken(pb.authStore.token)
      }

      try {
        // Tenta renovar preventivamente a sessão com authRefresh
        const authData = await pb.collection('users').authRefresh()

        if (isMounted && authData?.record) {
          pb.authStore.save(authData.token, authData.record)
          setUser(authData.record)
          setToken(authData.token)
        }
      } catch (err: any) {
        const status = err?.status || err?.response?.status
        const msg = err?.message || String(err)
        // Só purgar se houver confirmação explícita de token inválido/revogado pelo servidor (401/403)
        // Se for falha de rede/timeout/offline (ex: "Failed to fetch", status 0), NÃO purgar!
        const isConfirmedAuthRevocation =
          (status === 401 || status === 403) &&
          !msg.includes('Failed to fetch') &&
          !msg.includes('NetworkError')

        if (isConfirmedAuthRevocation) {
          // Tenta pb.collection('users').authRefresh() uma única vez mais após 1.5s de espera
          // Se tiver sucesso, salva e mantém a sessão; só se falhar novamente faz o clear.
          let recovered = false
          try {
            await new Promise((r) => setTimeout(r, 1500))
            const retryData = await pb.collection('users').authRefresh()
            if (retryData?.record && retryData?.token) {
              pb.authStore.save(retryData.token, retryData.record)
              if (isMounted) {
                setUser(retryData.record)
                setToken(retryData.token)
              }
              recovered = true
            }
          } catch {
            recovered = false
          }

          if (!recovered) {
            console.warn('Sessão revogada ou expirada no backend (401/403):', err)
            pb.authStore.clear()
            if (isMounted) {
              setUser(null)
              setToken(null)
            }
          }
        } else {
          // Falha transitória de rede ou timeout: preserva o token local
          console.warn('Falha transitória ao atualizar sessão, mantendo token local:', err)
          if (isMounted && pb.authStore.record) {
            setUser(pb.authStore.record)
            setToken(pb.authStore.token)
          }
        }
      } finally {
        clearTimeout(safetyTimeout)
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    rehydrateSession()

    const keepAlive = setInterval(() => {
      if (pb.authStore.token) {
        ensureValidSessionRef.current()
      }
    }, 180000)

    return () => {
      isMounted = false
      clearTimeout(safetyTimeout)
      clearInterval(keepAlive)
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

  const ensureValidSession = async (): Promise<boolean> => {
    if (!pb.authStore.token) {
      return false
    }
    try {
      const authData = await pb.collection('users').authRefresh()
      if (authData?.record) {
        pb.authStore.save(authData.token, authData.record)
        setUser(authData.record)
        setToken(authData.token)
        return true
      }
      return !!pb.authStore.token
    } catch (err: any) {
      // Falhas no authRefresh durante requisições longas ou oscilações de rede não devem
      // desconectar proativamente o usuário nem limpar o token local. Mantém a sessão local.
      console.warn('ensureValidSession: erro ao tentar refresh (preservando sessão local):', err)
      return !!pb.authStore.token
    }
  }
  ensureValidSessionRef.current = ensureValidSession

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
        ensureValidSession,
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
