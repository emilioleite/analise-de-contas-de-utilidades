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
  safeRefreshSession: () => Promise<boolean>
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
        // Se ambos forem nulos, foi um logout/clear explícito
        if (!newToken && !newRecord) {
          setToken(null)
          setUser(null)
          return
        }
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
        // Se receber 429 (Too Many Requests), timeout, offline ou erro de conexão, NUNCA revogar a sessão!
        if (status === 429) {
          console.warn(
            'rehydrateSession: limite de requisições (429) atingido. Mantendo token local.',
          )
          if (isMounted && pb.authStore.record) {
            setUser(pb.authStore.record)
            setToken(pb.authStore.token)
          }
          return
        }

        // Falha no rehydrateSession (inclusive 401 real, rede, timeout, 429):
        // NUNCA desloga ou chama clear() fora do logout explícito do usuário.
        // Mantém os dados da sessão local já hidratados do authStore.
        console.warn('rehydrateSession: falha ao atualizar sessão. Preservando sessão local:', err)
        if (isMounted && pb.authStore.record) {
          setUser(pb.authStore.record)
          setToken(pb.authStore.token)
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
    }, 300000) // Verifica a cada 5 minutos

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
            pb.authStore.save(authData.token, authData.record)
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
      } else if (pb.authStore.record) {
        setUser(pb.authStore.record)
      }
    } catch (_) {
      if (pb.authStore.record) {
        setUser(pb.authStore.record)
      }
    }
    if (pb.authStore.token) {
      setToken(pb.authStore.token)
    }
  }

  const lastRefreshTimestampRef = useRef<number>(0)

  // safeRefreshSession:
  // (a) Em 401 real do servidor, NÃO limpa o store — apenas retorna false, mantendo a sessão local e modal aberto;
  // (b) Em qualquer outro erro (rede, timeout, 429), mantém a sessão intacta e retorna false sem tocar no authStore;
  // (c) NUNCA chama pb.authStore.clear() fora do logout manual do usuário.
  const safeRefreshSession = async (): Promise<boolean> => {
    if (!pb.authStore.token) {
      return false
    }

    try {
      const authData = await pb.collection('users').authRefresh()
      if (authData?.record && authData?.token) {
        pb.authStore.save(authData.token, authData.record)
        setUser(authData.record)
        setToken(authData.token)
        lastRefreshTimestampRef.current = Date.now()
        return true
      }
      return false
    } catch (err: any) {
      const status = err?.status || err?.response?.status
      if (status === 401) {
        console.warn(
          'safeRefreshSession: 401 retornado pelo backend. Preservando sessão local e sem limpar store.',
        )
      } else if (status === 429) {
        console.warn(
          'safeRefreshSession: 429 (Too Many Requests). Preservando sessão local intacta.',
        )
      } else {
        console.warn(
          'safeRefreshSession: falha de rede/timeout/servidor. Preservando sessão local intacta:',
          err,
        )
      }
      // NUNCA limpa o store. Mantém sessão local e retorna false.
      return false
    }
  }

  const ensureValidSession = async (): Promise<boolean> => {
    if (!pb.authStore.token) {
      return false
    }

    // Se o token ainda é válido e foi renovado há menos de 5 minutos, evitar flood de chamadas ao backend
    const now = Date.now()
    if (pb.authStore.isValid && now - lastRefreshTimestampRef.current < 5 * 60 * 1000) {
      return true
    }

    const refreshed = await safeRefreshSession()
    if (refreshed) {
      return true
    }
    // Se não renovou, mantém sessão local válida se houver token
    return !!pb.authStore.token
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
        safeRefreshSession,
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
