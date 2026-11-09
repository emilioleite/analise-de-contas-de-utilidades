import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, Loader2, TrendingUp, Coins, Gauge, Percent } from 'lucide-react'
import { formatCurrencyBRL, formatNumberBR, toSafeNumber } from '@/lib/cnpj'
import { TipoUtilidade } from '@/types/entities'
import { gerarRelatorioUtilidadePDF } from '@/services/relatorioUtilidadePdf'
import { useToast } from '@/hooks/use-toast'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts'

export interface MonthDataPoint {
  key: string
  label: string
  consumo: number
  valor: number
  tarifa: number
  consumoConcessionaria?: number
  consumoMercadoLivre?: number
  valorConcessionaria?: number
  valorMercadoLivre?: number
}

export interface UtilidadeSectionData {
  tipoUtilidade: TipoUtilidade
  titulo: string
  subtitulo: string
  icon: React.ElementType
  corTema: string // hex
  corFundoIcone: string
  corBordaIcone: string
  corBadge: string
  unidadeConsumo: string
  rotuloTarifa: string
  gastoTotal: number
  consumoTotal: number
  tarifaMedia: number
  faturasCount: number
  meses: MonthDataPoint[]
  temMercadoLivre?: boolean
  totaisSeries?: {
    concessionaria: { consumo: number; valor: number }
    mercadoLivre: { consumo: number; valor: number }
  }
}

interface UtilidadeSectionProps {
  data: UtilidadeSectionData
  nomeEmpreendimento: string
  periodoTexto: string
}

