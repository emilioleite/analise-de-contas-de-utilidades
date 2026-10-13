import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { CenteredCardLayout } from '@/components/CenteredCardLayout'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await pb.collection('users').requestPasswordReset(email)
      setSubmitted(true)
    } catch (err: any) {
      console.error(err)
      // Even if it fails (e.g. email not found), show standard security response
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <CenteredCardLayout
      title="Recuperação de acesso"
      subtitle="Informe o e-mail cadastrado na sua conta corporativa"
    >
      {submitted ? (
        <div className="text-center space-y-4">
          <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-teal-600" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-900">Verifique seu e-mail</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Se existir uma conta com este e-mail, enviaremos um link de redefinição de senha com
              validade de 24 horas.
            </p>
          </div>
          <div className="pt-2">
            <Link to="/login">
              <Button variant="outline" className="w-full text-xs">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Voltar para o login
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-semibold text-gray-700">
              E-mail corporativo
            </Label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                id="email"
                type="email"
                required
                className="pl-9 h-10 border-gray-200 focus:border-teal-600"
                placeholder="seu.email@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                Enviando link...
              </>
            ) : (
              'Enviar link de recuperação'
            )}
          </Button>

          <div className="text-center pt-2">
            <Link
              to="/login"
              className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Voltar ao login
            </Link>
          </div>
        </form>
      )}
    </CenteredCardLayout>
  )
}
