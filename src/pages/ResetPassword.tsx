import React, { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { CenteredCardLayout } from '@/components/CenteredCardLayout'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()
  const { toast } = useToast()

  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('A senha deve conter no mínimo 8 caracteres.')
      return
    }

    if (password !== passwordConfirm) {
      setError('As senhas não coincidem.')
      return
    }

    if (!token) {
      setError('Token de recuperação inválido ou expirado.')
      return
    }

    setLoading(true)

    try {
      await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm)
      toast({
        title: 'Senha atualizada com sucesso',
        description: 'Faça login com sua nova credencial.',
      })
      navigate('/login')
    } catch (err: any) {
      console.error(err)
      setError('Falha ao redefinir senha. O link pode ter expirado.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <CenteredCardLayout title="Nova senha" subtitle="Defina sua nova senha de acesso à plataforma">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pass" className="text-xs font-semibold text-gray-700">
            Nova senha (mínimo 8 dígitos)
          </Label>
          <div className="relative">
            <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="pass"
              type={showPassword ? 'text' : 'password'}
              required
              className="pl-9 pr-9 h-10 border-gray-200 focus:border-teal-600"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pass-confirm" className="text-xs font-semibold text-gray-700">
            Confirmar nova senha
          </Label>
          <div className="relative">
            <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="pass-confirm"
              type={showPassword ? 'text' : 'password'}
              required
              className="pl-9 pr-9 h-10 border-gray-200 focus:border-teal-600"
              placeholder="••••••••"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-10 bg-teal-700 hover:bg-teal-800 text-white font-medium"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Gravando nova senha...
            </>
          ) : (
            'Definir nova senha'
          )}
        </Button>

        <div className="text-center pt-2">
          <Link to="/login" className="text-xs text-gray-500 hover:text-gray-800">
            Cancelar e voltar ao login
          </Link>
        </div>
      </form>
    </CenteredCardLayout>
  )
}