export function UtilidadeSection({
  data,
  nomeEmpreendimento,
  periodoTexto,
}: UtilidadeSectionProps) {
  const { toast } = useToast()
  const [exportando, setExportando] = useState(false)

  const {
    tipoUtilidade,
    titulo,
    subtitulo,
    icon: Icon,
    corTema,
    corFundoIcone,
    corBordaIcone,
    unidadeConsumo,
    rotuloTarifa,
    gastoTotal,
    consumoTotal,
    tarifaMedia,
    faturasCount,
    meses,
  } = data

  const handleExportarPdf = async () => {
    try {
      setExportando(true)
      await gerarRelatorioUtilidadePDF({
        nomeEmpreendimento,
        periodoCobertura: periodoTexto,
        tipoUtilidade,
        unidadeConsumo,
        rotuloTarifa,
        corTema,
        gastoTotal,
        consumoTotal,
        tarifaMedia,
        mesesComDados: faturasCount,
        meses,
      })

      toast({
        title: `Relatório de ${titulo} exportado!`,
        description: 'O download do PDF foi iniciado com sucesso.',
      })
    } catch (err: any) {
      console.error(`Erro ao exportar PDF de ${titulo}:`, err)
      toast({
        title: 'Erro ao gerar PDF',
        description: err.message || `Falha ao exportar relatório de ${titulo}.`,
        variant: 'destructive',
      })
    } finally {
      setExportando(false)
    }
  }

  const temMercadoLivre = Boolean(data.temMercadoLivre)

  // Tooltip customizada para gráfico de Consumo Físico
  const CustomConsumoTooltip = ({ active, payload, label }: any) => {
    if (active && Array.isArray(payload) && payload.length && payload[0]) {
      const row = payload[0].payload
      return (
        <div className="bg-[#111827] text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800">
          <p className="font-semibold text-gray-200 border-b border-gray-700 pb-1">
            Competência: {label || 'Período'}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-gray-300">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: corTema }} />
              Consumo Total:
            </span>
            <span className="font-bold tabular-nums text-white">
              {formatNumberBR(row.consumo, 2)} {unidadeConsumo}
            </span>
          </div>
          {temMercadoLivre && (
            <div className="pt-1 border-t border-gray-800 space-y-1 text-[11px]">
              <div className="flex justify-between items-center text-amber-300">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                  Concessionária:
                </span>
                <span className="font-semibold tabular-nums">
                  {formatNumberBR(row.consumoConcessionaria || 0, 2)} {unidadeConsumo}
                </span>
              </div>
              <div className="flex justify-between items-center text-purple-300">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
                  Mercado Livre:
                </span>
                <span className="font-semibold tabular-nums">
                  {formatNumberBR(row.consumoMercadoLivre || 0, 2)} {unidadeConsumo}
                </span>
              </div>
            </div>
          )}
        </div>
      )
    }
    return null
  }

  // Tooltip customizada para gráfico de Gasto em R$
  const CustomGastoTooltip = ({ active, payload, label }: any) => {
    if (active && Array.isArray(payload) && payload.length && payload[0]) {
      const row = payload[0].payload
      return (
        <div className="bg-[#111827] text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800">
          <p className="font-semibold text-gray-200 border-b border-gray-700 pb-1">
            Competência: {label || 'Período'}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-gray-300">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: corTema }} />
              Gasto Total:
            </span>
            <span className="font-bold tabular-nums text-emerald-400">
              {formatCurrencyBRL(row.valor)}
            </span>
          </div>
          {temMercadoLivre && (
            <div className="pt-1 border-t border-gray-800 space-y-1 text-[11px]">
              <div className="flex justify-between items-center text-amber-300">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                  Concessionária:
                </span>
                <span className="font-semibold tabular-nums">
                  {formatCurrencyBRL(row.valorConcessionaria || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center text-purple-300">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
                  Mercado Livre:
                </span>
                <span className="font-semibold tabular-nums">
                  {formatCurrencyBRL(row.valorMercadoLivre || 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      )
    }
    return null
  }

  // Tabela invertida (mais recente primeiro)
  const reversedMeses = [...meses].reverse()

  return (
    <Card className="p-6 border-[#E5E7EB] shadow-sm hover:shadow transition-all duration-200 space-y-6">
      {/* Header da Seção: Ícone + Título + Subtítulo + Botão Exportar PDF */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3.5">
          <div className={`p-3 rounded-xl ${corFundoIcone} border ${corBordaIcone} shrink-0`}>
            <Icon className="w-6 h-6" style={{ color: corTema }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight">{titulo}</h3>
              <Badge variant="outline" className={`text-[10px] font-semibold ${data.corBadge}`}>
                {unidadeConsumo}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleExportarPdf}
          disabled={exportando || faturasCount === 0}
          className="h-9 text-xs font-semibold bg-white border-gray-200 hover:bg-gray-50 text-gray-700 shadow-sm flex items-center gap-1.5 self-start sm:self-auto shrink-0"
        >
          {exportando ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: corTema }} />
              <span>Gerando PDF...</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" style={{ color: corTema }} />
              <span>Exportar PDF ({titulo})</span>
            </>
          )}
        </Button>
      </div>

      {/* Grid de 3 KPIs da Utilidade */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* KPI 1: Gasto Total R$ */}
        <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Gasto Total (12m)
            </span>
            <Coins className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
              {formatCurrencyBRL(gastoTotal)}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-gray-400 inline" />
              Desembolso financeiro no período
            </p>
            {temMercadoLivre && data.totaisSeries && (
              <div className="mt-2 pt-2 border-t border-gray-200/70 text-[11px] space-y-0.5">
                <div className="flex justify-between items-center text-amber-800">
                  <span>Concessionária:</span>
                  <span className="font-semibold tabular-nums">
                    {formatCurrencyBRL(data.totaisSeries.concessionaria.valor)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-purple-800">
                  <span>Mercado Livre:</span>
                  <span className="font-semibold tabular-nums">
                    {formatCurrencyBRL(data.totaisSeries.mercadoLivre.valor)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* KPI 2: Consumo Físico Total */}
        <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Consumo Total ({unidadeConsumo})
            </span>
            <Gauge className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
              {formatNumberBR(consumoTotal, 2)}{' '}
              <span className="text-base font-medium text-gray-600">{unidadeConsumo}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
              Volume total apurado
            </p>
            {temMercadoLivre && data.totaisSeries && (
              <div className="mt-2 pt-2 border-t border-gray-200/70 text-[11px] space-y-0.5">
                <div className="flex justify-between items-center text-amber-800">
                  <span>Concessionária:</span>
                  <span className="font-semibold tabular-nums">
                    {formatNumberBR(data.totaisSeries.concessionaria.consumo, 0)} {unidadeConsumo}
                  </span>
                </div>
                <div className="flex justify-between items-center text-purple-800">
                  <span>Mercado Livre:</span>
                  <span className="font-semibold tabular-nums">
                    {formatNumberBR(data.totaisSeries.mercadoLivre.consumo, 0)} {unidadeConsumo}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* KPI 3: Tarifa Média R$/unidade */}
        <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-100 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Tarifa Média Aplicada
            </span>
            <Percent className="w-4 h-4 text-gray-400" />
          </div>
          <div className="mt-2.5">
            <div className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
              {tarifaMedia > 0 ? (
                <>
                  {formatCurrencyBRL(tarifaMedia)}{' '}
                  <span className="text-sm font-medium text-gray-500">/{unidadeConsumo}</span>
                </>
              ) : (
                <span className="text-gray-400 font-normal text-lg">—</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Custo médio por {unidadeConsumo} consumido
            </p>
          </div>
        </div>
      </div>

      {/* Gráficos: Consumo Físico + Gasto R$ lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: Consumo Físico (m³ ou kWh) */}
        <div className="p-4 rounded-xl border border-gray-150 bg-white">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: corTema }} />
                Evolução Mensal do Consumo ({unidadeConsumo})
              </h4>
              <p className="text-[11px] text-gray-500">Quantidade física consumida mês a mês</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {temMercadoLivre && (
                <div className="flex items-center gap-2.5 text-[11px] font-medium mr-1">
                  <span className="flex items-center gap-1 text-amber-700">
                    <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                    Conc.
                  </span>
                  <span className="flex items-center gap-1 text-purple-700">
                    <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                    M. Livre
                  </span>
                </div>
              )}
              <span className="font-semibold tabular-nums text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                {formatNumberBR(consumoTotal, 0)} {unidadeConsumo}
              </span>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={meses} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient
                    id={`gradient-consumo-${tipoUtilidade}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={corTema} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={corTema} stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradient-consumo-conc-dash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradient-consumo-ml-dash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
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
                  tickFormatter={(val) =>
                    val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${Math.round(val)}`
                  }
                />
                <RechartsTooltip content={<CustomConsumoTooltip />} />
                {temMercadoLivre ? (
                  <>
                    <Area
                      type="monotone"
                      dataKey="consumoConcessionaria"
                      name="Concessionária"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#gradient-consumo-conc-dash)"
                      dot={{ r: 2.5, fill: '#F59E0B' }}
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="consumoMercadoLivre"
                      name="Mercado Livre"
                      stroke="#7C3AED"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#gradient-consumo-ml-dash)"
                      dot={{ r: 2.5, fill: '#7C3AED' }}
                      activeDot={{ r: 4 }}
                    />
                  </>
                ) : (
                  <Area
                    type="monotone"
                    dataKey="consumo"
                    stroke={corTema}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill={`url(#gradient-consumo-${tipoUtilidade})`}
                    dot={{ r: 3, fill: corTema }}
                    activeDot={{ r: 5 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Gasto em R$ */}
        <div className="p-4 rounded-xl border border-gray-150 bg-white">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: corTema }} />
                Evolução Mensal do Gasto (R$)
              </h4>
              <p className="text-[11px] text-gray-500">Desembolso financeiro faturado mês a mês</p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {temMercadoLivre && (
                <div className="flex items-center gap-2.5 text-[11px] font-medium mr-1">
                  <span className="flex items-center gap-1 text-amber-700">
                    <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                    Conc.
                  </span>
                  <span className="flex items-center gap-1 text-purple-700">
                    <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                    M. Livre
                  </span>
                </div>
              )}
              <span className="font-semibold tabular-nums text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                {formatCurrencyBRL(gastoTotal)}
              </span>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meses} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                <RechartsTooltip content={<CustomGastoTooltip />} />
                {temMercadoLivre ? (
                  <>
                    <Bar
                      dataKey="valorConcessionaria"
                      fill="#F59E0B"
                      radius={[3, 3, 0, 0]}
                      name="Concessionária (R$)"
                    />
                    <Bar
                      dataKey="valorMercadoLivre"
                      fill="#7C3AED"
                      radius={[3, 3, 0, 0]}
                      name="Mercado Livre (R$)"
                    />
                  </>
                ) : (
                  <Bar dataKey="valor" fill={corTema} radius={[4, 4, 0, 0]} name="Gasto (R$)" />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabela Mensal Resumida da Utilidade */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
            Detalhamento Mensal ({titulo})
          </h4>
          <span className="text-[11px] text-gray-500">
            Últimos 12 meses • Mais recente primeiro
          </span>
        </div>

        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-100/70 text-gray-600 font-semibold uppercase text-[10px] tracking-wider sticky top-0">
              <tr>
                <th className="py-2.5 px-4">Competência</th>
                <th className="py-2.5 px-4 text-right">Consumo Físico ({unidadeConsumo})</th>
                <th className="py-2.5 px-4 text-right">Gasto Total (R$)</th>
                <th className="py-2.5 px-4 text-right">Tarifa Média ({rotuloTarifa})</th>
                <th className="py-2.5 px-4 text-right">Part. %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reversedMeses.map((m) => {
                const part = gastoTotal > 0 ? (m.valor / gastoTotal) * 100 : 0
                const tarifaStr =
                  m.consumo > 0 && m.valor > 0
                    ? `${formatCurrencyBRL(m.valor / m.consumo)}/${unidadeConsumo}`
                    : '—'

                return (
                  <tr key={m.key} className="hover:bg-gray-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-gray-900">{m.label}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-gray-700">
                      {formatNumberBR(m.consumo, 2)} {unidadeConsumo}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-gray-900">
                      {formatCurrencyBRL(m.valor)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">
                      {tarifaStr}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-gray-500">
                      {part.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 font-bold border-t border-gray-200 text-gray-900">
              <tr>
                <td className="py-2.5 px-4 uppercase text-[11px]">Total Período</td>
                <td className="py-2.5 px-4 text-right tabular-nums">
                  {formatNumberBR(consumoTotal, 2)} {unidadeConsumo}
                </td>
                <td className="py-2.5 px-4 text-right tabular-nums">
                  {formatCurrencyBRL(gastoTotal)}
                </td>
                <td className="py-2.5 px-4 text-right tabular-nums">
                  {tarifaMedia > 0 ? `${formatCurrencyBRL(tarifaMedia)}/${unidadeConsumo}` : '—'}
                </td>
                <td className="py-2.5 px-4 text-right">100,0%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Card>
  )
}
