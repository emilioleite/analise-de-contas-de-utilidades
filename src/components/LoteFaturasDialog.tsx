import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { TipoUtilidade } from '@/types/entities'
import { faturasService } from '@/services/faturas'
import { formatCurrencyBRL, formatNumberValue, parseNumberValue } from '@/lib/cnpj'
import {
  LoteAlerta,
  LoteArquivo,
  LoteDraft,
  avaliarAlertasDraft,
  calcularLacunas,
  detectarDuplicidades,
  mediana,
  montarDraft,
  montarPayloadFatura,
  montarTriagem,
  resumoDoLote,
  rotuloCompetencia,
} from '@/lib/loteFaturas'
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  ScanLine,
  Trash2,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

/**
 * Extração de faturas EM LOTE.
 *
 * O motor é o mesmo endpoint do lançamento individual (POST /backend/v1/faturas/extract):
 * o lote é uma fila em série no front-end. Nada aqui muda o contrato da extração.
 *
 * Etapas:
 *  - seleção múltipla (arquivos ou pasta inteira) e lista antes de iniciar;
 *  - triagem prévia do PDF (com texto × escaneado) antes de gastar extração;
 *  - fila sequencial com progresso e cancelamento (erro numa linha não interrompe);
 *  - revisão em lista, com status e linha expandível reaproveitando o formulário;
 *  - gravação em bloco com resumo, duplicidade e lacunas.
 */

const EXTENSOES = ['pdf', 'csv', 'xls', 'xlsx']
const TAMANHO_MAX_MB = 10
const TENTATIVAS_EXTRACAO = 2

type Fase = 'selecao' | 'fila' | 'revisao' | 'concluido'

