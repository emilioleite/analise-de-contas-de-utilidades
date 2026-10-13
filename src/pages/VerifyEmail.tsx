import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { CenteredCardLayout } from '@/components/CenteredCardLayout'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setError('Token de verificação não informado.')
      return
    }

    pb.collection('users')
      .confirmVerification(token)
      .then(() => {
        setSuccess(true)
        setLoading(false)
        setTimeout(() => {
          navigate('/login')
        }, 3000)
      })
      .catch((err) => {
        console.error(err)
        setError('Link de verificação inválido ou já utilizado.')
        setLoading(false)
      })
  }, [token, navigate])

  return (
    <CenteredCardLayout
      title="Verificação de e-mail"
      subtitle="Validando sua conta de usuário na corporação"
    >
      <div className="text-center space-y-4 py-2">
        {loading && (
          <div className="space-y-3">
            <Loader2 className="w-8 h-8 text-teal-600 animate-spin mx-auto" />
            <p className="text-xs text-gray-500">Confirmando autenticidade do e-mail...</p>
          </div>
        )}

        {!loading && success && (
          <div className="space-y-3">
            <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">E-mail verificado com sucesso!</h3>
            <p className="text-xs text-gray-500">
              Sua conta corporativa está pronta. Redirecionando para o login em instantes...
            </p>
            <div className="pt-2">
              <Link to="/login">
                <Button className="w-full bg-teal-700 hover:bg-teal-800 text-xs text-white">
                  Ir para login agora
                </Button>
              </Link>
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="space-y-3">
            <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900">Falha na verificação</h3>
            <p className="text-xs text-red-600">{error}</p>
            <div className="pt-2">
              <Link to="/login">
                <Button variant="outline" className="w-full text-xs">
                  Voltar ao login
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </CenteredCardLayout>
  )
}
