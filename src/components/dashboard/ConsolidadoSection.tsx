import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Download,
  Loader2,
  TrendingUp,
  PieChart as PieIcon,
  Layers,
  Coins,
  Zap,
  Droplets,
  Flame,
} from 'lucide-react'
import { formatCurrencyBRL, toSafeNumber } from '@/lib/cnpj'
import { gerarRelatorioDashboardPDF, DashboardPdfData } from '@/services/relatorioDashboardPdf'
import { useToast } from '@/hooks/use-toast'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts'

export interface ConsolidadoSectionProps {
  total12m: number
  energia12m: number
  agua12m: number
  gas12m: number
  donutData: Array<{ name: string; value: number; color: string }>
  lineData: Array<{
    label: string
    energia: number
    agua: number
    gas: number
    total: number
  }>
  topConsumos: Array<{
    id: string
    nome: string
    tipo: string
    competencia: string
    valor: number
  }>
  nomeEmpreendimento: string
  periodoTexto: string
  disabled?: boolean
}

export function ConsolidadoSection({
  total12m,
  energia12m,
  agua12m,
  gas12m,
  donutData,
  lineData,
  topConsumos,
  nomeEmpreendimento,
  periodoTexto,
  disabled = false,
}: ConsolidadoSectionProps) {
  const { toast } = useToast()
  const [exportando, setExportando] = useState(false)

  const handleExportarPdf = async () => {
    try {
      setExportando(true)
      await gerarRelatorioDashboardPDF({
        nomeEmpreendimento,
        periodoCobertura: periodoTexto,
        total12m,
        energia12m,
        agua12m,
        gas12m,
        donutData,
        lineData,
        topConsumos,
      })

      toast({
        title: 'Relatório Consolidado exportado!',
        description: 'O download do relatório consolidado (R$) foi iniciado com sucesso.',
      })
    } catch (err: any) {
      console.error('Erro ao gerar PDF consolidado:', err)
      toast({
        title: 'Erro ao gerar PDF',
        description: err.message || 'Falha ao gerar relatório consolidado em PDF.',
        variant: 'destructive',
      })
    } finally {
      setExportando(false)
    }
  }

  // Tooltip customizada para Evolução Mensal Consolidada
  const CustomLineTooltip = ({ active, payload, label }: any) => {
    if (active && Array.isArray(payload) && payload.length) {
      return (
        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800 z-50">
          <p className="font-semibold text-gray-200 border-b border-gray-700 pb-1">
            Competência: {label || 'Período'}
          </p>
          {payload.map((entry: any, index: number) => {
            if (!entry) return null
            const name = entry.name || 'Valor'
            const color = entry.color || '#14B8A6'
            const val = toSafeNumber(entry.value, 0)
            return (
              <div key={`item-${index}`} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-gray-300">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  {name}:
                </span>
                <span className="font-bold tabular-nums text-white">{formatCurrencyBRL(val)}</span>
              </div>
            )
          })}
        </div>
      )
    }
    return null
  }

  return (
    <Card className="p-6 border-[#E5E7EB] shadow-sm hover:shadow transition-all duration-200 space-y-6 bg-white">
      {/* Header da Seção Consolidada */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 shrink-0">
            <Coins className="w-6 h-6 text-teal-700" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">
                Análise Consolidada (R$)
              </h3>
              <Badge
                variant="outline"
                className="text-[10px] font-semibold text-teal-800 bg-teal-50 border-teal-200"
              >
                Gasto Global
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Visão somada de todas as utilidades (Energia + Água + Gás) em Reais (R$)
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleExportarPdf}
          disabled={exportando || disabled || total12m === 0}
          className="h-9 text-xs font-semibold bg-white border-gray-200 hover:bg-gray-50 text-gray-700 shadow-sm flex items-center gap-1.5 self-start sm:self-auto shrink-0"
        >
          {exportando ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700" />
              <span>Gerando PDF Consolidado...</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5 text-teal-700" />
              <span>Exportar PDF (Consolidado)</span>
            </>
          )}
        </Button>
      </div>

      {/* Grid de KPIs Consolidados */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Consolidado */}
        <div className="p-4 rounded-xl bg-teal-50/60 border border-teal-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-900">
              Gasto Total Consolidado
            </span>
            <Coins className="w-4 h-4 text-teal-700" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-teal-950 tabular-nums tracking-tight">
              {formatCurrencyBRL(total12m)}
            </div>
            <p className="text-[11px] text-teal-700 mt-0.5">100% dos desembolsos de utilidades</p>
          </div>
        </div>

        {/* Parcela Energia */}
        <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
              Energia Elétrica
            </span>
            <Zap className="w-4 h-4 text-amber-600 fill-amber-600" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
              {formatCurrencyBRL(energia12m)}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {total12m > 0 ? ((energia12m / total12m) * 100).toFixed(1) : 0}% do total consolidado
            </p>
          </div>
        </div>

        {/* Parcela Água */}
        <div className="p-4 rounded-xl bg-sky-50/50 border border-sky-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-900">
              Água e Esgoto
            </span>
            <Droplets className="w-4 h-4 text-sky-600 fill-sky-600" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
              {formatCurrencyBRL(agua12m)}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {total12m > 0 ? ((agua12m / total12m) * 100).toFixed(1) : 0}% do total consolidado
            </p>
          </div>
        </div>

        {/* Parcela Gás */}
        <div className="p-4 rounded-xl bg-teal-50/40 border border-teal-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-900">
              Gás Natural/GLP
            </span>
            <Flame className="w-4 h-4 text-teal-600 fill-teal-600" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
              {formatCurrencyBRL(gas12m)}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {total12m > 0 ? ((gas12m / total12m) * 100).toFixed(1) : 0}% do total consolidado
            </p>
          </div>
        </div>
      </div>

      {/* Gráficos Consolidados: Composição (Donut) + Evolução Mensal (Soma Total + Linhas) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de Composição (Pizza / Donut) */}
        <div className="p-4 rounded-xl border border-gray-150 bg-white flex flex-col justify-between">
          <div className="mb-2">
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
              <PieIcon className="w-3.5 h-3.5 text-teal-700" />
              Composição dos Gastos (%)
            </h4>
            <p className="text-[11px] text-gray-500">
              Participação de cada utilidade no montante consolidado
            </p>
          </div>

          <div className="h-56 relative flex items-center justify-center my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && Array.isArray(payload) && payload.length && payload[0]) {
                      const data = payload[0]
                      const safeVal = toSafeNumber(data.value, 0)
                      const pct = total12m > 0 ? ((safeVal / total12m) * 100).toFixed(1) : '0'
                      return (
                        <div className="bg-[#111827] text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1">
                          <p className="font-semibold">{data.name || 'Utilidade'}</p>
                          <p className="text-gray-300 tabular-nums">
                            {formatCurrencyBRL(safeVal)} ({pct}%)
                          </p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[9px] uppercase font-bold text-gray-400">Total 12m</span>
              <span className="text-xs font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(total12m)}
              </span>
            </div>
          </div>

          {/* Legenda do Donut */}
          <div className="pt-3 border-t border-gray-100 flex flex-col gap-1.5">
            {donutData.map((item) => {
              const pct = total12m > 0 ? ((item.value / total12m) * 100).toFixed(1) : 0
              return (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-700 font-medium">{item.name}</span>
                  </div>
                  <div className="text-right tabular-nums">
                    <span className="text-gray-900 font-bold">{formatCurrencyBRL(item.value)}</span>
                    <span className="text-gray-400 ml-1.5">({pct}%)</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Gráfico de Evolução Mensal Consolidada em R$ */}
        <div className="p-4 rounded-xl border border-gray-150 bg-white lg:col-span-2 flex flex-col justify-between">
          <div className="mb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-teal-700" />
                Evolução Mensal Consolidada em R$
              </h4>
              <p className="text-[11px] text-gray-500">
                Soma global e trajetórias mensais de cada utilidade
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-teal-800 font-semibold">
                <span className="w-3 h-1 rounded-full bg-teal-700" />
                Total Geral
              </span>
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                Energia
              </span>
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-2 h-2 rounded-full bg-[#0EA5E9]" />
                Água
              </span>
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-2 h-2 rounded-full bg-[#14B8A6]" />
                Gás
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="label"
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
                <RechartsTooltip content={<CustomLineTooltip />} />
                {/* Linha Total Consolidada */}
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total Consolidado"
                  stroke="#0F766E"
                  strokeWidth={3}
                  dot={{ r: 3.5, fill: '#0F766E' }}
                  activeDot={{ r: 6 }}
                />
                {/* Linha Energia */}
                <Line
                  type="monotone"
                  dataKey="energia"
                  name="Energia Elétrica"
                  stroke="#F59E0B"
                  strokeWidth={1.8}
                  strokeDasharray="4 2"
                  dot={false}
                />
                {/* Linha Água */}
                <Line
                  type="monotone"
                  dataKey="agua"
                  name="Água e Esgoto"
                  stroke="#0EA5E9"
                  strokeWidth={1.8}
                  strokeDasharray="4 2"
                  dot={false}
                />
                {/* Linha Gás */}
                <Line
                  type="monotone"
                  dataKey="gas"
                  name="Gás"
                  stroke="#14B8A6"
                  strokeWidth={1.8}
                  strokeDasharray="4 2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  )
}
