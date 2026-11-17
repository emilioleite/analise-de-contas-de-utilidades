import React, { useEffect, useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { formatNumberBR, formatTCO2e } from '@/lib/cnpj'
import {
  deslocarMes,
  labelMes,
  limitesDisponiveis,
  MESES_CURTOS,
  mesKey,
  parseMesKey,
  validarPeriodo,
} from '@/lib/analisePeriodo'
import { construirSerieEmissoes, ResumoEmissoes } from '@/lib/emissoesPeriodo'
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Calendar,
  CalendarRange,
  Download,
  Droplets,
  Flame,
  Info,
  Leaf,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts'
import FatoresEmissaoTab from '@/components/emissoes/FatoresEmissaoTab'
import { gerarRelatorioEmissoesPDF } from '@/services/relatorioEmissoesPdf'
import { useToast } from '@/hooks/use-toast'
import { FaixaFontes } from '@/components/emissoes/FaixaFontes'

/** Seletor mês/ano de uma ponta do período. */
function MesAnoPicker({
  label,
  valor,
  anos,
  onChange,
}: {
  label: string
  valor: string
  anos: number[]
  onChange: (v: string) => void
}) {
  const ref = parseMesKey(valor)
  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
        {label}
      </label>
      <div className="flex gap-1.5 mt-1">
        <Select
          value={ref ? String(ref.mes) : ''}
          onValueChange={(m) => onChange(mesKey(ref?.ano || anos[0], Number(m)))}
        >
          <SelectTrigger className="h-9 text-xs bg-white border-gray-200">
            <SelectValue placeholder="mês" />
          </SelectTrigger>
          <SelectContent>
            {MESES_CURTOS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1)} className="text-xs">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={ref ? String(ref.ano) : ''}
          onValueChange={(a) => onChange(mesKey(Number(a), ref?.mes || 1))}
        >
          <SelectTrigger className="h-9 text-xs bg-white border-gray-200">
            <SelectValue placeholder="ano" />
          </SelectTrigger>
          <SelectContent>
            {anos.map((a) => (
              <SelectItem key={a} value={String(a)} className="text-xs">
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs space-y-1 z-50">
      <p className="font-bold text-gray-900 border-b pb-1 mb-1">{label}</p>
      {payload.map((entry: any, index: number) => (
        <div key={`item-${index}`} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: entry.color }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span>{entry.name}:</span>
          </span>
          <span className="font-mono font-bold text-gray-800">{formatTCO2e(entry.value, 3)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Emissoes() {
  const { faturas, empreendimentos, calculosEmissoes, loading } = useData()
  const { toast } = useToast()

  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState<string>('todos')
  const [activeTab, setActiveTab] = useState<'analise' | 'fatores'>('analise')
  const [exportandoPdf, setExportandoPdf] = useState<boolean>(false)
  const [inicio, setInicio] = useState<string>('')
  const [fim, setFim] = useState<string>('')

  const calculosFiltrados = useMemo(() => {
    if (!calculosEmissoes || calculosEmissoes.length === 0) return []
    if (selectedEmpreendimento === 'todos') return calculosEmissoes
    return calculosEmissoes.filter((c) => c.empreendimentoId === selectedEmpreendimento)
  }, [calculosEmissoes, selectedEmpreendimento])

  const disponivel = useMemo(() => {
    const doFiltro =
      selectedEmpreendimento === 'todos'
        ? faturas || []
        : (faturas || []).filter((f) => f.empreendimento === selectedEmpreendimento)
    return limitesDisponiveis(doFiltro)
  }, [faturas, selectedEmpreendimento])

  const anos = useMemo(() => {
    const a1 = parseMesKey(disponivel?.inicio || '')?.ano || new Date().getFullYear()
    const a2 = parseMesKey(disponivel?.fim || '')?.ano || new Date().getFullYear()
    const out: number[] = []
    for (let a = Math.min(a1, a2) - 1; a <= Math.max(a1, a2) + 1; a++) out.push(a)
    return out
  }, [disponivel])

  // Janela inicial: 24 meses até a última competência com dado (ou todo o histórico)
  const empKey = `${selectedEmpreendimento}|${disponivel?.inicio || ''}|${disponivel?.fim || ''}`
  useEffect(() => {
    if (!disponivel) {
      setInicio('')
      setFim('')
      return
    }
    const sugerido = deslocarMes(disponivel.fim, -23)
    setInicio(sugerido && sugerido > disponivel.inicio ? sugerido : disponivel.inicio)
    setFim(disponivel.fim)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empKey])

  const validacao = useMemo(() => validarPeriodo(inicio, fim), [inicio, fim])

  const resumo: ResumoEmissoes = useMemo(
    () =>
      construirSerieEmissoes({
        calculos: calculosFiltrados,
        meses: validacao.valido ? validacao.meses : [],
        empreendimentos: empreendimentos || [],
      }),
    [calculosFiltrados, validacao, empreendimentos],
  )

  const nomeEmpSelecionado =
    selectedEmpreendimento === 'todos'
      ? 'Todos os Empreendimentos'
      : empreendimentos?.find((e) => e.id === selectedEmpreendimento)?.nome ||
        'Empreendimento Selecionado'

  const exportarPdf = async () => {
    try {
      setExportandoPdf(true)
      const esc1 = resumo.porEscopo['Escopo 1']
      const esc2 = resumo.porEscopo['Escopo 2']
      const esc3 = resumo.porEscopo['Escopo 3']
      await gerarRelatorioEmissoesPDF({
        nomeEmpreendimento: nomeEmpSelecionado,
        periodoCobertura: resumo.periodoTexto,
        total24Meses: resumo.totalPeriodo,
        totalEscopo1: esc1.total,
        totalEscopo2: esc2.total,
        totalEscopo3: esc3.total,
        mediaMensal: resumo.mediaMensal || 0,
        maxPoint: resumo.maxPoint
          ? { label: resumo.maxPoint.label, totalTCO2e: resumo.maxPoint.total || 0 }
          : null,
        minPoint: resumo.minPoint
          ? { label: resumo.minPoint.label, totalTCO2e: resumo.minPoint.total || 0 }
          : null,
        slots: resumo.pontos.map((p) => ({
          key: p.key,
          label: p.label,
          shortMonth: p.shortMonth,
          ano: parseMesKey(p.key)?.ano || 0,
          mes: parseMesKey(p.key)?.mes || 0,
          totalTCO2e: p.total || 0,
          escopo1: p.escopo1 || 0,
          escopo2: p.escopo2 || 0,
          escopo3: p.escopo3 || 0,
          consumoEnergiaKwh: p.consumoEnergiaKwh || 0,
          consumoGasM3: p.consumoGasM3 || 0,
          consumoAguaM3: p.consumoAguaM3 || 0,
          fatorEnergiaAplicado: p.fatorEnergiaAplicado || 0,
          isEnergiaOficial: !!p.fatorEnergiaOficial,
          semFatura: p.semFatura,
          oficial: p.oficial || 0,
          estimado: p.estimado || 0,
        })),
        comparativoData: resumo.comparativoData.map((c) => ({
          mes: c.mes,
          ano1Label: c.anteriorLabel,
          ano1Valor: c.anteriorValor || 0,
          ano2Label: c.atualLabel,
          ano2Valor: c.atualValor || 0,
        })),
        breakdownEmpreendimentos: resumo.breakdown.map((b) => ({
          nome: b.nome,
          totalTCO2e: b.total,
          escopo1: b.escopo1,
          escopo2: b.escopo2,
          escopo3: b.escopo3,
          oficial: b.oficial,
          estimado: b.estimado,
        })),
        mesesComDado: resumo.mesesComDado,
        qtdMeses: resumo.qtdMeses,
        mesesSemDado: resumo.mesesSemDado.length,
        totalOficial: resumo.totalOficial,
        totalEstimado: resumo.totalEstimado,
        misturaFontes: resumo.misturaFontes,
        porEscopoFonte: { escopo1: esc1, escopo2: esc2, escopo3: esc3 },
      })
      toast({
        title: 'Relatório PDF gerado!',
        description: 'O download do relatório de Emissões de GEE foi iniciado com sucesso.',
      })
    } catch (err: any) {
      console.error('Erro ao gerar PDF de emissões:', err)
      toast({
        title: 'Erro ao gerar PDF',
        description: err.message || 'Ocorreu uma falha ao construir o relatório em PDF.',
        variant: 'destructive',
      })
    } finally {
      setExportandoPdf(false)
    }
  }

  const total = resumo.totalPeriodo
  const esc1 = resumo.porEscopo['Escopo 1']
  const esc2 = resumo.porEscopo['Escopo 2']
  const esc3 = resumo.porEscopo['Escopo 3']

  return (
    <div className="space-y-6">
      {/* Título e ações */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
              <Leaf className="w-4 h-4 text-teal-600" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Emissões de GEE (GHG Protocol)
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Emissões em tCO₂e por escopo, apuradas das faturas dentro do período escolhido.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-56">
            <Select value={selectedEmpreendimento} onValueChange={setSelectedEmpreendimento}>
              <SelectTrigger className="h-9 text-xs bg-white border-gray-200 shadow-sm">
                <Building2 className="w-3.5 h-3.5 mr-1.5 text-gray-500 shrink-0" />
                <SelectValue placeholder="Selecione empreendimento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">
                  Todos os Empreendimentos
                </SelectItem>
                {(empreendimentos || []).map((emp) => (
                  <SelectItem key={emp.id} value={emp.id} className="text-xs">
                    {emp.nome || 'Sem nome'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={exportarPdf}
            disabled={exportandoPdf || loading || !resumo.temDados}
            className="h-9 px-3.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
          >
            {exportandoPdf ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Gerando PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Exportar PDF</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Seletor de período */}
      <Card className="p-4 border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex items-center gap-2 lg:pb-2">
            <div className="p-1.5 rounded-lg bg-teal-50">
              <CalendarRange className="w-4 h-4 text-teal-700" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Período da análise</p>
              <p className="text-[11px] text-gray-500">
                {disponivel
                  ? `Histórico lançado: ${labelMes(disponivel.inicio, true)} a ${labelMes(
                      disponivel.fim,
                      true,
                    )}`
                  : 'Sem faturas lançadas para este filtro'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 flex-1 max-w-md">
            <MesAnoPicker label="Mês inicial" valor={inicio} anos={anos} onChange={setInicio} />
            <MesAnoPicker label="Mês final" valor={fim} anos={anos} onChange={setFim} />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:pb-1">
            {[
              { t: '12 meses', n: -11 },
              { t: '24 meses', n: -23 },
              { t: 'Todo o histórico', n: null },
            ].map((b) => (
              <Button
                key={b.t}
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-[11px]"
                disabled={!disponivel}
                onClick={() => {
                  if (!disponivel) return
                  if (b.n === null) {
                    setInicio(disponivel.inicio)
                  } else {
                    const i = deslocarMes(disponivel.fim, b.n)
                    setInicio(i && i > disponivel.inicio ? i : disponivel.inicio)
                  }
                  setFim(disponivel.fim)
                }}
              >
                {b.t}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 font-semibold">
            <Calendar className="w-3 h-3 text-teal-700" />
            {validacao.valido
              ? `${resumo.periodoTexto} • ${resumo.qtdMeses} competências`
              : 'Período inválido'}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200">
            Meses com fatura: {resumo.mesesComDado} de {resumo.qtdMeses}
          </span>
        </div>

        {validacao.erro && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800 font-medium">{validacao.erro}</p>
          </div>
        )}
        {!validacao.erro && resumo.aviso && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 font-medium">{resumo.aviso}</p>
          </div>
        )}
      </Card>

      <FaixaFontes resumo={resumo} />

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
        <TabsList className="bg-gray-200/80 p-1 rounded-xl grid grid-cols-2 w-full sm:w-80">
          <TabsTrigger
            value="analise"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-teal-700" />
            Análise por Período
          </TabsTrigger>
          <TabsTrigger
            value="fatores"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-teal-700" />
            Fatores de Emissão
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analise" className="space-y-6 mt-4">
          <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-teal-900">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-teal-950">
                  Metodologia GHG Protocol & Padrões Brasileiros:
                </span>
                <span className="ml-1 text-teal-800">
                  <strong>Escopo 1</strong> (Gás — combustão estacionária, IPCC 2006);{' '}
                  <strong>Escopo 2</strong> (Energia Elétrica — fator mensal do SIN, MCTI/SIRENE);{' '}
                  <strong>Escopo 3</strong> (Água e Esgoto — estimativa setorial do PB GHG
                  Protocol).
                </span>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('fatores')}
              className="text-xs font-bold text-teal-700 hover:text-teal-900 underline whitespace-nowrap self-end md:self-center"
            >
              Configurar Fatores →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card
              className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
              style={{ borderLeft: '5px solid #0F766E' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Total do Período
                </span>
                <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                  <Leaf className="w-4 h-4 text-teal-700" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-gray-900 tabular-nums font-mono">
                  {resumo.temDados ? formatTCO2e(total, 2) : 'ND'}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {resumo.mediaMensal === null
                    ? 'Sem mês com fatura — média não calculada'
                    : `Média de ${formatTCO2e(resumo.mediaMensal, 2)} por mês com fatura (${
                        resumo.mesesComDado
                      } ${resumo.mesesComDado === 1 ? 'mês' : 'meses'})`}
                </p>
              </div>
            </Card>

            {[
              {
                titulo: 'Escopo 1 (Gás)',
                dados: esc1,
                cor: '#14B8A6',
                icon: Flame,
                bg: 'bg-teal-50 text-teal-600',
              },
              {
                titulo: 'Escopo 2 (Eletricidade)',
                dados: esc2,
                cor: '#F59E0B',
                icon: Zap,
                bg: 'bg-amber-50 text-amber-600',
              },
              {
                titulo: 'Escopo 3 (Água e Esgoto)',
                dados: esc3,
                cor: '#0EA5E9',
                icon: Droplets,
                bg: 'bg-sky-50 text-sky-600',
              },
            ].map((k) => {
              const Icon = k.icon
              const pct = total > 0 ? (k.dados.total / total) * 100 : null
              return (
                <Card
                  key={k.titulo}
                  className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
                  style={{ borderLeft: `5px solid ${k.cor}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {k.titulo}
                    </span>
                    <div className={`p-2 rounded-lg ${k.bg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl font-bold text-gray-900 tabular-nums font-mono">
                      {resumo.temDados ? formatTCO2e(k.dados.total, 2) : 'ND'}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {pct === null ? 'Sem base para participação' : `${pct.toFixed(1)}% do total`}
                      {k.dados.total > 0 && (
                        <span className="block text-[10px] text-gray-400 mt-0.5">
                          Oficial {formatTCO2e(k.dados.oficial, 2)} · Estimativa{' '}
                          {formatTCO2e(k.dados.estimado, 2)}
                        </span>
                      )}
                    </p>
                  </div>
                </Card>
              )
            })}
          </div>

          <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="p-0 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold text-gray-900">
                  Evolução Mensal de Emissões — {resumo.periodoTexto} (tCO₂e)
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Barras empilhadas por escopo. Mês sem fatura fica em branco (lacuna), não em zero.
                </CardDescription>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-teal-700">
                  <span className="w-3 h-3 rounded bg-[#14B8A6]" />
                  E1 (Gás)
                </span>
                <span className="flex items-center gap-1.5 text-amber-600">
                  <span className="w-3 h-3 rounded bg-[#F59E0B]" />
                  E2 (Energia)
                </span>
                <span className="flex items-center gap-1.5 text-sky-600">
                  <span className="w-3 h-3 rounded bg-[#0EA5E9]" />
                  E3 (Água)
                </span>
              </div>
            </CardHeader>

            <div className="h-80 w-full">
              {resumo.temDados ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={resumo.pontos.map((p) => ({
                      label: p.label,
                      semFatura: p.semFatura,
                      escopo1: p.escopo1 || 0,
                      escopo2: p.escopo2 || 0,
                      escopo3: p.escopo3 || 0,
                    }))}
                    margin={{ top: 20, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dy={5}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `${val.toFixed(1)}t`}
                    />
                    <RechartsTooltip content={<CustomBarTooltip />} />
                    <Bar dataKey="escopo1" name="Escopo 1 (Gás)" stackId="a" fill="#14B8A6" />
                    <Bar dataKey="escopo2" name="Escopo 2 (Energia)" stackId="a" fill="#F59E0B" />
                    <Bar
                      dataKey="escopo3"
                      name="Escopo 3 (Água)"
                      stackId="a"
                      fill="#0EA5E9"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-gray-400">
                  Nenhuma emissão apurada no período selecionado.
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
              <CardHeader className="p-0 mb-4">
                <CardTitle className="text-sm font-bold text-gray-900">
                  Mesmo Mês do Ano Anterior (tCO₂e)
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Compara cada mês da janela com o mesmo mês do ano anterior. Mês sem base não
                  aparece — não vira zero.
                </CardDescription>
              </CardHeader>
              <div className="h-64 w-full">
                {resumo.comparativoData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={resumo.comparativoData.map((c) => ({
                        mes: c.mes,
                        ano1Valor: c.anteriorValor || 0,
                        ano2Valor: c.atualValor || 0,
                      }))}
                      margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                      <XAxis
                        dataKey="mes"
                        stroke="#9CA3AF"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#9CA3AF"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val.toFixed(1)}t`}
                      />
                      <RechartsTooltip
                        formatter={(val: any) => [`${formatTCO2e(val, 3)}`, 'Emissões']}
                        labelFormatter={(label) => `Mês de referência: ${label}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      <Bar
                        dataKey="ano1Valor"
                        name="Ano anterior"
                        fill="#94A3B8"
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="ano2Valor"
                        name="Ano atual"
                        fill="#0F766E"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">
                    Sem dois ciclos anuais cobertos pelo período para comparar.
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm flex flex-col justify-between">
              <div>
                <CardHeader className="p-0 mb-4">
                  <CardTitle className="text-sm font-bold text-gray-900">
                    Emissões por Empreendimento
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500">
                    Acumulado do período por unidade. Média dividida pelos meses com fatura de cada
                    uma.
                  </CardDescription>
                </CardHeader>

                {resumo.breakdown.length === 0 && (
                  <p className="text-xs text-gray-400">Nenhuma emissão apurada no período.</p>
                )}

                <div className="space-y-3.5">
                  {resumo.breakdown.map((emp, index) => {
                    const pct =
                      resumo.totalPeriodo > 0 ? (emp.total / resumo.totalPeriodo) * 100 : 0
                    return (
                      <div key={emp.empreendimentoId} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="font-semibold text-gray-800 flex items-center gap-1.5 truncate">
                            <span className="w-5 h-5 rounded-full bg-teal-50 text-teal-800 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {index + 1}
                            </span>
                            <span className="truncate">{emp.nome}</span>
                          </span>
                          <span className="font-mono font-bold text-teal-900 whitespace-nowrap">
                            {formatTCO2e(emp.total, 2)} ({pct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden flex">
                          <div
                            className="bg-teal-600 h-2 rounded-full"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-gray-400">
                          <span>E1: {formatTCO2e(emp.escopo1, 1)}</span>
                          <span>E2: {formatTCO2e(emp.escopo2, 1)}</span>
                          <span>E3: {formatTCO2e(emp.escopo3, 1)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-gray-400">
                          <span>
                            Média:{' '}
                            {emp.mediaMensal === null ? 'ND' : formatTCO2e(emp.mediaMensal, 2)}/mês
                            ({emp.mesesComDado} {emp.mesesComDado === 1 ? 'mês' : 'meses'} com
                            fatura)
                          </span>
                          <span>Estimativa: {formatTCO2e(emp.estimado, 2)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <p className="text-[11px] text-gray-400 mt-4 border-t pt-2">
                tCO₂e é unidade única e soma entre escopos. kWh, m³ de gás e m³ de água são
                grandezas diferentes — aparecem separadas na tabela, nunca somadas.
              </p>
            </Card>
          </div>

          <Card className="border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
            <CardHeader className="p-5 pb-3 border-b border-[#E5E7EB] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold text-gray-900">
                  Tabela Mensal de Emissões — {resumo.periodoTexto}
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Mês sem fatura aparece como “sem fatura”. Variação só existe quando o mês anterior
                  tem dado.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-red-600 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                  Máxima
                </span>
                <span className="flex items-center gap-1 text-green-600 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A]" />
                  Mínima
                </span>
              </div>
            </CardHeader>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4">Mês / Ano</th>
                    <th className="py-2.5 px-3">Escopo 1 (Gás)</th>
                    <th className="py-2.5 px-3">Escopo 2 (Energia)</th>
                    <th className="py-2.5 px-3">Escopo 3 (Água)</th>
                    <th className="py-2.5 px-3">Fonte</th>
                    <th className="py-2.5 px-4 text-right">Total (tCO₂e)</th>
                    <th className="py-2.5 px-3 text-right">Var. vs Mês Ant.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...resumo.pontos].reverse().map((row) => {
                    const isMax = !row.semFatura && resumo.maxPoint?.key === row.key
                    const isMin = !row.semFatura && resumo.minPoint?.key === row.key
                    return (
                      <tr
                        key={row.key}
                        className={`hover:bg-gray-50/80 transition-colors ${
                          isMax ? 'bg-red-50/40' : isMin ? 'bg-green-50/40' : ''
                        }`}
                      >
                        <td className="py-2.5 px-4 font-semibold text-gray-900">
                          <span className="flex items-center gap-2">
                            <span>{row.label}</span>
                            {isMax && (
                              <Badge className="bg-red-600 hover:bg-red-600 text-white text-[9px] px-1.5 py-0 h-4">
                                Máx
                              </Badge>
                            )}
                            {isMin && (
                              <Badge className="bg-green-600 hover:bg-green-600 text-white text-[9px] px-1.5 py-0 h-4">
                                Mín
                              </Badge>
                            )}
                            {row.semFatura && (
                              <Badge
                                variant="outline"
                                className="text-[9px] bg-gray-100 text-gray-500 border-gray-200 px-1.5 py-0 h-4"
                              >
                                sem fatura
                              </Badge>
                            )}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 font-mono">
                          {row.escopo1 === null ? '—' : formatTCO2e(row.escopo1, 3)}
                          <span className="block text-[10px] text-gray-400 font-sans">
                            {row.consumoGasM3 === null || row.semFatura
                              ? '\u00a0'
                              : `${formatNumberBR(row.consumoGasM3, 0)} m³`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 font-mono">
                          {row.escopo2 === null ? '—' : formatTCO2e(row.escopo2, 3)}
                          <span className="block text-[10px] text-gray-400 font-sans">
                            {row.consumoEnergiaKwh === null || row.semFatura
                              ? '\u00a0'
                              : `${formatNumberBR(row.consumoEnergiaKwh, 0)} kWh`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 font-mono">
                          {row.escopo3 === null ? '—' : formatTCO2e(row.escopo3, 3)}
                          <span className="block text-[10px] text-gray-400 font-sans">
                            {row.consumoAguaM3 === null || row.semFatura
                              ? '\u00a0'
                              : `${formatNumberBR(row.consumoAguaM3, 0)} m³`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[10px]">
                          {row.semFatura ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <span className="inline-flex flex-col gap-0.5">
                              {row.fatorEnergiaAplicado !== null && (
                                <span className="text-gray-600 font-mono">
                                  {(row.fatorEnergiaAplicado * 1000).toFixed(1)} kg/MWh{' '}
                                  {row.fatorEnergiaOficial ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 px-1 py-0 h-3.5"
                                    >
                                      Oficial
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 px-1 py-0 h-3.5"
                                    >
                                      Fallback
                                    </Badge>
                                  )}
                                </span>
                              )}
                              {(row.estimado || 0) > 0 && (
                                <span className="text-amber-700">
                                  Água/Esgoto: estimativa setorial
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-gray-900">
                          {row.total === null ? '—' : formatTCO2e(row.total, 3)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs">
                          {row.variacaoPct === null ? (
                            <span className="text-gray-400">ND</span>
                          ) : (
                            <span
                              className={row.variacaoPct > 0 ? 'text-red-600' : 'text-green-600'}
                            >
                              {row.variacaoPct > 0 ? '+' : ''}
                              {row.variacaoPct.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-[#E5E7EB] text-[11px] text-gray-500 space-y-1">
              <p>
                <strong>Unidades:</strong> tCO₂e é a única grandeza somada aqui — e só dentro de
                tCO₂e. Consumo de energia (kWh) e de água/gás (m³) são grandezas distintas e
                aparecem apenas como referência, nunca somadas entre si.
              </p>
              <p>
                <strong>Fontes:</strong> escopos 1 e 2 usam fator oficial (IPCC 2006 / MCTI-SIRENE);
                o escopo 3 usa estimativa setorial (PB GHG Protocol). Total que reúne os dois está
                sinalizado no topo — não equivale a inventário verificado.
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="fatores" className="mt-4">
          <FatoresEmissaoTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
