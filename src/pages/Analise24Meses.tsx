import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { TipoUtilidade } from '@/types/entities'
import { formatCurrencyBRL, formatNumberBR } from '@/lib/cnpj'
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
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts'

export default function Analise24Meses() {
  const { faturas } = useData()
  const [activeTab, setActiveTab] = useState<'Total Geral' | TipoUtilidade>('Total Geral')

  // Process data over 24 months
  const {
    coverageText,
    monthPoints,
    maxPoint,
    minPoint,
    mediaMensal,
    comparativoData,
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
        comparativoData: [],
        tableRows: [],
        accentColor: '#0F766E',
      }
    }

    // Filter faturas by activeTab if not 'Total Geral'
    const relevantFaturas =
      activeTab === 'Total Geral' ? faturas : faturas.filter((f) => f.tipo_utilidade === activeTab)

    // Determine available date range
    const sorted = [...faturas].sort(
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

    // Build exactly 24 monthly slots leading up to newestDate
    const slots: {
      key: string
      label: string
      shortMonth: string
      date: Date
      valor: number
      consumo: number
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
        date: d,
        valor: 0,
        consumo: 0,
      })
    }

    // Populate values
    relevantFaturas.forEach((fat) => {
      const d = new Date(fat.competencia)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const found = slots.find((s) => s.key === key)
      if (found) {
        found.valor += Number(fat.valor_total) || 0
        found.consumo += Number(fat.consumo) || 0
      }
    })

    // Find max, min, average
    let max = slots[0]
    let min = slots[0]
    let sum = 0
    let countWithData = 0

    slots.forEach((s) => {
      sum += s.valor
      if (s.valor > 0) countWithData++
      if (s.valor > max.valor) max = s
      if (s.valor > 0 && (min.valor === 0 || s.valor < min.valor)) min = s
    })

    const avg = countWithData > 0 ? sum / 24 : 0

    // Group into Ano 1 (first 12 months) vs Ano 2 (last 12 months) for side-by-side bar chart
    const ano1 = slots.slice(0, 12)
    const ano2 = slots.slice(12, 24)

    const comparativo = ano1.map((item, idx) => {
      const matchAno2 = ano2[idx]
      return {
        mes: item.shortMonth,
        ano1Label: item.label,
        ano1Valor: Math.round(item.valor * 100) / 100,
        ano2Label: matchAno2 ? matchAno2.label : '',
        ano2Valor: matchAno2 ? Math.round(matchAno2.valor * 100) / 100 : 0,
      }
    })

    // Monthly table rows with % variation vs previous month (newest first)
    const reversedSlots = [...slots].reverse()
    const tableData = reversedSlots.map((item, index) => {
      // previous month chronologically is reversedSlots[index + 1]
      const prev = reversedSlots[index + 1]
      let variacaoPct = 0
      if (prev && prev.valor > 0) {
        variacaoPct = ((item.valor - prev.valor) / prev.valor) * 100
      }

      const isMax = item.key === max?.key && item.valor > 0
      const isMin = item.key === min?.key && item.valor > 0

      return {
        ...item,
        variacaoPct,
        isMax,
        isMin,
      }
    })

    // Pick accent color for the utility
    let color = '#0F766E'
    if (activeTab === 'Energia Elétrica') color = '#F59E0B'
    if (activeTab === 'Água e Esgoto') color = '#0EA5E9'
    if (activeTab === 'Gás') color = '#14B8A6'

    return {
      coverageText: coverage,
      monthPoints: slots,
      maxPoint: max,
      minPoint: min,
      mediaMensal: avg,
      comparativoData: comparativo,
      tableRows: tableData,
      accentColor: color,
    }
  }, [faturas, activeTab])

  // Custom Dot for Area Chart to mark Maximum (#DC2626) and Minimum (#16A34A)
  const RenderCustomDot = (props: any) => {
    const { cx, cy, payload } = props
    if (!payload) return null

    const isMax = payload.key === maxPoint?.key && payload.valor > 0
    const isMin = payload.key === minPoint?.key && payload.valor > 0

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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Análise — 24 Meses
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Comportamento histórico, sazonalidade, máximas e mínimas por utilidade.
          </p>
        </div>

        {/* Coverage range badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-teal-700" />
          <span>Cobertura: {coverageText}</span>
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
            Gás
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Stat Cards Row (3 Cards with Left Border Stripe) */}
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
              Média Mensal
            </span>
            <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
              <Activity className="w-4 h-4 text-teal-700" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-gray-900 tabular-nums">
              {formatCurrencyBRL(mediaMensal)}
            </div>
            <p className="text-xs text-gray-500 mt-1">Média ponderada nos 24 meses analisados</p>
          </div>
        </Card>
      </div>

      {/* 24-point Area Chart: Série Histórica */}
      <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-gray-900">
              Série Temporal Contínua (24 Meses)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Linha de tendência com destaque para o mês de maior e menor gasto
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
                            Consumo: {formatNumberBR(row.consumo)}
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
                dot={<RenderCustomDot />}
                activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Side-by-Side Annual Comparison (Ano 1 vs Ano 2) */}
      <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-gray-900">
              Comparativo Anual (Ano 1 vs. Ano 2)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Confronto direto dos mesmos meses entre os dois ciclos de 12 meses
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
            <BarChart data={comparativoData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
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

      {/* Monthly Detail Table */}
      <Card className="border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <CardTitle className="text-sm font-bold text-gray-900">
            Detalhamento Mensal Completo
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Variação percentual mês a mês; destaque em âmbar para máxima e verde para mínima
          </CardDescription>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                <th className="py-3 px-4">Mês / Ano</th>
                <th className="py-3 px-4">Consumo Apurado</th>
                <th className="py-3 px-4 text-right">Valor Total (R$)</th>
                <th className="py-3 px-4 text-right">Variação vs Mês Anterior</th>
                <th className="py-3 px-4 text-center">Classificação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tableRows.map((row) => {
                // Background color according to spec:
                // "linha do maior valor com fundo âmbar claro e do menor com fundo verde claro"
                let rowBgClass = 'hover:bg-gray-50/80 transition-colors'
                if (row.isMax) {
                  rowBgClass = 'bg-amber-50/80 hover:bg-amber-100/70 font-medium'
                } else if (row.isMin) {
                  rowBgClass = 'bg-emerald-50/80 hover:bg-emerald-100/70 font-medium'
                }

                return (
                  <tr key={row.key} className={rowBgClass}>
                    <td className="py-3 px-4 font-semibold text-gray-900">{row.label}</td>
                    <td className="py-3 px-4 text-gray-600 tabular-nums">
                      {row.consumo > 0 ? formatNumberBR(row.consumo) : '-'}
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
                          Pico (Máxima)
                        </span>
                      )}
                      {row.isMin && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                          Menor Valor (Mínima)
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
