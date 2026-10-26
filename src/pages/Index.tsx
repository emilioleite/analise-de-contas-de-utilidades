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
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { getFaturaConsumoReal } from '@/lib/consumoTarifa'
import { useCountUp } from '@/hooks/use-count-up'
import { useToast } from '@/hooks/use-toast'
import { gerarRelatorioDashboardPDF } from '@/services/relatorioDashboardPdf'
import {
  UtilidadeSection,
  UtilidadeSectionData,
  MonthDataPoint,
} from '@/components/dashboard/UtilidadeSection'
import { ConsolidadoSection } from '@/components/dashboard/ConsolidadoSection'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
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
  const { user, isLoading } = useAuth()
  const { faturas, empreendimentos, loading } = useData()
  const { toast } = useToast()

  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState<string>('todos')
  const [exportandoPdfGeral, setExportandoPdfGeral] = useState(false)

  const userName = user?.name ? user.name.trim().split(/\s+/)[0] : 'Colaborador'

  // Nome do empreendimento formatado
  const nomeEmpSelecionado = useMemo(() => {
    if (selectedEmpreendimento === 'todos') {
      return 'Todos os Empreendimentos'
    }
    const found = empreendimentos.find((e) => e.id === selectedEmpreendimento)
    return found ? found.nome : 'Empreendimento Selecionado'
  }, [selectedEmpreendimento, empreendimentos])

  // Calculations for last 12 months respecting selectedEmpreendimento filter
  const {
    total12m,
    energia12m,
    agua12m,
    gas12m,
    consumoEnergiaTotal,
    consumoAguaTotal,
    consumoGasTotal,
    secaoAgua,
    secaoGas,
    secaoEnergia,
    donutData,
    lineData,
    topConsumos,
    periodoTexto,
    hasFilteredFaturas,
  } = useMemo(() => {
    const emptyResult = {
      total12m: 0,
      energia12m: 0,
      agua12m: 0,
      gas12m: 0,
      consumoEnergiaTotal: 0,
      consumoAguaTotal: 0,
      consumoGasTotal: 0,
      secaoAgua: null as UtilidadeSectionData | null,
      secaoGas: null as UtilidadeSectionData | null,
      secaoEnergia: null as UtilidadeSectionData | null,
      donutData: [] as Array<{ name: string; value: number; color: string }>,
      lineData: [] as Array<{
        label: string
        energia: number
        agua: number
        gas: number
        total: number
      }>,
      topConsumos: [] as Array<{
        id: string
        nome: string
        tipo: string
        competencia: string
        valor: number
      }>,
      periodoTexto: 'Sem dados',
      hasFilteredFaturas: false,
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

    // Mapa mensal consolidado
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

    // Mapas mensais por utilidade
    const aguaMonthlyMap: Record<string, MonthDataPoint> = {}
    const gasMonthlyMap: Record<string, MonthDataPoint> = {}
    const energiaMonthlyMap: Record<string, MonthDataPoint> = {}

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

      aguaMonthlyMap[key] = {
        key,
        label,
        consumo: 0,
        valor: 0,
        tarifa: 0,
      }

      gasMonthlyMap[key] = {
        key,
        label,
        consumo: 0,
        valor: 0,
        tarifa: 0,
      }

      energiaMonthlyMap[key] = {
        key,
        label,
        consumo: 0,
        valor: 0,
        tarifa: 0,
      }
    }

    let total = 0
    let energia = 0
    let agua = 0
    let gas = 0

    let cEnergiaTotal = 0
    let cAguaTotal = 0
    let cGasTotal = 0

    let countAgua = 0
    let countGas = 0
    let countEnergia = 0

    // Preencher com faturas válidas
    validFaturas.forEach((fat) => {
      const fDate = new Date(fat.competencia)
      if (isNaN(fDate.getTime())) return

      const val = toSafeNumber(fat.valor_total, 0)
      const realConsumo = getFaturaConsumoReal(fat)
      const consumoFisico = toSafeNumber(realConsumo?.consumo, 0)
      const key = `${fDate.getFullYear()}-${String(fDate.getMonth() + 1).padStart(2, '0')}`

      if (fDate >= cutoffDate) {
        total += val
        if (fat.tipo_utilidade === 'Energia Elétrica') {
          energia += val
          cEnergiaTotal += consumoFisico
          countEnergia++
        } else if (fat.tipo_utilidade === 'Água e Esgoto') {
          agua += val
          cAguaTotal += consumoFisico
          countAgua++
        } else if (fat.tipo_utilidade === 'Gás') {
          gas += val
          cGasTotal += consumoFisico
          countGas++
        }
      }

      // Preenchimento mensal consolidado
      if (monthlyMap[key]) {
        monthlyMap[key].total += val
        if (fat.tipo_utilidade === 'Energia Elétrica') {
          monthlyMap[key].energia += val
        } else if (fat.tipo_utilidade === 'Água e Esgoto') {
          monthlyMap[key].agua += val
        } else if (fat.tipo_utilidade === 'Gás') {
          monthlyMap[key].gas += val
        }
      }

      // Preenchimento mensal por utilidade
      if (fat.tipo_utilidade === 'Água e Esgoto' && aguaMonthlyMap[key]) {
        aguaMonthlyMap[key].valor += val
        aguaMonthlyMap[key].consumo += consumoFisico
      } else if (fat.tipo_utilidade === 'Gás' && gasMonthlyMap[key]) {
        gasMonthlyMap[key].valor += val
        gasMonthlyMap[key].consumo += consumoFisico
      } else if (fat.tipo_utilidade === 'Energia Elétrica' && energiaMonthlyMap[key]) {
        energiaMonthlyMap[key].valor += val
        energiaMonthlyMap[key].consumo += consumoFisico
      }
    })

    // Calcular tarifas médias mensais
    Object.values(aguaMonthlyMap).forEach((m) => {
      m.tarifa = m.consumo > 0 && m.valor > 0 ? m.valor / m.consumo : 0
    })
    Object.values(gasMonthlyMap).forEach((m) => {
      m.tarifa = m.consumo > 0 && m.valor > 0 ? m.valor / m.consumo : 0
    })
    Object.values(energiaMonthlyMap).forEach((m) => {
      m.tarifa = m.consumo > 0 && m.valor > 0 ? m.valor / m.consumo : 0
    })

    // Construção das 3 seções estruturadas
    const secaoAguaData: UtilidadeSectionData = {
      tipoUtilidade: 'Água e Esgoto',
      titulo: 'Água e Esgoto',
      subtitulo: 'Abastecimento público e saneamento (m³ e R$)',
      icon: Droplets,
      corTema: '#0EA5E9',
      corFundoIcone: 'bg-sky-50',
      corBordaIcone: 'border-sky-200',
      corBadge: 'text-sky-800 bg-sky-50 border-sky-200',
      unidadeConsumo: 'm³',
      rotuloTarifa: 'R$/m³',
      gastoTotal: toSafeNumber(agua, 0),
      consumoTotal: toSafeNumber(cAguaTotal, 0),
      tarifaMedia: cAguaTotal > 0 ? toSafeNumber(agua / cAguaTotal, 0) : 0,
      faturasCount: countAgua,
      meses: Object.values(aguaMonthlyMap),
    }

    const secaoGasData: UtilidadeSectionData = {
      tipoUtilidade: 'Gás',
      titulo: 'Gás Natural',
      subtitulo: 'Gás canalizado / GLP cilindro (m³ e R$)',
      icon: Flame,
      corTema: '#14B8A6',
      corFundoIcone: 'bg-teal-50',
      corBordaIcone: 'border-teal-200',
      corBadge: 'text-teal-800 bg-teal-50 border-teal-200',
      unidadeConsumo: 'm³',
      rotuloTarifa: 'R$/m³',
      gastoTotal: toSafeNumber(gas, 0),
      consumoTotal: toSafeNumber(cGasTotal, 0),
      tarifaMedia: cGasTotal > 0 ? toSafeNumber(gas / cGasTotal, 0) : 0,
      faturasCount: countGas,
      meses: Object.values(gasMonthlyMap),
    }

    const secaoEnergiaData: UtilidadeSectionData = {
      tipoUtilidade: 'Energia Elétrica',
      titulo: 'Energia Elétrica',
      subtitulo: 'Fornecimento elétrico de concessionária (kWh e R$)',
      icon: Zap,
      corTema: '#F59E0B',
      corFundoIcone: 'bg-amber-50',
      corBordaIcone: 'border-amber-200',
      corBadge: 'text-amber-800 bg-amber-50 border-amber-200',
      unidadeConsumo: 'kWh',
      rotuloTarifa: 'R$/kWh',
      gastoTotal: toSafeNumber(energia, 0),
      consumoTotal: toSafeNumber(cEnergiaTotal, 0),
      tarifaMedia: cEnergiaTotal > 0 ? toSafeNumber(energia / cEnergiaTotal, 0) : 0,
      faturasCount: countEnergia,
      meses: Object.values(energiaMonthlyMap),
    }

    const donut = [
      { name: 'Energia Elétrica', value: toSafeNumber(energia, 0), color: '#F59E0B' },
      { name: 'Água e Esgoto', value: toSafeNumber(agua, 0), color: '#0EA5E9' },
      { name: 'Gás', value: toSafeNumber(gas, 0), color: '#14B8A6' },
    ].filter((d) => d.value > 0)

    const lines = Object.values(monthlyMap)

    // Top 5 faturas de maior impacto
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
      consumoEnergiaTotal: toSafeNumber(cEnergiaTotal, 0),
      consumoAguaTotal: toSafeNumber(cAguaTotal, 0),
      consumoGasTotal: toSafeNumber(cGasTotal, 0),
      secaoAgua: secaoAguaData,
      secaoGas: secaoGasData,
      secaoEnergia: secaoEnergiaData,
      donutData: donut,
      lineData: lines,
      topConsumos: top5,
      periodoTexto: periodoStr,
      hasFilteredFaturas: true,
    }
  }, [faturas, empreendimentos, selectedEmpreendimento])

  // Empty State geral
  if (!loading && faturas.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Olá, {isLoading ? '...' : userName}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Bem-vindo à plataforma de gestão de utilidades da corporação.
          </p>
        </div>

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
    <div className="space-y-8">
      {/* Header Greeting & Controles Globais */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Olá, {isLoading ? '...' : userName}
            </h2>
            <Badge
              variant="outline"
              className="text-[11px] font-semibold text-teal-800 bg-teal-50 border-teal-200"
            >
              Dekazen
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Painel Executivo: seções dedicadas por utilidade (quantidade e R$) e análise
            consolidada.
          </p>
        </div>

        {/* Controls: Filtro Empreendimento + Exportar PDF Geral + Enviar Fatura */}
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

          {/* Botão Exportar PDF Geral (visão executiva completa) */}
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                setExportandoPdfGeral(true)
                await gerarRelatorioDashboardPDF({
                  nomeEmpreendimento: nomeEmpSelecionado,
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
                  title: 'Relatório Executivo Geral gerado!',
                  description:
                    'O download do relatório consolidado com maiores faturas foi iniciado com sucesso.',
                })
              } catch (err: any) {
                console.error('Erro ao gerar PDF do dashboard:', err)
                toast({
                  title: 'Erro ao gerar PDF',
                  description: err.message || 'Falha ao construir o documento PDF do dashboard.',
                  variant: 'destructive',
                })
              } finally {
                setExportandoPdfGeral(false)
              }
            }}
            disabled={exportandoPdfGeral || loading || faturas.length === 0}
            className="h-9 text-xs font-semibold bg-white border-gray-200 hover:bg-gray-50 text-gray-700 shadow-sm flex items-center gap-1.5"
          >
            {exportandoPdfGeral ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700" />
                <span>Gerando PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-teal-700" />
                <span>Exportar Dashboard Completo</span>
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

      {/* 4 Cards de Visão Rápida Superior */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AnimatedKPICard
          title="Total Consolidado (12m)"
          value={total12m}
          icon={Coins}
          iconColor="text-teal-700"
          bgColor="bg-teal-50"
          borderColor="border-teal-100"
          subtitle="Soma de todas as utilidades"
        />
        <AnimatedKPICard
          title="Água e Esgoto"
          value={agua12m}
          icon={Droplets}
          iconColor="text-sky-500 fill-sky-500"
          bgColor="bg-sky-50"
          borderColor="border-sky-100"
          subtitle="Abastecimento e saneamento"
        />
        <AnimatedKPICard
          title="Gás Natural / GLP"
          value={gas12m}
          icon={Flame}
          iconColor="text-teal-600 fill-teal-600"
          bgColor="bg-teal-50"
          borderColor="border-teal-100"
          subtitle="Gás canalizado / cilindros"
        />
        <AnimatedKPICard
          title="Energia Elétrica"
          value={energia12m}
          icon={Zap}
          iconColor="text-amber-500 fill-amber-500"
          bgColor="bg-amber-50"
          borderColor="border-amber-100"
          subtitle="Concessionária de energia"
        />
      </div>

      {/* =========================================================================
          REQUISITO 1: SEÇÕES DEDICADAS POR UTILIDADE COM EXPORTAÇÃO INDIVIDUAL
          1. Água e Esgoto
          2. Gás Natural
          3. Energia Elétrica
         ========================================================================= */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-gray-200 pb-2">
          <div>
            <h3 className="text-base font-bold text-gray-900 tracking-tight">
              Análises Dedicadas por Utilidade
            </h3>
            <p className="text-xs text-gray-500">
              Métricas exclusivas, evolução física e financeira, tabela mensal e exportação de PDF
              individual por utilidade.
            </p>
          </div>
        </div>

        {/* 1. SEÇÃO: ÁGUA E ESGOTO */}
        {secaoAgua && (
          <UtilidadeSection
            data={secaoAgua}
            nomeEmpreendimento={nomeEmpSelecionado}
            periodoTexto={periodoTexto}
          />
        )}

        {/* 2. SEÇÃO: GÁS NATURAL */}
        {secaoGas && (
          <UtilidadeSection
            data={secaoGas}
            nomeEmpreendimento={nomeEmpSelecionado}
            periodoTexto={periodoTexto}
          />
        )}

        {/* 3. SEÇÃO: ENERGIA ELÉTRICA */}
        {secaoEnergia && (
          <UtilidadeSection
            data={secaoEnergia}
            nomeEmpreendimento={nomeEmpSelecionado}
            periodoTexto={periodoTexto}
          />
        )}
      </div>

      {/* =========================================================================
          REQUISITO 3: ANÁLISE CONSOLIDADA EM R$ NO FINAL DA TELA
          - Gasto total consolidado do período (R$)
          - Gráfico de Composição (%) das utilidades (Donut)
          - Gráfico de Evolução Mensal Consolidada em R$
          - Botão "Exportar PDF" próprio da seção consolidada
         ========================================================================= */}
      <div className="space-y-4 pt-2">
        <div className="border-b border-gray-200 pb-2">
          <h3 className="text-base font-bold text-gray-900 tracking-tight">
            Análise Financeira Consolidada
          </h3>
          <p className="text-xs text-gray-500">
            Visão financeira agregada somando as três utilidades no período de 12 meses.
          </p>
        </div>

        <ConsolidadoSection
          total12m={total12m}
          energia12m={energia12m}
          agua12m={agua12m}
          gas12m={gas12m}
          donutData={donutData}
          lineData={lineData}
          topConsumos={topConsumos}
          nomeEmpreendimento={nomeEmpSelecionado}
          periodoTexto={periodoTexto}
          disabled={!hasFilteredFaturas}
        />
      </div>

      {/* Bloco Adicional de Maiores Faturas (Top 5) & Link para Análise 24 Meses */}
      <Card className="p-5 border-[#E5E7EB] shadow-sm">
        <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-gray-900">
              Maiores Contas Registradas (Top 5)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Faturas individuais com maior desembolso financeiro
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
