import React, { useState, useEffect, useMemo } from 'react'
import { usersService } from '@/services/users'
import { UserRecord, UserRole, UserStatus } from '@/types/entities'
import { useAuth } from '@/context/AuthContext'
import {
  Users as UsersIcon,
  UserPlus,
  Mail,
  Shield,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Clock,
  UserX,
  Search,
  MoreVertical,
  Edit2,
  Send,
  KeyRound,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Lock,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

export default function Usuarios() {
  const { user: currentUser, isAdmin } = useAuth()
  const { toast } = useToast()

  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('all')

  // Invite modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('user')
  const [inviting, setInviting] = useState(false)

  // Edit user modal
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('user')
  const [savingEdit, setSavingEdit] = useState(false)

  // Deactivate modal
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false)
  const [targetUser, setTargetUser] = useState<UserRecord | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const loadUsers = async () => {
    try {
      setLoading(true)
      const list = await usersService.listUsers()
      setUsers(list)
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao carregar usuários',
        description: err.message || 'Verifique suas permissões de administrador.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  // Handle Invite
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha o nome e o e-mail do colaborador.',
        variant: 'destructive',
      })
      return
    }

    setInviting(true)
    try {
      await usersService.inviteUser({
        name: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      })
      toast({
        title: 'Convite enviado com sucesso!',
        description: `O colaborador receberá o e-mail oficial para ativar a conta e definir a senha.`,
      })
      setInviteModalOpen(false)
      setInviteName('')
      setInviteEmail('')
      setInviteRole('user')
      await loadUsers()
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Falha ao convidar',
        description: err.message || 'Verifique se o e-mail já está cadastrado ou tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setInviting(false)
    }
  }

  // Handle Edit User
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return

    setSavingEdit(true)
    try {
      await usersService.updateUser(editingUser.id, {
        name: editName.trim(),
        role: editRole,
      })
      toast({
        title: 'Usuário atualizado',
        description: `Os dados de "${editName}" foram atualizados com sucesso.`,
      })
      setEditModalOpen(false)
      setEditingUser(null)
      await loadUsers()
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao atualizar usuário',
        description: err.message || 'Ocorreu um problema ao salvar as alterações.',
        variant: 'destructive',
      })
    } finally {
      setSavingEdit(false)
    }
  }

  // Handle Resend Invite or Password Reset
  const handleResendInviteOrReset = async (userRecord: UserRecord, isResendInvite = false) => {
    try {
      await usersService.sendPasswordReset(userRecord.email)
      toast({
        title: isResendInvite ? 'Convite reenviado!' : 'E-mail de redefinição enviado',
        description: `Instruções enviadas para ${userRecord.email}.`,
      })
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao enviar e-mail',
        description: err.message || 'Não foi possível disparar o e-mail.',
        variant: 'destructive',
      })
    }
  }

  // Toggle user activation (Deactivate / Reactivate)
  const handleToggleStatus = async () => {
    if (!targetUser) return
    const isDeactivating = targetUser.status !== 'inactive'
    setActionLoading(true)
    try {
      if (isDeactivating) {
        await usersService.deactivateUser(targetUser.id)
        toast({
          title: 'Conta desativada',
          description: `O acesso de "${targetUser.name || targetUser.email}" foi bloqueado. O histórico de dados permanece preservado.`,
        })
      } else {
        await usersService.activateUser(targetUser.id)
        toast({
          title: 'Conta reativada',
          description: `O acesso de "${targetUser.name || targetUser.email}" foi restabelecido.`,
        })
      }
      setDeactivateModalOpen(false)
      setTargetUser(null)
      await loadUsers()
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Falha na alteração',
        description: err.message || 'Não foi possível alterar o status do usuário.',
        variant: 'destructive',
      })
    } finally {
      setActionLoading(false)
    }
  }

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Role filter
      if (roleFilter !== 'all') {
        const uRole = (u.role || '').toLowerCase()
        const matchAdmin =
          roleFilter === 'admin' && (uRole === 'admin' || uRole === 'administrator')
        const matchUser = roleFilter === 'user' && uRole !== 'admin' && uRole !== 'administrator'
        if (!matchAdmin && !matchUser) return false
      }

      // Status filter
      if (statusFilter !== 'all') {
        const uStatus = u.status || 'active'
        if (uStatus !== statusFilter) return false
      }

      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase()
        const name = (u.name || '').toLowerCase()
        const email = (u.email || '').toLowerCase()
        if (!name.includes(query) && !email.includes(query)) return false
      }

      return true
    })
  }, [users, roleFilter, statusFilter, searchTerm])

  const renderStatusBadge = (status?: UserStatus, verified?: boolean) => {
    switch (status) {
      case 'pending':
        return (
          <span
            title="Convite enviado por e-mail, aguardando colaborador definir senha e ativar conta"
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs"
          >
            <Clock className="w-3 h-3 text-amber-600" />
            Pendente de ativação
          </span>
        )
      case 'inactive':
        return (
          <span
            title={
              verified === false
                ? 'Conta desativada pelo administrador (não ativada)'
                : 'Conta desativada pelo administrador. Acesso bloqueado.'
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 shadow-2xs"
          >
            <UserX className="w-3 h-3 text-red-600" />
            Inativo
          </span>
        )
      case 'active':
      default:
        return (
          <span
            title="Conta verificada e ativa. Acesso liberado ao sistema."
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs"
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Ativo
          </span>
        )
    }
  }

  const renderRoleBadge = (role?: string) => {
    const normalized = (role || '').trim().toLowerCase()
    if (normalized === 'admin' || normalized === 'administrator') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200">
          <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
          Administrador
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        <UsersIcon className="w-3.5 h-3.5 text-slate-500" />
        Usuário comum
      </span>
    )
  }

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center max-w-lg mx-auto mt-12 border-red-200 bg-red-50/50">
        <ShieldAlert className="w-12 h-12 text-red-600 mx-auto mb-3" />
        <h3 className="text-base font-bold text-gray-900">Acesso Restrito</h3>
        <p className="text-xs text-gray-600 mt-1">
          Apenas administradores do sistema têm permissão para acessar a gestão de colaboradores.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Gestão de Usuários
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Cadastre e convide os colaboradores da empresa para operar no Gestor de Utilidades.
          </p>
        </div>

        <Button
          onClick={() => {
            setInviteName('')
            setInviteEmail('')
            setInviteRole('user')
            setInviteModalOpen(true)
          }}
          className="bg-teal-700 hover:bg-teal-800 text-white text-xs h-9 shadow-sm"
        >
          <UserPlus className="w-3.5 h-3.5 mr-1.5" />
          Convidar Colaborador
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-[#E5E7EB] bg-white shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700 shrink-0">
            <UsersIcon className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              Total de Colaboradores
            </span>
            <p className="text-xl font-bold text-gray-900 leading-tight">{users.length}</p>
          </div>
        </Card>

        <Card className="p-4 border-[#E5E7EB] bg-white shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-700 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              Administradores
            </span>
            <p className="text-xl font-bold text-gray-900 leading-tight">
              {
                users.filter((u) => {
                  const r = (u.role || '').toLowerCase()
                  return r === 'admin' || r === 'administrator'
                }).length
              }
            </p>
          </div>
        </Card>

        <Card className="p-4 border-[#E5E7EB] bg-white shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              Convites Pendentes
            </span>
            <p className="text-xl font-bold text-gray-900 leading-tight">
              {users.filter((u) => u.status === 'pending').length}
            </p>
          </div>
        </Card>

        <Card className="p-4 border-[#E5E7EB] bg-white shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shrink-0">
            <UserX className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              Contas Inativas
            </span>
            <p className="text-xl font-bold text-gray-900 leading-tight">
              {users.filter((u) => u.status === 'inactive').length}
            </p>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="p-4 border-[#E5E7EB] bg-white shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Buscar por nome ou e-mail..."
              className="pl-9 h-9 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Role Filter */}
          <Select value={roleFilter} onValueChange={(val: any) => setRoleFilter(val)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Perfil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Perfis</SelectItem>
              <SelectItem value="admin">Administrador</SelectItem>
              <SelectItem value="user">Usuário Comum</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="pending">Pendentes de Ativação</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Users Table */}
      {loading ? (
        <Card className="p-12 text-center">
          <Loader2 className="w-6 h-6 text-teal-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-gray-500">Carregando lista de colaboradores...</p>
        </Card>
      ) : filteredUsers.length === 0 ? (
        <Card className="p-8 text-center border-dashed border-2 border-gray-200">
          <UsersIcon className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-gray-700">Nenhum colaborador encontrado</h3>
          <p className="text-xs text-gray-500 mt-1">
            Ajuste os filtros de busca ou convide um novo colaborador para a empresa.
          </p>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/75 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                  <th className="py-3 px-4">Colaborador</th>
                  <th className="py-3 px-4">E-mail</th>
                  <th className="py-3 px-4">Perfil</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                {filteredUsers.map((u) => {
                  const isCurrent = u.id === currentUser?.id
                  const initials = (u.name || u.email || 'U').slice(0, 2).toUpperCase()
                  const isInactive = u.status === 'inactive'
                  const isPending = u.status === 'pending'

                  return (
                    <tr
                      key={u.id}
                      className={`hover:bg-slate-50/75 transition-colors ${
                        isInactive ? 'opacity-60 bg-gray-50/50' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8 rounded-full border border-gray-200 shrink-0">
                            <AvatarFallback className="bg-teal-700 text-white font-medium text-xs">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                              {u.name || 'Sem nome cadastrado'}
                              {isCurrent && (
                                <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-teal-50 text-teal-700 border border-teal-200">
                                  Você
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-400">
                              Cadastrado em{' '}
                              {u.created ? new Date(u.created).toLocaleDateString('pt-BR') : '-'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-gray-600">{u.email}</td>
                      <td className="py-3.5 px-4">{renderRoleBadge(u.role)}</td>
                      <td className="py-3.5 px-4">{renderStatusBadge(u.status, u.verified)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              className="cursor-pointer text-xs"
                              onClick={() => {
                                const normRole: UserRole =
                                  (u.role || '').toLowerCase() === 'admin' ||
                                  (u.role || '').toLowerCase() === 'administrator'
                                    ? 'admin'
                                    : 'user'
                                setEditingUser(u)
                                setEditName(u.name || '')
                                setEditRole(normRole)
                                setEditModalOpen(true)
                              }}
                            >
                              <Edit2 className="w-3.5 h-3.5 mr-2 text-gray-600" />
                              Editar dados
                            </DropdownMenuItem>

                            {isPending && (
                              <DropdownMenuItem
                                className="cursor-pointer text-xs text-teal-700 focus:text-teal-800"
                                onClick={() => handleResendInviteOrReset(u, true)}
                              >
                                <Send className="w-3.5 h-3.5 mr-2" />
                                Reenviar convite
                              </DropdownMenuItem>
                            )}

                            {!isPending && (
                              <DropdownMenuItem
                                className="cursor-pointer text-xs"
                                onClick={() => handleResendInviteOrReset(u, false)}
                              >
                                <KeyRound className="w-3.5 h-3.5 mr-2 text-gray-600" />
                                Enviar redefinição
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            {/* Desativar / Reativar (não permite desativar a si próprio pelo admin na listagem para não se trancar) */}
                            {isInactive ? (
                              <DropdownMenuItem
                                className="cursor-pointer text-xs text-emerald-700 focus:text-emerald-800 focus:bg-emerald-50"
                                onClick={() => {
                                  setTargetUser(u)
                                  setDeactivateModalOpen(true)
                                }}
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-2" />
                                Reativar conta
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                disabled={isCurrent}
                                className={`cursor-pointer text-xs text-red-600 focus:text-red-700 focus:bg-red-50 ${
                                  isCurrent ? 'opacity-40 cursor-not-allowed' : ''
                                }`}
                                onClick={() => {
                                  if (isCurrent) return
                                  setTargetUser(u)
                                  setDeactivateModalOpen(true)
                                }}
                              >
                                <UserX className="w-3.5 h-3.5 mr-2" />
                                Desativar conta
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Convidar Colaborador */}
      <Dialog open={inviteModalOpen} onOpenChange={setInviteModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-teal-700" />
              Convidar Novo Colaborador
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              O colaborador receberá um e-mail com instruções para ativar sua conta e definir sua
              própria senha de acesso.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInvite} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name" className="text-xs font-semibold text-gray-700">
                Nome completo *
              </Label>
              <Input
                id="inv-name"
                required
                placeholder="Ex: Carlos Eduardo de Souza"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="h-10 text-xs sm:text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-email" className="text-xs font-semibold text-gray-700">
                E-mail corporativo *
              </Label>
              <Input
                id="inv-email"
                type="email"
                required
                placeholder="colaborador@empresa.com.br"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-10 text-xs sm:text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-role" className="text-xs font-semibold text-gray-700">
                Perfil de Acesso
              </Label>
              <Select value={inviteRole} onValueChange={(val: UserRole) => setInviteRole(val)}>
                <SelectTrigger className="h-10 text-xs sm:text-sm">
                  <SelectValue placeholder="Selecione o perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">
                    <div className="flex flex-col text-left py-1">
                      <span className="font-semibold text-gray-800">Usuário Comum</span>
                      <span className="text-[11px] text-gray-500">
                        Visualiza faturas, dashboards e emissões; lança faturas. Não cria
                        empreendimentos nem exclui dados.
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col text-left py-1">
                      <span className="font-semibold text-purple-800">Administrador</span>
                      <span className="text-[11px] text-gray-500">
                        Acesso total: gerencia usuários, convites, cria e edita empreendimentos e
                        exclui registros.
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteModalOpen(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={inviting}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
              >
                {inviting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Enviando convite...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 mr-2" />
                    Enviar Convite
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Editar Usuário */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              Editar Colaborador
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Atualize o nome ou o nível de privilégio do usuário no sistema.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEdit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-700">E-mail</Label>
              <Input
                disabled
                value={editingUser?.email || ''}
                className="h-10 text-xs sm:text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs font-semibold text-gray-700">
                Nome completo *
              </Label>
              <Input
                id="edit-name"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-10 text-xs sm:text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-role" className="text-xs font-semibold text-gray-700">
                Perfil de Acesso
              </Label>
              <Select value={editRole} onValueChange={(val: UserRole) => setEditRole(val)}>
                <SelectTrigger className="h-10 text-xs sm:text-sm">
                  <SelectValue placeholder="Selecione o perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário Comum</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditModalOpen(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={savingEdit}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
              >
                {savingEdit ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Alterações'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmar Desativação / Reativação */}
      <Dialog open={deactivateModalOpen} onOpenChange={setDeactivateModalOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                targetUser?.status === 'inactive'
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              {targetUser?.status === 'inactive' ? (
                <RotateCcw className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <DialogTitle className="text-base font-bold text-gray-900">
              {targetUser?.status === 'inactive' ? 'Reativar conta?' : 'Desativar colaborador?'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-600 leading-relaxed">
              {targetUser?.status === 'inactive' ? (
                <>
                  Deseja restabelecer o acesso de{' '}
                  <strong>&quot;{targetUser?.name || targetUser?.email}&quot;</strong>? Ele poderá
                  fazer login normalmente na plataforma com sua senha atual.
                </>
              ) : (
                <>
                  Tem certeza que deseja desativar o acesso de{' '}
                  <strong>&quot;{targetUser?.name || targetUser?.email}&quot;</strong>? O
                  colaborador não conseguirá mais fazer login. O histórico de faturas e dados
                  associados <strong>não será apagado</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeactivateModalOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={actionLoading}
              onClick={handleToggleStatus}
              className={`text-xs font-medium text-white ${
                targetUser?.status === 'inactive'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {actionLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Processando...
                </>
              ) : targetUser?.status === 'inactive' ? (
                'Confirmar Reativação'
              ) : (
                'Confirmar Desativação'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
