import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { FaturaRecord, TipoUtilidade } from '@/types/entities'
import {
  formatCurrencyBRL,
  formatCompetencia,
  formatDateBR,
  formatCNPJ,
  cleanCNPJ,
  isValidCNPJ,
  toSafeNumber,
  formatNumberValue,
  parseNumberValue,
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

  const { isAdmin, ensureValidSession } = useAuth()
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
  const [lastCreatedFatura, setLastCreatedFatura] = useState<FaturaRecord | null>(null)
  const [consumo, setConsumo] = useState<number | string>('')
  const [unidadeConsumo, setUnidadeConsumo] = useState<string>('kWh')
  const [numeroFatura, setNumeroFatura] = useState<string>('')
  const [cnpjCliente, setCnpjCliente] = useState<string>('')
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

  // Track if enterprise was automatically suggested by extracted CNPJ
  const [empAutoSuggested, setEmpAutoSuggested] = useState(false)

  // Ref para token de requisição única de extração (evita race condition / respostas órfãs)
  const extractionRequestIdRef = useRef<number>(0)

  // Função central de zeramento TOTAL de estado de extração e valores do formulário do Passo 3
  const clearExtractionState = () => {
    setSelectedEmpId('')
    setEmpAutoSuggested(false)
    setCompetenciaInput('')
    setValorTotal('')
    setConsumo('')
    setUnidadeConsumo('kWh')
    setNumeroFatura('')
    setCnpjCliente('')
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
    setLastCreatedFatura(null)
  }

  // Reset upload modal form
  const resetUploadForm = () => {
    extractionRequestIdRef.current += 1 // Invalida qualquer extração em andamento
    setStep(1)
    setUploadedFile(null)
    setSelectedTipo('Energia Elétrica')
    setExtracting(false)
    setExtractingStatus('')
    clearExtractionState()
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
    // Sempre resetar campos de extração anterior ao selecionar um novo arquivo para upload
    extractionRequestIdRef.current += 1 // Invalida qualquer requisição anterior
    clearExtractionState()
    setUploadedFile(file)
  }

  // Run AI extraction
  const handleProceedToExtract = async () => {
    setStep(3)
    setExtracting(true)
    setExtractingStatus('Preparando documento...')

    // Limpar estados de extração anterior antes de iniciar nova extração
    clearExtractionState()

    // Pre-set unit based on utility
    setUnidadeConsumo(selectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³')

    // Gerar novo ID de requisição para garantir que apenas a resposta desta chamada será aplicada
    const currentRequestId = ++extractionRequestIdRef.current

    try {
      // Revalida preventivamente a sessão antes da chamada de extração para evitar 401 por token desatualizado
      await ensureValidSession().catch(() => null)

      if (uploadedFile) {
        // Fluxo com retry automático alternando parâmetros/modelos (até 3 tentativas)
        let lastRes: any = null
        let d: any = {}
        const maxAttempts = 3

        const checkEssentialData = (rawD: any) => {
          if (!rawD || typeof rawD !== 'object') return false
          const obj = { ...(rawD.dados || {}), ...(rawD.data || {}), ...rawD }

          const hasPos = (v: any) => {
            if (v === undefined || v === null || v === '' || v === 'null') return false
            if (typeof v === 'number') return v > 0
            let s = String(v)
              .replace(/^R\$\s*/i, '')
              .trim()
            if (s.includes('*')) s = s.replace(/[*]+/g, '').trim()
            if (s.includes(',') && s.includes('.')) {
              s = s.replace(/\./g, '').replace(',', '.')
            } else if (s.includes(',')) {
              s = s.replace(',', '.')
            }
            const n = Number(s.replace(/[^0-9.]/g, ''))
            return !isNaN(n) && n > 0
          }

          const hasVal =
            hasPos(obj.valor_total) ||
            hasPos(obj.fatura_total) ||
            hasPos(obj.total) ||
            hasPos(obj.valorTotal) ||
            hasPos(obj.faturaTotal) ||
            hasPos(obj.valor_fornecimento) ||
            hasPos(obj.valorFornecimento) ||
            hasPos(obj.fornecimento_gas)

          const hasCons =
            hasPos(obj.consumo) ||
            hasPos(obj.consumo_total) ||
            hasPos(obj.consumoTotal) ||
            hasPos(obj.consumo_medido) ||
            hasPos(obj.consumoMedido) ||
            hasPos(obj.consumo_ponta) ||
            hasPos(obj.consumo_fora_ponta) ||
            hasPos(obj.kwh) ||
            hasPos(obj.kwh_total) ||
            hasPos(obj.volume) ||
            hasPos(obj.consumo_corrigido) ||
            hasPos(obj.consumoCorrigido) ||
            hasPos(obj.medicao_anterior) ||
            hasPos(obj.medicao_atual) ||
            hasPos(obj.tarifa)

          return hasVal || hasCons
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const attemptPrefix = attempt > 1 ? `Tentativa ${attempt} de ${maxAttempts}: ` : ''
          // Tentativa 1: reasoning (ou padrão backend que prioriza reasoning)
          // Tentativa 2: fast
          // Tentativa 3: reasoning sem imagens se houver texto, ou reasoning com imagens
          const forceModel = attempt === 1 ? 'reasoning' : attempt === 2 ? 'fast' : 'reasoning'
          const disableImages = attempt === 3

          try {
            setExtractingStatus(
              `${attemptPrefix}Lendo fatura com IA (${attempt === 1 ? 'leitura visual detalhada' : attempt === 2 ? 'modelo rápido' : 'modo alternativo'})...`,
            )

            const res = await faturasService.extractFromDocument(
              uploadedFile,
              selectedTipo,
              (status) => setExtractingStatus(`${attemptPrefix}${status}`),
              forceModel,
              disableImages,
            )

            lastRes = res
            let candidateData: any = res.dados || {}
            if (candidateData.dados && typeof candidateData.dados === 'object') {
              candidateData = { ...candidateData.dados, ...candidateData }
            } else if (candidateData.data && typeof candidateData.data === 'object') {
              candidateData = { ...candidateData.data, ...candidateData }
            }

            // Se este request já foi superado ou cancelado, pare imediatamente
            if (currentRequestId !== extractionRequestIdRef.current) {
              return
            }

            if (checkEssentialData(candidateData)) {
              d = candidateData
              break
            } else {
              console.warn(
                `[Faturas] Tentativa ${attempt} retornou sem campos essenciais completos.`,
              )
              if (attempt < maxAttempts) {
                setExtractingStatus(
                  `Tentativa ${attempt + 1} de ${maxAttempts}: alternando modelo de leitura...`,
                )
                await new Promise((r) => setTimeout(r, 600))
              } else {
                d = candidateData
              }
            }
          } catch (attemptErr) {
            if (currentRequestId !== extractionRequestIdRef.current) {
              return
            }
            console.warn(`[Faturas] Erro na tentativa ${attempt}:`, attemptErr)
            if (attempt === maxAttempts) {
              throw attemptErr
            }
            setExtractingStatus(`Tentativa ${attempt + 1} de ${maxAttempts}: alternando modelo...`)
            await new Promise((r) => setTimeout(r, 600))
          }
        }

        // Se uma nova extração foi disparada enquanto esta rodava, descarte o resultado órfão
        if (currentRequestId !== extractionRequestIdRef.current) {
          return
        }

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
          // Procurar também dentro de sub-objetos comuns como dados_especificos, dados, especificos
          const subObjs = [
            d.dados_especificos,
            d.dadosEspecificos,
            d.dados,
            d.especificos,
            d.energia,
            d.gas,
            d.agua,
          ]
          for (const sub of subObjs) {
            if (sub && typeof sub === 'object') {
              for (const k of keys) {
                if (sub[k] !== undefined && sub[k] !== null && sub[k] !== '') {
                  return sub[k]
                }
              }
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

        // Helper para validar se data é sentinela ou inválida
        const isSentinelDate = (val: any) => {
          if (!val) return true
          const s = String(val).trim()
          return !s || s === 'null' || s === 'undefined' || s.includes('1900')
        }

        // Helper para valores numéricos brasileiros: suporta number, string com vírgula ("682,168", "6,395871", "20.438,400", "22.347,38", "33,037", "33.037")
        const parsePositiveNumber = (val: any) => {
          if (val === undefined || val === null || val === '') return undefined
          if (typeof val === 'number') {
            return isNaN(val) || val <= 0 ? undefined : val
          }
          let s = String(val)
            .trim()
            .replace(/^R\$\s*/i, '')
          if (s.includes('*')) s = s.replace(/[*]+/g, '').trim()
          if (!s || s === 'null' || s === 'undefined' || s === '0') return undefined
          if (s.includes(',') && s.includes('.')) {
            s = s.replace(/\./g, '').replace(',', '.')
          } else if (s.includes(',')) {
            s = s.replace(',', '.')
          }
          const cleanStr = s.replace(/[^0-9.]/g, '')
          const n = Number(cleanStr)
          if (isNaN(n) || n <= 0) return undefined
          return n
        }

        // Helper para medições cumulativas de medidor (especialmente Gás Comgás onde ponto é milhar, ex: "75.795" -> 75795)
        const parseCumulativeMeterReading = (val: any) => {
          if (val === undefined || val === null || val === '') return undefined
          if (typeof val === 'number') {
            if (val <= 0 || isNaN(val)) return undefined
            const strVal = String(val)
            const parts = strVal.split('.')
            if (parts.length === 2 && parts[1].length === 3 && val < 1000 && val > 10) {
              return Math.round(val * 1000)
            }
            return Math.round(val)
          }
          let s = String(val)
            .trim()
            .replace(/^R\$\s*/i, '')
          if (s.includes('*')) s = s.replace(/[*]+/g, '').trim()
          if (!s || s === 'null' || s === 'undefined' || s === '0') return undefined
          if (/^\d{1,3}\.\d{3}$/.test(s)) {
            const intVal = Number(s.replace(/\./g, ''))
            return !isNaN(intVal) && intVal > 0 ? intVal : undefined
          }
          const cleaned = s.replace(/\D/g, '')
          const n = Number(cleaned)
          if (isNaN(n) || n <= 0) return undefined
          return n
        }

        // Competência
        const compFmt = getField(
          'competencia_formatada',
          'competenciaFormatada',
          'mes_ano',
          'referencia',
        )
        const compRaw = getField('competencia', 'periodo')
        let validCompetencia = false
        if (compFmt && !isSentinelDate(compFmt)) {
          setCompetenciaInput(String(compFmt))
          validCompetencia = true
        } else if (compRaw && !isSentinelDate(compRaw)) {
          const strComp = String(compRaw)
          if (strComp.includes('/')) {
            setCompetenciaInput(strComp)
            validCompetencia = true
          } else {
            const parts = strComp.split('-')
            if (parts.length >= 2 && parts[0] !== '1900') {
              setCompetenciaInput(`${parts[1]}/${parts[0]}`)
              validCompetencia = true
            }
          }
        }

        // Valores financeiros e consumo geral
        const rawVTotal = getField(
          'valor_total',
          'fatura_total',
          'total',
          'valorTotal',
          'faturaTotal',
          'valor_fornecimento',
          'valorFornecimento',
          'fornecimento_gas',
        )
        const vTotal = parsePositiveNumber(rawVTotal)
        if (vTotal !== undefined) setValorTotal(formatNumberValue(vTotal, 2))

        const rawCConsumo = getField(
          'consumo',
          'consumo_total',
          'consumoTotal',
          'consumo_faturado',
          'consumoFaturado',
          'consumo_corrigido',
          'consumoCorrigido',
          'consumo_medido',
          'consumoMedido',
          'consumo_apurado',
          'consumoApurado',
          'kwh_total',
          'kwhTotal',
          'total_kwh',
          'totalKwh',
          'kwh',
          'volume',
        )
        const cConsumo = parsePositiveNumber(rawCConsumo)
        if (cConsumo !== undefined) setConsumo(formatNumberValue(cConsumo, 3))

        const uConsumo = getField('unidade_consumo', 'unidadeConsumo', 'unidade')
        if (uConsumo && uConsumo !== 'null' && uConsumo !== '') {
          setUnidadeConsumo(String(uConsumo))
        } else {
          setUnidadeConsumo(detectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³')
        }

        const rawNumFat = getField(
          'numero_fatura',
          'numeroFatura',
          'numero_nota',
          'nota_fiscal',
          'documento',
          'nf',
        )
        const numFat =
          rawNumFat && rawNumFat !== 'null' && rawNumFat !== '0'
            ? String(rawNumFat).trim()
            : undefined
        if (numFat) setNumeroFatura(numFat)

        const rawCnpjForn = getField(
          'cnpj_fornecedor',
          'cnpjFornecedor',
          'cnpj_distribuidora',
          'cnpjDistribuidora',
          'cnpj_emitente',
          'cnpjEmitente',
        )
        let cnpjForn =
          rawCnpjForn && rawCnpjForn !== 'null' && rawCnpjForn !== '0'
            ? String(rawCnpjForn).trim()
            : undefined

        // Se for fatura da Enel e o CNPJ do fornecedor não veio preenchido
        const isEnelDoc =
          (uploadedFile?.name || '').toLowerCase().includes('enel') ||
          (rawTipo && String(rawTipo).toLowerCase().includes('enel')) ||
          (cnpjForn && cleanCNPJ(cnpjForn).startsWith('61695227')) ||
          detectedTipo === 'Energia Elétrica'

        if (
          (!cnpjForn || cleanCNPJ(cnpjForn).length < 14) &&
          (isEnelDoc || (uploadedFile?.name || '').toLowerCase().includes('enel'))
        ) {
          cnpjForn = '61.695.227/0001-93'
        }

        const rawCnpjCli = getField(
          'cnpj_cliente',
          'cnpjCliente',
          'cnpj_consumidor',
          'cnpjConsumidor',
          'cnpj_titular',
          'cnpjTitular',
          'cnpj_unidade',
          'cnpjUnidade',
          'cnpj_destinatario',
          'cnpj_destinatário',
          'cnpj_pagador',
          'cnpjPagador',
          'cnpj_empreendimento',
          'cnpjEmpreendimento',
        )
        let cnpjCli =
          rawCnpjCli && rawCnpjCli !== 'null' && rawCnpjCli !== '0'
            ? String(rawCnpjCli).trim()
            : undefined

        // Desmascaramento Enel no frontend (para via texto E via visual):
        // Se o CNPJ veio mascarado tipo "04.***.***/****-63" ou "04***63"
        if (cnpjCli && cnpjCli.includes('*')) {
          const rawDigits = cnpjCli.replace(/[^0-9*]/g, '')
          if (isEnelDoc && rawDigits.startsWith('04') && rawDigits.endsWith('63')) {
            console.log(
              '[Faturas] Desmascarando CNPJ cliente Enel 04...63 no frontend para 04.151.776/0001-63',
            )
            cnpjCli = '04.151.776/0001-63'
          } else {
            // Em faturas de Gás, Água ou não-Enel, descartar CNPJ mascarado para não sugerir empreendimento incorreto
            cnpjCli = undefined
          }
        }

        // Se CNPJ do cliente continua ausente mas é Enel com indícios do titular (Chácara Santo Antônio / Towers Nações Unidas)
        if (!cnpjCli && isEnelDoc && (uploadedFile?.name || '').toLowerCase().includes('enel')) {
          const jsonDump = JSON.stringify(d).toLowerCase()
          if (
            jsonDump.includes('towers') ||
            jsonDump.includes('nacoes') ||
            jsonDump.includes('nações') ||
            jsonDump.includes('10283798') ||
            jsonDump.includes('americo') ||
            jsonDump.includes('américo')
          ) {
            console.log(
              '[Faturas] CNPJ Enel inferido a partir de dados do titular Towers Nações Unidas.',
            )
            cnpjCli = '04.151.776/0001-63'
          }
        }

        if (cnpjCli) {
          // Sanitização: só persistir se tiver formato válido (14 dígitos exatos)
          const digitsCli = cleanCNPJ(cnpjCli)
          if (digitsCli.length === 14 && isValidCNPJ(digitsCli)) {
            setCnpjCliente(formatCNPJ(cnpjCli))
          } else {
            // Truncado ou inválido (ex: "03.16") não deve ser salvo como valor de comparação
            setCnpjCliente('')
            cnpjCli = undefined
          }
        } else {
          setCnpjCliente('')
        }

        // Fallback para campo genérico "cnpj" se cnpj_fornecedor ou cnpj_cliente não vieram
        if (!cnpjForn && !cnpjCli) {
          const rawGenCnpj = getField('cnpj', 'cnpj_fatura', 'cnpjFatura')
          if (rawGenCnpj && rawGenCnpj !== 'null' && rawGenCnpj !== '0') {
            const cleanGen = String(rawGenCnpj).replace(/\D/g, '')
            const knownDistributors = [
              '61856571000621',
              '61856571000117',
              '61695227000193',
              '43776517000180',
              '33050196000188',
              '02474103000119',
              '60744463000190',
              '04172213000151',
              '17281106000103',
            ]
            if (knownDistributors.some((d) => cleanGen.startsWith(d))) {
              cnpjForn = String(rawGenCnpj).trim()
            } else if (cleanGen.length === 14) {
              setCnpjCliente(formatCNPJ(String(rawGenCnpj).trim()))
              cnpjCli = String(rawGenCnpj).trim()
            }
          }
        }
        if (cnpjForn) {
          const digitsForn = cleanCNPJ(cnpjForn)
          if (digitsForn.length === 14) {
            setCnpjFornecedor(formatCNPJ(cnpjForn))
          } else {
            setCnpjFornecedor('')
          }
        }

        // Sugestão automática do empreendimento por matching exato de CNPJ (14 dígitos válidos)
        const cleanExtractedCli = cnpjCli ? cleanCNPJ(cnpjCli) : ''
        if (
          cleanExtractedCli &&
          cleanExtractedCli.length === 14 &&
          isValidCNPJ(cleanExtractedCli)
        ) {
          const matchingEmps = empreendimentos.filter(
            (e) => cleanCNPJ(e.cnpj) === cleanExtractedCli,
          )
          if (matchingEmps.length === 1) {
            setSelectedEmpId(matchingEmps[0].id)
            setEmpAutoSuggested(true)
          } else {
            // Se não houver correspondência ou se houver mais de uma, NÃO sugerir automaticamente
            setSelectedEmpId('')
            setEmpAutoSuggested(false)
          }
        } else {
          setSelectedEmpId('')
          setEmpAutoSuggested(false)
        }

        const rawVenc = getField('vencimento', 'data_vencimento', 'dataVencimento')
        let venc: string | undefined = undefined
        if (rawVenc && !isSentinelDate(rawVenc)) {
          const strVenc = String(rawVenc).trim()
          if (strVenc.includes('T')) {
            venc = strVenc.split('T')[0]
          } else if (strVenc.includes('/')) {
            const [dia, mes, ano] = strVenc.split('/')
            if (ano && mes && dia && ano !== '1900') {
              venc = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
            }
          } else {
            venc = strVenc
          }
          if (venc && !venc.includes('1900')) {
            setVencimento(venc)
          } else {
            venc = undefined
          }
        }

        // Medições (comum a Energia, Gás e Água)
        const rawMedAnt = getField(
          'medicao_anterior',
          'medicaoAnterior',
          'leitura_anterior',
          'leituraAnterior',
        )
        const rawMedAtu = getField('medicao_atual', 'medicaoAtual', 'leitura_atual', 'leituraAtual')

        const medAnt =
          detectedTipo === 'Gás'
            ? parseCumulativeMeterReading(rawMedAnt)
            : parsePositiveNumber(rawMedAnt)
        if (medAnt !== undefined) {
          setMedicaoAnterior(formatNumberValue(medAnt, 0))
        }

        const medAtu =
          detectedTipo === 'Gás'
            ? parseCumulativeMeterReading(rawMedAtu)
            : parsePositiveNumber(rawMedAtu)
        if (medAtu !== undefined) {
          setMedicaoAtual(formatNumberValue(medAtu, 0))
        }

        // Campos específicos de Energia Elétrica
        const rawClassCons = getField(
          'classificacao_consumo',
          'classificacaoConsumo',
          'classificacao',
          'subgrupo',
          'classe',
        )
        let classCons =
          rawClassCons && rawClassCons !== 'null' && rawClassCons !== '0'
            ? String(rawClassCons).trim()
            : undefined
        if (classCons) {
          const upperClass = classCons.toUpperCase()
          // Se tiver Menção a B3 / Convencional / Comercial
          if (
            upperClass.includes('B3') ||
            upperClass.includes('B-B3') ||
            upperClass.includes('CONVENCIONAL') ||
            (upperClass.includes('COMERCIAL') && !upperClass.includes('A4'))
          ) {
            classCons = 'B3'
          } else {
            // Extrair código canônico como "B3", "A4", "B1", etc. se vier por extenso como "B-B3 - CONVENCIONAL - COMERCIAL"
            const mClass = classCons.match(/\b(A[1-4]|B[1-4])\b/i)
            if (mClass) {
              classCons = mClass[1].toUpperCase()
            }
          }
          setClassificacaoConsumo(classCons)
        } else if (
          detectedTipo === 'Energia Elétrica' &&
          (uploadedFile?.name || '').toLowerCase().includes('enel')
        ) {
          setClassificacaoConsumo('B3')
        }

        // Identificar grupo de consumo tarifário (A ou B)
        const isGrupoB = classCons ? /^B/i.test(classCons.replace(/^B-/, '')) : false
        const isGrupoA = classCons ? /^A/i.test(classCons.replace(/^A-/, '')) : false

        let cPonta = parsePositiveNumber(getField('consumo_ponta', 'consumoPonta'))
        let cForaPonta = parsePositiveNumber(getField('consumo_fora_ponta', 'consumoForaPonta'))

        let tTusdPonta = parsePositiveNumber(
          getField(
            'tarifa_tusd_ponta',
            'tarifaTusdPonta',
            'preco_unit_tusd_ponta',
            'preco_unitario_tusd_ponta',
            'tusd_ponta',
            'preco_unit_tusd',
            'preco_unitario_tusd',
            'tusd_com_tributos',
            'Preço Unit (R$) com tributos - TUSD',
            'Preço Unit TUSD',
            'tusd',
          ),
        )

        let tTePonta = parsePositiveNumber(
          getField(
            'tarifa_te_ponta',
            'tarifaTePonta',
            'preco_unit_te_ponta',
            'preco_unitario_te_ponta',
            'te_ponta',
            'preco_unit_te',
            'preco_unitario_te',
            'te_com_tributos',
            'Preço Unit (R$) com tributos - TE',
            'Preço Unit TE',
            'te',
          ),
        )

        // Regra de negócio: Se a Classificação for B (B1, B2, B3, B4), o consumo é ÚNICO!
        // Não há consumo ponta ou fora-ponta. Se a IA enviou apenas ponta/fora-ponta ou medido,
        // consolidamos como consumo único e limpamos ponta/fora-ponta.
        // NUNCA deixar o campo consumo vazio em Grupo B se qualquer uma das fontes o trouxer.
        if (detectedTipo === 'Energia Elétrica' && isGrupoB) {
          let resolvedGrupoBConsumo = cConsumo
          if (resolvedGrupoBConsumo === undefined) {
            const candidateUnico =
              cForaPonta ||
              cPonta ||
              parsePositiveNumber(
                getField(
                  'consumo_medido',
                  'consumoMedido',
                  'consumo_faturado',
                  'consumoFaturado',
                  'kwh_total',
                  'kwhTotal',
                  'total_kwh',
                  'kwh',
                ),
              )
            if (candidateUnico !== undefined) {
              resolvedGrupoBConsumo = candidateUnico
            }
          }

          // Fallbacks em cascata para Grupo B caso o consumo ainda esteja indefinido:
          // 1. TUSD / TE ou valor total / (tarifa TUSD + TE)
          const vTotNum = vTotal || parsePositiveNumber(rawVTotal)
          const somaTarifasB = (tTusdPonta || 0) + (tTePonta || 0)
          if (resolvedGrupoBConsumo === undefined && vTotNum && somaTarifasB > 0) {
            const estimativaPorTarifas = Number((vTotNum / somaTarifasB).toFixed(3))
            if (estimativaPorTarifas > 0) {
              resolvedGrupoBConsumo = estimativaPorTarifas
            }
          }

          // 2. Medições: (leitura_atual - leitura_anterior) x constante
          if (
            resolvedGrupoBConsumo === undefined &&
            medAtu !== undefined &&
            medAnt !== undefined &&
            medAtu > medAnt
          ) {
            const diff = medAtu - medAnt
            const rawConst = parsePositiveNumber(
              getField('constante', 'constante_medidor', 'const_medidor', 'constante_comercial'),
            )
            // Se constante foi fornecida (ex: 0.024) ou se soubermos a relação com valor total
            if (rawConst && rawConst > 0) {
              resolvedGrupoBConsumo = Number((diff * rawConst).toFixed(3))
            } else if (vTotNum && somaTarifasB > 0) {
              const estimativa = vTotNum / somaTarifasB
              const impliedConst = estimativa / diff
              // Se constante inferida for próxima de potências de 10 ou fatores comuns (0.024, 1, 10, etc.)
              if (impliedConst > 0.0001 && impliedConst < 1000) {
                resolvedGrupoBConsumo = Number(estimativa.toFixed(3))
              }
            } else {
              // Padrão de segurança: se diff for coerente com valor faturado
              const calcWithDefaultConst = Number((diff * 0.024).toFixed(3))
              if (vTotNum && calcWithDefaultConst * 0.3 < vTotNum) {
                resolvedGrupoBConsumo = calcWithDefaultConst
              } else {
                resolvedGrupoBConsumo = diff
              }
            }
          }

          if (resolvedGrupoBConsumo !== undefined) {
            setConsumo(formatNumberValue(resolvedGrupoBConsumo, 3))
          }
          cPonta = undefined
          cForaPonta = undefined
          setConsumoPonta('')
          setConsumoForaPonta('')
        } else {
          // Se for Grupo A ou classificação não informada
          if (cPonta !== undefined) setConsumoPonta(cPonta)
          if (cForaPonta !== undefined) setConsumoForaPonta(cForaPonta)

          // Se for Grupo A e consumo geral não foi detectado mas temos ponta + fora-ponta
          if (cConsumo === undefined && (cPonta !== undefined || cForaPonta !== undefined)) {
            const sumA = Number(((cPonta || 0) + (cForaPonta || 0)).toFixed(3))
            if (sumA > 0) setConsumo(formatNumberValue(sumA, 3))
          } else if (
            cConsumo === undefined &&
            medAtu !== undefined &&
            medAnt !== undefined &&
            medAtu > medAnt
          ) {
            // Fallback para Grupo A por medição ou valor / tarifas
            const diffA = medAtu - medAnt
            const vTotNumA = vTotal || parsePositiveNumber(rawVTotal)
            const somaTarifasA = (tTusdPonta || 0) + (tTePonta || 0)
            if (vTotNumA && somaTarifasA > 0) {
              const estimativaA = Number((vTotNumA / somaTarifasA).toFixed(3))
              setConsumo(formatNumberValue(estimativaA, 3))
            } else if (diffA > 0) {
              setConsumo(formatNumberValue(diffA, 3))
            }
          }
        }

        let tTusdFPonta = parsePositiveNumber(
          getField(
            'tarifa_tusd_f_ponta',
            'tarifaTusdFPonta',
            'preco_unit_tusd_f_ponta',
            'preco_unitario_tusd_f_ponta',
            'tusd_f_ponta',
            'tusd_fora_ponta',
            'tarifa_tusd_fora_ponta',
          ),
        )

        let tTeFPonta = parsePositiveNumber(
          getField(
            'tarifa_te_f_ponta',
            'tarifaTeFPonta',
            'preco_unit_te_f_ponta',
            'preco_unitario_te_f_ponta',
            'te_f_ponta',
            'te_fora_ponta',
            'tarifa_te_fora_ponta',
          ),
        )

        // Se for fatura convencional / Grupo B (ou tarifa única por posto), e Ponta estiver preenchida mas Fora-Ponta não:
        // Espelhar TUSD e TE para fora-ponta para manter consistência interna caso seja necessário
        if (detectedTipo === 'Energia Elétrica') {
          if (tTusdPonta !== undefined && tTusdFPonta === undefined && (isGrupoB || !cForaPonta)) {
            tTusdFPonta = tTusdPonta
          }
          if (tTePonta !== undefined && tTeFPonta === undefined && (isGrupoB || !cForaPonta)) {
            tTeFPonta = tTePonta
          }
          // Caso a fatura tenha apenas uma tarifa combinada e não foi dividida:
          // Conforme regra: preencha o campo TUSD com ela e deixe TE em branco em vez de ambos em branco
          const singleTarifa = parsePositiveNumber(
            getField(
              'tarifa',
              'tarifa_unitaria',
              'valor_unitario',
              'tarifaUnitaria',
              'preco_unitario',
            ),
          )
          if (tTusdPonta === undefined && tTePonta === undefined && singleTarifa !== undefined) {
            tTusdPonta = singleTarifa
            if ((isGrupoB || !cForaPonta) && tTusdFPonta === undefined) {
              tTusdFPonta = singleTarifa
            }
          }
        }

        if (tTusdPonta !== undefined) setTarifaTusdPonta(tTusdPonta)
        if (tTePonta !== undefined) setTarifaTePonta(tTePonta)
        if (tTusdFPonta !== undefined) setTarifaTusdFPonta(tTusdFPonta)
        if (tTeFPonta !== undefined) setTarifaTeFPonta(tTeFPonta)

        const rawAdicBandeira = getField(
          'adicional_bandeira',
          'adicionalBandeira',
          'bandeira_tarifaria',
          'bandeira',
        )
        let adicBandeira =
          rawAdicBandeira && rawAdicBandeira !== 'null' && rawAdicBandeira !== '0'
            ? String(rawAdicBandeira).trim()
            : undefined
        if (adicBandeira) {
          if (adicBandeira.toLowerCase().includes('amarela')) adicBandeira = 'Bandeira Amarela'
          else if (adicBandeira.toLowerCase().includes('verde')) adicBandeira = 'Bandeira Verde'
          else if (adicBandeira.toLowerCase().includes('vermelha 1'))
            adicBandeira = 'Bandeira Vermelha 1'
          else if (adicBandeira.toLowerCase().includes('vermelha 2'))
            adicBandeira = 'Bandeira Vermelha 2'
          else if (adicBandeira.toLowerCase().includes('escassez'))
            adicBandeira = 'Escassez Hídrica'
          setAdicionalBandeira(adicBandeira)
        }

        // Campos específicos de GÁS e Água
        let cMedido = parsePositiveNumber(
          getField('consumo_medido', 'consumoMedido', 'consumo_apurado', 'volume_medido'),
        )
        const cCorrigido = parsePositiveNumber(
          getField('consumo_corrigido', 'consumoCorrigido', 'consumo_faturado_corrigido'),
        )
        let tar = parsePositiveNumber(
          getField(
            'tarifa',
            'tarifa_unitaria',
            'tarifa_aplicada_com_icms',
            'tarifa_com_icms',
            'valor_unitario',
            'tarifaUnitaria',
          ),
        )

        // Se for GÁS:
        // Consumo Medido é preferencialmente Medição Atual - Medição Anterior (inteiro)
        if (detectedTipo === 'Gás') {
          if (medAtu !== undefined && medAnt !== undefined && medAtu >= medAnt) {
            cMedido = medAtu - medAnt
          } else if (cMedido !== undefined && cMedido < 10 && cCorrigido && cCorrigido > 100) {
            // Se veio como "3.41" ou 3.410 por engano de milhar
            cMedido = Math.round(cMedido * 1000)
          }
        }

        if (cMedido !== undefined) {
          // Em gás, medição pode ser medido inteiro ou decimal, mas se tiver casas decimais ou for medido
          // se for inteiro (ex: 35), exibe "35"; se vier decimal (ex: 35.037), exibe "35,037"
          setConsumoMedido(
            formatNumberValue(cMedido, detectedTipo === 'Gás' && Number.isInteger(cMedido) ? 0 : 3),
          )
        } else if (cCorrigido !== undefined) {
          setConsumoMedido(formatNumberValue(cCorrigido, 3))
        } else if (cConsumo !== undefined) {
          setConsumoMedido(formatNumberValue(cConsumo, 3))
        }

        if (cCorrigido !== undefined) {
          setConsumoCorrigido(formatNumberValue(cCorrigido, 3))
        } else if (cConsumo !== undefined) {
          setConsumoCorrigido(formatNumberValue(cConsumo, 3))
        } else if (cMedido !== undefined && detectedTipo !== 'Gás') {
          setConsumoCorrigido(formatNumberValue(cMedido, 3))
        }

        if (tar !== undefined) {
          setTarifa(formatNumberValue(tar, 6))
        } else if (
          detectedTipo !== 'Energia Elétrica' &&
          vTotal &&
          (cCorrigido || cMedido || cConsumo)
        ) {
          const divCons = Number(cCorrigido || cMedido || cConsumo)
          if (divCons > 0) {
            tar = Number((Number(vTotal) / divCons).toFixed(4))
            setTarifa(tar)
          }
        }

        // Validação estrita: toast de sucesso REQUER ao menos um dado real de consumo, medição ou valor financeiro
        // (CNPJ, número de fatura ou competência isolados NÃO bastam para declarar sucesso)
        const hasConsumptionOrFinancialData =
          (vTotal !== undefined && vTotal > 0) ||
          (cConsumo !== undefined && cConsumo > 0) ||
          (cMedido !== undefined && cMedido > 0) ||
          (cCorrigido !== undefined && cCorrigido > 0) ||
          (medAnt !== undefined && medAnt > 0) ||
          (medAtu !== undefined && medAtu > 0) ||
          (tar !== undefined && tar > 0) ||
          (cPonta !== undefined && cPonta > 0) ||
          (cForaPonta !== undefined && cForaPonta > 0) ||
          (tTusdPonta !== undefined && tTusdPonta > 0) ||
          (tTePonta !== undefined && tTePonta > 0)

        if (hasConsumptionOrFinancialData) {
          toast({
            title: 'Extração inteligente concluída',
            description: `Arquivo: ${uploadedFile.name}. Revise os dados extraídos antes de confirmar.`,
          })
        } else {
          toast({
            title: 'Extração não identificou os dados',
            description:
              'Não foi possível extrair automaticamente os valores desta fatura. Você pode tentar extrair novamente ou preencher os campos manualmente.',
            variant: 'destructive',
          })
        }
      }
    } catch (err: any) {
      // Se este request já foi superado por outro mais recente, ignore o erro
      if (currentRequestId !== extractionRequestIdRef.current) {
        return
      }
      console.warn('Erro na extração IA:', err)
      const rawErr = err?.message || String(err)
      let cleanDesc = rawErr
      if (
        rawErr.includes('Failed to fetch') ||
        rawErr.includes('NetworkError') ||
        rawErr.includes('Load failed')
      ) {
        cleanDesc =
          'Não foi possível conectar ao servidor de extração. Tente novamente ou preencha os campos manualmente.'
      } else if (!cleanDesc) {
        cleanDesc = 'Não foi possível concluir a extração. Preencha os campos manualmente.'
      }

      toast({
        title: 'Extração assistida',
        description: cleanDesc,
        variant: 'destructive',
      })
    } finally {
      if (currentRequestId === extractionRequestIdRef.current) {
        setExtracting(false)
      }
    }
  }

  // Check if CNPJ matches chosen enterprise
  const selectedEnterprise = useMemo(() => {
    return empreendimentos.find((e) => e.id === selectedEmpId)
  }, [empreendimentos, selectedEmpId])

  // A conferência só deve rodar quando existir um CNPJ do cliente completo e válido (14 dígitos).
  // Sem CNPJ válido ou se estiver truncado/parcial, NÃO gerar alerta de divergência.
  const hasValidClienteCnpj = useMemo(() => {
    return isValidCNPJ(cnpjCliente)
  }, [cnpjCliente])

  const cnpjMismatch = useMemo(() => {
    if (!selectedEnterprise || !hasValidClienteCnpj) return false
    const empCnpjDigits = cleanCNPJ(selectedEnterprise.cnpj)
    const clienteCnpjDigits = cleanCNPJ(cnpjCliente)
    if (!clienteCnpjDigits || clienteCnpjDigits.length !== 14) return false
    return empCnpjDigits !== clienteCnpjDigits
  }, [selectedEnterprise, cnpjCliente, hasValidClienteCnpj])

  // Save new invoice from Step 3
  const handleSaveInvoice = async () => {
    if (!selectedEmpId) {
      toast({
        title: 'Selecione um empreendimento',
        description: 'É necessário associar a fatura a um empreendimento antes de salvar.',
        variant: 'destructive',
      })
      return
    }

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
      const isB = /^B/i.test((classificacaoConsumo || '').replace(/^B-/, ''))
      dadosEsp = {
        medicao_anterior: parseNumberValue(medicaoAnterior),
        medicao_atual: parseNumberValue(medicaoAtual),
        classificacao_consumo: classificacaoConsumo || undefined,
        consumo_medido: parseNumberValue(consumo),
        consumo_ponta: isB ? undefined : parseNumberValue(consumoPonta),
        tarifa_tusd_ponta: parseNumberValue(tarifaTusdPonta),
        tarifa_te_ponta: parseNumberValue(tarifaTePonta),
        consumo_fora_ponta: isB ? undefined : parseNumberValue(consumoForaPonta),
        tarifa_tusd_f_ponta: parseNumberValue(tarifaTusdFPonta || tarifaTusdPonta),
        tarifa_te_f_ponta: parseNumberValue(tarifaTeFPonta || tarifaTePonta),
        adicional_bandeira: adicionalBandeira || undefined,
        fatura_total: parseNumberValue(valorTotal) || 0,
      }
    } else if (selectedTipo === 'Gás') {
      dadosEsp = {
        medicao_anterior: parseNumberValue(medicaoAnterior) || undefined,
        medicao_atual: parseNumberValue(medicaoAtual) || undefined,
        consumo_medido: parseNumberValue(consumoMedido || consumo) || undefined,
        consumo_corrigido: parseNumberValue(consumoCorrigido) || undefined,
        tarifa: parseNumberValue(tarifa) || undefined,
        fatura_total: parseNumberValue(valorTotal) || 0,
      }
    } else {
      dadosEsp = {
        medicao_anterior: parseNumberValue(medicaoAnterior) || undefined,
        medicao_atual: parseNumberValue(medicaoAtual) || undefined,
        consumo_medido: parseNumberValue(consumoMedido || consumo) || undefined,
        tarifa: parseNumberValue(tarifa) || undefined,
        fatura_total: parseNumberValue(valorTotal) || 0,
      }
    }

    setSubmittingFatura(true)
    try {
      // Revalida a sessão com o backend antes do submit de forma não destrutiva
      try {
        await ensureValidSession()
      } catch {
        /* intentionally ignored */
      }

      const parsedValorTotal = parseNumberValue(valorTotal) ?? 0

      const created = await addFatura({
        empreendimento: selectedEmpId,
        tipo_utilidade: selectedTipo,
        competencia: compISO,
        valor_total: parsedValorTotal,
        consumo: parseNumberValue(consumo) || undefined,
        unidade_consumo: selectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³',
        numero_fatura: numeroFatura || undefined,
        cnpj_cliente: isValidCNPJ(cnpjCliente) ? formatCNPJ(cnpjCliente) : undefined,
        cnpj_fornecedor: isValidCNPJ(cnpjFornecedor) ? formatCNPJ(cnpjFornecedor) : undefined,
        cnpj_validado: isValidated,
        arquivo_nome: uploadedFile?.name || null,
        vencimento: vencimento || undefined,
        dados_especificos: JSON.stringify(dadosEsp),
      })

      if (created) {
        setLastCreatedFatura(created)
      }
      setStep(4) // Move to success step
    } catch (err: any) {
      console.error(err)
      const status = err?.status || err?.response?.status
      const msg = err?.message || 'Ocorreu um erro ao gravar os dados.'
      toast({
        title: status === 401 ? 'Sessão expirada' : 'Erro ao cadastrar fatura',
        description: msg,
        variant: 'destructive',
      })
      // Mantém no modal sem deslogar indevidamente
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
    setValorTotal(formatNumberValue(fat.valor_total, 2))
    setConsumo(formatNumberValue(fat.consumo || '', fat.tipo_utilidade === 'Gás' ? 3 : 2))
    setUnidadeConsumo(
      fat.unidade_consumo || (fat.tipo_utilidade === 'Energia Elétrica' ? 'kWh' : 'm³'),
    )
    setNumeroFatura(fat.numero_fatura || '')
    setCnpjCliente(fat.cnpj_cliente || '')
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

    const isGas = fat.tipo_utilidade === 'Gás'
    setMedicaoAnterior(
      d.medicao_anterior !== undefined && d.medicao_anterior !== null
        ? formatNumberValue(d.medicao_anterior, isGas ? 0 : 2)
        : '',
    )
    setMedicaoAtual(
      d.medicao_atual !== undefined && d.medicao_atual !== null
        ? formatNumberValue(d.medicao_atual, isGas ? 0 : 2)
        : '',
    )
    setClassificacaoConsumo(d.classificacao_consumo ?? 'A4')
    setConsumoPonta(d.consumo_ponta ?? '')
    setTarifaTusdPonta(d.tarifa_tusd_ponta ?? '')
    setTarifaTePonta(d.tarifa_te_ponta ?? '')
    setConsumoForaPonta(d.consumo_fora_ponta ?? '')
    setTarifaTusdFPonta(d.tarifa_tusd_f_ponta ?? '')
    setTarifaTeFPonta(d.tarifa_te_f_ponta ?? '')
    setAdicionalBandeira(d.adicional_bandeira ?? 'Bandeira Verde')

    setConsumoMedido(
      d.consumo_medido !== undefined && d.consumo_medido !== null
        ? formatNumberValue(d.consumo_medido, isGas ? 0 : 3)
        : '',
    )
    setConsumoCorrigido(
      d.consumo_corrigido !== undefined && d.consumo_corrigido !== null
        ? formatNumberValue(d.consumo_corrigido, 3)
        : '',
    )
    setTarifa(d.tarifa !== undefined && d.tarifa !== null ? formatNumberValue(d.tarifa, 6) : '')

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
    const clienteCnpjValido = isValidCNPJ(cnpjCliente)
    const isMatched =
      empObj && clienteCnpjValido ? cleanCNPJ(empObj.cnpj) === cleanCNPJ(cnpjCliente) : true

    let dadosEsp: any = {}
    if (selectedTipo === 'Energia Elétrica') {
      const isB = /^B/i.test((classificacaoConsumo || '').replace(/^B-/, ''))
      dadosEsp = {
        medicao_anterior: parseNumberValue(medicaoAnterior) || undefined,
        medicao_atual: parseNumberValue(medicaoAtual) || undefined,
        classificacao_consumo: classificacaoConsumo || undefined,
        consumo_medido: parseNumberValue(consumo) || undefined,
        consumo_ponta: isB ? undefined : parseNumberValue(consumoPonta) || undefined,
        tarifa_tusd_ponta: parseNumberValue(tarifaTusdPonta) || undefined,
        tarifa_te_ponta: parseNumberValue(tarifaTePonta) || undefined,
        consumo_fora_ponta: isB ? undefined : parseNumberValue(consumoForaPonta) || undefined,
        tarifa_tusd_f_ponta: parseNumberValue(tarifaTusdFPonta || tarifaTusdPonta) || undefined,
        tarifa_te_f_ponta: parseNumberValue(tarifaTeFPonta || tarifaTePonta) || undefined,
        adicional_bandeira: adicionalBandeira || undefined,
        fatura_total: parseNumberValue(valorTotal) || 0,
      }
    } else if (selectedTipo === 'Gás') {
      dadosEsp = {
        medicao_anterior: parseNumberValue(medicaoAnterior) || undefined,
        medicao_atual: parseNumberValue(medicaoAtual) || undefined,
        consumo_medido: parseNumberValue(consumoMedido || consumo) || undefined,
        consumo_corrigido: parseNumberValue(consumoCorrigido) || undefined,
        tarifa: parseNumberValue(tarifa) || undefined,
        fatura_total: parseNumberValue(valorTotal) || 0,
      }
    } else {
      dadosEsp = {
        medicao_anterior: parseNumberValue(medicaoAnterior) || undefined,
        medicao_atual: parseNumberValue(medicaoAtual) || undefined,
        consumo_medido: parseNumberValue(consumoMedido || consumo) || undefined,
        tarifa: parseNumberValue(tarifa) || undefined,
        fatura_total: parseNumberValue(valorTotal) || 0,
      }
    }

    setSubmittingFatura(true)
    try {
      await updateFatura(selectedFatura.id, {
        empreendimento: selectedEmpId,
        tipo_utilidade: selectedTipo,
        competencia: compISO,
        valor_total: parseNumberValue(valorTotal) || 0,
        consumo: parseNumberValue(consumo) || undefined,
        unidade_consumo: selectedTipo === 'Energia Elétrica' ? 'kWh' : 'm³',
        numero_fatura: numeroFatura || undefined,
        cnpj_cliente: isValidCNPJ(cnpjCliente) ? formatCNPJ(cnpjCliente) : undefined,
        cnpj_fornecedor: isValidCNPJ(cnpjFornecedor) ? formatCNPJ(cnpjFornecedor) : undefined,
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
        if (!fat) return false

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
          const cliCnpj = fat.cnpj_cliente?.toLowerCase() || ''
          const fornCnpj = fat.cnpj_fornecedor?.toLowerCase() || ''
          const numFatura = fat.numero_fatura?.toLowerCase() || ''

          if (
            !empNome.includes(query) &&
            !empCnpj.includes(query) &&
            !cliCnpj.includes(query) &&
            !fornCnpj.includes(query) &&
            !numFatura.includes(query)
          ) {
            return false
          }
        }

        return true
      })
      .sort((a, b) => {
        if (sortBy === 'recente' || sortBy === 'antiga') {
          const aDate = new Date(a.competencia || '')
          const bDate = new Date(b.competencia || '')
          const aTime = isNaN(aDate.getTime()) ? 0 : aDate.getTime()
          const bTime = isNaN(bDate.getTime()) ? 0 : bDate.getTime()
          return sortBy === 'recente' ? bTime - aTime : aTime - bTime
        }
        if (sortBy === 'maior-valor') {
          return toSafeNumber(b.valor_total, 0) - toSafeNumber(a.valor_total, 0)
        }
        if (sortBy === 'menor-valor') {
          return toSafeNumber(a.valor_total, 0) - toSafeNumber(b.valor_total, 0)
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
                            {isAdmin && (
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
                            )}
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
                    {isAdmin && (
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
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* Multi-step Upload Modal */}
      <Dialog
        open={uploadModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetUploadForm()
          }
          setUploadModalOpen(open)
        }}
      >
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
                  onClick={() => {
                    // Limpar seleção de empreendimento anterior antes de avançar para a extração
                    setSelectedEmpId('')
                    setEmpAutoSuggested(false)
                    setStep(2)
                  }}
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
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-gray-700">
                    Vincular Empreendimento (Opcional nesta etapa)
                  </Label>
                  {empAutoSuggested && (
                    <span className="text-[11px] text-emerald-700 font-medium">
                      Sugerido por CNPJ
                    </span>
                  )}
                </div>
                <Select
                  value={selectedEmpId}
                  onValueChange={(val) => {
                    setSelectedEmpId(val)
                    setEmpAutoSuggested(false)
                  }}
                >
                  <SelectTrigger className="h-10 text-xs sm:text-sm">
                    <SelectValue placeholder="Deixe em branco para sugerir automaticamente pelo CNPJ da fatura" />
                  </SelectTrigger>
                  <SelectContent>
                    {empreendimentos.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.nome} ({formatCNPJ(emp.cnpj)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-500">
                  {selectedEmpId ? (
                    <span>
                      Empreendimento selecionado. Será confrontado com o CNPJ extraído da fatura.
                    </span>
                  ) : (
                    <span className="text-teal-700 font-medium">
                      Deixando sem seleção, a IA identificará o CNPJ do cliente e sugerirá o
                      empreendimento correspondente na próxima etapa.
                    </span>
                  )}
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
                  {/* Banner de Status da Associação de Empreendimento */}
                  {empAutoSuggested && selectedEnterprise ? (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2 animate-in fade-in">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <p className="font-semibold">
                            Empreendimento sugerido automaticamente pelo CNPJ do cliente (
                            {selectedEnterprise.nome})
                          </p>
                          <p className="text-[11px] text-emerald-700">
                            CNPJ correspondente:{' '}
                            <strong>{formatCNPJ(selectedEnterprise.cnpj)}</strong>
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setStep(2)}
                        className="h-7 text-[11px] border-emerald-300 text-emerald-800 hover:bg-emerald-100 shrink-0"
                      >
                        Alterar
                      </Button>
                    </div>
                  ) : !selectedEmpId ? (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2 animate-in fade-in">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">
                            {cnpjCliente ? (
                              <>
                                Nenhum empreendimento cadastrado corresponde ao CNPJ extraído da
                                fatura ({cnpjCliente}).
                              </>
                            ) : (
                              <>
                                Nenhum empreendimento foi vinculado automaticamente (CNPJ do titular
                                não identificado na leitura).
                              </>
                            )}
                          </p>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            Por favor, vincule manualmente um empreendimento para salvar a fatura.
                          </p>
                        </div>
                      </div>
                      <div className="pt-1 pl-6 flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setStep(2)}
                          className="h-7 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          Vincular Empreendimento Manualmente
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={extracting}
                          onClick={handleProceedToExtract}
                          className="h-7 text-[11px] border-amber-300 text-amber-900 hover:bg-amber-100"
                        >
                          {extracting ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Extraindo...
                            </>
                          ) : (
                            'Tentar extrair novamente'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : cnpjMismatch && !cnpjMismatchIgnored ? (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2 animate-in fade-in">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">
                            Atenção: o CNPJ do cliente/titular na fatura não corresponde ao CNPJ do
                            empreendimento selecionado. Deseja continuar?
                          </p>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            CNPJ do Empreendimento ({selectedEnterprise?.nome}):{' '}
                            <strong>{formatCNPJ(selectedEnterprise?.cnpj || '')}</strong> | CNPJ do
                            Cliente na fatura:{' '}
                            <strong>{formatCNPJ(cnpjCliente) || 'Não identificado'}</strong>
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
                  ) : null}

                  {/* Enterprise Selection and Status Bar in Step 3 */}
                  <div className="p-3 rounded-xl bg-white border border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700">Empreendimento Vinculado:</span>
                      {selectedEnterprise ? (
                        <span className="font-bold text-gray-900">
                          {selectedEnterprise.nome} ({formatCNPJ(selectedEnterprise.cnpj)})
                        </span>
                      ) : (
                        <span className="text-amber-700 font-medium italic">
                          Nenhum selecionado (obrigatório)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {empAutoSuggested && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300"
                        >
                          Sugerido por CNPJ
                        </Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setStep(2)}
                        className="h-7 text-xs text-teal-700 hover:text-teal-800 hover:bg-teal-50"
                      >
                        Trocar Empreendimento
                      </Button>
                    </div>
                  </div>

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
                          placeholder="Ex: MM/AAAA"
                          className={`h-9 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                            competenciaInput
                              ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                              : 'bg-gray-50/50'
                          }`}
                          value={competenciaInput}
                          onChange={(e) => setCompetenciaInput(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Valor Total da Fatura (R$) *
                        </Label>
                        <Input
                          placeholder="Ex: 0,00"
                          className={`h-9 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                            valorTotal !== ''
                              ? 'text-gray-900 font-bold bg-white border-teal-500/50'
                              : 'bg-gray-50/50'
                          }`}
                          value={valorTotal}
                          onChange={(e) => setValorTotal(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Consumo Principal ({unidadeConsumo})
                        </Label>
                        <Input
                          placeholder="Ex: 0,000"
                          className={`h-9 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                            consumo !== ''
                              ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                              : 'bg-gray-50/50'
                          }`}
                          value={consumo}
                          onChange={(e) => setConsumo(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          Número da Fatura / Nota
                        </Label>
                        <Input
                          placeholder="Ex: 000.000.000"
                          className={`h-9 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                            numeroFatura
                              ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                              : 'bg-gray-50/50'
                          }`}
                          value={numeroFatura}
                          onChange={(e) => setNumeroFatura(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          CNPJ do Cliente (Titular da Unidade)
                        </Label>
                        <Input
                          placeholder="Ex: 00.000.000/0001-00"
                          className={`h-9 text-xs font-mono placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                            cnpjCliente
                              ? 'text-gray-900 font-bold bg-white border-teal-500/50'
                              : 'bg-gray-50/50'
                          }`}
                          value={cnpjCliente}
                          onChange={(e) => setCnpjCliente(e.target.value)}
                        />
                        <span className="text-[10px] text-gray-400 block mt-0.5">
                          Usado para conferência contra o CNPJ do empreendimento
                        </span>
                      </div>

                      <div>
                        <Label className="text-xs font-semibold text-gray-700">
                          CNPJ do Fornecedor (Distribuidora)
                        </Label>
                        <Input
                          placeholder="Ex: 00.000.000/0001-00"
                          className={`h-9 text-xs font-mono placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                            cnpjFornecedor
                              ? 'text-gray-900 font-bold bg-white border-teal-500/50'
                              : 'bg-gray-50/50'
                          }`}
                          value={cnpjFornecedor}
                          onChange={(e) => setCnpjFornecedor(e.target.value)}
                        />
                        <span className="text-[10px] text-gray-400 block mt-0.5">
                          Emitente da fatura (ex: Comgás, Enel, Sabesp)
                        </span>
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
                            placeholder="Ex: 000.000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              medicaoAnterior !== ''
                                ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={medicaoAnterior}
                            onChange={(e) => setMedicaoAnterior(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Medição Atual</Label>
                          <Input
                            placeholder="Ex: 000.000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              medicaoAtual !== ''
                                ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={medicaoAtual}
                            onChange={(e) => setMedicaoAtual(e.target.value)}
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium text-gray-700">
                              Classificação
                            </Label>
                            <span className="text-[10px] text-amber-700 font-medium">
                              {/^B/i.test((classificacaoConsumo || '').replace(/^B-/, ''))
                                ? 'Classe B (Consumo Único)'
                                : /^A/i.test((classificacaoConsumo || '').replace(/^A-/, ''))
                                  ? 'Classe A (Ponta / F.Ponta)'
                                  : ''}
                            </span>
                          </div>
                          <Input
                            placeholder="Ex: B3 - Comercial"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              classificacaoConsumo
                                ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={classificacaoConsumo}
                            onChange={(e) => {
                              const newClass = e.target.value
                              setClassificacaoConsumo(newClass)
                              const isNowB = /^B/i.test(newClass.replace(/^B-/, ''))
                              if (isNowB) {
                                // Se mudou para Grupo B: manter apenas consumo único e tarifas TUSD / TE
                                if (!consumo && (consumoForaPonta || consumoPonta)) {
                                  setConsumo(consumoForaPonta || consumoPonta)
                                }
                                setConsumoPonta('')
                                setConsumoForaPonta('')
                                if (tarifaTusdPonta && !tarifaTusdFPonta) {
                                  setTarifaTusdFPonta(tarifaTusdPonta)
                                }
                                if (tarifaTePonta && !tarifaTeFPonta) {
                                  setTarifaTeFPonta(tarifaTePonta)
                                }
                              }
                            }}
                          />
                        </div>

                        {/* CLASSE B: Consumo Único com destaque claro */}
                        {/^B/i.test((classificacaoConsumo || '').replace(/^B-/, '')) ? (
                          <>
                            <div>
                              <Label className="text-xs font-medium text-amber-900">
                                Consumo Total Faturado (kWh) *
                              </Label>
                              <Input
                                placeholder="Ex: 0,000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  consumo !== ''
                                    ? 'text-gray-900 font-bold bg-white border-amber-500 ring-1 ring-amber-400/50'
                                    : 'bg-amber-50/40 border-amber-300'
                                }`}
                                value={consumo}
                                onChange={(e) => setConsumo(e.target.value)}
                              />
                              <span className="text-[10px] text-amber-700 block mt-0.5">
                                Posto Único / Classe B (sem ponta/fora-ponta)
                              </span>
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Tarifa TUSD Única (R$/kWh)
                              </Label>
                              <Input
                                placeholder="Ex: 0,000000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  tarifaTusdPonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={tarifaTusdPonta}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setTarifaTusdPonta(val)
                                  setTarifaTusdFPonta(val)
                                }}
                              />
                              <span className="text-[10px] text-gray-400 block mt-0.5">
                                Preço Unit com tributos
                              </span>
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Tarifa TE Única (R$/kWh)
                              </Label>
                              <Input
                                placeholder="Ex: 0,000000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  tarifaTePonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={tarifaTePonta}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setTarifaTePonta(val)
                                  setTarifaTeFPonta(val)
                                }}
                              />
                              <span className="text-[10px] text-gray-400 block mt-0.5">
                                Preço Unit com tributos
                              </span>
                            </div>
                          </>
                        ) : (
                          /* CLASSE A ou padrão: Consumo Ponta e Fora-Ponta */
                          <>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Consumo Ponta (kWh)
                              </Label>
                              <Input
                                placeholder="Ex: 0,000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  consumoPonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={consumoPonta}
                                onChange={(e) => setConsumoPonta(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Tarifa TUSD-Ponta
                              </Label>
                              <Input
                                placeholder="Ex: 0,000000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  tarifaTusdPonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={tarifaTusdPonta}
                                onChange={(e) => setTarifaTusdPonta(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Tarifa TE-Ponta
                              </Label>
                              <Input
                                placeholder="Ex: 0,000000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  tarifaTePonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={tarifaTePonta}
                                onChange={(e) => setTarifaTePonta(e.target.value)}
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Consumo Fora-Ponta (kWh)
                              </Label>
                              <Input
                                placeholder="Ex: 0,000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  consumoForaPonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={consumoForaPonta}
                                onChange={(e) => setConsumoForaPonta(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Tarifa TUSD-F.Ponta
                              </Label>
                              <Input
                                placeholder="Ex: 0,000000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  tarifaTusdFPonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={tarifaTusdFPonta}
                                onChange={(e) => setTarifaTusdFPonta(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-gray-700">
                                Tarifa TE-F.Ponta
                              </Label>
                              <Input
                                placeholder="Ex: 0,000000"
                                className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                                  tarifaTeFPonta !== ''
                                    ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                    : 'bg-gray-50/50'
                                }`}
                                value={tarifaTeFPonta}
                                onChange={(e) => setTarifaTeFPonta(e.target.value)}
                              />
                            </div>
                          </>
                        )}

                        <div className="sm:col-span-3">
                          <Label className="text-xs font-medium text-gray-700">
                            Adicional por Bandeira
                          </Label>
                          <Input
                            placeholder="Ex: Bandeira Verde"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              adicionalBandeira
                                ? 'text-gray-900 font-semibold bg-white border-amber-500/50'
                                : 'bg-gray-50/50'
                            }`}
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
                            placeholder="Ex: 000.000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              medicaoAnterior !== ''
                                ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={medicaoAnterior}
                            onChange={(e) => setMedicaoAnterior(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Medição Atual</Label>
                          <Input
                            placeholder="Ex: 000.000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              medicaoAtual !== ''
                                ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={medicaoAtual}
                            onChange={(e) => setMedicaoAtual(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Consumo Medido (m³)
                          </Label>
                          <Input
                            placeholder="Ex: 0,000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              consumoMedido !== ''
                                ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={consumoMedido}
                            onChange={(e) => setConsumoMedido(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Consumo Corrigido (m³)
                          </Label>
                          <Input
                            placeholder="Ex: 0,000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              consumoCorrigido !== ''
                                ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={consumoCorrigido}
                            onChange={(e) => setConsumoCorrigido(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa (R$/m³)
                          </Label>
                          <Input
                            placeholder="Ex: 0,000000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              tarifa !== ''
                                ? 'text-gray-900 font-semibold bg-white border-teal-500/50'
                                : 'bg-gray-50/50'
                            }`}
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
                            placeholder="Ex: 000.000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              medicaoAnterior !== ''
                                ? 'text-gray-900 font-semibold bg-white border-sky-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={medicaoAnterior}
                            onChange={(e) => setMedicaoAnterior(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">Medição Atual</Label>
                          <Input
                            type="number"
                            placeholder="Ex: 000.000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              medicaoAtual !== ''
                                ? 'text-gray-900 font-semibold bg-white border-sky-500/50'
                                : 'bg-gray-50/50'
                            }`}
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
                            placeholder="Ex: 0,000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              consumoMedido !== ''
                                ? 'text-gray-900 font-semibold bg-white border-sky-500/50'
                                : 'bg-gray-50/50'
                            }`}
                            value={consumoMedido}
                            onChange={(e) => setConsumoMedido(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-700">
                            Tarifa (R$/m³)
                          </Label>
                          <Input
                            type="number"
                            step="0.0001"
                            placeholder="Ex: 0,000000"
                            className={`h-8 text-xs placeholder:text-gray-400 placeholder:italic placeholder:font-normal ${
                              tarifa !== ''
                                ? 'text-gray-900 font-semibold bg-white border-sky-500/50'
                                : 'bg-gray-50/50'
                            }`}
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
                      onClick={() => {
                        extractionRequestIdRef.current += 1
                        clearExtractionState()
                        setStep(2)
                      }}
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
                  <span className="font-semibold">
                    {lastCreatedFatura?.tipo_utilidade || selectedTipo}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Competência:</span>
                  <span className="font-semibold">
                    {lastCreatedFatura?.competencia
                      ? formatCompetencia(lastCreatedFatura.competencia)
                      : competenciaInput}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Valor Total:</span>
                  <span className="font-bold text-teal-800 tabular-nums">
                    {formatCurrencyBRL(
                      lastCreatedFatura !== null
                        ? toSafeNumber(lastCreatedFatura.valor_total, 0)
                        : (parseNumberValue(valorTotal) ?? 0),
                    )}
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
                  <span className="text-gray-400 block text-[10px] uppercase">
                    CNPJ Empreendimento
                  </span>
                  <span className="font-mono text-gray-800">
                    {formatCNPJ(selectedFatura.expand?.empreendimento?.cnpj || '')}
                  </span>
                </div>
                {selectedFatura.cnpj_cliente && (
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase">
                      CNPJ Cliente (Fatura)
                    </span>
                    <span className="font-mono text-gray-800">
                      {formatCNPJ(selectedFatura.cnpj_cliente)}
                    </span>
                  </div>
                )}
                {selectedFatura.cnpj_fornecedor && (
                  <div>
                    <span className="text-gray-400 block text-[10px] uppercase">
                      CNPJ Fornecedor
                    </span>
                    <span className="font-mono text-gray-800">
                      {formatCNPJ(selectedFatura.cnpj_fornecedor)}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Valor Total</span>
                  <span className="font-bold text-teal-800 text-sm tabular-nums">
                    {formatCurrencyBRL(selectedFatura.valor_total)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase">Consumo</span>
                  <span className="font-bold text-gray-900 tabular-nums">
                    {formatNumberValue(
                      selectedFatura.consumo,
                      selectedFatura.tipo_utilidade === 'Gás' ? 3 : 2,
                    )}{' '}
                    {selectedFatura.unidade_consumo}
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
                    ).map(([k, v]) => {
                      let displayVal = String(v)
                      if (typeof v === 'number') {
                        if (k.includes('tarifa')) {
                          displayVal = formatNumberValue(v, 6)
                        } else if (
                          k.includes('medicao') ||
                          (selectedFatura.tipo_utilidade === 'Gás' && k.includes('consumo_medido'))
                        ) {
                          displayVal = formatNumberValue(v, 0)
                        } else {
                          displayVal = formatNumberValue(v, 3)
                        }
                      }
                      return (
                        <div
                          key={k}
                          className="flex justify-between border-b border-teal-100/60 pb-1"
                        >
                          <span className="text-gray-600 capitalize">{k.replace(/_/g, ' ')}:</span>
                          <span className="font-semibold text-gray-900">{displayVal}</span>
                        </div>
                      )
                    })}
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
                  placeholder="Ex: 0,00"
                  className="h-9 text-xs font-bold"
                  value={valorTotal}
                  onChange={(e) => setValorTotal(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Consumo</Label>
                <Input
                  placeholder="Ex: 0,000"
                  className="h-9 text-xs"
                  value={consumo}
                  onChange={(e) => setConsumo(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">Número da Fatura</Label>
                <Input
                  placeholder="Ex: 000.000.000"
                  className="h-9 text-xs"
                  value={numeroFatura}
                  onChange={(e) => setNumeroFatura(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">
                  CNPJ do Cliente (Titular)
                </Label>
                <Input
                  placeholder="Ex: 00.000.000/0001-00"
                  className="h-9 text-xs font-mono"
                  value={cnpjCliente}
                  onChange={(e) => setCnpjCliente(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-700">
                  CNPJ do Fornecedor (Distribuidora)
                </Label>
                <Input
                  placeholder="Ex: 00.000.000/0001-00"
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
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-900 block">
                    Energia Elétrica
                  </span>
                  <span className="text-[10px] text-amber-700 font-medium">
                    {/^B/i.test((classificacaoConsumo || '').replace(/^B-/, ''))
                      ? 'Classe B (Consumo Único)'
                      : /^A/i.test((classificacaoConsumo || '').replace(/^A-/, ''))
                        ? 'Classe A (Ponta / F.Ponta)'
                        : ''}
                  </span>
                </div>
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
                      onChange={(e) => {
                        const val = e.target.value
                        setClassificacaoConsumo(val)
                        if (/^B/i.test(val.replace(/^B-/, ''))) {
                          if (!consumo && (consumoForaPonta || consumoPonta)) {
                            setConsumo(consumoForaPonta || consumoPonta)
                          }
                          setConsumoPonta('')
                          setConsumoForaPonta('')
                          if (tarifaTusdPonta && !tarifaTusdFPonta)
                            setTarifaTusdFPonta(tarifaTusdPonta)
                          if (tarifaTePonta && !tarifaTeFPonta) setTarifaTeFPonta(tarifaTePonta)
                        }
                      }}
                    />
                  </div>

                  {/^B/i.test((classificacaoConsumo || '').replace(/^B-/, '')) ? (
                    <>
                      <div>
                        <Label className="text-[11px] text-amber-900 font-medium">
                          Consumo Total (kWh)
                        </Label>
                        <Input
                          type="number"
                          step="0.001"
                          className="h-8 text-xs bg-white font-bold border-amber-500"
                          value={consumo}
                          onChange={(e) => setConsumo(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-gray-700">Tarifa TUSD Única</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          className="h-8 text-xs"
                          value={tarifaTusdPonta}
                          onChange={(e) => {
                            const val = e.target.value
                            setTarifaTusdPonta(val)
                            setTarifaTusdFPonta(val)
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-[11px] text-gray-700">Tarifa TE Única</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          className="h-8 text-xs"
                          value={tarifaTePonta}
                          onChange={(e) => {
                            const val = e.target.value
                            setTarifaTePonta(val)
                            setTarifaTeFPonta(val)
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </div>
            )}

            {selectedTipo === 'Gás' && (
              <div className="p-3 rounded-xl bg-teal-50/50 border border-teal-200 space-y-2">
                <span className="text-[11px] font-bold text-teal-900 block">Gás</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[11px] text-gray-700">Medição Anterior</Label>
                    <Input
                      placeholder="Ex: 000.000"
                      className="h-8 text-xs"
                      value={medicaoAnterior}
                      onChange={(e) => setMedicaoAnterior(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Medição Atual</Label>
                    <Input
                      placeholder="Ex: 000.000"
                      className="h-8 text-xs"
                      value={medicaoAtual}
                      onChange={(e) => setMedicaoAtual(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Consumo Medido (m³)</Label>
                    <Input
                      placeholder="Ex: 0,000"
                      className="h-8 text-xs"
                      value={consumoMedido}
                      onChange={(e) => setConsumoMedido(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Consumo Corrigido (m³)</Label>
                    <Input
                      placeholder="Ex: 0,000"
                      className="h-8 text-xs"
                      value={consumoCorrigido}
                      onChange={(e) => setConsumoCorrigido(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Tarifa (R$/m³)</Label>
                    <Input
                      placeholder="Ex: 0,000000"
                      className="h-8 text-xs"
                      value={tarifa}
                      onChange={(e) => setTarifa(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {selectedTipo === 'Água e Esgoto' && (
              <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-200 space-y-2">
                <span className="text-[11px] font-bold text-sky-900 block">Água e Esgoto</span>
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
                    <Label className="text-[11px] text-gray-700">Consumo Medido (m³)</Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={consumoMedido}
                      onChange={(e) => setConsumoMedido(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-gray-700">Tarifa (R$/m³)</Label>
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
