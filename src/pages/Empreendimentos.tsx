import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { EmpreendimentoRecord, TipoEmpreendimento } from '@/types/entities'
import { formatCNPJ, isValidCNPJ, cleanCNPJ } from '@/lib/cnpj'
import {
  Building2,
  Plus,
  MoreVertical,
  MapPin,
  FileText,
  Edit2,
  Trash2,
  ExternalLink,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export default function Empreendimentos() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const {
    empreendimentos,
    faturas,
    addEmpreendimento,
    updateEmpreendimento,
    deleteEmpreendimento,
    loading,
  } = useData()
  const { toast } = useToast()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingEmp, setEditingEmp] = useState<EmpreendimentoRecord | null>(null)

  // Form states
  const [nome, setNome] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [endereco, setEndereco] = useState('')
  const [tipo, setTipo] = useState<TipoEmpreendimento | ''>('Comercial')
  const [cnpjError, setCnpjError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Delete modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [empToDelete, setEmpToDelete] = useState<EmpreendimentoRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const openCreateModal = () => {
    setEditingEmp(null)
    setNome('')
    setCnpj('')
    setEndereco('')
    setTipo('Comercial')
    setCnpjError(null)
    setModalOpen(true)
  }

  const openEditModal = (emp: EmpreendimentoRecord) => {
    setEditingEmp(emp)
    setNome(emp.nome)
    setCnpj(emp.cnpj)
    setEndereco(emp.endereco || '')
    setTipo(emp.tipo || 'Comercial')
    setCnpjError(null)
    setModalOpen(true)
  }

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCNPJ(e.target.value)
    setCnpj(formatted)
    const digits = cleanCNPJ(formatted)
    if (digits.length === 14) {
      if (!isValidCNPJ(formatted)) {
        setCnpjError('CNPJ inválido (dígito verificador incorreto)')
      } else {
        setCnpjError(null)
      }
    } else {
      setCnpjError(null)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!nome.trim()) {
      toast({
        title: 'Nome obrigatório',
        description: 'Informe o nome do empreendimento.',
        variant: 'destructive',
      })
      return
    }

    if (!isValidCNPJ(cnpj)) {
      setCnpjError('CNPJ inválido')
      toast({
        title: 'CNPJ inválido',
        description: 'Digite um CNPJ válido com 14 dígitos.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      if (editingEmp) {
        await updateEmpreendimento(editingEmp.id, {
          nome: nome.trim(),
          cnpj: cnpj.trim(),
          endereco: endereco.trim(),
          tipo: tipo as TipoEmpreendimento,
        })
        toast({
          title: 'Empreendimento atualizado',
          description: `Os dados de "${nome}" foram atualizados com sucesso.`,
        })
      } else {
        await addEmpreendimento({
          nome: nome.trim(),
          cnpj: cnpj.trim(),
          endereco: endereco.trim(),
          tipo: tipo as TipoEmpreendimento,
        })
        toast({
          title: 'Empreendimento cadastrado',
          description: `"${nome}" adicionado com sucesso.`,
        })
      }
      setModalOpen(false)
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao salvar',
        description: err.message || 'Verifique se o CNPJ já está cadastrado.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!empToDelete) return
    setDeleting(true)
    try {
      await deleteEmpreendimento(empToDelete.id)
      toast({
        title: 'Empreendimento removido',
        description: `"${empToDelete.nome}" foi excluído do sistema.`,
      })
      setDeleteConfirmOpen(false)
      setEmpToDelete(null)
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao excluir',
        description: err.message || 'Não foi possível excluir o empreendimento.',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Empreendimentos
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Cadastre os empreendimentos e unidades consumidoras para conferência de CNPJ.
          </p>
        </div>

        {isAdmin && (
          <Button
            onClick={openCreateModal}
            className="bg-teal-700 hover:bg-teal-800 text-white text-xs h-9 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Novo Empreendimento
          </Button>
        )}
      </div>

      {/* Grid of Enterprise Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {empreendimentos.map((emp) => {
          // Count invoices for this enterprise
          const empFaturas = faturas.filter((f) => f.empreendimento === emp.id)
          const faturasCount = empFaturas.length

          // Check which utilities are present
          const hasEnergia = empFaturas.some((f) => f.tipo_utilidade === 'Energia Elétrica')
          const hasAgua = empFaturas.some((f) => f.tipo_utilidade === 'Água e Esgoto')
          const hasGas = empFaturas.some((f) => f.tipo_utilidade === 'Gás')

          return (
            <Card
              key={emp.id}
              className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-teal-700" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm sm:text-base text-gray-900 leading-tight">
                        {emp.nome}
                      </h3>
                      <span className="text-[11px] font-mono text-gray-500 block mt-0.5">
                        CNPJ: {emp.cnpj}
                      </span>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        className="cursor-pointer text-xs"
                        onClick={() => navigate(`/faturas?enterprise=${emp.id}`)}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-2 text-teal-700" />
                        Ver Faturas
                      </DropdownMenuItem>
                      {isAdmin && (
                        <>
                          <DropdownMenuItem
                            className="cursor-pointer text-xs"
                            onClick={() => openEditModal(emp)}
                          >
                            <Edit2 className="w-3.5 h-3.5 mr-2 text-gray-600" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="cursor-pointer text-xs text-red-600 focus:text-red-700 focus:bg-red-50"
                            onClick={() => {
                              setEmpToDelete(emp)
                              setDeleteConfirmOpen(true)
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {emp.endereco && (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5 line-clamp-2 mt-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    {emp.endereco}
                  </p>
                )}

                {emp.tipo && (
                  <div className="mt-3">
                    <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {emp.tipo}
                    </span>
                  </div>
                )}
              </div>

              {/* Card Footer: Invoice Count & Utility dots */}
              <div className="mt-5 pt-3.5 border-t border-gray-100 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => navigate(`/faturas?enterprise=${emp.id}`)}
                  className="flex items-center gap-1.5 text-gray-600 hover:text-teal-700 font-medium group transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-400 group-hover:text-teal-700" />
                  <span>
                    {faturasCount} {faturasCount === 1 ? 'fatura' : 'faturas'}
                  </span>
                </button>

                {/* Utility Dots */}
                <div className="flex items-center gap-1.5" title="Utilidades cadastradas">
                  <span
                    className={`w-2.5 h-2.5 rounded-full transition-opacity ${
                      hasEnergia ? 'bg-[#F59E0B]' : 'bg-gray-200 opacity-40'
                    }`}
                    title="Energia Elétrica"
                  />
                  <span
                    className={`w-2.5 h-2.5 rounded-full transition-opacity ${
                      hasAgua ? 'bg-[#0EA5E9]' : 'bg-gray-200 opacity-40'
                    }`}
                    title="Água e Esgoto"
                  />
                  <span
                    className={`w-2.5 h-2.5 rounded-full transition-opacity ${
                      hasGas ? 'bg-[#14B8A6]' : 'bg-gray-200 opacity-40'
                    }`}
                    title="Gás"
                  />
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Modal: New / Edit Enterprise */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">
              {editingEmp ? 'Editar Empreendimento' : 'Novo Empreendimento'}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Cadastre o nome e CNPJ oficial do empreendimento para garantir a correta apuração das
              contas.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="nome" className="text-xs font-semibold text-gray-700">
                Nome do Empreendimento *
              </Label>
              <Input
                id="nome"
                required
                placeholder="Ex: Sede Administrativa, Galpão A..."
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="h-10 text-xs sm:text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cnpj" className="text-xs font-semibold text-gray-700">
                CNPJ * (com validação oficial)
              </Label>
              <Input
                id="cnpj"
                required
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={handleCnpjChange}
                maxLength={18}
                className={`h-10 text-xs sm:text-sm font-mono ${
                  cnpjError ? 'border-red-400 focus:ring-red-400' : ''
                }`}
              />
              {cnpjError && <p className="text-[11px] text-red-600 font-medium">{cnpjError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo" className="text-xs font-semibold text-gray-700">
                Tipo de Imóvel / Operação
              </Label>
              <Select value={tipo} onValueChange={(val: any) => setTipo(val)}>
                <SelectTrigger className="h-10 text-xs sm:text-sm">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Comercial">Comercial</SelectItem>
                  <SelectItem value="Industrial">Industrial</SelectItem>
                  <SelectItem value="Residencial">Residencial</SelectItem>
                  <SelectItem value="Misto">Misto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="endereco" className="text-xs font-semibold text-gray-700">
                Endereço Completo (opcional)
              </Label>
              <Input
                id="endereco"
                placeholder="Rua, Número, Bairro, Cidade - UF"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                className="h-10 text-xs sm:text-sm"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <DialogTitle className="text-base font-bold text-gray-900">
              Excluir empreendimento?
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-600 leading-relaxed">
              Tem certeza que deseja excluir &quot;{empToDelete?.nome}&quot;? Todas as faturas
              associadas a este empreendimento também serão removidas do sistema.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Confirmar Exclusão'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