export interface LoteFaturasDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function novoId(): string {
  return `lote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function extensao(nome: string): string {
  return (nome.split('.').pop() || '').toLowerCase()
}

function statusRotulo(a: LoteArquivo): { texto: string; classe: string } {
  switch (a.status) {
    case 'aguardando':
      return { texto: 'Aguardando', classe: 'bg-gray-100 text-gray-600 border-gray-200' }
    case 'triagem':
      return { texto: 'Triagem', classe: 'bg-sky-50 text-sky-700 border-sky-200' }
    case 'extraindo':
      return { texto: 'Extraindo', classe: 'bg-teal-50 text-teal-700 border-teal-200' }
    case 'revisar':
      return { texto: 'Revisar', classe: 'bg-amber-50 text-amber-800 border-amber-200' }
    case 'pronta':
      return { texto: 'Pronta', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    case 'erro':
      return { texto: 'Erro', classe: 'bg-red-50 text-red-700 border-red-200' }
    case 'ignorado':
      return { texto: 'Ignorado', classe: 'bg-gray-100 text-gray-500 border-gray-200' }
    case 'gravada':
      return { texto: 'Gravada', classe: 'bg-emerald-600 text-white border-emerald-700' }
    case 'pulada':
      return { texto: 'Pulada', classe: 'bg-gray-100 text-gray-500 border-gray-200' }
    default:
      return { texto: a.status, classe: 'bg-gray-100 text-gray-600 border-gray-200' }
  }
}

function corAlerta(nivel: LoteAlerta['nivel']): string {
  if (nivel === 'erro') return 'text-red-700 bg-red-50 border-red-200'
  if (nivel === 'atencao') return 'text-amber-800 bg-amber-50 border-amber-200'
  return 'text-sky-800 bg-sky-50 border-sky-200'
}

export default function LoteFaturasDialog({ open, onOpenChange }: LoteFaturasDialogProps) {
  const { addFatura, faturas, empreendimentos, refreshData } = useData()
  const { safeRefreshSession } = useAuth()
  const { toast } = useToast()

  const [fase, setFase] = useState<Fase>('selecao')
  const [arquivos, setArquivos] = useState<LoteArquivo[]>([])
  const [tipoPadrao, setTipoPadrao] = useState<TipoUtilidade | 'auto'>('auto')
  const [processando, setProcessando] = useState(false)
  const [indiceAtual, setIndiceAtual] = useState(0)
  const [statusAtual, setStatusAtual] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [gravando, setGravando] = useState(false)
  const [gravadas, setGravadas] = useState(0)
  const [falhas, setFalhas] = useState(0)
  const [resultadoGravacao, setResultadoGravacao] = useState<string[]>([])

  const canceladoRef = useRef(false)
  const inputArquivosRef = useRef<HTMLInputElement | null>(null)
  const inputPastaRef = useRef<HTMLInputElement | null>(null)

  // webkitdirectory é atributo não padrão: aplicado direto no elemento
  useEffect(() => {
    if (inputPastaRef.current) {
      ;(inputPastaRef.current as any).webkitdirectory = ''
      ;(inputPastaRef.current as any).directory = ''
    }
  }, [open])

  const resetar = useCallback(() => {
    canceladoRef.current = true
    setFase('selecao')
    setArquivos([])
    setProcessando(false)
    setIndiceAtual(0)
    setStatusAtual('')
    setExpandido(null)
    setGravando(false)
    setGravadas(0)
    setFalhas(0)
    setResultadoGravacao([])
    setTipoPadrao('auto')
  }, [])

  // Consumo típico por empreendimento+utilidade, para desempatar o ponto decimal.
  const referenciaPorEmpTipo = useMemo(() => {
    const mapa = new Map<string, number | null>()
    const grupos = new Map<string, number[]>()
    faturas.forEach((f) => {
      const c = Number(f.consumo) || 0
      if (c <= 0) return
      const k = `${f.empreendimento}||${f.tipo_utilidade}`
      const arr = grupos.get(k) || []
      arr.push(c)
      grupos.set(k, arr)
    })
    grupos.forEach((arr, k) => mapa.set(k, mediana(arr)))
    return mapa
  }, [faturas])

  // ---------------------------------------------------------------- seleção
  const adicionarArquivos = (lista: FileList | File[]) => {
    const novos: LoteArquivo[] = []
    const recusados: string[] = []
    Array.from(lista).forEach((file) => {
      if (file.name.startsWith('.')) return
      const ext = extensao(file.name)
      if (!EXTENSOES.includes(ext)) {
        recusados.push(`${file.name} (formato)`)
        return
      }
      if (file.size > TAMANHO_MAX_MB * 1024 * 1024) {
        recusados.push(`${file.name} (acima de ${TAMANHO_MAX_MB}MB)`)
        return
      }
      novos.push({
        id: novoId(),
        file,
        nome: file.name,
        caminho: (file as any).webkitRelativePath || file.name,
        tamanho: file.size,
        status: 'aguardando',
        alertas: [],
        incluir: true,
        draft: undefined,
      })
    })

    setArquivos((prev) => {
      const existentes = new Set(prev.map((p) => p.caminho || p.nome))
      const filtrados = novos.filter((n) => !existentes.has(n.caminho || n.nome))
      return [...prev, ...filtrados]
    })

    if (recusados.length > 0) {
      toast({
        title: `${recusados.length} arquivo(s) não incluído(s)`,
        description: recusados.slice(0, 4).join('; ') + (recusados.length > 4 ? '…' : ''),
        variant: 'destructive',
      })
    }
  }

  // ---------------------------------------------------------------- triagem
  const triarArquivo = async (a: LoteArquivo): Promise<LoteArquivo> => {
    if (extensao(a.nome) !== 'pdf') {
      return {
        ...a,
        triagem: {
          paginas: 0,
          caracteresTexto: 0,
          temTexto: true,
          escaneado: false,
          motivo: 'Planilha/CSV — lido direto',
        },
      }
    }
    try {
      const { loadPdfJs } = await import('@/lib/pdfToImages')
      const pdfjs = await loadPdfJs()
      const buffer = await a.file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: buffer }).promise
      let texto = ''
      const paginas = Math.min(pdf.numPages, 3)
      for (let p = 1; p <= paginas; p++) {
        const page = await pdf.getPage(p)
        const content = await page.getTextContent()
        texto += content.items.map((i: any) => i.str || '').join(' ')
      }
      return { ...a, triagem: montarTriagem({ paginas: pdf.numPages, texto }) }
    } catch {
      return {
        ...a,
        triagem: {
          paginas: 0,
          caracteresTexto: 0,
          temTexto: false,
          escaneado: true,
          motivo: 'Não foi possível ler o texto no navegador — será lido por imagens (visão)',
        },
      }
    }
  }

  // ------------------------------------------------- fila de extração (série)
  const extrairDraft = async (a: LoteArquivo): Promise<LoteDraft> => {
    const tipoPedido = tipoPadrao === 'auto' ? undefined : (tipoPadrao as TipoUtilidade)
    let ultimoErro: any = null

    for (let tentativa = 1; tentativa <= TENTATIVAS_EXTRACAO; tentativa++) {
      if (canceladoRef.current) throw new Error('cancelado')
      try {
        const res = await faturasService.extractFromDocument(
          a.file,
          tipoPedido,
          (s) => setStatusAtual(tentativa > 1 ? `Tentativa ${tentativa}: ${s}` : s),
          tentativa === 1 ? 'reasoning' : 'fast',
          false,
        )
        const payload = (res as any)?.dados ?? res
        let draft = montarDraft(payload, { empreendimentos, tipoSolicitado: tipoPedido })

        // Ponto ambíguo não confirmado pela leitura: tenta a mediana histórica antes de aceitar
        if (draft.empreendimentoId && draft.avisosExtracao.some((x) => x.includes('ambíguo'))) {
          const ref = referenciaPorEmpTipo.get(`${draft.empreendimentoId}||${draft.tipo}`) ?? null
          if (ref) {
            draft = montarDraft(payload, {
              empreendimentos,
              tipoSolicitado: tipoPedido,
              consumoReferencia: ref,
            })
          }
        }
        return draft
      } catch (err: any) {
        if (err?.message === 'cancelado') throw err
        ultimoErro = err
        if (tentativa < TENTATIVAS_EXTRACAO) {
          setStatusAtual(`Tentativa ${tentativa} falhou — alternando modelo...`)
          await new Promise((r) => setTimeout(r, 800))
        }
      }
    }
    throw ultimoErro || new Error('Falha na extração')
  }

  const iniciarLote = async () => {
    if (arquivos.length === 0) return
    canceladoRef.current = false
    setProcessando(true)
    setFase('fila')
    setGravadas(0)
    setFalhas(0)
    setResultadoGravacao([])

    await safeRefreshSession().catch(() => null)

    // Triagem de TODOS antes de extrair (marca escaneados)
    setStatusAtual('Triando documentos...')
    const triados: LoteArquivo[] = []
    for (let i = 0; i < arquivos.length; i++) {
      if (canceladoRef.current) break
      setIndiceAtual(i)
      setArquivos((prev) => prev.map((a, idx) => (idx === i ? { ...a, status: 'triagem' } : a)))
      setStatusAtual(`Triando ${i + 1} de ${arquivos.length}: ${arquivos[i].nome}`)
      const t = await triarArquivo(arquivos[i])
      triados.push(t)
      setArquivos((prev) => prev.map((a, idx) => (idx === i ? t : a)))
      await new Promise((r) => setTimeout(r, 0))
    }

    // Extração sequencial
    for (let i = 0; i < triados.length; i++) {
      if (canceladoRef.current) break
      const base = triados[i]
      setIndiceAtual(i)
      setArquivos((prev) => prev.map((a) => (a.id === base.id ? { ...a, status: 'extraindo' } : a)))
      setStatusAtual(`Extraindo ${i + 1} de ${triados.length}: ${base.nome}`)

      try {
        const draft = await extrairDraft(base)
        const alertas = avaliarAlertasDraft(draft)
        setArquivos((prev) =>
          prev.map((a) =>
            a.id === base.id
              ? {
                  ...a,
                  draft,
                  alertas,
                  status: alertas.length > 0 ? 'revisar' : 'pronta',
                  erro: undefined,
                }
              : a,
          ),
        )
      } catch (err: any) {
        if (err?.message === 'cancelado') break
        // Erro numa linha NÃO interrompe o lote
        setArquivos((prev) =>
          prev.map((a) =>
            a.id === base.id
              ? {
                  ...a,
                  status: 'erro',
                  erro: err?.message || 'Falha na extração',
                  alertas: [
                    ...(a.alertas || []).filter((x) => x.codigo !== 'extracao_falhou'),
                    {
                      nivel: 'erro' as const,
                      codigo: 'extracao_falhou',
                      mensagem: err?.message || 'Falha na extração deste arquivo.',
                    },
                  ],
                }
              : a,
          ),
        )
      }
      await new Promise((r) => setTimeout(r, 0))
    }

    setProcessando(false)
    setStatusAtual('')
    setFase('revisao')

    // Duplicidade calculada sobre o lote fechado
    setArquivos((prev) =>
      prev.map((a) => {
        if (!a.draft) return a
        const dup = detectarDuplicidades(a, prev, faturas)
        if (dup.dentroDoLote.length === 0 && dup.noBanco.length === 0) {
          return { ...a, duplicadaExistente: null }
        }
        const msgs: LoteAlerta[] = []
        if (dup.noBanco.length > 0) {
          msgs.push({
            nivel: 'atencao',
            codigo: 'duplicidade_banco',
            mensagem: `Já existe fatura no banco para ${a.draft.tipo} em ${rotuloCompetencia(
              a.draft.competencia,
            )} neste empreendimento.`,
          })
        }
        if (dup.dentroDoLote.length > 0) {
          msgs.push({
            nivel: 'atencao',
            codigo: 'duplicidade_lote',
            mensagem: `Outro arquivo do lote (${dup.dentroDoLote
              .map((x) => x.nome)
              .join(', ')}) tem a mesma competência e utilidade.`,
          })
        }
        return {
          ...a,
          duplicadaExistente: dup.noBanco.length
            ? { id: dup.noBanco[0].id, competencia: a.draft.competencia }
            : null,
          alertas: [...a.alertas.filter((x) => !x.codigo.startsWith('duplicidade')), ...msgs],
        }
      }),
    )
  }

  const cancelarLote = () => {
    canceladoRef.current = true
    setStatusAtual('Cancelando...')
  }

  // ------------------------------------------------------- edição de uma linha
  const atualizarDraft = (id: string, patch: Partial<LoteDraft>) => {
    setArquivos((prev) =>
      prev.map((a) => {
        if (a.id !== id || !a.draft) return a
        const draft = { ...a.draft, ...patch }
        const alertas = avaliarAlertasDraft(draft)
        return {
          ...a,
          draft,
          alertas,
          status:
            a.status === 'gravada'
              ? a.status
              : alertas.some((x) => x.nivel === 'erro')
                ? 'revisar'
                : 'pronta',
        }
      }),
    )
  }

  const definirInclusao = (id: string, incluir: boolean) => {
    setArquivos((prev) => prev.map((a) => (a.id === id ? { ...a, incluir } : a)))
  }

  // ------------------------------------------------- gravação em bloco
  const gravarLote = async () => {
    const alvos = arquivos.filter(
      (a) => a.incluir && a.draft && !a.alertas.some((x) => x.nivel === 'erro'),
    )
    if (alvos.length === 0) {
      toast({
        title: 'Nada para gravar',
        description: 'Nenhuma linha está pronta (sem erro e marcada para incluir).',
        variant: 'destructive',
      })
      return
    }

    setGravando(true)
    let ok = 0
    let erro = 0
    const log: string[] = []

    await safeRefreshSession().catch(() => null)

    for (let i = 0; i < alvos.length; i++) {
      const a = alvos[i]
      setStatusAtual(`Gravando ${i + 1} de ${alvos.length}: ${a.nome}`)
      try {
        const payload = montarPayloadFatura(a.draft!, a.nome)
        await addFatura(payload)
        ok++
        setArquivos((prev) =>
          prev.map((x) => (x.id === a.id ? { ...x, status: 'gravada', erro: undefined } : x)),
        )
      } catch (err: any) {
        erro++
        const msg = err?.data?.message || err?.message || 'Falha ao gravar'
        log.push(`${a.nome}: ${msg}`)
        setArquivos((prev) =>
          prev.map((x) =>
            x.id === a.id
              ? {
                  ...x,
                  status: 'erro',
                  erro: msg,
                  alertas: [
                    ...x.alertas.filter((y) => y.codigo !== 'gravacao'),
                    {
                      nivel: 'erro' as const,
                      codigo: 'gravacao',
                      mensagem: `Falha ao gravar: ${msg}`,
                    },
                  ],
                }
              : x,
          ),
        )
      }
      await new Promise((r) => setTimeout(r, 0))
    }

    setGravadas(ok)
    setFalhas(erro)
    setResultadoGravacao(log)
    setGravando(false)
    setStatusAtual('')
    setFase('concluido')

    await refreshData().catch(() => null)

    toast({
      title: `${ok} fatura(s) gravada(s)`,
      description:
        erro > 0 ? `${erro} falha(s) — veja a lista antes de fechar.` : 'Lote gravado com sucesso.',
      variant: erro > 0 ? 'destructive' : 'default',
    })
  }

  // ---------------------------------------------------------------- derivações
  const resumo = useMemo(
    () => resumoDoLote(arquivos, faturas, gravadas, falhas),
    [arquivos, faturas, gravadas, falhas],
  )
  const lacunas = useMemo(() => calcularLacunas(arquivos, faturas), [arquivos, faturas])
  const escaneados = arquivos.filter((a) => a.triagem?.escaneado).length
  const progresso =
    arquivos.length > 0
      ? Math.min(100, Math.round(((indiceAtual + (processando ? 0.5 : 1)) / arquivos.length) * 100))
      : 0
  const nomeEmp = (id: string) => empreendimentos.find((e) => e.id === id)?.nome || '—'
  const alvosGravacao = arquivos.filter(
    (a) => a.incluir && a.draft && !a.alertas.some((x) => x.nivel === 'erro'),
  ).length

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          if (processando || gravando) return // não fecha no meio
          resetar()
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-[1000px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-gray-900 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-700" />
              Extração de faturas em lote
            </span>
            <span className="text-xs font-normal text-gray-500">
              {fase === 'selecao' && 'Passo 1 de 3 — seleção'}
              {fase === 'fila' && 'Passo 2 de 3 — extração'}
              {fase === 'revisao' && 'Passo 3 de 3 — revisão'}
              {fase === 'concluido' && 'Concluído'}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Selecione vários arquivos ou uma pasta inteira. A extração roda uma fatura por vez, com
            triagem prévia dos PDFs escaneados.
          </DialogDescription>
        </DialogHeader>

        {/* SELEÇÃO */}
        {fase === 'selecao' && (
          <div className="space-y-4 py-2">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (e.dataTransfer.files?.length) adicionarArquivos(e.dataTransfer.files)
              }}
              className="border-2 border-dashed border-gray-300 hover:border-teal-600 rounded-xl p-6 text-center bg-gray-50/50 hover:bg-teal-50/30 transition-all cursor-pointer"
              onClick={() => inputArquivosRef.current?.click()}
            >
              <input
                type="file"
                ref={inputArquivosRef}
                className="hidden"
                accept=".pdf,.csv,.xls,.xlsx"
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) adicionarArquivos(e.target.files)
                  e.target.value = ''
                }}
              />
              <input
                type="file"
                ref={inputPastaRef}
                className="hidden"
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) adicionarArquivos(e.target.files)
                  e.target.value = ''
                }}
              />
              <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center mx-auto mb-3">
                <FolderOpen className="w-6 h-6 text-teal-700" />
              </div>
              <p className="text-sm font-semibold text-gray-800">
                Arraste os arquivos aqui, ou{' '}
                <span className="text-teal-700 underline">escolha os arquivos</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Aceita vários PDF/CSV/XLS/XLSX por vez (máx. {TAMANHO_MAX_MB}MB cada)
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1">
                <Label className="text-xs font-semibold text-gray-700">Utilidade das faturas</Label>
                <Select value={tipoPadrao} onValueChange={(v) => setTipoPadrao(v as any)}>
                  <SelectTrigger className="h-9 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs">
                      Detectar em cada fatura (recomendado)
                    </SelectItem>
                    <SelectItem value="Gás" className="text-xs">
                      Gás — todas
                    </SelectItem>
                    <SelectItem value="Água e Esgoto" className="text-xs">
                      Água e Esgoto — todas
                    </SelectItem>
                    <SelectItem value="Energia Elétrica" className="text-xs">
                      Energia Elétrica — todas
                    </SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-gray-500 block mt-1">
                  Fixar a utilidade ajuda a IA quando a fatura não traz o tipo escrito; em
                  "detectar", cada arquivo é lido como vier.
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => inputPastaRef.current?.click()}
                className="h-9 text-xs"
              >
                <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                Escolher pasta
              </Button>
            </div>

            {arquivos.length > 0 && (
              <Card className="p-0 border-[#E5E7EB] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-[#E5E7EB]">
                  <span className="text-xs font-semibold text-gray-700">
                    {arquivos.length} arquivo(s) na fila
                  </span>
                  <button
                    type="button"
                    onClick={() => setArquivos([])}
                    className="text-[11px] text-gray-500 hover:text-red-600 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Limpar lista
                  </button>
                </div>
                <div className="max-h-[260px] overflow-y-auto divide-y divide-gray-100">
                  {arquivos.map((a, i) => (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-[10px] text-gray-400 w-5 text-right">{i + 1}</span>
                      <FileText className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-900 truncate">{a.nome}</p>
                        {a.caminho !== a.nome && (
                          <p className="text-[10px] text-gray-400 truncate">{a.caminho}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {(a.tamanho / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => setArquivos((prev) => prev.filter((x) => x.id !== a.id))}
                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <DialogFooter className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={arquivos.length === 0}
                onClick={iniciarLote}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
              >
                Iniciar extração ({arquivos.length})
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* FILA */}
        {fase === 'fila' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs gap-3">
                <span className="font-semibold text-gray-800 min-w-0 truncate">
                  {processando ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 shrink-0" />
                      <span className="truncate">{statusAtual}</span>
                    </span>
                  ) : (
                    'Finalizando...'
                  )}
                </span>
                <span className="text-gray-500 shrink-0">
                  {Math.min(indiceAtual + 1, arquivos.length)} de {arquivos.length}
                </span>
              </div>
              <Progress value={progresso} className="h-1.5" />
            </div>

            <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-100 border border-[#E5E7EB] rounded-lg">
              {arquivos.map((a) => {
                const st = statusRotulo(a)
                return (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2">
                    <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <p className="text-xs text-gray-800 truncate flex-1">{a.nome}</p>
                    {a.triagem?.escaneado && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1 shrink-0">
                        <ScanLine className="w-3 h-3" />
                        escaneado
                      </span>
                    )}
                    <Badge variant="outline" className={`text-[10px] ${st.classe}`}>
                      {st.texto}
                    </Badge>
                  </div>
                )
              })}
            </div>

            <DialogFooter className="pt-2 flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-500">
                {escaneados > 0
                  ? `${escaneados} PDF(s) escaneado(s) — serão lidos por imagens (visão).`
                  : 'Todos os PDFs com camada de texto.'}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={cancelarLote}
                disabled={!processando}
                className="text-xs border-red-200 text-red-700 hover:bg-red-50"
              >
                <Ban className="w-3.5 h-3.5 mr-1.5" />
                Cancelar lote
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* REVISÃO */}
        {fase === 'revisao' && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Arquivos</p>
                <p className="text-base font-bold text-gray-900">{resumo.total}</p>
              </Card>
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Com alerta</p>
                <p className="text-base font-bold text-amber-700">{resumo.comAlerta}</p>
              </Card>
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Com erro</p>
                <p className="text-base font-bold text-red-700">{resumo.comErro}</p>
              </Card>
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Estornos</p>
                <p className="text-base font-bold text-sky-700">{resumo.estornos}</p>
              </Card>
            </div>

            {lacunas.length > 0 && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <strong>{lacunas.length} competência(s) sem fatura</strong> no intervalo do lote —{' '}
                  {lacunas
                    .slice(0, 6)
                    .map(
                      (l) =>
                        `${rotuloCompetencia(l.competencia)} (${l.tipo}, ${nomeEmp(
                          l.empreendimentoId,
                        )})`,
                    )
                    .join(', ')}
                  {lacunas.length > 6 ? '…' : ''}. Mês sem fatura é lacuna, nunca zero.
                </div>
              </div>
            )}

            <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
              <div className="grid grid-cols-[24px_1fr_90px_90px_110px_28px] gap-2 px-3 py-2 bg-gray-50 border-b border-[#E5E7EB] text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <span />
                <span>Arquivo / Empreendimento</span>
                <span className="text-right">Valor</span>
                <span className="text-right">Consumo</span>
                <span>Status</span>
                <span />
              </div>
              <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
                {arquivos.map((a) => {
                  const st = statusRotulo(a)
                  const d = a.draft
                  const erro = a.alertas.some((x) => x.nivel === 'erro')
                  const aberto = expandido === a.id
                  return (
                    <div key={a.id}>
                      <div className="grid grid-cols-[24px_1fr_90px_90px_110px_28px] gap-2 px-3 py-2 items-center hover:bg-gray-50/60">
                        <input
                          type="checkbox"
                          checked={a.incluir}
                          disabled={a.status === 'gravada' || !d || erro}
                          onChange={(e) => definirInclusao(a.id, e.target.checked)}
                          className="w-3.5 h-3.5 accent-teal-700"
                          title={erro ? 'Corrija os erros para incluir' : 'Incluir na gravação'}
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-gray-900 truncate flex items-center gap-1.5">
                            <span className="truncate">{a.nome}</span>
                            {d?.estorno && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 shrink-0">
                                estorno
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            {d
                              ? `${nomeEmp(d.empreendimentoId)} · ${d.tipo} · ${rotuloCompetencia(
                                  d.competencia,
                                )}`
                              : a.erro || '—'}
                          </p>
                        </div>
                        <span className="text-xs text-right text-gray-900 tabular-nums">
                          {d?.valorTotal
                            ? formatCurrencyBRL(parseNumberValue(d.valorTotal) ?? 0)
                            : '—'}
                        </span>
                        <span className="text-xs text-right text-gray-600 tabular-nums">
                          {d?.consumo ? `${d.consumo} ${d.unidadeConsumo}` : 'ND'}
                        </span>
                        <span>
                          <Badge variant="outline" className={`text-[10px] ${st.classe}`}>
                            {st.texto}
                          </Badge>
                        </span>
                        <button
                          type="button"
                          onClick={() => setExpandido(aberto ? null : a.id)}
                          disabled={!d}
                          className="p-1 text-gray-400 hover:text-teal-700 disabled:opacity-30"
                        >
                          {aberto ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {a.alertas.length > 0 && (
                        <div className="px-3 pb-2 pl-9 space-y-1">
                          {a.alertas.map((al, i) => (
                            <p
                              key={`${al.codigo}-${i}`}
                              className={`text-[10px] px-2 py-1 rounded border ${corAlerta(al.nivel)}`}
                            >
                              {al.mensagem}
                            </p>
                          ))}
                        </div>
                      )}

                      {aberto && d && (
                        <LinhaEdicao
                          arquivo={a}
                          empreendimentos={empreendimentos}
                          onPatch={(patch) => atualizarDraft(a.id, patch)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <DialogFooter className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={resetar} className="text-xs">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Novo lote
                </Button>
                <span className="text-[11px] text-gray-500">
                  {alvosGravacao} de {resumo.total} prontas para gravar
                </span>
              </div>
              <Button
                type="button"
                onClick={gravarLote}
                disabled={gravando || alvosGravacao === 0}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium"
              >
                {gravando ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    {statusAtual || 'Gravando...'}
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    Gravar {alvosGravacao} fatura(s)
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* CONCLUSÃO */}
        {fase === 'concluido' && (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-emerald-900">
                  {gravadas} fatura(s) gravada(s){falhas > 0 ? ` · ${falhas} com falha` : ''}
                </p>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Os dados foram recarregados. Confira a lista de faturas e a Análise por Período.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">
                  Valor no período
                </p>
                <p className="text-sm font-bold text-gray-900">
                  {formatCurrencyBRL(resumo.valorTotalPeriodo)}
                </p>
              </Card>
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Estornos</p>
                <p className="text-sm font-bold text-sky-700">{resumo.estornos}</p>
              </Card>
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Lacunas</p>
                <p className="text-sm font-bold text-amber-700">{lacunas.length}</p>
              </Card>
              <Card className="p-2.5 border-[#E5E7EB]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Gravadas</p>
                <p className="text-sm font-bold text-emerald-700">{gravadas}</p>
              </Card>
            </div>

            {resumo.custoMedio.length > 0 && (
              <Card className="p-3 border-[#E5E7EB] space-y-1">
                <p className="text-[11px] font-semibold text-gray-800">
                  Custo médio do lote (estornos e meses sem consumo ficam fora)
                </p>
                {resumo.custoMedio.map((c) => (
                  <p key={c.tipo} className="text-[11px] text-gray-600">
                    {c.tipo}:{' '}
                    {c.media === null
                      ? 'ND — sem consumo informado, média não calculada'
                      : `${formatCurrencyBRL(c.media)} / ${
                          c.tipo === 'Energia Elétrica' ? 'kWh' : 'm³'
                        } (${formatCurrencyBRL(c.valor)} ÷ ${formatNumberValue(c.consumo, 3)} ${
                          c.tipo === 'Energia Elétrica' ? 'kWh' : 'm³'
                        })`}
                  </p>
                ))}
                <p className="text-[10px] text-gray-500 pt-1">
                  É custo médio do conjunto no lote — não é a tarifa impressa na fatura.
                </p>
              </Card>
            )}

            {lacunas.length > 0 && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                <strong>Lacunas de competência:</strong>{' '}
                {lacunas.map((l) => `${rotuloCompetencia(l.competencia)} (${l.tipo})`).join(', ')}.
                Nenhum desses meses foi lançado como zero.
              </div>
            )}

            {resultadoGravacao.length > 0 && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-900 space-y-1">
                <strong>{resultadoGravacao.length} arquivo(s) não gravado(s):</strong>
                {resultadoGravacao.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={resetar} className="text-xs">
                Novo lote
              </Button>
              <Button
                type="button"
                onClick={() => {
                  resetar()
                  onOpenChange(false)
                }}
                className="bg-teal-700 hover:bg-teal-800 text-white text-xs"
              >
                Fechar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Linha expandível: mesmos campos do formulário do passo 3
// ---------------------------------------------------------------------------

function LinhaEdicao({
  arquivo,
  empreendimentos,
  onPatch,
}: {
  arquivo: LoteArquivo
  empreendimentos: { id: string; nome: string; cnpj: string }[]
  onPatch: (patch: Partial<LoteDraft>) => void
}) {
  const d = arquivo.draft!
  const campo = (
    label: string,
    valor: string,
    onChange: (v: string) => void,
    placeholder?: string,
  ) => (
    <div>
      <Label className="text-[10px] font-medium text-gray-600">{label}</Label>
      <Input
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs mt-0.5"
      />
    </div>
  )

  return (
    <div className="px-3 pb-3 pl-9 bg-gray-50/60 border-t border-gray-100">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
        <div className="sm:col-span-2">
          <Label className="text-[10px] font-medium text-gray-600">Empreendimento</Label>
          <Select
            value={d.empreendimentoId || ''}
            onValueChange={(v) => onPatch({ empreendimentoId: v })}
          >
            <SelectTrigger className="h-8 text-xs mt-0.5">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {empreendimentos.map((e) => (
                <SelectItem key={e.id} value={e.id} className="text-xs">
                  {e.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] font-medium text-gray-600">Utilidade</Label>
          <Select
            value={d.tipo}
            onValueChange={(v) =>
              onPatch({
                tipo: v as TipoUtilidade,
                unidadeConsumo: v === 'Energia Elétrica' ? 'kWh' : 'm³',
              })
            }
          >
            <SelectTrigger className="h-8 text-xs mt-0.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Energia Elétrica" className="text-xs">
                Energia Elétrica
              </SelectItem>
              <SelectItem value="Água e Esgoto" className="text-xs">
                Água e Esgoto
              </SelectItem>
              <SelectItem value="Gás" className="text-xs">
                Gás
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {campo(
          'Competência (MM/AAAA)',
          d.competencia,
          (v) => onPatch({ competencia: v }),
          '01/2025',
        )}
        {campo('Valor total (R$)', d.valorTotal, (v) => onPatch({ valorTotal: v }), '0,00')}
        {campo(`Consumo (${d.unidadeConsumo})`, d.consumo, (v) => onPatch({ consumo: v }), '0,000')}
        {campo('Número da fatura', d.numeroFatura, (v) => onPatch({ numeroFatura: v }))}
        {campo('Vencimento', d.vencimento, (v) => onPatch({ vencimento: v }), 'AAAA-MM-DD')}
        {campo('CNPJ do cliente', d.cnpjCliente, (v) => onPatch({ cnpjCliente: v }))}
        {campo('CNPJ do fornecedor', d.cnpjFornecedor, (v) => onPatch({ cnpjFornecedor: v }))}
        {campo('Medição anterior', d.medicaoAnterior, (v) => onPatch({ medicaoAnterior: v }))}
        {campo('Medição atual', d.medicaoAtual, (v) => onPatch({ medicaoAtual: v }))}

        {d.tipo === 'Gás' && (
          <>
            {campo('Consumo medido (m³)', d.consumoMedido, (v) => onPatch({ consumoMedido: v }))}
            {campo('Consumo corrigido (m³)', d.consumoCorrigido, (v) =>
              onPatch({ consumoCorrigido: v }),
            )}
            {campo('Fator PTZ (rodapé)', d.fatorPtz, (v) => onPatch({ fatorPtz: v }), '0,9426')}
            {campo(
              'Fator de compressão',
              d.fatorCompressao,
              (v) => onPatch({ fatorCompressao: v }),
              '1,0313',
            )}
            {campo('Tarifa (R$/m³)', d.tarifa, (v) => onPatch({ tarifa: v }))}
            {campo(
              'Identificação (destino/medidor)',
              d.identificacao,
              (v) => onPatch({ identificacao: v }),
              'Caldeira, Cozinha',
            )}
          </>
        )}

        {d.tipo === 'Água e Esgoto' && (
          <>
            {campo('Consumo medido (m³)', d.consumoMedido, (v) => onPatch({ consumoMedido: v }))}
            {campo('Tarifa (R$/m³)', d.tarifa, (v) => onPatch({ tarifa: v }))}
          </>
        )}

        {d.tipo === 'Energia Elétrica' && (
          <>
            {campo('Classificação (A4, B3…)', d.classificacaoConsumo, (v) =>
              onPatch({ classificacaoConsumo: v }),
            )}
            {campo('Consumo ponta (kWh)', d.consumoPonta, (v) => onPatch({ consumoPonta: v }))}
            {campo('Consumo fora-ponta (kWh)', d.consumoForaPonta, (v) =>
              onPatch({ consumoForaPonta: v }),
            )}
            {campo('Tarifa TUSD', d.tarifaTusdPonta, (v) => onPatch({ tarifaTusdPonta: v }))}
            {campo('Tarifa TE', d.tarifaTePonta, (v) => onPatch({ tarifaTePonta: v }))}
            {campo('Bandeira', d.adicionalBandeira, (v) => onPatch({ adicionalBandeira: v }))}
          </>
        )}
      </div>

      <div className="flex items-center gap-4 pt-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
          <input
            type="checkbox"
            checked={d.estorno}
            onChange={(e) => onPatch({ estorno: e.target.checked })}
            className="w-3.5 h-3.5 accent-teal-700"
          />
          Estorno / crédito (fora do custo e da média)
        </label>
        <span className="text-[10px] text-gray-400">
          lido por IA · {arquivo.triagem?.escaneado ? 'imagens (visão)' : 'texto + imagens'}
        </span>
      </div>
    </div>
  )
}
