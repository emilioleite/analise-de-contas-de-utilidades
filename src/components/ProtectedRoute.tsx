import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import pb from '@/lib/pocketbase/client'
import { Loader2 } from 'lucide-react'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, user, token } = useAuth()
  const location = useLocation()

  // Se o contexto está em loading OU se o PocketBase ainda possui token/registro válido localmente
  // mas o estado do React ainda não sincronizou (ou durante refresh transitório de rede),
  // exibe o estado de carregamento e mantém a rota atual em vez de redirecionar precocemente para /login.
  const hasPbSession = Boolean(pb.authStore.isValid && (pb.authStore.token || pb.authStore.record))
  const hasLocalAuth = Boolean(isAuthenticated || (token && user) || hasPbSession)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin" />
          <p className="text-xs text-gray-500 font-medium">Carregando permissões...</p>
        </div>
      </div>
    )
  }

  // Só redireciona quando a sessão estiver REALMENTE ausente/revogada (sem authStore válido e sem auth local),
  // nunca durante estados de carregamento/refresh ou falha transitória de rede.
  if (!hasLocalAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
