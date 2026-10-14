import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { TipoUtilidade } from '@/types/entities'
import { formatNumberBR, formatTCO2e } from '@/lib/cnpj'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Droplets,
  Flame,
  Layers,
  Calendar,
  Building2,
  Leaf,
  SlidersHorizontal,
  Info,
  ShieldCheck,
  BarChart3,
  Sparkles,
  Download,
  Loader2,
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

export default function Emissoes() {
  const { faturas, empreendimentos, calculosEmissoes, loading } = useData()
  const { toast } = useToast()

  // Filtros
  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState<string>('todos')
  const [activeTab, setActiveTab] = useState<'analise' | 'fatores'>('analise')
  const [filtroEscopo, setFiltroEscopo] = useState<'Todos' | 'Escopo 1' | 'Escopo 2' | 'Escopo 3'>(
    'Todos',
  )
  const [exportandoPdf, setExportandoPdf] = useState<boolean>(false)

  // Cálculos filtrados por empreendimento
  const calculosFiltrados = useMemo(() => {
    if (!calculosEmissoes || calculosEmissoes.length === 0) return []
    if (selectedEmpreendimento === 'todos') return calculosEmissoes
    return calculosEmissoes.filter((c) => c.empreendimentoId === selectedEmpreendimento)
  }, [calculosEmissoes, selectedEmpreendimento])

  // Processamento dos 24 meses
  const analise24Meses = useMemo(() => {
    if (!faturas || faturas.length === 0 || calculosFiltrados.length === 0) {
      return {
        coverageText: 'Sem dados suficientes',
        slots: [],
        total24Meses: 0,
        totalEscopo1: 0,
        totalEscopo2: 0,
        totalEscopo3: 0,
        mediaMensal: 0,
        maxPoint: null,
        minPoint: null,
        comparativoData: [],
        breakdownEmpreendimentos: [],
        tableRows: [],
      }
    }

    // Ordenar cronologicamente
    const faturasFiltradasIds = new Set(calculosFiltrados.map((c) => c.faturaId))
    const faturasConsideradas = faturas.filter((f) => faturasFiltradasIds.has(f.id))
    if (faturasConsideradas.length === 0) {
      return {
        coverageText: 'Sem dados para o filtro',
        slots: [],
        total24Meses: 0,
        totalEscopo1: 0,
        totalEscopo2: 0,
        totalEscopo3: 0,
        mediaMensal: 0,
        maxPoint: null,
        minPoint: null,
        comparativoData: [],
        breakdownEmpreendimentos: [],
        tableRows: [],
      }
    }

    const sorted = [...faturasConsideradas].sort(
      (a, b) => new Date(a.competencia).getTime() - new Date(b.competencia).getTime(),
    )
    const oldestDate = new Date(sorted[0].competencia)
    const newestDate = new Date(sorted[sorted.length - 1].competencia)

    const monthNames = [
      'jan',
      'fev',
      'mar',
      'abr',
      'mai',
      'jun',
      'jul',
      'ago',
      'set',
      'out',
      'nov',
      'dez',
    ]
    const coverage = `${monthNames[oldestDate.getMonth()]} ${oldestDate.getFullYear()} — ${monthNames[newestDate.getMonth()]} ${newestDate.getFullYear()}`

    // Construir 24 slots mensais terminando no newestDate
    const slots: {
      key: string
      label: string
      shortMonth: string
      ano: number
      mes: number
      date: Date
      totalTCO2e: number
      escopo1: number // Gás
      escopo2: number // Energia
      escopo3: number // Água
      consumoEnergiaKwh: number
      consumoGasM3: number
      consumoAguaM3: number
      fatorEnergiaAplicado: number
      isEnergiaOficial: boolean
    }[] = []

    for (let i = 23; i >= 0; i--) {
      const d = new Date(newestDate.getFullYear(), newestDate.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = `${monthNames[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`
      const shortMonth = monthNames[d.getMonth()]
      slots.push({
        key,
        label,
        shortMonth,
        ano: d.getFullYear(),
        mes: d.getMonth() + 1,
        date: d,
        totalTCO2e: 0,
        escopo1: 0,
        escopo2: 0,
        escopo3: 0,
        consumoEnergiaKwh: 0,
        consumoGasM3: 0,
        consumoAguaM3: 0,
        fatorEnergiaAplicado: 0,
        isEnergiaOficial: false,
      })
    }

    let sumTotal = 0
    let sumEscopo1 = 0
    let sumEscopo2 = 0
    let sumEscopo3 = 0

    // Agregar os cálculos por slot mensal
    calculosFiltrados.forEach((calc) => {
      const d = new Date(calc.competencia)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const found = slots.find((s) => s.key === key)
      if (found) {
        found.totalTCO2e += calc.emissoesTCO2e
        sumTotal += calc.emissoesTCO2e

        if (calc.escopo === 'Escopo 1') {
          found.escopo1 += calc.emissoesTCO2e
          found.consumoGasM3 += calc.consumoConsiderado
          sumEscopo1 += calc.emissoesTCO2e
        } else if (calc.escopo === 'Escopo 2') {
          found.escopo2 += calc.emissoesTCO2e
          found.consumoEnergiaKwh += calc.consumoConsiderado
          found.fatorEnergiaAplicado = calc.fatorAplicado
          found.isEnergiaOficial = calc.isFatorOficial
          sumEscopo2 += calc.emissoesTCO2e
        } else if (calc.escopo === 'Escopo 3') {
          found.escopo3 += calc.emissoesTCO2e
          found.consumoAguaM3 += calc.consumoConsiderado
          sumEscopo3 += calc.emissoesTCO2e
        }
      }
    })

    // Arredondar valores dos slots para os gráficos
    slots.forEach((s) => {
      s.totalTCO2e = Math.round(s.totalTCO2e * 1000) / 1000
      s.escopo1 = Math.round(s.escopo1 * 1000) / 1000
      s.escopo2 = Math.round(s.escopo2 * 1000) / 1000
      s.escopo3 = Math.round(s.escopo3 * 1000) / 1000
    })

    // Identificar máximo, mínimo e média
    let max = slots[0]
    let min = slots[0]
    let countComDados = 0

    slots.forEach((s) => {
      if (s.totalTCO2e > 0) countComDados++
      if (s.totalTCO2e > max.totalTCO2e) max = s
      if (s.totalTCO2e > 0 && (min.totalTCO2e === 0 || s.totalTCO2e < min.totalTCO2e)) min = s
    })

    const media = countComDados > 0 ? sumTotal / 24 : 0

    // Comparativo Ano 1 vs Ano 2 (12 meses cada)
    const ano1 = slots.slice(0, 12)
    const ano2 = slots.slice(12, 24)

    const comparativo = ano1.map((item, idx) => {
      const matchAno2 = ano2[idx]
      return {
        mes: item.shortMonth,
        ano1Label: item.label,
        ano1Valor: item.totalTCO2e,
        ano2Label: matchAno2 ? matchAno2.label : '',
        ano2Valor: matchAno2 ? matchAno2.totalTCO2e : 0,
      }
    })

    // Breakdown por empreendimento (top emissores)
    const empMap = new Map<
      string,
      { nome: string; totalTCO2e: number; escopo1: number; escopo2: number; escopo3: number }
    >()
    empreendimentos.forEach((emp) => {
      empMap.set(emp.id, {
        nome: emp.nome,
        totalTCO2e: 0,
        escopo1: 0,
        escopo2: 0,
        escopo3: 0,
      })
    })

    calculosFiltrados.forEach((calc) => {
      const entry = empMap.get(calc.empreendimentoId)
      if (entry) {
        entry.totalTCO2e += calc.emissoesTCO2e
        if (calc.escopo === 'Escopo 1') entry.escopo1 += calc.emissoesTCO2e
        if (calc.escopo === 'Escopo 2') entry.escopo2 += calc.emissoesTCO2e
        if (calc.escopo === 'Escopo 3') entry.escopo3 += calc.emissoesTCO2e
      }
    })

    const breakdownEmpreendimentos = Array.from(empMap.values())
      .filter((e) => e.totalTCO2e > 0)
      .sort((a, b) => b.totalTCO2e - a.totalTCO2e)

    // Tabela detalhada mensal (mais recente primeiro) com variação %
    const reversedSlots = [...slots].reverse()
    const tableRows = reversedSlots.map((item, idx) => {
      const prev = reversedSlots[idx + 1]
      let variacaoPct = 0
      if (prev && prev.totalTCO2e > 0) {
        variacaoPct = ((item.totalTCO2e - prev.totalTCO2e) / prev.totalTCO2e) * 100
      }
      const isMax = item.key === max?.key && item.totalTCO2e > 0
      const isMin = item.key === min?.key && item.totalTCO2e > 0

      return {
        ...item,
        variacaoPct,
        isMax,
        isMin,
      }
    })

    return {
      coverageText: coverage,
      slots,
      total24Meses: sumTotal,
      totalEscopo1: sumEscopo1,
      totalEscopo2: sumEscopo2,
      totalEscopo3: sumEscopo3,
      mediaMensal: media,
      maxPoint: max,
      minPoint: min,
      comparativoData: comparativo,
      breakdownEmpreendimentos,
      tableRows,
    }
  }, [faturas, calculosFiltrados, empreendimentos])

  // Custom tooltip para os gráficos
  const CustomBarTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-xs space-y-1 z-50">
          <p className="font-bold text-gray-900 border-b pb-1 mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5" style={{ color: entry.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span>{entry.name}:</span>
              </span>
              <span className="font-mono font-bold text-gray-800">
                {formatTCO2e(entry.value, 3)}
              </span>
            </div>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Main Bar */}
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
            Inventário corporativo de 24 meses em tCO₂e por escopo e utilidade a partir das faturas
            registradas.
          </p>
        </div>

        {/* Action / Coverage badge & Empreendimento select & Exportar PDF */}
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
                {empreendimentos.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id} className="text-xs">
                    {emp.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-teal-700" />
            <span>Cobertura: {analise24Meses.coverageText}</span>
          </div>

          <Button
            onClick={async () => {
              try {
                setExportandoPdf(true)
                const nomeEmp =
                  selectedEmpreendimento === 'todos'
                    ? 'Todos os Empreendimentos'
                    : empreendimentos.find((e) => e.id === selectedEmpreendimento)?.nome ||
                      'Empreendimento Selecionado'

                await gerarRelatorioEmissoesPDF({
                  nomeEmpreendimento: nomeEmp,
                  periodoCobertura: analise24Meses.coverageText,
                  total24Meses: analise24Meses.total24Meses,
                  totalEscopo1: analise24Meses.totalEscopo1,
                  totalEscopo2: analise24Meses.totalEscopo2,
                  totalEscopo3: analise24Meses.totalEscopo3,
                  mediaMensal: analise24Meses.mediaMensal,
                  maxPoint: analise24Meses.maxPoint
                    ? {
                        label: analise24Meses.maxPoint.label,
                        totalTCO2e: analise24Meses.maxPoint.totalTCO2e,
                      }
                    : null,
                  minPoint: analise24Meses.minPoint
                    ? {
                        label: analise24Meses.minPoint.label,
                        totalTCO2e: analise24Meses.minPoint.totalTCO2e,
                      }
                    : null,
                  slots: analise24Meses.slots,
                  comparativoData: analise24Meses.comparativoData,
                  breakdownEmpreendimentos: analise24Meses.breakdownEmpreendimentos,
                })

                toast({
                  title: 'Relatório PDF gerado!',
                  description:
                    'O download do relatório de Emissões de GEE foi iniciado com sucesso.',
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
            }}
            disabled={exportandoPdf || loading || analise24Meses.slots.length === 0}
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

      {/* Main Tabs (Análise 24 Meses vs Fatores de Emissão) */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
        <TabsList className="bg-gray-200/80 p-1 rounded-xl grid grid-cols-2 w-full sm:w-80">
          <TabsTrigger
            value="analise"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-teal-700" />
            Análise 24 Meses
          </TabsTrigger>
          <TabsTrigger
            value="fatores"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-teal-700" />
            Fatores de Emissão
          </TabsTrigger>
        </TabsList>

        {/* ABA: ANÁLISE 24 MESES */}
        <TabsContent value="analise" className="space-y-6 mt-4">
          {/* Metodologia Banner Informativo */}
          <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-teal-900">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-teal-950">
                  Metodologia GHG Protocol & Padrões Brasileiros:
                </span>
                <span className="ml-1 text-teal-800">
                  <strong>Escopo 1</strong> (Gás Natural — combustão estacionária, 2,15 kgCO₂e/m³,
                  IPCC 2006); <strong>Escopo 2</strong> (Energia Elétrica — aquisição via rede SIN,
                  fator location-based mensal MCTI/SIRENE); <strong>Escopo 3</strong> (Água e Esgoto
                  — abastecimento 0,208 + esgoto 0,700 kgCO₂e/m³, prática PB GHG Protocol).
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

          {/* KPI Stat Cards (4 Cards) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total 24 Meses */}
            <Card
              className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
              style={{ borderLeft: '5px solid #0F766E' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Total 24 Meses
                </span>
                <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                  <Leaf className="w-4 h-4 text-teal-700" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-gray-900 tabular-nums font-mono">
                  {formatTCO2e(analise24Meses.total24Meses, 2)}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Média de {formatTCO2e(analise24Meses.mediaMensal, 2)} / mês
                </p>
              </div>
            </Card>

            {/* Escopo 1 (Gás Natural) */}
            <Card
              className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
              style={{ borderLeft: '5px solid #14B8A6' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Escopo 1 (Gás Natural)
                </span>
                <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
                  <Flame className="w-4 h-4 text-teal-600 fill-teal-600" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-gray-900 tabular-nums font-mono">
                  {formatTCO2e(analise24Meses.totalEscopo1, 2)}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {analise24Meses.total24Meses > 0
                    ? `${((analise24Meses.totalEscopo1 / analise24Meses.total24Meses) * 100).toFixed(1)}% do inventário`
                    : '0% do inventário'}
                </p>
              </div>
            </Card>

            {/* Escopo 2 (Energia Elétrica) */}
            <Card
              className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
              style={{ borderLeft: '5px solid #F59E0B' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Escopo 2 (Eletricidade)
                </span>
                <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                  <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-gray-900 tabular-nums font-mono">
                  {formatTCO2e(analise24Meses.totalEscopo2, 2)}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {analise24Meses.total24Meses > 0
                    ? `${((analise24Meses.totalEscopo2 / analise24Meses.total24Meses) * 100).toFixed(1)}% do inventário`
                    : '0% do inventário'}
                </p>
              </div>
            </Card>

            {/* Escopo 3 (Água e Esgoto) */}
            <Card
              className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
              style={{ borderLeft: '5px solid #0EA5E9' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Escopo 3 (Água e Esgoto)
                </span>
                <div className="p-2 rounded-lg bg-sky-50 text-sky-600">
                  <Droplets className="w-4 h-4 text-sky-500 fill-sky-500" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-gray-900 tabular-nums font-mono">
                  {formatTCO2e(analise24Meses.totalEscopo3, 2)}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {analise24Meses.total24Meses > 0
                    ? `${((analise24Meses.totalEscopo3 / analise24Meses.total24Meses) * 100).toFixed(1)}% do inventário`
                    : '0% do inventário'}
                </p>
              </div>
            </Card>
          </div>

          {/* Gráfico 24 Meses: Barras Empilhadas por Escopo */}
          <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="p-0 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold text-gray-900">
                  Evolução Mensal de Emissões — 24 Meses (tCO₂e)
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Emissões empilhadas por escopo do GHG Protocol: Escopo 1 (Gás), Escopo 2
                  (Eletricidade) e Escopo 3 (Água).
                </CardDescription>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-teal-700">
                  <span className="w-3 h-3 rounded bg-[#14B8A6]" />
                  Escopo 1 (Gás)
                </span>
                <span className="flex items-center gap-1.5 text-amber-600">
                  <span className="w-3 h-3 rounded bg-[#F59E0B]" />
                  Escopo 2 (Eletricidade)
                </span>
                <span className="flex items-center gap-1.5 text-sky-600">
                  <span className="w-3 h-3 rounded bg-[#0EA5E9]" />
                  Escopo 3 (Água)
                </span>
              </div>
            </CardHeader>

            <div className="h-80 w-full">
              {analise24Meses.slots.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analise24Meses.slots}
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
                    <Bar
                      dataKey="escopo1"
                      name="Escopo 1 (Gás)"
                      stackId="a"
                      fill="#14B8A6"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="escopo2"
                      name="Escopo 2 (Energia)"
                      stackId="a"
                      fill="#F59E0B"
                      radius={[0, 0, 0, 0]}
                    />
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
                  Nenhum dado para o período selecionado.
                </div>
              )}
            </div>
          </Card>

          {/* Grid: Comparativo Ano 1 vs Ano 2 & Top Emissores */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Comparativo Ano 1 vs Ano 2 */}
            <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
              <CardHeader className="p-0 mb-4">
                <CardTitle className="text-sm font-bold text-gray-900">
                  Comparativo Sazonal: Ano 1 vs. Ano 2 (tCO₂e)
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Confronto mês a mês dos dois ciclos anuais para identificação de variações na
                  pegada de carbono.
                </CardDescription>
              </CardHeader>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analise24Meses.comparativoData}
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
                      name="Ano 1 (12m anteriores)"
                      fill="#94A3B8"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="ano2Valor"
                      name="Ano 2 (12m recentes)"
                      fill="#0F766E"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Top Emissores por Empreendimento */}
            <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm flex flex-col justify-between">
              <div>
                <CardHeader className="p-0 mb-4">
                  <CardTitle className="text-sm font-bold text-gray-900">
                    Breakdown por Empreendimento (Top Emissores)
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500">
                    Distribuição da pegada acumulada de 24 meses por unidade consumidora.
                  </CardDescription>
                </CardHeader>

                <div className="space-y-3.5">
                  {analise24Meses.breakdownEmpreendimentos.map((emp, index) => {
                    const pct =
                      analise24Meses.total24Meses > 0
                        ? (emp.totalTCO2e / analise24Meses.total24Meses) * 100
                        : 0

                    return (
                      <div key={index} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-gray-800 flex items-center gap-1.5 truncate">
                            <span className="w-5 h-5 rounded-full bg-teal-50 text-teal-800 flex items-center justify-center text-[10px] font-bold">
                              {index + 1}
                            </span>
                            <span className="truncate">{emp.nome}</span>
                          </span>
                          <span className="font-mono font-bold text-teal-900">
                            {formatTCO2e(emp.totalTCO2e, 2)} ({pct.toFixed(1)}%)
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
                      </div>
                    )
                  })}
                </div>
              </div>

              <p className="text-[11px] text-gray-400 mt-4 border-t pt-2">
                Permite priorizar investimentos em eficiência energética e transição de combustíveis
                nas unidades com maior impacto.
              </p>
            </Card>
          </div>

          {/* Tabela Mensal Detalhada (24 Meses) */}
          <Card className="border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
            <CardHeader className="p-5 pb-3 border-b border-[#E5E7EB] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold text-gray-900">
                  Tabela Mensal de Emissões — Série 24 Meses
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Valores apurados mês a mês com fatores aplicados e destaques de máxima e mínima
                  histórica.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-red-600 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                  Pico (Máxima)
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
                    <th className="py-2.5 px-3">Fator Energia (SIN)</th>
                    <th className="py-2.5 px-4 text-right">Total Emissões (tCO₂e)</th>
                    <th className="py-2.5 px-3 text-right">Var. vs Mês Ant.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analise24Meses.tableRows.map((row) => {
                    return (
                      <tr
                        key={row.key}
                        className={`hover:bg-gray-50/80 transition-colors ${
                          row.isMax ? 'bg-red-50/40' : row.isMin ? 'bg-green-50/40' : ''
                        }`}
                      >
                        <td className="py-2.5 px-4 font-semibold text-gray-900 flex items-center gap-2">
                          <span>{row.label}</span>
                          {row.isMax && (
                            <Badge className="bg-red-600 hover:bg-red-600 text-white text-[9px] px-1.5 py-0 h-4">
                              Máx
                            </Badge>
                          )}
                          {row.isMin && (
                            <Badge className="bg-green-600 hover:bg-green-600 text-white text-[9px] px-1.5 py-0 h-4">
                              Mín
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 font-mono">
                          {formatTCO2e(row.escopo1, 3)}
                          <span className="block text-[10px] text-gray-400 font-sans">
                            {formatNumberBR(row.consumoGasM3, 0)} m³
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 font-mono">
                          {formatTCO2e(row.escopo2, 3)}
                          <span className="block text-[10px] text-gray-400 font-sans">
                            {formatNumberBR(row.consumoEnergiaKwh, 0)} kWh
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 font-mono">
                          {formatTCO2e(row.escopo3, 3)}
                          <span className="block text-[10px] text-gray-400 font-sans">
                            {formatNumberBR(row.consumoAguaM3, 0)} m³
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-600 font-mono text-[11px]">
                          {row.fatorEnergiaAplicado > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <span>{(row.fatorEnergiaAplicado * 1000).toFixed(1)} kg/MWh</span>
                              {row.isEnergiaOficial ? (
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
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-gray-900">
                          {formatTCO2e(row.totalTCO2e, 3)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs">
                          {row.variacaoPct !== 0 ? (
                            <span
                              className={`inline-flex items-center gap-0.5 ${
                                row.variacaoPct > 0 ? 'text-red-600' : 'text-green-600'
                              }`}
                            >
                              {row.variacaoPct > 0 ? '+' : ''}
                              {row.variacaoPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ABA: FATORES DE EMISSÃO */}
        <TabsContent value="fatores" className="mt-4">
          <FatoresEmissaoTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
