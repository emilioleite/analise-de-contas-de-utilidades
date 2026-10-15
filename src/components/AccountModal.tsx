import React, { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useToast } from '@/hooks/use-toast'
import {
  User,
  Mail,
  ShieldCheck,
  KeyRound,
  UserX,
  Loader2,
  AlertTriangle,
  Check,
} from 'lucide-react'

interface AccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AccountModal({ open, onOpenChange }: AccountModalProps) {
  const { user, isAdmin, updateProfileName, requestPasswordReset, deactivateAccount } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [name, setName] = useState(user?.name || '')
  const [savingName, setSavingName] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  // Atualizar o nome local caso o usuário do context mude
  React.useEffect(() => {
    if (user?.name) {
      setName(user.name)
    }
  }, [user?.name])

  const initials = (() => {
    if (user?.name && user.name.trim()) {
      const parts = user.name.trim().split(/\s+/).filter(Boolean)
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      }
      return parts[0].slice(0, 2).toUpperCase()
    }
    if (user?.email && user.email.trim()) {
      return user.email.trim().slice(0, 2).toUpperCase()
    }
    return 'CO'
  })()

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast({
        title: 'Nome obrigatório',
        description: 'Por favor, digite seu nome completo.',
        variant: 'destructive',
      })
      return
    }

    setSavingName(true)
    try {
      await updateProfileName(name.trim())
      toast({
        title: 'Perfil atualizado',
        description: 'Seu nome foi alterado com sucesso.',
      })
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao atualizar',
        description: err.message || 'Não foi possível salvar seu nome.',
        variant: 'destructive',
      })
    } finally {
      setSavingName(false)
    }
  }

  const handleRequestPasswordReset = async () => {
    if (!user?.email) return
    setSendingReset(true)
    try {
      const { error } = await requestPasswordReset()
      if (error) throw error
      toast({
        title: 'E-mail de redefinição enviado',
        description: `Enviamos as instruções para ${user.email}. Verifique sua caixa de entrada.`,
      })
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao solicitar',
        description: err.message || 'Falha ao disparar o e-mail de redefinição.',
        variant: 'destructive',
      })
    } finally {
      setSendingReset(false)
    }
  }

  const handleDeactivateAccount = async () => {
    setDeactivating(true)
    try {
      await deactivateAccount()
      toast({
        title: 'Conta desativada',
        description: 'Sua conta foi desativada e sua sessão encerrada.',
      })
      setConfirmDeactivateOpen(false)
      onOpenChange(false)
      navigate('/login')
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao desativar conta',
        description: err.message || 'Não foi possível desativar sua conta.',
        variant: 'destructive',
      })
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <User className="w-5 h-5 text-teal-700" />
              Minha Conta
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Gerencie suas informações de perfil, redefinição de senha e acesso à plataforma.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Header info */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-lg">
              <Avatar className="w-12 h-12 rounded-full border border-gray-200">
                <AvatarFallback className="bg-teal-700 text-white font-semibold text-sm">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 truncate">
                <p className="text-sm font-bold text-gray-900 truncate">
                  {user?.name || 'Membro Corporativo'}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      isAdmin ? 'bg-purple-100 text-purple-800' : 'bg-teal-100 text-teal-800'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    {isAdmin ? 'Administrador' : 'Usuário Comum'}
                  </span>
                </div>
              </div>
            </div>

            {/* Form: Editar Nome */}
            <form onSubmit={handleSaveName} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="account-name" className="text-xs font-semibold text-gray-700">
                  Nome Completo
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="account-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="h-9 text-xs sm:text-sm"
                  />
                  <Button
                    type="submit"
                    disabled={savingName || name.trim() === user?.name}
                    className="h-9 text-xs bg-teal-700 hover:bg-teal-800 text-white shrink-0"
                  >
                    {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar'}
                  </Button>
                </div>
              </div>
            </form>

            {/* Section: Redefinir Senha */}
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <Label className="text-xs font-semibold text-gray-700 block">Segurança e Senha</Label>
              <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center gap-2.5">
                  <KeyRound className="w-4 h-4 text-teal-700 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-gray-800">Redefinir senha de acesso</p>
                    <p className="text-[11px] text-gray-400">
                      Enviaremos um link seguro para o seu e-mail cadastrado
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRequestPasswordReset}
                  disabled={sendingReset}
                  className="text-xs h-8 shrink-0"
                >
                  {sendingReset ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Solicitar e-mail'
                  )}
                </Button>
              </div>
            </div>

            {/* Section: Desativar Conta */}
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <Label className="text-xs font-semibold text-red-600 block">Zona de Atenção</Label>
              <div className="flex items-center justify-between p-3 rounded-lg border border-red-200 bg-red-50/50">
                <div className="flex items-center gap-2.5">
                  <UserX className="w-4 h-4 text-red-600 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-red-900">Desativar minha conta</p>
                    <p className="text-[11px] text-red-700">
                      Você perderá o acesso imediato. O histórico de faturas permanece preservado.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDeactivateOpen(true)}
                  className="text-xs h-8 text-red-600 hover:text-red-700 hover:bg-red-100 border-red-200 shrink-0"
                >
                  Desativar
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation modal for deactivating own account */}
      <Dialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <DialogTitle className="text-base font-bold text-gray-900">
              Tem certeza que deseja desativar sua conta?
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-600 leading-relaxed">
              Ao confirmar a desativação:
              <br />• Sua sessão será encerrada imediatamente.
              <br />• Você <strong>não conseguirá mais fazer login</strong> com seu e-mail e senha.
              <br />• Para reativar seu acesso no futuro, será necessário solicitar a um
              Administrador da empresa.
              <br />• Suas faturas, lançamentos e relatórios gerados continuam válidos no sistema.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeactivateOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={deactivating}
              onClick={handleDeactivateAccount}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            >
              {deactivating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Desativando...
                </>
              ) : (
                'Confirmar e Desativar Conta'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
