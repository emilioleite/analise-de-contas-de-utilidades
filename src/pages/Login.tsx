import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CenteredCardLayout } from '@/components/CenteredCardLayout'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (location.state as any)?.from?.pathname || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await pb.collection('users').authWithPassword(email, password)
      toast({
        title: 'Login efetuado com sucesso',
        description: 'Bem-vindo ao Gestor de Utilidades.',
      })
      navigate(from, { replace: true })
    } catch (err: any) {
      console.error('Falha no login:', err)
      setError('E-mail ou senha incorretos. Verifique suas credenciais.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <CenteredCardLayout
      title="Acesso corporativo"
      subtitle="Entre com suas credenciais autorizadas"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-semibold text-gray-700">
            E-mail institucional
          </Label>
          <div className="relative">
            <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="pl-9 h-10 border-gray-200 focus:border-teal-600 focus:ring-teal-600"
              placeholder="seu.email@empresa.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-semibold text-gray-700">
              Senha
            </Label>
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-xs text-teal-700 hover:text-teal-800 hover:underline font-medium"
            >
              Esqueci minha senha
            </button>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="pl-9 pr-9 h-10 border-gray-200 focus:border-teal-600 focus:ring-teal-600"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-10 bg-teal-700 hover:bg-teal-800 text-white font-medium shadow-sm transition-all active:scale-[0.98]"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Autenticando...
            </>
          ) : (
            'Entrar'
          )}
        </Button>

        <div className="pt-2 text-center">
          <p className="text-[11px] text-gray-400">Acesso restrito a membros da corporação.</p>
        </div>
      </form>
    </CenteredCardLayout>
  )
}
