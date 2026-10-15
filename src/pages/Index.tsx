import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import {
  Zap,
  Droplets,
  Flame,
  Coins,
  ArrowUpRight,
  PlusCircle,
  FileText,
  TrendingUp,
  Building2,
  Download,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrencyBRL, toSafeNumber } from '@/lib/cnpj'
import { useCountUp } from '@/hooks/use-count-up'
import { useToast } from '@/hooks/use-toast'
import { gerarRelatorioDashboardPDF } from '@/services/relatorioDashboardPdf'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts'

interface KPICardProps {
  title: string
  value: number
  icon: React.ElementType
  iconColor: string
  bgColor: string
  borderColor: string
  subtitle: string
}

function AnimatedKPICard({
  title,
  value,
  icon: Icon,
  iconColor,
  bgColor,
  borderColor,
  subtitle,
}: KPICardProps) {
  const animatedValue = useCountUp(value, 600)

  return (
    <Card className="p-5 border-[#E5E7EB] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </span>
        <div className={`p-2.5 rounded-xl ${bgColor} border ${borderColor}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
      <div className="mt-3">
        <div className="text-2xl lg:text-[28px] font-bold text-gray-900 tracking-tight tabular-nums">
          {formatCurrencyBRL(animatedValue)}
        </div>
        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <ArrowUpRight className="w-3.5 h-3.5 text-gray-400 inline" />
          {subtitle}
        </p>
      </div>
    </Card>
  )
}

export default function Index() {
  const { user } = useAuth()
  const { faturas, empreendimentos, loading } = useData()
  const { toast } = useToast()

  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState<string>('todos')
  const [exportandoPdf, setExportandoPdf] = useState(false)

  const userName = user?.name ? user.name.split(' ')[0] : 'Gestor'

  // Calculations for last 12 months respecting selectedEmpreendimento filter
  const { total12m, energia12m, agua12m, gas12m, donutData, lineData, topConsumos, periodoTexto } =
    useMemo(() => {
      const emptyResult = {
        total12m: 0,
        energia12m: 0,
        agua12m: 0,
        gas12m: 0,
        donutData: [],
        lineData: [],
        topConsumos: [],
        periodoTexto: 'Sem dados',
      }

      if (!Array.isArray(faturas) || faturas.length === 0) {
        return emptyResult
      }

      // Filtrar por empreendimento se selecionado
      const filteredFaturas =
        selectedEmpreendimento === 'todos'
          ? faturas
          : faturas.filter((f) => f && f.empreendimento === selectedEmpreendimento)

      if (filteredFaturas.length === 0) {
        return {
          ...emptyResult,
          periodoTexto: 'Sem faturas no filtro',
        }
      }

      // Filtrar faturas com data de competência válida
      const validFaturas = filteredFaturas.filter((fat) => {
        if (!fat || !fat.competencia) return false
        const d = new Date(fat.competencia)
        return !isNaN(d.getTime())
      })

      // Se não houver faturas com competência válida, fallback para data atual
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

      let newestDate: Date
      if (validFaturas.length > 0) {
        const sorted = [...validFaturas].sort(
          (a, b) => new Date(b.competencia).getTime() - new Date(a.competencia).getTime(),
        )
        newestDate = new Date(sorted[0].competencia)
      } else {
        newestDate = new Date()
      }

      const cutoffDate = new Date(newestDate)
      cutoffDate.setMonth(cutoffDate.getMonth() - 11)
      cutoffDate.setDate(1)
      cutoffDate.setHours(0, 0, 0, 0)

      let total = 0
      let energia = 0
      let agua = 0
      let gas = 0

      const monthlyMap: Record<
        string,
        {
          monthKey: string
          label: string
          energia: number
          agua: number
          gas: number
          total: number
          date: Date
        }
      > = {}

      for (let i = 11; i >= 0; i--) {
        const d = new Date(newestDate.getFullYear(), newestDate.getMonth() - i, 1)
        const safeMonthIdx = Number.isFinite(d.getMonth()) ? d.getMonth() : 0
        const key = `${d.getFullYear()}-${String(safeMonthIdx + 1).padStart(2, '0')}`
        const label = `${monthNames[safeMonthIdx] || 'mês'}/${String(d.getFullYear()).slice(-2)}`
        monthlyMap[key] = {
          monthKey: key,
          label,
          energia: 0,
          agua: 0,
          gas: 0,
          total: 0,
          date: d,
        }
      }

      // Preencher com faturas válidas
      validFaturas.forEach((fat) => {
        const fDate = new Date(fat.competencia)
        if (isNaN(fDate.getTime())) return

        const val = toSafeNumber(fat.valor_total, 0)
        const key = `${fDate.getFullYear()}-${String(fDate.getMonth() + 1).padStart(2, '0')}`

        if (fDate >= cutoffDate) {
          total += val
          if (fat.tipo_utilidade === 'Energia Elétrica') energia += val
          else if (fat.tipo_utilidade === 'Água e Esgoto') agua += val
          else if (fat.tipo_utilidade === 'Gás') gas += val
        }

        if (monthlyMap[key]) {
          monthlyMap[key].total += val
          if (fat.tipo_utilidade === 'Energia Elétrica') monthlyMap[key].energia += val
          else if (fat.tipo_utilidade === 'Água e Esgoto') monthlyMap[key].agua += val
          else if (fat.tipo_utilidade === 'Gás') monthlyMap[key].gas += val
        }
      })

      const donut = [
        { name: 'Energia Elétrica', value: toSafeNumber(energia, 0), color: '#F59E0B' },
        { name: 'Água e Esgoto', value: toSafeNumber(agua, 0), color: '#0EA5E9' },
        { name: 'Gás', value: toSafeNumber(gas, 0), color: '#14B8A6' },
      ].filter((d) => d.value > 0)

      const lines = Object.values(monthlyMap)

      // Top 5 invoices by value across all utilities (sanitizando expand e valor)
      const top5 = [...filteredFaturas]
        .sort((a, b) => toSafeNumber(b.valor_total, 0) - toSafeNumber(a.valor_total, 0))
        .slice(0, 5)
        .map((fat) => {
          const empNome =
            fat.expand?.empreendimento?.nome ||
            empreendimentos.find((e) => e.id === fat.empreendimento)?.nome ||
            'Empreendimento'

          return {
            id: fat.id || String(Math.random()),
            nome: empNome,
            tipo: fat.tipo_utilidade || 'Utilidade',
            competencia: fat.competencia || '',
            valor: toSafeNumber(fat.valor_total, 0),
          }
        })

      const cutoffMonth = Number.isFinite(cutoffDate.getMonth()) ? cutoffDate.getMonth() : 0
      const newestMonth = Number.isFinite(newestDate.getMonth()) ? newestDate.getMonth() : 0
      const periodoStr = `${monthNames[cutoffMonth] || ''} ${cutoffDate.getFullYear()} — ${monthNames[newestMonth] || ''} ${newestDate.getFullYear()}`

      return {
        total12m: toSafeNumber(total, 0),
        energia12m: toSafeNumber(energia, 0),
        agua12m: toSafeNumber(agua, 0),
        gas12m: toSafeNumber(gas, 0),
        donutData: donut,
        lineData: lines,
        topConsumos: top5,
        periodoTexto: periodoStr,
      }
    }, [faturas, empreendimentos, selectedEmpreendimento])

  // Custom Dark Tooltip for charts (blindado contra valores nulos/indefinidos)
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && Array.isArray(payload) && payload.length) {
      return (
        <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800 z-50">
          <p className="font-semibold text-gray-200 border-b border-gray-700 pb-1">
            {label || 'Período'}
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

  if (!loading && faturas.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Olá, {userName}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Bem-vindo à plataforma de gestão de utilidades da corporação.
          </p>
        </div>

        {/* Empty State */}
        <Card className="p-12 text-center border-dashed border-2 border-gray-200 bg-white">
          <div className="w-16 h-16 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-teal-700" />
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">
            Nenhuma fatura cadastrada ainda
          </h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
            Envie as contas de água, gás e energia elétrica dos seus empreendimentos em PDF, CSV ou
            XLS para acompanhar gastos e apurar consumos.
          </p>
          <Link to="/faturas">
            <Button className="bg-teal-700 hover:bg-teal-800 text-white font-medium shadow-sm">
              <PlusCircle className="w-4 h-4 mr-2" />
              Enviar primeira fatura
            </Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Olá, {userName}
            </h2>
            <Badge
              variant="outline"
              className="text-[11px] font-semibold text-teal-800 bg-teal-50 border-teal-200"
            >
              Dekazen
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Visão consolidada de energia elétrica, água e gás nos últimos 12 meses.
          </p>
        </div>

        {/* Controls: Filtro Empreendimento + Exportar PDF + Enviar Fatura */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Empreendimento */}
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

          {/* Botão Exportar PDF */}
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

                await gerarRelatorioDashboardPDF({
                  nomeEmpreendimento: nomeEmp,
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
                  title: 'Relatório PDF gerado!',
                  description:
                    'O download do relatório do Dashboard Geral foi iniciado com sucesso.',
                })
              } catch (err: any) {
                console.error('Erro ao gerar PDF do dashboard:', err)
                toast({
                  title: 'Erro ao gerar PDF',
                  description: err.message || 'Falha ao construir o documento PDF do dashboard.',
                  variant: 'destructive',
                })
              } finally {
                setExportandoPdf(false)
              }
            }}
            disabled={exportandoPdf || loading || faturas.length === 0}
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

          <Link to="/faturas">
            <Button className="bg-teal-700 hover:bg-teal-800 text-white text-xs h-9 shadow-sm">
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
              Enviar Fatura
            </Button>
          </Link>
        </div>
      </div>

      {/* 4 KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AnimatedKPICard
          title="Total Gasto (12m)"
          value={total12m}
          icon={Coins}
          iconColor="text-teal-700"
          bgColor="bg-teal-50"
          borderColor="border-teal-100"
          subtitle="Consolidado de todas as utilidades"
        />
        <AnimatedKPICard
          title="Energia Elétrica"
          value={energia12m}
          icon={Zap}
          iconColor="text-amber-500 fill-amber-500"
          bgColor="bg-amber-50"
          borderColor="border-amber-100"
          subtitle="Contas de fornecimento elétrico"
        />
        <AnimatedKPICard
          title="Água e Esgoto"
          value={agua12m}
          icon={Droplets}
          iconColor="text-sky-500 fill-sky-500"
          bgColor="bg-sky-50"
          borderColor="border-sky-100"
          subtitle="Saneamento e abastecimento"
        />
        <AnimatedKPICard
          title="Gás Natural/GLP"
          value={gas12m}
          icon={Flame}
          iconColor="text-teal-600 fill-teal-600"
          bgColor="bg-teal-50"
          borderColor="border-teal-100"
          subtitle="Fornecimento canalizado/cilindro"
        />
      </div>

      {/* Charts Grid: Donut + Line */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Donut Chart: Gasto por Utilidade */}
        <Card className="p-5 border-[#E5E7EB] shadow-sm flex flex-col justify-between">
          <CardHeader className="p-0 mb-4">
            <CardTitle className="text-sm font-bold text-gray-900">
              Gasto por Utilidade (12 meses)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Distribuição percentual dos custos operacionais
            </CardDescription>
          </CardHeader>
          <div className="h-64 relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={95}
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
              <span className="text-[10px] uppercase font-bold text-gray-400">Total 12m</span>
              <span className="text-xs font-bold text-gray-900 tabular-nums">
                {formatCurrencyBRL(total12m)}
              </span>
            </div>
          </div>
          {/* Legend */}
          <div className="pt-4 border-t border-gray-100 flex flex-col gap-2">
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
        </Card>

        {/* Multi-line Chart: Evolução Mensal (12 meses) */}
        <Card className="p-5 border-[#E5E7EB] shadow-sm lg:col-span-2 flex flex-col justify-between">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Evolução Mensal (12 Meses)
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Trajetória dos gastos por utilidade mês a mês
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
                Energia
              </span>
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0EA5E9]" />
                Água
              </span>
              <span className="flex items-center gap-1 text-gray-600">
                <span className="w-2.5 h-2.5 rounded-full bg-[#14B8A6]" />
                Gás
              </span>
            </div>
          </CardHeader>
          <div className="h-72 w-full">
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
                <RechartsTooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="energia"
                  name="Energia Elétrica"
                  stroke="#F59E0B"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#F59E0B' }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="agua"
                  name="Água e Esgoto"
                  stroke="#0EA5E9"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#0EA5E9' }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="gas"
                  name="Gás"
                  stroke="#14B8A6"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#14B8A6' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Horizontal Bar Chart: Maiores Consumos (Top 5) */}
      <Card className="p-5 border-[#E5E7EB] shadow-sm">
        <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-gray-900">
              Maiores Contas Registradas (Top 5)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Faturas com maior desembolso financeiro
            </CardDescription>
          </div>
          <Link
            to="/analise-24-meses"
            className="text-xs text-teal-700 hover:underline font-semibold flex items-center"
          >
            Ver análise completa de 24 meses
            <TrendingUp className="w-3.5 h-3.5 ml-1" />
          </Link>
        </CardHeader>
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topConsumos}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
              <XAxis
                type="number"
                stroke="#9CA3AF"
                fontSize={11}
                tickFormatter={(v) => `R$ ${v}`}
              />
              <YAxis
                type="category"
                dataKey="nome"
                stroke="#4B5563"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: '#E5E7EB' }}
                width={140}
              />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (active && Array.isArray(payload) && payload.length && payload[0]?.payload) {
                    const row = payload[0].payload
                    const safeValor = toSafeNumber(row?.valor, 0)
                    const nome = row?.nome || 'Empreendimento'
                    const tipo = row?.tipo || 'Utilidade'
                    return (
                      <div className="bg-[#111827] text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1">
                        <p className="font-bold">{nome}</p>
                        <p className="text-gray-300">
                          Utilidade: <span className="text-white font-medium">{tipo}</span>
                        </p>
                        <p className="text-teal-400 font-bold tabular-nums">
                          {formatCurrencyBRL(safeValor)}
                        </p>
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Bar dataKey="valor" name="Valor da Fatura" fill="#0F766E" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}
