import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '@/context/DataContext'
import { FaturaRecord, TipoUtilidade } from '@/types/entities'
import {
  formatCurrencyBRL,
  formatCompetencia,
  formatDateBR,
  formatCNPJ,
  cleanCNPJ,
} from '@/lib/cnpj'
import { faturasService } from '@/services/faturas'
import {
  FileText,
  Plus,
  Search,
  Filter,
  Eye,
  Edit2,
  Trash2,
  UploadCloud,
  Zap,
  Droplets,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  FileSpreadsheet,
  FileCheck,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

export default function Faturas() {
  const [searchParams] = useSearchParams()
  const enterpriseQuery = searchParams.get('enterprise') || 'Todos'

  const { faturas, empreendimentos, addFatura, updateFatura, deleteFatura, loading } = useData()
  const { toast } = useToast()

  // Filters state
  const [searchTerm, setSearchTerm] = useState('')
  const [tipoFilter, setTipoFilter] = useState<string>('Todas')
  const [empFilter, setEmpFilter] = useState<string>(enterpriseQuery)
  const [sortBy, setSortBy] = useState<string>('recente')

  // Keep empFilter updated if query param changes
  useEffect(() => {
    if (enterpriseQuery && enterpriseQuery !== 'Todos') {
      setEmpFilter(enterpriseQuery)
    }
  }, [enterpriseQuery])

  // Modals state
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const [selectedFatura, setSelectedFatura] = useState<FaturaRecord | null>(null)
  const [faturaToDelete, setFaturaToDelete] = useState<FaturaRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Upload multi-step state: 1 (dropzone), 2 (enterprise & utility), 3 (extracting & review form), 4 (success)
  const [step, setStep] = useState<number>(1)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [selectedEmpId, setSelectedEmpId] = useState<string>('')
  const [selectedTipo, setSelectedTipo] = useState<TipoUtilidade>('Energia Elétrica')
  const [extracting, setExtracting] = useState<boolean>(false)
  const [extractingStatus, setExtractingStatus] = useState<string>('')

  // Form values (for step 3 review and edit modal)
  const [competenciaInput, setCompetenciaInput] = useState<string>('') // MM/AAAA or YYYY-MM
  const [valorTotal, setValorTotal] = useState<number | string>('')
  const [consumo, setConsumo] = useState<number | string>('')
  const [unidadeConsumo, setUnidadeConsumo] = useState<string>('kWh')
  const [numeroFatura, setNumeroFatura] = useState<string>('')
  const [cnpjFornecedor, setCnpjFornecedor] = useState<string>('')
  const [vencimento, setVencimento] = useState<string>('')

  // Specific fields for Energia
  const [medicaoAnterior, setMedicaoAnterior] = useState<number | string>('')
  const [medicaoAtual, setMedicaoAtual] = useState<number | string>('')
  const [classificacaoConsumo, setClassificacaoConsumo] = useState<string>('A4')
  const [consumoPonta, setConsumoPonta] = useState<number | string>('')
  const [tarifaTusdPonta, setTarifaTusdPonta] = useState<number | string>('')
  const [tarifaTePonta, setTarifaTePonta] = useState<number | string>('')
  const [consumoForaPonta, setConsumoForaPonta] = useState<number | string>('')
  const [tarifaTusdFPonta, setTarifaTusdFPonta] = useState<number | string>('')
  const [tarifaTeFPonta, setTarifaTeFPonta] = useState<number | string>('')
  const [adicionalBandeira, setAdicionalBandeira] = useState<string>('Bandeira Verde')

  // Specific fields for Gas / Agua
  const [consumoMedido, setConsumoMedido] = useState<number | string>('')
  const [consumoCorrigido, setConsumoCorrigido] = useState<number | string>('')
  const [tarifa, setTarifa] = useState<number | string>('')

  // CNPJ mismatch alert state in Step 3
  const [cnpjMismatchIgnored, setCnpjMismatchIgnored] = useState(false)
  const [submittingFatura, setSubmittingFatura] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Reset upload modal form
  const resetUploadForm = () => {
    setStep(1)
    setUploadedFile(null)
    setSelectedEmpId(empreendimentos[0]?.id || '')
    setSelectedTipo('Energia Elétrica')
    setExtracting(false)
    setCompetenciaInput('')
    setValorTotal('')
    setConsumo('')
    setUnidadeConsumo('kWh')
    setNumeroFatura('')
    setCnpjFornecedor('')
    setVencimento('')
    setMedicaoAnterior('')
    setMedicaoAtual('')
    setClassificacaoConsumo('A4')
    setConsumoPonta('')
    setTarifaTusdPonta('')
    setTarifaTePonta('')
    setConsumoForaPonta('')
    setTarifaTusdFPonta('')
    setTarifaTeFPonta('')
    setAdicionalBandeira('Bandeira Verde')
    setConsumoMedido('')
    setConsumoCorrigido('')
    setTarifa('')
    setCnpjMismatchIgnored(false)
  }

  // Handle selected file drop or pick
  const handleFileSelect = (file: File) => {
    const validExtensions = ['pdf', 'csv', 'xls', 'xlsx']
    const ext = file.name.toLowerCase().split('.').pop()
    if (!ext || !validExtensions.includes(ext)) {
      toast({
        title: 'Formato não suportado',
        description: 'Por favor, selecione um arquivo em formato PDF, CSV ou XLS/XLSX.',
        variant: 'destructive',
      })
      return
    }
    setUploadedFile(file)
  }

  // Run AI extraction
  const handleProceedToExtract = async () => {
    if (!selectedEmpId) {
      toast({
        title: 'Selecione um empreendimento',
        description: 'É necessário associar a fatura a um empreendimento.',
        variant: 'destructive',
      })
      return
    }

    setStep(3)
    setExtracting(true)
    setExtractingStatus('Preparando documento...')

    // Pre-set unit based on utility
    setUnidadeConsumo(selectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³')

    try {
      if (uploadedFile) {
        const res = await faturasService.extractFromDocument(uploadedFile, selectedTipo, (status) =>
          setExtractingStatus(status),
        )
        // Desembrulhar res.dados caso venha aninhado (ex: { dados: { ... } } ou { data: { ... } })
        let d: any = res.dados || {}
        if (d.dados && typeof d.dados === 'object') {
          d = { ...d.dados, ...d }
        } else if (d.data && typeof d.data === 'object') {
          d = { ...d.data, ...d }
        }

        // Helper para resolver campos com nomes alternativos (snake_case e camelCase)
        const getField = (...keys: string[]) => {
          for (const k of keys) {
            if (d[k] !== undefined && d[k] !== null && d[k] !== '') {
              return d[k]
            }
          }
          return undefined
        }

        // Determinar e sincronizar tipo de utilidade
        const rawTipo = getField('tipo_utilidade', 'tipoUtilidade', 'tipo', 'utilidade')
        let detectedTipo: TipoUtilidade = selectedTipo

        if (rawTipo) {
          const strTipo = String(rawTipo).trim().toLowerCase()
          if (
            strTipo.includes('gás') ||
            strTipo.includes('gas') ||
            strTipo.includes('comgás') ||
            strTipo.includes('naturgy')
          ) {
            detectedTipo = 'Gás'
          } else if (
            strTipo.includes('água') ||
            strTipo.includes('agua') ||
            strTipo.includes('esgoto') ||
            strTipo.includes('sabesp')
          ) {
            detectedTipo = 'Água e Esgoto'
          } else if (
            strTipo.includes('energia') ||
            strTipo.includes('elétric') ||
            strTipo.includes('eletric') ||
            strTipo.includes('luz')
          ) {
            detectedTipo = 'Energia Elétrica'
          }
          setSelectedTipo(detectedTipo)
        }

        // Competência
        const compFmt = getField(
          'competencia_formatada',
          'competenciaFormatada',
          'mes_ano',
          'referencia',
        )
        const compRaw = getField('competencia', 'periodo')
        if (compFmt) {
          setCompetenciaInput(String(compFmt))
        } else if (compRaw) {
          const strComp = String(compRaw)
          if (strComp.includes('/')) {
            setCompetenciaInput(strComp)
          } else {
            const parts = strComp.split('-')
            if (parts.length >= 2) {
              setCompetenciaInput(`${parts[1]}/${parts[0]}`)
            }
          }
        }

        // Valores financeiros e consumo geral
        const vTotal = getField('valor_total', 'fatura_total', 'total', 'valorTotal', 'faturaTotal')
        if (vTotal !== undefined) setValorTotal(Number(vTotal) || vTotal)

        const cConsumo = getField(
          'consumo',
          'consumo_faturado',
          'consumoFaturado',
          'volume',
          'consumo_corrigido',
          'consumoCorrigido',
          'consumo_medido',
          'consumoMedido',
        )
        if (cConsumo !== undefined) setConsumo(Number(cConsumo) || cConsumo)

        const uConsumo = getField('unidade_consumo', 'unidadeConsumo', 'unidade')
        if (uConsumo) {
          setUnidadeConsumo(String(uConsumo))
        } else {
          setUnidadeConsumo(detectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³')
        }

        const numFat = getField(
          'numero_fatura',
          'numeroFatura',
          'numero_nota',
          'nota_fiscal',
          'documento',
          'nf',
        )
        if (numFat) setNumeroFatura(String(numFat))

        const cnpjForn = getField('cnpj_fornecedor', 'cnpjFornecedor', 'cnpj', 'cnpj_distribuidora')
        if (cnpjForn) setCnpjFornecedor(formatCNPJ(String(cnpjForn)))

        const venc = getField('vencimento', 'data_vencimento', 'dataVencimento')
        if (venc) {
          const strVenc = String(venc)
          if (strVenc.includes('T')) {
            setVencimento(strVenc.split('T')[0])
          } else if (strVenc.includes('/')) {
            const [dia, mes, ano] = strVenc.split('/')
            if (ano && mes && dia) {
              setVencimento(`${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`)
            } else {
              setVencimento(strVenc)
            }
          } else {
            setVencimento(strVenc)
          }
        }

        // Medições (comum a Energia, Gás e Água)
        const medAnt = getField(
          'medicao_anterior',
          'medicaoAnterior',
          'leitura_anterior',
          'leituraAnterior',
        )
        if (medAnt !== undefined) setMedicaoAnterior(Number(medAnt) || medAnt)

        const medAtu = getField('medicao_atual', 'medicaoAtual', 'leitura_atual', 'leituraAtual')
        if (medAtu !== undefined) setMedicaoAtual(Number(medAtu) || medAtu)

        // Campos específicos de Energia Elétrica
        const classCons = getField('classificacao_consumo', 'classificacaoConsumo', 'classificacao')
        if (classCons) setClassificacaoConsumo(String(classCons))

        const cPonta = getField('consumo_ponta', 'consumoPonta')
        if (cPonta !== undefined) setConsumoPonta(Number(cPonta) || cPonta)

        const tTusdPonta = getField('tarifa_tusd_ponta', 'tarifaTusdPonta')
        if (tTusdPonta !== undefined) setTarifaTusdPonta(Number(tTusdPonta) || tTusdPonta)

        const tTePonta = getField('tarifa_te_ponta', 'tarifaTePonta')
        if (tTePonta !== undefined) setTarifaTePonta(Number(tTePonta) || tTePonta)

        const cForaPonta = getField('consumo_fora_ponta', 'consumoForaPonta')
        if (cForaPonta !== undefined) setConsumoForaPonta(Number(cForaPonta) || cForaPonta)

        const tTusdFPonta = getField('tarifa_tusd_f_ponta', 'tarifaTusdFPonta')
        if (tTusdFPonta !== undefined) setTarifaTusdFPonta(Number(tTusdFPonta) || tTusdFPonta)

        const tTeFPonta = getField('tarifa_te_f_ponta', 'tarifaTeFPonta')
        if (tTeFPonta !== undefined) setTarifaTeFPonta(Number(tTeFPonta) || tTeFPonta)

        const adicBandeira = getField(
          'adicional_bandeira',
          'adicionalBandeira',
          'bandeira_tarifaria',
          'bandeira',
        )
        if (adicBandeira) setAdicionalBandeira(String(adicBandeira))

        // Campos específicos de GÁS e Água
        const cMedido = getField(
          'consumo_medido',
          'consumoMedido',
          'consumo_apurado',
          'volume_medido',
        )
        const cCorrigido = getField(
          'consumo_corrigido',
          'consumoCorrigido',
          'consumo_faturado_corrigido',
        )
        const tar = getField('tarifa', 'tarifa_unitaria', 'valor_unitario', 'tarifaUnitaria')

        if (cMedido !== undefined) {
          setConsumoMedido(Number(cMedido) || cMedido)
        } else if (cCorrigido !== undefined) {
          setConsumoMedido(Number(cCorrigido) || cCorrigido)
        } else if (cConsumo !== undefined) {
          setConsumoMedido(Number(cConsumo) || cConsumo)
        }

        if (cCorrigido !== undefined) {
          setConsumoCorrigido(Number(cCorrigido) || cCorrigido)
        } else if (cMedido !== undefined) {
          setConsumoCorrigido(Number(cMedido) || cMedido)
        } else if (cConsumo !== undefined) {
          setConsumoCorrigido(Number(cConsumo) || cConsumo)
        }

        if (tar !== undefined) {
          setTarifa(Number(tar) || tar)
        } else if (vTotal && (cCorrigido || cMedido || cConsumo)) {
          const divCons = Number(cCorrigido || cMedido || cConsumo)
          if (divCons > 0) {
            setTarifa(Number((Number(vTotal) / divCons).toFixed(4)))
          }
        }

        // Verificar se algum campo relevante foi efetivamente preenchido
        const hasAnyExtractedField =
          vTotal !== undefined ||
          cConsumo !== undefined ||
          numFat !== undefined ||
          cnpjForn !== undefined ||
          venc !== undefined ||
          medAnt !== undefined ||
          medAtu !== undefined ||
          cMedido !== undefined ||
          cCorrigido !== undefined ||
          tar !== undefined

        if (hasAnyExtractedField) {
          toast({
            title: 'Extração inteligente concluída',
            description: 'Revise os dados extraídos antes de confirmar.',
          })
        } else {
          toast({
            title: 'Campos não detectados',
            description:
              'A IA não conseguiu identificar os dados com precisão neste comprovante. Por favor, preencha as medições e valores manualmente no formulário.',
            variant: 'destructive',
          })
        }
      }
    } catch (err: any) {
      console.warn('Erro na extração IA:', err)
      toast({
        title: 'Extração assistida',
        description:
          err.message ||
          'Não foi possível extrair automaticamente. Preencha os campos manualmente.',
        variant: 'destructive',
      })
    } finally {
      setExtracting(false)
    }
  }

  // Check if CNPJ matches chosen enterprise
  const selectedEnterprise = useMemo(() => {
    return empreendimentos.find((e) => e.id === selectedEmpId)
  }, [empreendimentos, selectedEmpId])

  const cnpjMismatch = useMemo(() => {
    if (!selectedEnterprise || !cnpjFornecedor) return false
    const empCnpjDigits = cleanCNPJ(selectedEnterprise.cnpj)
    const faturaCnpjDigits = cleanCNPJ(cnpjFornecedor)
    if (!faturaCnpjDigits) return false
    return empCnpjDigits !== faturaCnpjDigits
  }, [selectedEnterprise, cnpjFornecedor])

  // Save new invoice from Step 3
  const handleSaveInvoice = async () => {
    if (!valorTotal) {
      toast({
        title: 'Valor total obrigatório',
        description: 'Informe o valor total da fatura.',
        variant: 'destructive',
      })
      return
    }

    // Format ISO date for first day of month from MM/AAAA
    let compISO = new Date().toISOString()
    if (competenciaInput.includes('/')) {
      const [mm, yyyy] = competenciaInput.split('/')
      if (mm && yyyy) {
        compISO = `${yyyy}-${mm.padStart(2, '0')}-01T00:00:00.000Z`
      }
    } else if (competenciaInput.includes('-')) {
      compISO = `${competenciaInput}-01T00:00:00.000Z`
    }

    // Determine cnpj_validado flag based on match
    const isValidated = !cnpjMismatch || (cnpjMismatchIgnored === true && !cnpjMismatch)

    // Build specific data object
    let dadosEsp: any = {}
    if (selectedTipo === 'Energia Elétrica') {
      dadosEsp = {
        medicao_anterior: Number(medicaoAnterior) || undefined,
        medicao_atual: Number(medicaoAtual) || undefined,
        classificacao_consumo: classificacaoConsumo || undefined,
        consumo_ponta: Number(consumoPonta) || undefined,
        tarifa_tusd_ponta: Number(tarifaTusdPonta) || undefined,
        tarifa_te_ponta: Number(tarifaTePonta) || undefined,
        consumo_fora_ponta: Number(consumoForaPonta) || undefined,
        tarifa_tusd_f_ponta: Number(tarifaTusdFPonta) || undefined,
        tarifa_te_f_ponta: Number(tarifaTeFPonta) || undefined,
        adicional_bandeira: adicionalBandeira || undefined,
        fatura_total: Number(valorTotal),
      }
    } else if (selectedTipo === 'Gás') {
      dadosEsp = {
        medicao_anterior: Number(medicaoAnterior) || undefined,
        medicao_atual: Number(medicaoAtual) || undefined,
        consumo_medido: Number(consumoMedido || consumo) || undefined,
        consumo_corrigido: Number(consumoCorrigido) || undefined,
        tarifa: Number(tarifa) || undefined,
        fatura_total: Number(valorTotal),
      }
    } else {
      dadosEsp = {
        medicao_anterior: Number(medicaoAnterior) || undefined,
        medicao_atual: Number(medicaoAtual) || undefined,
        consumo_medido: Number(consumoMedido || consumo) || undefined,
        tarifa: Number(tarifa) || undefined,
        fatura_total: Number(valorTotal),
      }
    }

    setSubmittingFatura(true)
    try {
      await addFatura({
        empreendimento: selectedEmpId,
        tipo_utilidade: selectedTipo,
        competencia: compISO,
        valor_total: Number(valorTotal),
        consumo: Number(consumo) || undefined,
        unidade_consumo: selectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³',
        numero_fatura: numeroFatura || undefined,
        cnpj_fornecedor: cnpjFornecedor ? formatCNPJ(cnpjFornecedor) : undefined,
        cnpj_validado: !cnpjMismatch,
        arquivo_nome: uploadedFile?.name || null,
        vencimento: vencimento || undefined,
        dados_especificos: JSON.stringify(dadosEsp),
      })

      setStep(4) // Move to success step
    } catch (err: any) {
      console.error(err)
      toast({
        title: 'Erro ao cadastrar fatura',
        description: err.message || 'Ocorreu um erro ao gravar os dados.',
        variant: 'destructive',
      })
    } finally {
      setSubmittingFatura(false)
    }
  }

  // Open edit modal with existing invoice
  const openEditModal = (fat: FaturaRecord) => {
    setSelectedFatura(fat)
    setSelectedEmpId(fat.empreendimento)
    setSelectedTipo(fat.tipo_utilidade)
    setCompetenciaInput(formatCompetencia(fat.competencia))
    setValorTotal(fat.valor_total)
    setConsumo(fat.consumo || '')
    setUnidadeConsumo(
      fat.unidade_consumo || (fat.tipo_utilidade === 'Energia Elétrica' ? 'kWh' : 'm³'),
    )
    setNumeroFatura(fat.numero_fatura || '')
    setCnpjFornecedor(fat.cnpj_fornecedor || '')
    setVencimento(fat.vencimento ? fat.vencimento.split('T')[0] : '')

    // Parse dados específicos
    let d: any = {}
    if (typeof fat.dados_especificos === 'string') {
      try {
        d = JSON.parse(fat.dados_especificos)
      } catch {
        /* intentionally ignored */
      }
    } else if (fat.dados_especificos) {
      d = fat.dados_especificos
    }

    setMedicaoAnterior(d.medicao_anterior ?? '')
    setMedicaoAtual(d.medicao_atual ?? '')
    setClassificacaoConsumo(d.classificacao_consumo ?? 'A4')
    setConsumoPonta(d.consumo_ponta ?? '')
    setTarifaTusdPonta(d.tarifa_tusd_ponta ?? '')
    setTarifaTePonta(d.tarifa_te_ponta ?? '')
    setConsumoForaPonta(d.consumo_fora_ponta ?? '')
    setTarifaTusdFPonta(d.tarifa_tusd_f_ponta ?? '')
    setTarifaTeFPonta(d.tarifa_te_f_ponta ?? '')
    setAdicionalBandeira(d.adicional_bandeira ?? 'Bandeira Verde')

    setConsumoMedido(d.consumo_medido ?? '')
    setConsumoCorrigido(d.consumo_corrigido ?? '')
    setTarifa(d.tarifa ?? '')

    setEditModalOpen(true)
  }

  // Save changes to existing invoice
  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFatura) return

    let compISO = selectedFatura.competencia
    if (competenciaInput.includes('/')) {
      const [mm, yyyy] = competenciaInput.split('/')
      if (mm && yyyy) {
        compISO = `${yyyy}-${mm.padStart(2, '0')}-01T00:00:00.000Z`
      }
    }

    const empObj = empreendimentos.find((e) => e.id === selectedEmpId)
    const isMatched =
      empObj && cnpjFornecedor ? cleanCNPJ(empObj.cnpj) === cleanCNPJ(cnpjFornecedor) : true

    let dadosEsp: any = {}
    if (selectedTipo === 'Energia Elétrica') {
      dadosEsp = {
        medicao_anterior: Number(medicaoAnterior) || undefined,
        medicao_atual: Number(medicaoAtual) || undefined,
        classificacao_consumo: classificacaoConsumo || undefined,
        consumo_ponta: Number(consumoPonta) || undefined,
        tarifa_tusd_ponta: Number(tarifaTusdPonta) || undefined,
        tarifa_te_ponta: Number(tarifaTePonta) || undefined,
        consumo_fora_ponta: Number(consumoForaPonta) || undefined,
        tarifa_tusd_f_ponta: Number(tarifaTusdFPonta) || undefined,
        tarifa_te_f_ponta: Number(tarifaTeFPonta) || undefined,
        adicional_bandeira: adicionalBandeira || undefined,
        fatura_total: Number(valorTotal),
      }
    } else if (selectedTipo === 'Gás') {
      dadosEsp = {
        medicao_anterior: Number(medicaoAnterior) || undefined,
        medicao_atual: Number(medicaoAtual) || undefined,
        consumo_medido: Number(consumoMedido || consumo) || undefined,
        consumo_corrigido: Number(consumoCorrigido) || undefined,
        tarifa: Number(tarifa) || undefined,
        fatura_total: Number(valorTotal),
      }
    } else {
      dadosEsp = {
        medicao_anterior: Number(medicaoAnterior) || undefined,
        medicao_atual: Number(medicaoAtual) || undefined,
        consumo_medido: Number(consumoMedido || consumo) || undefined,
        tarifa: Number(tarifa) || undefined,
        fatura_total: Number(valorTotal),
      }
    }

    setSubmittingFatura(true)
    try {
      await updateFatura(selectedFatura.id, {
        empreendimento: selectedEmpId,
        tipo_utilidade: selectedTipo,
        competencia: compISO,
        valor_total: Number(valorTotal),
        consumo: Number(consumo) || undefined,
        unidade_consumo: selectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³',
        numero_fatura: numeroFatura || undefined,
        cnpj_fornecedor: cnpjFornecedor ? formatCNPJ(cnpjFornecedor) : undefined,
        cnpj_validado: isMatched,
        vencimento: vencimento || undefined,
        dados_especificos: JSON.stringify(dadosEsp),
      })
      toast({
        title: 'Fatura atualizada',
        description: 'As alterações foram gravadas com sucesso.',
      })
      setEditModalOpen(false)
    } catch (err: any) {
      toast({
        title: 'Erro ao atualizar',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setSubmittingFatura(false)
    }
  }

  // Delete invoice handler
  const handleDeleteInvoice = async () => {
    if (!faturaToDelete) return
    setDeleting(true)
    try {
      await deleteFatura(faturaToDelete.id)
      toast({
        title: 'Fatura excluída',
        description: 'A fatura foi removida com sucesso.',
      })
      setDeleteConfirmOpen(false)
      setFaturaToDelete(null)
    } catch (err: any) {
      toast({
        title: 'Erro ao excluir',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  // Filtered and Sorted list
  const filteredFaturas = useMemo(() => {
    return faturas
      .filter((fat) => {
        // Filter by Enterprise
        if (empFilter !== 'Todos' && fat.empreendimento !== empFilter) {
          return false
        }

        // Filter by Utility
        if (tipoFilter !== 'Todas' && fat.tipo_utilidade !== tipoFilter) {
          return false
        }

        // Filter by search query (enterprise name or cnpj or numero fatura)
        if (searchTerm.trim()) {
          const query = searchTerm.toLowerCase()
          const empNome = fat.expand?.empreendimento?.nome?.toLowerCase() || ''
          const empCnpj = fat.expand?.empreendimento?.cnpj?.toLowerCase() || ''
          const fatCnpj = fat.cnpj_fornecedor?.toLowerCase() || ''
          const numFat = fat.numero_fatura?.toLowerCase() || ''
          if (
            !empNome.includes(query) &&
            !empCnpj.includes(query) &&
            !fatCnpj.includes(query) &&
            !numFat.includes(query)
          ) {
            return false
          }
        }

        return true
      })
      .sort((a, b) => {
        if (sortBy === 'recente') {
          return new Date(b.competencia).getTime() - new Date(a.competencia).getTime()
        }
        if (sortBy === 'antiga') {
          return new Date(a.competencia).getTime() - new Date(b.competencia).getTime()
        }
        if (sortBy === 'maior-valor') {
          return Number(b.valor_total) - Number(a.valor_total)
        }
        if (sortBy === 'menor-valor') {
          return Number(a.valor_total) - Number(b.valor_total)
        }
        return 0
      })
  }, [faturas, empFilter, tipoFilter, searchTerm, sortBy])

  // Utility badge styling helper
  const getUtilityBadge = (tipo: TipoUtilidade) => {
    switch (tipo) {
      case 'Energia Elétrica':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
            Energia
          </span>
        )
      case 'Água e Esgoto':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
            <Droplets className="w-3 h-3 text-sky-500 fill-sky-500" />
            Água
          </span>
        )
      case 'Gás':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
            <Flame className="w-3 h-3 text-teal-600 fill-teal-600" />
            Gás
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">Faturas</h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Lançamento, conferência e auditoria de contas de água, gás e energia elétrica.
          </p>
        </div>

        <Button
          onClick={() => {
            resetUploadForm()
            setUploadModalOpen(true)
          }}
          className="bg-teal-700 hover:bg-teal-800 text-white text-xs h-9 shadow-sm"
        >
          <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
          Enviar Fatura
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4 border-[#E5E7EB] bg-white shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Buscar por empreendimento, CNPJ..."
              className="pl-9 h-9 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Utility Filter */}
          <Select value={tipoFilter} onValueChange={(val) => setTipoFilter(val)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Utilidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todas">Todas as Utilidades</SelectItem>
              <SelectItem value="Energia Elétrica">Energia Elétrica</SelectItem>
              <SelectItem value="Água e Esgoto">Água e Esgoto</SelectItem>
              <SelectItem value="Gás">Gás</SelectItem>
            </SelectContent>
          </Select>

          {/* Enterprise Filter */}
          <Select value={empFilter} onValueChange={(val) => setEmpFilter(val)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Empreendimento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Todos os Empreendimentos</SelectItem>
              {empreendimentos.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort Dropdown */}
          <Select value={sortBy} onValueChange={(val) => setSortBy(val)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Ordenar por" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recente">Data (mais recente)</SelectItem>
              <SelectItem value="antiga">Data (mais antiga)</SelectItem>
              <SelectItem value="maior-valor">Valor (maior primeiro)</SelectItem>
              <SelectItem value="menor-valor">Valor (menor primeiro)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Invoice List: Table on Desktop, Cards on Mobile */}
      {filteredFaturas.length === 0 ? (
        <Card className="p-8 text-center border-dashed border-2 border-gray-200">
          <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-gray-700">Nenhuma fatura encontrada</h3>
          <p className="text-xs text-gray-500 mt-1">
            Tente ajustar os filtros ou envie uma nova fatura para este empreendimento.
          </p>
        </Card>
      ) : (
        <>
          {/* Desktop Table View (≥ 1025px / md) */}
          <div className="hidden md:block bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/75 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                    <th className="py-3 px-4">Empreendimento</th>
                    <th className="py-3 px-4">Utilidade</th>
                    <th className="py-3 px-4">Competência</th>
                    <th className="py-3 px-4">Consumo</th>
                    <th className="py-3 px-4 text-right">Valor Total</th>
                    <th className="py-3 px-4 text-center">Status CNPJ</th>
                    <th className="py-3 px-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                  {filteredFaturas.map((fat) => {
                    const empName = fat.expand?.empreendimento?.nome || 'Empreendimento'
                    const empCnpj = fat.expand?.empreendimento?.cnpj || fat.cnpj_fornecedor || ''

                    return (
                      <tr key={fat.id} className="hover:bg-slate-50/75 transition-colors group">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-gray-900">{empName}</div>
                          <div className="text-[11px] font-mono text-gray-400 mt-0.5">
                            {formatCNPJ(empCnpj)}
                          </div>
                        </td>
                        <td className="py-3 px-4">{getUtilityBadge(fat.tipo_utilidade)}</td>
                        <td className="py-3 px-4 font-medium text-gray-700 tabular-nums">
                          {formatCompetencia(fat.competencia)}
                        </td>
                        <td className="py-3 px-4 text-gray-700 tabular-nums">
                          {fat.consumo !== undefined && fat.consumo !== null
                            ? `${fat.consumo} ${fat.unidade_consumo || ''}`
                            : '-'}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">
                          {formatCurrencyBRL(fat.valor_total)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {fat.cnpj_validado ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Validado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFatura(fat)
                                setDetailModalOpen(true)
                              }}
                              className="p-1.5 text-gray-500 hover:text-teal-700 hover:bg-gray-100 rounded-md transition-colors"
                              title="Visualizar detalhes"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(fat)}
                              className="p-1.5 text-gray-500 hover:text-teal-700 hover:bg-gray-100 rounded-md transition-colors"
                              title="Editar fatura"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFaturaToDelete(fat)
                                setDeleteConfirmOpen(true)
                              }}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title="Excluir fatura"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Stacked Cards (≤ 640px / md hidden) */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {filteredFaturas.map((fat) => {
              const empName = fat.expand?.empreendimento?.nome || 'Empreendimento'
              const empCnpj = fat.expand?.empreendimento?.cnpj || fat.cnpj_fornecedor || ''

              return (
                <Card key={fat.id} className="p-4 border-[#E5E7EB] bg-white shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-gray-900">{empName}</h4>
                      <p className="text-[11px] font-mono text-gray-400 mt-0.5">
                        CNPJ: {formatCNPJ(empCnpj)}
                      </p>
                    </div>
                    {getUtilityBadge(fat.tipo_utilidade)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-gray-100">
                    <div>
                      <span className="text-gray-400 text-[10px] uppercase block">Competência</span>
                      <span className="font-semibold text-gray-800 tabular-nums">
                        {formatCompetencia(fat.competencia)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[10px] uppercase block">Consumo</span>
                      <span className="font-semibold text-gray-800 tabular-nums">
                        {fat.consumo !== undefined ? `${fat.consumo} ${fat.unidade_consumo}` : '-'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div>
                      <span className="text-gray-400 text-[10px] uppercase block">Valor Total</span>
                      <span className="font-bold text-base text-gray-900 tabular-nums">
                        {formatCurrencyBRL(fat.valor_total)}
                      </span>
                    </div>
                    <div>
                      {fat.cnpj_validado ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Validado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          Pendente
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedFatura(fat)
                        setDetailModalOpen(true)
                      }}
                      className="text-xs h-8"
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" />
                      Ver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(fat)}
                      className="text-xs h-8"
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFaturaToDelete(fat)
                        setDeleteConfirmOpen(true)
                      }}
                      className="text-xs h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* Multi-step Upload Modal */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900 flex items-center justify-between">
              <span>Cadastro e Extração de Fatura</span>
              <span className="text-xs font-normal text-gray-500">Passo {step} de 4</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Faça upload do comprovante para preenchimento assistido por Inteligência Artificial.
            </DialogDescription>
          </DialogHeader>

          {/* STEP 1: DROPZONE */}
          {step === 1 && (
            <div className="space-y-4 py-2">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0])
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 hover:border-teal-600 rounded-xl p-8 text-center bg-gray-50/50 hover:bg-teal-50/30 transition-all cursor-pointer group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.csv,.xls,.xlsx"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0])
                    }
                  }}
                />

                <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform">
                  <UploadCloud className="w-6 h-6 text-teal-700" />
                </div>

                <p className="text-sm font-semibold text-gray-800">
                  Arraste e solte o arquivo aqui, ou{' '}
                  <span className="text-teal-700 underline">procure no computador</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Formatos aceitos: PDF, CSV, XLS, XLSX (máx. 10MB)
                </p>
              </div>

              {/* Selected file preview */}
              {uploadedFile && (
                <div className="flex items-center justify-between p-3 rounded-lg border border-teal-200 bg-teal-50/60 animate-in fade-in">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-5 h-5 text-teal-700" />
                    <div>
                      <p className="text-xs font-semibold text-gray-900 truncate max-w-[320px]">
                        {uploadedFile.name}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {(uploadedFile.size / 1024).toFixed(1)} KB •{' '}
                        {uploadedFile.type || 'Documento'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setUploadedFile(null)
                    }}
                    className="p-1 text-gray-400 hover:text-gray-700 rounded-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setUploadModalOpen(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  disabled={!uploadedFile}
                  onClick={() => setStep(2)}
                  className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
                >
                  Continuar
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 2: EMPREENDIMENTO & TIPO DE UTILIDADE */}
          {step === 2 && (
            <div className="space-y-5 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-gray-700">
                  Selecionar Empreendimento *
                </Label>
                <Select value={selectedEmpId} onValueChange={(val) => setSelectedEmpId(val)}>
                  <SelectTrigger className="h-10 text-xs sm:text-sm">
                    <SelectValue placeholder="Selecione o empreendimento titular" />
                  </SelectTrigger>
                  <SelectContent>
                    {empreendimentos.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.nome} ({emp.cnpj})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400">
                  O CNPJ da fatura será confrontado com o CNPJ deste empreendimento.
                </p>
              </div>

              {/* Utility Segmented Control */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-gray-700">Tipo de Utilidade *</Label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTipo('Energia Elétrica')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                      selectedTipo === 'Energia Elétrica'
                        ? 'border-amber-400 bg-amber-50/70 text-amber-900 ring-2 ring-amber-400/40'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <Zap className="w-5 h-5 text-amber-500 fill-amber-500" />
                    <span className="text-xs font-semibold">Energia Elétrica</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTipo('Água e Esgoto')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                      selectedTipo === 'Água e Esgoto'
                        ? 'border-sky-400 bg-sky-50/70 text-sky-900 ring-2 ring-sky-400/40'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <Droplets className="w-5 h-5 text-sky-500 fill-sky-500" />
                    <span className="text-xs font-semibold">Água e Esgoto</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTipo('Gás')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all text-center ${
                      selectedTipo === 'Gás'
                        ? 'border-teal-400 bg-teal-50/70 text-teal-900 ring-2 ring-teal-400/40'
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <Flame className="w-5 h-5 text-teal-600 fill-teal-600" />
                    <span className="text-xs font-semibold">Gás</span>
                  </button>
                </div>
              </div>

              <DialogFooter className="pt-2 flex justify-between sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="text-xs"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                  Voltar
                </Button>
                <Button
                  type="button"
                  onClick={handleProceedToExtract}
                  className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
                >
                  Extrair com IA
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 3: EXTRACTION LOADER & REVIEW EDITABLE FORM */}
          {step === 3 && (
            <div className="space-y-4 py-2">
              {extracting ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full bg-teal-50 border-2 border-teal-200 flex items-center justify-center animate-pulse">
                      <Zap className="w-7 h-7 text-teal-700 animate-bounce" />
                    </div>
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">
                    {extractingStatus || 'Extraindo dados da fatura...'}
                  </h4>
                  <p className="text-xs text-gray-500 max-w-xs">
                    Nossa IA com Visão Computacional está analisando a fatura e identificando
                    medições, tarifas, consumo e CNPJ.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* CNPJ Mismatch Alert Banner */}
                  {cnpjMismatch && !cnpjMismatchIgnored && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2 animate-in fade-in">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">
                            Atenção: o CNPJ da fatura não corresponde ao CNPJ do empreendimento
                            selecionado. Deseja continuar?
                          </p>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            CNPJ do Empreendimento: <strong>{selectedEnterprise?.cnpj}</strong> |
                            CNPJ da fatura: <strong>{cnpjFornecedor || 'Não identificado'}</strong>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1 pl-6">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setStep(2)}
                          className="h-7 text-[11px] border-amber-300 text-amber-900 hover:bg-amber-100"
                        >
                          Corrigir Empreendimento
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setCnpjMismatchIgnored(true)}
                          className="h-7 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          Continuar mesmo assim
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* General Fields Grid */}
                  <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-200 space-y-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
                      Dados Gerais da Fatura
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Competência (MM/AAAA) *
                        </Label>
                        <Input
                          placeholder="03/2024"
                          className="h-9 text-xs"
                          value={competenciaInput}
                          onChange={(e) => setCompetenciaInput(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Valor Total da Fatura (R$) *
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="1234.56"
                          className="h-9 text-xs font-bold"
                          value={valorTotal}
                          onChange={(e) => setValorTotal(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Consumo Principal ({unidadeConsumo})
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Consumo apurado"
                          className="h-9 text-xs"
                          value={consumo}
                          onChange={(e) => setConsumo(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Número da Fatura / Nota
                        </Label>
                        <Input
                          placeholder="NF-123456"
                          className="h-9 text-xs"
                          value={numeroFatura}
                          onChange={(e) => setNumeroFatura(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          CNPJ da Fatura / Fornecedor
                        </Label>
                        <Input
                          placeholder="00.000.000/0000-00"
                          className="h-9 text-xs font-mono"
                          value={cnpjFornecedor}
                          onChange={(e) => setCnpjFornecedor(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Data de Vencimento
                        </Label>
                        <Input
                          type="date"
                          className="h-9 text-xs"
                          value={vencimento}
                          onChange={(e) => setVencimento(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* DYNAMIC FIELDS PER UTILITY */}

                  {/* 1. ENERGIA ELÉTRICA */}
                  {selectedTipo === 'Energia Elétrica' && (
                    <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 space-y-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
                        Campos Específicos: Energia Elétrica
                      </span>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Medição Anterior
                          </Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={medicaoAnterior}
                            onChange={(e) => setMedicaoAnterior(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Medição Atual</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={medicaoAtual}
                            onChange={(e) => setMedicaoAtual(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Classificação</Label>
                          <Input
                            placeholder="A4, B3..."
                            className="h-8 text-xs"
                            value={classificacaoConsumo}
                            onChange={(e) => setClassificacaoConsumo(e.target.value)}
                          />
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-700">Consumo Ponta</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={consumoPonta}
                            onChange={(e) => setConsumoPonta(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa TUSD-Ponta
                          </Label>
                          <Input
                            type="number"
                            step="0.0001"
                            className="h-8 text-xs"
                            value={tarifaTusdPonta}
                            onChange={(e) => setTarifaTusdPonta(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa TE-Ponta
                          </Label>
                          <Input
                            type="number"
                            step="0.0001"
                            className="h-8 text-xs"
                            value={tarifaTePonta}
                            onChange={(e) => setTarifaTePonta(e.target.value)}
                          />
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Consumo Fora-Ponta
                          </Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={consumoForaPonta}
                            onChange={(e) => setConsumoForaPonta(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa TUSD-F.Ponta
                          </Label>
                          <Input
                            type="number"
                            step="0.0001"
                            className="h-8 text-xs"
                            value={tarifaTusdFPonta}
                            onChange={(e) => setTarifaTusdFPonta(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa TE-F.Ponta
                          </Label>
                          <Input
                            type="number"
                            step="0.0001"
                            className="h-8 text-xs"
                            value={tarifaTeFPonta}
                            onChange={(e) => setTarifaTeFPonta(e.target.value)}
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <Label className="text-xs font-medium text-gray-700">
                            Adicional por Bandeira
                          </Label>
                          <Input
                            placeholder="Bandeira Verde, Amarela, Vermelha..."
                            className="h-8 text-xs"
                            value={adicionalBandeira}
                            onChange={(e) => setAdicionalBandeira(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2. GÁS */}
                  {selectedTipo === 'Gás' && (
                    <div className="p-3 rounded-xl bg-teal-50/50 border border-teal-200 space-y-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-teal-900 block flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-teal-600 fill-teal-600" />
                        Campos Específicos: Gás
                      </span>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Medição Anterior
                          </Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={medicaoAnterior}
                            onChange={(e) => setMedicaoAnterior(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Medição Atual</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={medicaoAtual}
                            onChange={(e) => setMedicaoAtual(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Consumo Medido
                          </Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={consumoMedido}
                            onChange={(e) => setConsumoMedido(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Consumo Corrigido
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 text-xs"
                            value={consumoCorrigido}
                            onChange={(e) => setConsumoCorrigido(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa (R$/m³)
                          </Label>
                          <Input
                            type="number"
                            step="0.0001"
                            className="h-8 text-xs"
                            value={tarifa}
                            onChange={(e) => setTarifa(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3. ÁGUA E ESGOTO */}
                  {selectedTipo === 'Água e Esgoto' && (
                    <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-200 space-y-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-sky-900 block flex items-center gap-1.5">
                        <Droplets className="w-3.5 h-3.5 text-sky-600 fill-sky-600" />
                        Campos Específicos: Água e Esgoto
                      </span>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Medição Anterior
                          </Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={medicaoAnterior}
                            onChange={(e) => setMedicaoAnterior(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Medição Atual</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={medicaoAtual}
                            onChange={(e) => setMedicaoAtual(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Consumo Medido (m³)
                          </Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={consumoMedido}
                            onChange={(e) => setConsumoMedido(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Tarifa</Label>
                          <Input
                            type="number"
                            step="0.0001"
                            className="h-8 text-xs"
                            value={tarifa}
                            onChange={(e) => setTarifa(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <DialogFooter className="pt-2 flex justify-between sm:justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep(2)}
                      className="text-xs"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                      Voltar
                    </Button>
                    <Button
                      type="button"
                      disabled={submittingFatura}
                      onClick={handleSaveInvoice}
                      className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
                    >
                      {submittingFatura ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                          Gravando fatura...
                        </>
                      ) : (
                        'Confirmar e Salvar Fatura'
                      )}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: SUCCESS WITH CHECKMARK */}
          {step === 4 && (
            <div className="py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 animate-in zoom-in-75 duration-300">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-bold text-gray-900">
                  Fatura cadastrada com sucesso!
                </h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  A conta foi devidamente vinculada ao empreendimento e integrada aos dashboards e à
                  análise de 24 meses.
                </p>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs max-w-sm mx-auto space-y-1 text-left">
                <div className="flex justify-between">
                  <span className="text-gray-500">Utilidade:</span>
                  <span className="font-semibold">{selectedTipo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Competência:</span>
                  <span className="font-semibold">{competenciaInput}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Valor Total:</span>
                  <span className="font-bold text-teal-800 tabular-nums">
                    {formatCurrencyBRL(Number(valorTotal))}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetUploadForm()}
                  className="text-xs"
                >
                  Enviar outra
                </Button>
                <Button
                  size="sm"
                  onClick={() => setUploadModalOpen(false)}
                  className="bg-teal-700 hover:bg-teal-800 text-white text-xs"
                >
                  Ver faturas
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoice Detail Modal (Read-Only) */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {selectedFatura && getUtilityBadge(selectedFatura.tipo_utilidade)}
              <DialogTitle className="text-base font-bold text-gray-900">
                Detalhes da Fatura
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-gray-500">
              {selectedFatura?.expand?.empreendimento?.nome} • Competência{' '}
              {formatCompetencia(selectedFatura?.competencia)}
            </DialogDescription>
          </DialogHeader>

          {selectedFatura && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Empreendimento</span>
                  <span className="font-bold text-gray-900">
                    {selectedFatura.expand?.empreendimento?.nome}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">CNPJ Titular</span>
                  <span className="font-mono text-gray-800">
                    {formatCNPJ(selectedFatura.expand?.empreendimento?.cnpj || '')}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Valor Total</span>
                  <span className="font-bold text-teal-800 text-sm tabular-nums">
                    {formatCurrencyBRL(selectedFatura.valor_total)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Consumo</span>
                  <span className="font-bold text-gray-900 tabular-nums">
                    {selectedFatura.consumo} {selectedFatura.unidade_consumo}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">
                    Número da Fatura
                  </span>
                  <span className="font-medium text-gray-700">
                    {selectedFatura.numero_fatura || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Vencimento</span>
                  <span className="font-medium text-gray-700">
                    {formatDateBR(selectedFatura.vencimento)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Status do CNPJ</span>
                  <span className="font-semibold">
                    {selectedFatura.cnpj_validado ? 'Validado' : 'Pendente de validação'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">
                    Arquivo Original
                  </span>
                  <span className="font-medium text-gray-700 truncate block">
                    {selectedFatura.arquivo_nome || 'Lançamento manual / migrado'}
                  </span>
                </div>
              </div>

              {/* Specific fields preview */}
              {selectedFatura.dados_especificos && (
                <div className="p-3 bg-teal-50/40 rounded-xl border border-teal-100 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-900 block">
                    Medições e Parâmetros Específicos
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {Object.entries(
                      typeof selectedFatura.dados_especificos === 'string'
                        ? JSON.parse(selectedFatura.dados_especificos || '{}')
                        : selectedFatura.dados_especificos,
                    ).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex justify-between border-b border-teal-100/60 pb-1"
                      >
                        <span className="text-gray-600 capitalize">{k.replace(/_/g, ' ')}:</span>
                        <span className="font-semibold text-gray-900">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDetailModalOpen(false)}
              className="text-xs"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Invoice Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-gray-900">Editar Fatura</DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Ajuste as medições, tarifas ou valores apurados nesta conta.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateInvoice} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-700">Competência (MM/AAAA)</Label>
                <Input
                  className="h-9 text-xs"
                  value={competenciaInput}
                  onChange={(e) => setCompetenciaInput(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Valor Total (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  className="h-9 text-xs font-bold"
                  value={valorTotal}
                  onChange={(e) => setValorTotal(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Consumo</Label>
                <Input
                  type="number"
                  step="0.01"
                  className="h-9 text-xs"
                  value={consumo}
                  onChange={(e) => setConsumo(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Número da Fatura</Label>
                <Input
                  className="h-9 text-xs"
                  value={numeroFatura}
                  onChange={(e) => setNumeroFatura(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">CNPJ da Fatura</Label>
                <Input
                  className="h-9 text-xs font-mono"
                  value={cnpjFornecedor}
                  onChange={(e) => setCnpjFornecedor(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Data de Vencimento</Label>
                <Input
                  type="date"
                  className="h-9 text-xs"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                />
              </div>
            </div>

            {/* Utility specific fields editor */}
            {selectedTipo === 'Energia Elétrica' && (
              <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 space-y-2">
                <span className="text-[11px] font-bold text-amber-900 block">Energia Elétrica</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[11px] text-gray-700">Medição Anterior</Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={medicaoAnterior}
                      onChange={(e) => setMedicaoAnterior(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Medição Atual</Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={medicaoAtual}
                      onChange={(e) => setMedicaoAtual(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Classificação</Label>
                    <Input
                      className="h-8 text-xs"
                      value={classificacaoConsumo}
                      onChange={(e) => setClassificacaoConsumo(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Consumo Ponta</Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={consumoPonta}
                      onChange={(e) => setConsumoPonta(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Tarifa TUSD-Ponta</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      className="h-8 text-xs"
                      value={tarifaTusdPonta}
                      onChange={(e) => setTarifaTusdPonta(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Tarifa TE-Ponta</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      className="h-8 text-xs"
                      value={tarifaTePonta}
                      onChange={(e) => setTarifaTePonta(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Consumo F.Ponta</Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={consumoForaPonta}
                      onChange={(e) => setConsumoForaPonta(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Tarifa TUSD-F.Ponta</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      className="h-8 text-xs"
                      value={tarifaTusdFPonta}
                      onChange={(e) => setTarifaTusdFPonta(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Tarifa TE-F.Ponta</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      className="h-8 text-xs"
                      value={tarifaTeFPonta}
                      onChange={(e) => setTarifaTeFPonta(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
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
                disabled={submittingFatura}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
              >
                {submittingFatura ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar alterações'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Invoice Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <DialogTitle className="text-base font-bold text-gray-900">
              Excluir esta fatura?
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-600 leading-relaxed">
              Esta ação não pode ser desfeita. A fatura será excluída de forma definitiva e removida
              dos históricos de consumo.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2">
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
              onClick={handleDeleteInvoice}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir Fatura'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
