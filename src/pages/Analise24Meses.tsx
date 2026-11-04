import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { TipoUtilidade } from '@/types/entities'
import { formatCurrencyBRL, formatNumberBR, toSafeNumber } from '@/lib/cnpj'
import {
  getFaturaConsumoReal,
  getFaturaTarifaMedia,
  getUnidadePorUtilidade,
  getRotuloTarifa,
} from '@/lib/consumoTarifa'
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Droplets,
  Flame,
  Layers,
  ArrowUp,
  ArrowDown,
  Calendar,
  Building2,
  Download,
  Loader2,
  Gauge,
  CircleDollarSign,
  BarChart3,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { gerarRelatorioAnalise24MesesPDF } from '@/services/relatorioAnalise24MesesPdf'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
} from 'recharts'

export default function Analise24Meses() {
  const { faturas, empreendimentos, loading } = useData()
  const { toast } = useToast()

  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState<string>('todos')
  const [activeTab, setActiveTab] = useState<'Total Geral' | TipoUtilidade>('Total Geral')
  const [exportandoPdf, setExportandoPdf] = useState(false)

  // Unidade de consumo e de tarifa conforme a aba ativa
  const unidadeConsumo = getUnidadePorUtilidade(activeTab)
  const rotuloTarifa = getRotuloTarifa(activeTab)
  const isUtilidadeEspecifica = activeTab !== 'Total Geral'

  // Process data over 24 months
  const {
    coverageText,
    monthPoints,
    // Financeiro
    maxPoint,
    minPoint,
    mediaMensal,
    totalPeriodo,
    comparativoData,
    // Consumo (quantidade)
    maxConsumoPoint,
    minConsumoPoint,
    mediaConsumoMensal,
    totalConsumoPeriodo,
    comparativoConsumoData,
    // Tarifa
    maxTarifaPoint,
    minTarifaPoint,
    mediaTarifaPeriodo,
    // Tabela
    tableRows,
    accentColor,
  } = useMemo(() => {
    if (!faturas || faturas.length === 0) {
      return {
        coverageText: 'Sem dados suficientes',
        monthPoints: [],
        maxPoint: null,
        minPoint: null,
        mediaMensal: 0,
        totalPeriodo: 0,
        comparativoData: [],
        maxConsumoPoint: null,
        minConsumoPoint: null,
        mediaConsumoMensal: 0,
        totalConsumoPeriodo: 0,
        comparativoConsumoData: [],
        maxTarifaPoint: null,
        minTarifaPoint: null,
        mediaTarifaPeriodo: 0,
        tableRows: [],
        accentColor: '#0F766E',
      }
    }

    // Filter by empreendimento first
    const empFiltered =
      selectedEmpreendimento === 'todos'
        ? faturas
        : faturas.filter((f) => f.empreendimento === selectedEmpreendimento)

    if (empFiltered.length === 0) {
      return {
        coverageText: 'Sem dados para o filtro',
        monthPoints: [],
        maxPoint: null,
        minPoint: null,
        mediaMensal: 0,
        totalPeriodo: 0,
        comparativoData: [],
        maxConsumoPoint: null,
        minConsumoPoint: null,
        mediaConsumoMensal: 0,
        totalConsumoPeriodo: 0,
        comparativoConsumoData: [],
        maxTarifaPoint: null,
        minTarifaPoint: null,
        mediaTarifaPeriodo: 0,
        tableRows: [],
        accentColor: '#0F766E',
      }
    }

    // Filter faturas by activeTab if not 'Total Geral'
    const relevantFaturas =
      activeTab === 'Total Geral'
        ? empFiltered
        : empFiltered.filter((f) => f.tipo_utilidade === activeTab)

    // Determine available date range based on empFiltered
    const validDateFaturas = empFiltered.filter((f) => {
      if (!f || !f.competencia) return false
      const d = new Date(f.competencia)
      return !isNaN(d.getTime())
    })
    const sorted = [...validDateFaturas].sort(
      (a, b) => new Date(a.competencia).getTime() - new Date(b.competencia).getTime(),
    )
    const oldestDate = validDateFaturas.length > 0 ? new Date(sorted[0].competencia) : new Date()
    const newestDate =
      validDateFaturas.length > 0 ? new Date(sorted[sorted.length - 1].competencia) : new Date()

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
    const coverage = `${
      monthNames[Number.isFinite(oldestDate.getMonth()) ? oldestDate.getMonth() : 0] || ''
    } ${oldestDate.getFullYear()} — ${
      monthNames[Number.isFinite(newestDate.getMonth()) ? newestDate.getMonth() : 0] || ''
    } ${newestDate.getFullYear()}`

    // Build exactly 24 monthly slots leading up to newestDate
    const slots: {
      key: string
      label: string
      shortMonth: string
      date: Date
      valor: number
      consumo: number
      tarifa: number // R$ por unidade do mês
    }[] = []

    for (let i = 23; i >= 0; i--) {
      const d = new Date(newestDate.getFullYear(), newestDate.getMonth() - i, 1)
      const safeMonthIdx = Number.isFinite(d.getMonth()) ? d.getMonth() : 0
      const key = `${d.getFullYear()}-${String(safeMonthIdx + 1).padStart(2, '0')}`
      const label = `${monthNames[safeMonthIdx] || 'mês'}/${String(d.getFullYear()).slice(-2)}`
      const shortMonth = monthNames[safeMonthIdx] || 'mês'
      slots.push({
        key,
        label,
        shortMonth,
        date: d,
        valor: 0,
        consumo: 0,
        tarifa: 0,
      })
    }

    // Populate values using real extracted consumption
    relevantFaturas.forEach((fat) => {
      if (!fat || !fat.competencia) return
      const d = new Date(fat.competencia)
      if (isNaN(d.getTime())) return
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const found = slots.find((s) => s.key === key)
      if (found) {
        found.valor += toSafeNumber(fat.valor_total, 0)
        const real = getFaturaConsumoReal(fat)
        found.consumo += toSafeNumber(real?.consumo, 0)
      }
    })

    // Compute monthly average tariff (R$ / unidade)
    slots.forEach((s) => {
      if (s.consumo > 0 && s.valor > 0) {
        // Para faturas individuais ou soma mensal, a tarifa média analítica é s.valor / s.consumo
        s.tarifa = s.valor / s.consumo
      } else {
        // Fallback: se houver faturas para este mês com tarifa unitária informada ou calculada
        const faturasDoMes = relevantFaturas.filter((fat) => {
          if (!fat || !fat.competencia) return false
          const d = new Date(fat.competencia)
          if (isNaN(d.getTime())) return false
          const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          return k === s.key
        })
        if (faturasDoMes.length > 0) {
          const tMedia = getFaturaTarifaMedia(faturasDoMes[0])
          s.tarifa = tMedia > 0 ? tMedia : 0
        } else {
          s.tarifa = 0
        }
      }
    })

    // 1. Financeiro: Max, Min, Média, Total
    let maxFinanceiro = slots[0]
    let minFinanceiro = slots[0]
    let sumValor = 0
    let countComValor = 0

    slots.forEach((s) => {
      sumValor += s.valor
      if (s.valor > 0) countComValor++
      if (s.valor > maxFinanceiro.valor) maxFinanceiro = s
      if (s.valor > 0 && (minFinanceiro.valor === 0 || s.valor < minFinanceiro.valor)) {
        minFinanceiro = s
      }
    })

    const avgValor = countComValor > 0 ? sumValor / 24 : 0

    // 2. Consumo: Max, Min, Média, Total
    let maxConsumo = slots[0]
    let minConsumo = slots[0]
    let sumConsumo = 0
    let countComConsumo = 0

    slots.forEach((s) => {
      sumConsumo += s.consumo
      if (s.consumo > 0) countComConsumo++
      if (s.consumo > maxConsumo.consumo) maxConsumo = s
      if (s.consumo > 0 && (minConsumo.consumo === 0 || s.consumo < minConsumo.consumo)) {
        minConsumo = s
      }
    })

    const avgConsumo = countComConsumo > 0 ? sumConsumo / 24 : 0

    // 3. Tarifa: Max, Min, Média ponderada
    let maxTarifa = slots[0]
    let minTarifa = slots[0]

    slots.forEach((s) => {
      if (s.tarifa > maxTarifa.tarifa) maxTarifa = s
      if (s.tarifa > 0 && (minTarifa.tarifa === 0 || s.tarifa < minTarifa.tarifa)) {
        minTarifa = s
      }
    })

    const mediaTarifa = sumConsumo > 0 ? sumValor / sumConsumo : 0

    // Group into Ano 1 (first 12 months) vs Ano 2 (last 12 months)
    const ano1 = slots.slice(0, 12)
    const ano2 = slots.slice(12, 24)

    // Comparativo Financeiro
    const comparativo = ano1.map((item, idx) => {
      const matchAno2 = ano2[idx]
      return {
        mes: item.shortMonth,
        ano1Label: item.label,
        ano1Valor: Math.round(toSafeNumber(item.valor, 0) * 100) / 100,
        ano2Label: matchAno2 ? matchAno2.label : '',
        ano2Valor: matchAno2 ? Math.round(toSafeNumber(matchAno2.valor, 0) * 100) / 100 : 0,
      }
    })

    // Comparativo Consumo (Ano 1 vs Ano 2)
    const comparativoConsumo = ano1.map((item, idx) => {
      const matchAno2 = ano2[idx]
      return {
        mes: item.shortMonth,
        ano1Label: item.label,
        ano1Consumo: Math.round(toSafeNumber(item.consumo, 0) * 100) / 100,
        ano2Label: matchAno2 ? matchAno2.label : '',
        ano2Consumo: matchAno2 ? Math.round(toSafeNumber(matchAno2.consumo, 0) * 100) / 100 : 0,
      }
    })

    // Monthly table rows with % variations (newest first)
    const reversedSlots = [...slots].reverse()
    const tableData = reversedSlots.map((item, index) => {
      const prev = reversedSlots[index + 1]

      let variacaoPct = 0
      if (prev && prev.valor > 0) {
        variacaoPct = ((item.valor - prev.valor) / prev.valor) * 100
      }

      let variacaoConsumoPct = 0
      if (prev && prev.consumo > 0) {
        variacaoConsumoPct = ((item.consumo - prev.consumo) / prev.consumo) * 100
      }

      const isMax = item.key === maxFinanceiro?.key && item.valor > 0
      const isMin = item.key === minFinanceiro?.key && item.valor > 0
      const isMaxConsumo = item.key === maxConsumo?.key && item.consumo > 0
      const isMinConsumo = item.key === minConsumo?.key && item.consumo > 0

      return {
        ...item,
        variacaoPct,
        variacaoConsumoPct,
        isMax,
        isMin,
        isMaxConsumo,
        isMinConsumo,
      }
    })

    // Pick accent color for the utility
    let color = '#0F766E'
    if (activeTab === 'Energia Elétrica') color = '#F59E0B'
    if (activeTab === 'Água e Esgoto') color = '#0EA5E9'
    if (activeTab === 'Gás') color = '#14B8A6'

    const safeSumValor = toSafeNumber(sumValor, 0)
    const safeSumConsumo = toSafeNumber(sumConsumo, 0)

    return {
      coverageText: coverage,
      monthPoints: slots,
      // Financeiro
      maxPoint: toSafeNumber(maxFinanceiro?.valor, 0) > 0 ? maxFinanceiro : null,
      minPoint: toSafeNumber(minFinanceiro?.valor, 0) > 0 ? minFinanceiro : null,
      mediaMensal: toSafeNumber(avgValor, 0),
      totalPeriodo: safeSumValor,
      comparativoData: comparativo,
      // Consumo
      maxConsumoPoint: toSafeNumber(maxConsumo?.consumo, 0) > 0 ? maxConsumo : null,
      minConsumoPoint: toSafeNumber(minConsumo?.consumo, 0) > 0 ? minConsumo : null,
      mediaConsumoMensal: toSafeNumber(avgConsumo, 0),
      totalConsumoPeriodo: safeSumConsumo,
      comparativoConsumoData: comparativoConsumo,
      // Tarifa
      maxTarifaPoint: toSafeNumber(maxTarifa?.tarifa, 0) > 0 ? maxTarifa : null,
      minTarifaPoint: toSafeNumber(minTarifa?.tarifa, 0) > 0 ? minTarifa : null,
      mediaTarifaPeriodo: toSafeNumber(mediaTarifa, 0),
      // Tabela
      tableRows: tableData,
      accentColor: color,
    }
  }, [faturas, selectedEmpreendimento, activeTab])

  // Custom Dot para Gráfico Financeiro (Máxima #DC2626, Mínima #16A34A)
  const RenderCustomDotFinanceiro = (props: any) => {
    const { cx, cy, payload } = props
    if (!payload) return null

    const isMax = payload.key === maxPoint?.key && toSafeNumber(payload.valor, 0) > 0
    const isMin = payload.key === minPoint?.key && toSafeNumber(payload.valor, 0) > 0

    if (isMax) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2} />
          <text
            x={cx}
            y={cy - 10}
            textAnchor="middle"
            fill="#DC2626"
            fontSize={10}
            fontWeight="bold"
          >
            Máxima
          </text>
        </g>
      )
    }

    if (isMin) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#16A34A" stroke="#FFFFFF" strokeWidth={2} />
          <text
            x={cx}
            y={cy + 18}
            textAnchor="middle"
            fill="#16A34A"
            fontSize={10}
            fontWeight="bold"
          >
            Mínima
          </text>
        </g>
      )
    }

    return null
  }

  // Custom Dot para Gráfico de Consumo (Máxima #DC2626, Mínima #16A34A)
  const RenderCustomDotConsumo = (props: any) => {
    const { cx, cy, payload } = props
    if (!payload) return null

    const isMax = payload.key === maxConsumoPoint?.key && toSafeNumber(payload.consumo, 0) > 0
    const isMin = payload.key === minConsumoPoint?.key && toSafeNumber(payload.consumo, 0) > 0

    if (isMax) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2} />
          <text
            x={cx}
            y={cy - 10}
            textAnchor="middle"
            fill="#DC2626"
            fontSize={10}
            fontWeight="bold"
          >
            Pico
          </text>
        </g>
      )
    }

    if (isMin) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#16A34A" stroke="#FFFFFF" strokeWidth={2} />
          <text
            x={cx}
            y={cy + 18}
            textAnchor="middle"
            fill="#16A34A"
            fontSize={10}
            fontWeight="bold"
          >
            Mínimo
          </text>
        </g>
      )
    }

    return null
  }

  // Custom Dot para Gráfico de Tarifa (Máxima #DC2626, Mínima #16A34A)
  const RenderCustomDotTarifa = (props: any) => {
    const { cx, cy, payload } = props
    if (!payload) return null

    const isMax = payload.key === maxTarifaPoint?.key && toSafeNumber(payload.tarifa, 0) > 0
    const isMin = payload.key === minTarifaPoint?.key && toSafeNumber(payload.tarifa, 0) > 0

    if (isMax) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={5} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2} />
          <text
            x={cx}
            y={cy - 9}
            textAnchor="middle"
            fill="#DC2626"
            fontSize={9.5}
            fontWeight="bold"
          >
            Máx
          </text>
        </g>
      )
    }

    if (isMin) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={5} fill="#16A34A" stroke="#FFFFFF" strokeWidth={2} />
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            fill="#16A34A"
            fontSize={9.5}
            fontWeight="bold"
          >
            Mín
          </text>
        </g>
      )
    }

    return null
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Análise — 24 Meses
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Comportamento histórico, quantidades consumidas, tarifas aplicadas e faturamento por
            utilidade.
          </p>
        </div>

        {/* Actions: Filtro Empreendimento + Cobertura + Exportar PDF */}
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
            <span>Cobertura: {coverageText}</span>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                setExportandoPdf(true)
                const nomeEmp =
                  selectedEmpreendimento === 'todos'
                    ? 'Todos os Empreendimentos'
                    : empreendimentos.find((e) => e.id === selectedEmpreendimento)?.nome ||
                      'Empreendimento Selecionado'

                await gerarRelatorioAnalise24MesesPDF({
                  nomeEmpreendimento: nomeEmp,
                  periodoCobertura: coverageText,
                  utilidadeSelecionada: activeTab,
                  unidadeConsumo,
                  rotuloTarifa,
                  mediaMensal,
                  totalPeriodo,
                  maxPoint,
                  minPoint,
                  mediaConsumoMensal,
                  totalConsumoPeriodo,
                  maxConsumoPoint,
                  minConsumoPoint,
                  mediaTarifaPeriodo,
                  maxTarifaPoint,
                  minTarifaPoint,
                  monthPoints,
                  comparativoData,
                  comparativoConsumoData,
                  tableRows,
                })

                toast({
                  title: 'Relatório PDF gerado!',
                  description:
                    'O download do relatório de Análise de 24 Meses foi iniciado com sucesso.',
                })
              } catch (err: any) {
                console.error('Erro ao gerar PDF de 24 meses:', err)
                toast({
                  title: 'Erro ao gerar PDF',
                  description: err.message || 'Falha ao construir o documento PDF da análise.',
                  variant: 'destructive',
                })
              } finally {
                setExportandoPdf(false)
              }
            }}
            disabled={exportandoPdf || loading || monthPoints.length === 0}
            className="h-9 text-xs font-semibold bg-white border-gray-200 hover:bg-gray-50 text-gray-700 shadow-sm flex items-center gap-1.5"
          >
            {exportandoPdf ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700" />
                <span>Gerando PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-teal-700" />
                <span>Exportar PDF</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Utility Tabs Segmented Control */}
      <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)} className="w-full">
        <TabsList className="bg-gray-200/80 p-1 rounded-xl grid grid-cols-2 sm:grid-cols-4 w-full sm:w-auto">
          <TabsTrigger
            value="Total Geral"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <Layers className="w-3.5 h-3.5 mr-1.5 text-teal-700" />
            Total Geral
          </TabsTrigger>
          <TabsTrigger
            value="Energia Elétrica"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-amber-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-500 fill-amber-500" />
            Energia Elétrica
          </TabsTrigger>
          <TabsTrigger
            value="Água e Esgoto"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-sky-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <Droplets className="w-3.5 h-3.5 mr-1.5 text-sky-500 fill-sky-500" />
            Água e Esgoto
          </TabsTrigger>
          <TabsTrigger
            value="Gás"
            className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
          >
            <Flame className="w-3.5 h-3.5 mr-1.5 text-teal-600 fill-teal-600" />
            Gás Natural
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ========================================================================= */}
      {/* SEÇÃO 1: QUANTIDADE CONSUMIDA (FÍSICO) — kWh/mês ou m³/mês                */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-50 text-teal-700">
              <Gauge className="w-4 h-4 text-teal-700" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Análise de Consumo Físico{' '}
                {isUtilidadeEspecifica ? `(${unidadeConsumo}/mês)` : '(Quantidades Físicas)'}
              </h3>
              <p className="text-xs text-gray-500">
                {activeTab === 'Energia Elétrica' &&
                  'Consumo ativo em kWh/mês (Grupo A: ponta + fora-ponta somados; Grupo B: consumo único)'}
                {activeTab === 'Água e Esgoto' &&
                  'Volume medido de abastecimento e esgoto em m³/mês'}
                {activeTab === 'Gás' &&
                  'Volume de Gás Natural faturado em m³/mês (consumo corrigido quando disponível)'}
                {activeTab === 'Total Geral' &&
                  'Soma do volume e grandezas físicas registradas nas faturas'}
              </p>
            </div>
          </div>
          {isUtilidadeEspecifica && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 self-start sm:self-auto">
              Unidade: {unidadeConsumo}
            </span>
          )}
        </div>

        {/* KPI Cards de Consumo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Maior Consumo */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #DC2626` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Maior Consumo (Pico)
              </span>
              <div className="p-2 rounded-lg bg-red-50 text-red-600">
                <TrendingUp className="w-4 h-4 text-red-600" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatNumberBR(maxConsumoPoint?.consumo || 0)}{' '}
                <span className="text-sm font-medium text-gray-500">{unidadeConsumo}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span className="font-semibold text-red-700">Mês de pico:</span>
                <span>{maxConsumoPoint?.label || '-'}</span>
              </p>
            </div>
          </Card>

          {/* Menor Consumo */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #16A34A` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Menor Consumo (Mínima)
              </span>
              <div className="p-2 rounded-lg bg-green-50 text-green-600">
                <TrendingDown className="w-4 h-4 text-green-600" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatNumberBR(minConsumoPoint?.consumo || 0)}{' '}
                <span className="text-sm font-medium text-gray-500">{unidadeConsumo}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span className="font-semibold text-green-700">Mês de menor consumo:</span>
                <span>{minConsumoPoint?.label || '-'}</span>
              </p>
            </div>
          </Card>

          {/* Média Mensal de Consumo */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid ${accentColor}` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Média Mensal de Consumo
              </span>
              <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                <Activity className="w-4 h-4 text-teal-700" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatNumberBR(mediaConsumoMensal, 1)}{' '}
                <span className="text-sm font-medium text-gray-500">{unidadeConsumo}/mês</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Total 24m: {formatNumberBR(totalConsumoPeriodo)} {unidadeConsumo}
              </p>
            </div>
          </Card>
        </div>

        {/* Gráfico de Quantidade Consumida: Série 24 Meses */}
        <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Evolução do Consumo Mensal (24 Meses) — {unidadeConsumo}
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Série temporal contínua da quantidade física consumida com destaque para picos e
                vales
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1 text-red-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                Pico
              </span>
              <span className="flex items-center gap-1 text-green-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A]" />
                Mínimo
              </span>
            </div>
          </CardHeader>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthPoints} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorConsumoArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={accentColor} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`)}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const row = payload[0].payload
                      const isMax = row.key === maxConsumoPoint?.key && row.consumo > 0
                      const isMin = row.key === minConsumoPoint?.key && row.consumo > 0
                      return (
                        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800">
                          <div className="flex items-center justify-between gap-3 border-b border-gray-700 pb-1">
                            <span className="font-semibold text-gray-200">{row.label}</span>
                            {isMax && (
                              <span className="px-1.5 py-0.5 rounded bg-red-600/80 text-[10px] font-bold">
                                Pico Consumo
                              </span>
                            )}
                            {isMin && (
                              <span className="px-1.5 py-0.5 rounded bg-green-600/80 text-[10px] font-bold">
                                Mínimo Consumo
                              </span>
                            )}
                          </div>
                          <p className="font-bold tabular-nums text-white text-sm">
                            {formatNumberBR(row.consumo)} {unidadeConsumo}
                          </p>
                          {row.valor > 0 && (
                            <p className="text-gray-400 text-[11px]">
                              Valor: {formatCurrencyBRL(row.valor)}
                            </p>
                          )}
                          {row.tarifa > 0 && (
                            <p className="text-teal-300 text-[11px]">
                              Tarifa média: {formatCurrencyBRL(row.tarifa)}/{unidadeConsumo}
                            </p>
                          )}
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="consumo"
                  name="Consumo"
                  stroke={accentColor}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorConsumoArea)"
                  dot={<RenderCustomDotConsumo />}
                  activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Comparativo de Consumo Ano 1 vs Ano 2 */}
        <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Comparativo Anual de Consumo (Ano 1 vs. Ano 2)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Confronto da quantidade consumida ({unidadeConsumo}) entre os dois ciclos de 12
                meses
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-gray-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
                Ano 1 (Anterior)
              </span>
              <span className="flex items-center gap-1.5 text-gray-900 font-semibold">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: accentColor }} />
                Ano 2 (Recente)
              </span>
            </div>
          </CardHeader>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={comparativoConsumoData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="mes"
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`)}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const row = payload[0].payload
                      return (
                        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5">
                          <p className="font-bold text-gray-300 border-b border-gray-700 pb-1">
                            Consumo: Mês {row.mes.toUpperCase()}
                          </p>
                          <div className="flex justify-between gap-4">
                            <span className="text-gray-400">Ano 1 ({row.ano1Label}):</span>
                            <span className="font-bold tabular-nums">
                              {formatNumberBR(row.ano1Consumo)} {unidadeConsumo}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-teal-400">Ano 2 ({row.ano2Label}):</span>
                            <span className="font-bold tabular-nums text-teal-300">
                              {formatNumberBR(row.ano2Consumo)} {unidadeConsumo}
                            </span>
                          </div>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Bar dataKey="ano1Consumo" name="Ano 1" fill="#9CA3AF" radius={[4, 4, 0, 0]} />
                <Bar dataKey="ano2Consumo" name="Ano 2" fill={accentColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO 2: EVOLUÇÃO DA TARIFA APLICADA (R$/kWh ou R$/m³)                     */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700">
              <CircleDollarSign className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Evolução da Tarifa Aplicada ({rotuloTarifa})
              </h3>
              <p className="text-xs text-gray-500">
                Comportamento do custo unitário efetivo (Valor Total ÷ Consumo do mês) ao longo dos
                24 meses
              </p>
            </div>
          </div>
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 self-start sm:self-auto">
            Tarifa Efetiva Média: {formatCurrencyBRL(mediaTarifaPeriodo)}/{unidadeConsumo}
          </span>
        </div>

        {/* KPI Cards de Tarifa */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Tarifa Máxima */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #DC2626` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Tarifa Mais Alta
              </span>
              <div className="p-2 rounded-lg bg-red-50 text-red-600">
                <TrendingUp className="w-4 h-4 text-red-600" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(maxTarifaPoint?.tarifa || 0)}
                <span className="text-xs font-medium text-gray-500">/{unidadeConsumo}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span className="font-semibold text-red-700">Mês mais oneroso:</span>
                <span>{maxTarifaPoint?.label || '-'}</span>
              </p>
            </div>
          </Card>

          {/* Tarifa Mínima */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #16A34A` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Tarifa Mais Econômica
              </span>
              <div className="p-2 rounded-lg bg-green-50 text-green-600">
                <TrendingDown className="w-4 h-4 text-green-600" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(minTarifaPoint?.tarifa || 0)}
                <span className="text-xs font-medium text-gray-500">/{unidadeConsumo}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span className="font-semibold text-green-700">Mês mais econômico:</span>
                <span>{minTarifaPoint?.label || '-'}</span>
              </p>
            </div>
          </Card>

          {/* Tarifa Média Ponderada */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #D97706` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Tarifa Média do Período
              </span>
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700">
                <Activity className="w-4 h-4 text-amber-700" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(mediaTarifaPeriodo)}
                <span className="text-xs font-medium text-gray-500">/{unidadeConsumo}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Média ponderada pelo consumo total dos 24 meses
              </p>
            </div>
          </Card>
        </div>

        {/* Gráfico da Tarifa Aplicada */}
        <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Trajetória da Tarifa Média Mensal ({rotuloTarifa})
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Impacto de reajustes tarifários, bandeiras e estrutura tarifária na conta mensal
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1 text-red-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                Maior Tarifa
              </span>
              <span className="flex items-center gap-1 text-green-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A]" />
                Menor Tarifa
              </span>
            </div>
          </CardHeader>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthPoints} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickFormatter={(val) => `R$ ${Number(val).toFixed(2)}`}
                  domain={['auto', 'auto']}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const row = payload[0].payload
                      const isMax = row.key === maxTarifaPoint?.key && row.tarifa > 0
                      const isMin = row.key === minTarifaPoint?.key && row.tarifa > 0
                      return (
                        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800">
                          <div className="flex items-center justify-between gap-3 border-b border-gray-700 pb-1">
                            <span className="font-semibold text-gray-200">{row.label}</span>
                            {isMax && (
                              <span className="px-1.5 py-0.5 rounded bg-red-600/80 text-[10px] font-bold">
                                Tarifa Máxima
                              </span>
                            )}
                            {isMin && (
                              <span className="px-1.5 py-0.5 rounded bg-green-600/80 text-[10px] font-bold">
                                Tarifa Mínima
                              </span>
                            )}
                          </div>
                          <p className="font-bold tabular-nums text-amber-300 text-sm">
                            {formatCurrencyBRL(row.tarifa)} / {unidadeConsumo}
                          </p>
                          <div className="text-[11px] text-gray-400 space-y-0.5">
                            <p>Valor total: {formatCurrencyBRL(row.valor)}</p>
                            <p>
                              Consumo apurado: {formatNumberBR(row.consumo)} {unidadeConsumo}
                            </p>
                          </div>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="tarifa"
                  name="Tarifa Unitária"
                  stroke="#D97706"
                  strokeWidth={2.5}
                  dot={<RenderCustomDotTarifa />}
                  activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO 3: ANÁLISE FINANCEIRA (DESEMBOLSO EM REAIS R$)                       */}
      {/* ========================================================================= */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between pb-1 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-50 text-teal-700">
              <BarChart3 className="w-4 h-4 text-teal-700" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Análise Financeira de Desembolso (Reais R$)
              </h3>
              <p className="text-xs text-gray-500">
                Valores totais faturados em Reais, picos e médias históricas de pagamento
              </p>
            </div>
          </div>
        </div>

        {/* Stat Cards Financeiros */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Maior Gasto */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #DC2626` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Maior Gasto
              </span>
              <div className="p-2 rounded-lg bg-red-50 text-red-600">
                <TrendingUp className="w-4 h-4 text-red-600" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(maxPoint?.valor || 0)}
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span className="font-semibold text-red-700">Pico histórico:</span>
                <span>{maxPoint?.label || '-'}</span>
              </p>
            </div>
          </Card>

          {/* Menor Gasto */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid #16A34A` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Menor Gasto
              </span>
              <div className="p-2 rounded-lg bg-green-50 text-green-600">
                <TrendingDown className="w-4 h-4 text-green-600" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(minPoint?.valor || 0)}
              </div>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span className="font-semibold text-green-700">Mínimo apurado:</span>
                <span>{minPoint?.label || '-'}</span>
              </p>
            </div>
          </Card>

          {/* Média Mensal */}
          <Card
            className="p-5 border-[#E5E7EB] bg-white shadow-sm hover:shadow-md transition-all relative overflow-hidden"
            style={{ borderLeft: `5px solid ${accentColor}` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Média Mensal em Reais
              </span>
              <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                <Activity className="w-4 h-4 text-teal-700" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(mediaMensal)}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Total acumulado 24m: {formatCurrencyBRL(totalPeriodo)}
              </p>
            </div>
          </Card>
        </div>

        {/* 24-point Area Chart: Série Histórica em Reais */}
        <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Série Temporal Contínua em Reais (24 Meses)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Linha de tendência em R$ com destaque para o mês de maior e menor gasto
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1 text-red-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                Máxima
              </span>
              <span className="flex items-center gap-1 text-green-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A]" />
                Mínima
              </span>
            </div>
          </CardHeader>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthPoints} margin={{ top: 20, right: 20, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorUtility" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={accentColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={accentColor} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickFormatter={(val) => `R$ ${(val / 1000).toFixed(0)}k`}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const row = payload[0].payload
                      const isMax = row.key === maxPoint?.key && row.valor > 0
                      const isMin = row.key === minPoint?.key && row.valor > 0
                      return (
                        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800">
                          <div className="flex items-center justify-between gap-3 border-b border-gray-700 pb-1">
                            <span className="font-semibold text-gray-200">{row.label}</span>
                            {isMax && (
                              <span className="px-1.5 py-0.5 rounded bg-red-600/80 text-[10px] font-bold">
                                Máxima
                              </span>
                            )}
                            {isMin && (
                              <span className="px-1.5 py-0.5 rounded bg-green-600/80 text-[10px] font-bold">
                                Mínima
                              </span>
                            )}
                          </div>
                          <p className="font-bold tabular-nums text-white text-sm">
                            {formatCurrencyBRL(row.valor)}
                          </p>
                          {row.consumo > 0 && (
                            <p className="text-gray-400 text-[11px]">
                              Consumo: {formatNumberBR(row.consumo)} {unidadeConsumo}
                            </p>
                          )}
                          {row.tarifa > 0 && (
                            <p className="text-amber-400 text-[11px]">
                              Tarifa: {formatCurrencyBRL(row.tarifa)}/{unidadeConsumo}
                            </p>
                          )}
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="valor"
                  name="Gasto Total"
                  stroke={accentColor}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorUtility)"
                  dot={<RenderCustomDotFinanceiro />}
                  activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Side-by-Side Annual Comparison (Ano 1 vs Ano 2 em Reais) */}
        <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Comparativo Anual Financeiro (Ano 1 vs. Ano 2)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Confronto direto dos valores em R$ entre os dois ciclos de 12 meses
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-gray-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
                Ano 1 (Anterior)
              </span>
              <span className="flex items-center gap-1.5 text-gray-900 font-semibold">
                <span className="w-2.5 h-2.5 rounded-sm bg-teal-700" />
                Ano 2 (Recente)
              </span>
            </div>
          </CardHeader>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={comparativoData}
                margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="mes"
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickFormatter={(val) => `R$ ${(val / 1000).toFixed(0)}k`}
                />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const row = payload[0].payload
                      return (
                        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5">
                          <p className="font-bold text-gray-300 border-b border-gray-700 pb-1">
                            Comparativo: Mês {row.mes.toUpperCase()}
                          </p>
                          <div className="flex justify-between gap-4">
                            <span className="text-gray-400">Ano 1 ({row.ano1Label}):</span>
                            <span className="font-bold tabular-nums">
                              {formatCurrencyBRL(row.ano1Valor)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-teal-400">Ano 2 ({row.ano2Label}):</span>
                            <span className="font-bold tabular-nums text-teal-300">
                              {formatCurrencyBRL(row.ano2Valor)}
                            </span>
                          </div>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Bar dataKey="ano1Valor" name="Ano 1" fill="#9CA3AF" radius={[4, 4, 0, 0]} />
                <Bar dataKey="ano2Valor" name="Ano 2" fill="#0F766E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ========================================================================= */}
      {/* SEÇÃO 4: DETALHAMENTO MENSAL COMPLETO (TABELA UNIFICADA)                  */}
      {/* ========================================================================= */}
      <Card className="border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <CardTitle className="text-sm font-bold text-gray-900">
            Detalhamento Mensal Completo (24 Competências)
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Consumo físico apurado ({unidadeConsumo}), tarifa unitária ({rotuloTarifa}), valor total
            faturado e variações mensais
          </CardDescription>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                <th className="py-3 px-4">Mês / Ano</th>
                <th className="py-3 px-4 text-right">Consumo ({unidadeConsumo})</th>
                <th className="py-3 px-4 text-right">Var. Consumo</th>
                <th className="py-3 px-4 text-right">Tarifa ({rotuloTarifa})</th>
                <th className="py-3 px-4 text-right">Valor Total (R$)</th>
                <th className="py-3 px-4 text-right">Var. Valor (%)</th>
                <th className="py-3 px-4 text-center">Classificação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tableRows.map((row) => {
                let rowBgClass = 'hover:bg-gray-50/80 transition-colors'
                if (row.isMax) {
                  rowBgClass = 'bg-amber-50/80 hover:bg-amber-100/70 font-medium'
                } else if (row.isMin) {
                  rowBgClass = 'bg-emerald-50/80 hover:bg-emerald-100/70 font-medium'
                }

                return (
                  <tr key={row.key} className={rowBgClass}>
                    <td className="py-3 px-4 font-semibold text-gray-900">{row.label}</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-700 tabular-nums">
                      {row.consumo > 0 ? formatNumberBR(row.consumo) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      {row.variacaoConsumoPct === 0 ? (
                        <span className="text-gray-400">-</span>
                      ) : row.variacaoConsumoPct > 0 ? (
                        <span className="inline-flex items-center text-red-600 font-semibold gap-0.5">
                          <ArrowUp className="w-3 h-3" />+{row.variacaoConsumoPct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-emerald-600 font-semibold gap-0.5">
                          <ArrowDown className="w-3 h-3" />
                          {row.variacaoConsumoPct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-amber-900 tabular-nums">
                      {row.tarifa > 0 ? formatCurrencyBRL(row.tarifa) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-gray-900 tabular-nums">
                      {formatCurrencyBRL(row.valor)}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      {row.variacaoPct === 0 ? (
                        <span className="text-gray-400">-</span>
                      ) : row.variacaoPct > 0 ? (
                        <span className="inline-flex items-center text-red-600 font-semibold gap-0.5">
                          <ArrowUp className="w-3 h-3" />+{row.variacaoPct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-emerald-600 font-semibold gap-0.5">
                          <ArrowDown className="w-3 h-3" />
                          {row.variacaoPct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {row.isMax && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                          Pico Valor
                        </span>
                      )}
                      {row.isMin && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                          Menor Valor
                        </span>
                      )}
                      {!row.isMax && !row.isMin && (
                        <span className="text-gray-400 text-[11px]">Regular</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
