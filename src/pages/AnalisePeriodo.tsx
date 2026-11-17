import React, { useEffect, useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { FaturaRecord, TipoUtilidade } from '@/types/entities'
import { formatCurrencyBRL, formatNumberBR, toSafeNumber } from '@/lib/cnpj'
import { getFaturaConsumoReal, getUnidadePorUtilidade, getRotuloTarifa } from '@/lib/consumoTarifa'
import { getFaturaTipoEnergia } from '@/lib/faturaIdentificacao'
import { buildLinhasDetalhamento } from '@/lib/analiseSeries'
import {
  avaliarCobertura,
  deslocarMes,
  labelMes,
  limitesDisponiveis,
  mediaSobreMesesComDado,
  mesAnoAnterior,
  mesKey,
  mesKeyFromCompetencia,
  MESES_CURTOS,
  parseMesKey,
  validarPeriodo,
  variacaoPercentual,
} from '@/lib/analisePeriodo'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  Calendar,
  CalendarRange,
  CircleDollarSign,
  Download,
  Droplets,
  Flame,
  Gauge,
  Info,
  Layers,
  Loader2,
  TrendingDown,
  TrendingUp,
  Zap,
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
import { gerarRelatorioAnalisePeriodoPDF } from '@/services/relatorioAnalisePeriodoPdf'
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

const UTILIDADES: TipoUtilidade[] = ['Energia Elétrica', 'Água e Esgoto', 'Gás']

export interface Ponto {
  key: string
  label: string
  shortMonth: string
  valor: number | null
  consumo: number | null
  tarifa: number | null
  semFatura: boolean
  qtdFaturas: number
  qtdCreditos: number
  valorConcessionaria: number | null
  consumoConcessionaria: number | null
  valorMercadoLivre: number | null
  consumoMercadoLivre: number | null
}

function corDe(utilidade: string): string {
  if (utilidade === 'Energia Elétrica') return '#F59E0B'
  if (utilidade === 'Água e Esgoto') return '#0EA5E9'
  if (utilidade === 'Gás') return '#14B8A6'
  return '#0F766E'
}

const fmtMoeda = (v: number | null) => (v === null ? 'ND' : formatCurrencyBRL(v))
const fmtNum = (v: number | null, dec = 0) => (v === null ? 'ND' : formatNumberBR(v, dec))
const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

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

/** Card de indicador. */
function Kpi({
  titulo,
  valor,
  sub,
  cor,
  icon: Icon,
}: {
  titulo: string
  valor: React.ReactNode
  sub: React.ReactNode
  cor: string
  icon: any
}) {
  return (
    <Card
      className="p-5 border-[#E5E7EB] bg-white shadow-sm"
      style={{ borderLeft: `5px solid ${cor}` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {titulo}
        </span>
        <div className="p-2 rounded-lg" style={{ backgroundColor: `${cor}1A` }}>
          <Icon className="w-4 h-4" style={{ color: cor }} />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold text-gray-900 tabular-nums">{valor}</div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </Card>
  )
}

export default function AnalisePeriodo() {
  const { faturas, empreendimentos, loading } = useData()
  const { toast } = useToast()

  const [selectedEmpreendimento, setSelectedEmpreendimento] = useState<string>('todos')
  const [activeTab, setActiveTab] = useState<'Total Geral' | TipoUtilidade>('Total Geral')
  const [exportandoPdf, setExportandoPdf] = useState(false)
  const [inicio, setInicio] = useState<string>('')
  const [fim, setFim] = useState<string>('')

  const unidadeConsumo = getUnidadePorUtilidade(activeTab)
  const rotuloTarifa = getRotuloTarifa(activeTab)
  const isUtilidadeEspecifica = activeTab !== 'Total Geral'
  const accentColor = corDe(activeTab)

  const empFiltered = useMemo(
    () =>
      !faturas || faturas.length === 0
        ? []
        : selectedEmpreendimento === 'todos'
          ? faturas
          : faturas.filter((f) => f.empreendimento === selectedEmpreendimento),
    [faturas, selectedEmpreendimento],
  )

  const disponivel = useMemo(() => limitesDisponiveis(empFiltered), [empFiltered])

  // Janela inicial: últimos 24 meses até a última competência com dado
  // (ou todo o histórico, se ele for menor). O usuário pode mudar à vontade.
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

  const anos = useMemo(() => {
    const a1 = parseMesKey(disponivel?.inicio || '')?.ano || new Date().getFullYear()
    const a2 = parseMesKey(disponivel?.fim || '')?.ano || new Date().getFullYear()
    const out: number[] = []
    for (let a = Math.min(a1, a2) - 1; a <= Math.max(a1, a2) + 1; a++) out.push(a)
    return out
  }, [disponivel])

  const analise = useMemo(() => {
    const vazio = {
      coverageText: 'Período inválido',
      monthPoints: [] as Ponto[],
      maxPoint: null as Ponto | null,
      minPoint: null as Ponto | null,
      mediaMensal: null as number | null,
      totalPeriodo: 0,
      mesesComValor: 0,
      maxConsumoPoint: null as Ponto | null,
      minConsumoPoint: null as Ponto | null,
      mediaConsumoMensal: null as number | null,
      totalConsumoPeriodo: 0,
      mesesComConsumo: 0,
      maxTarifaPoint: null as Ponto | null,
      minTarifaPoint: null as Ponto | null,
      mediaTarifaPeriodo: null as number | null,
      comparativoAnual: [] as any[],
      comparativoConsumoAnual: [] as any[],
      tableRows: [] as any[],
      temMercadoLivreEnergia: false,
      statsEnergiaSeries: null as any,
      avisoCobertura: null as string | null,
      temDados: false,
      qtdMeses: 0,
      porUtilidade: [] as any[],
    }
    if (!validacao.valido) return vazio

    const relevantes =
      activeTab === 'Total Geral'
        ? empFiltered
        : empFiltered.filter((f) => f.tipo_utilidade === activeTab)

    // Agrega por competência (1 chave por mês)
    const porMes = new Map<
      string,
      { valor: number; consumo: number; qtd: number; creditos: number }
    >()
    relevantes.forEach((fat) => {
      const k = mesKeyFromCompetencia(fat?.competencia)
      if (!k) return
      const atual = porMes.get(k) || { valor: 0, consumo: 0, qtd: 0, creditos: 0 }
      const valor = toSafeNumber(fat.valor_total, 0)
      atual.valor += valor
      atual.consumo += toSafeNumber(getFaturaConsumoReal(fat).consumo, 0)
      atual.qtd += 1
      if (valor < 0) atual.creditos += 1
      porMes.set(k, atual)
    })

    const temMercadoLivreEnergia =
      activeTab === 'Energia Elétrica' &&
      relevantes.some((f) => getFaturaTipoEnergia(f) === 'mercado_livre')

    // Um ponto por competência da janela. Mês sem fatura = null (lacuna), nunca 0.
    const monthPoints: Ponto[] = validacao.meses.map((key) => {
      const ref = parseMesKey(key)!
      const agg = porMes.get(key)
      const semFatura = !agg || agg.qtd === 0
      const consumo = agg && agg.consumo > 0 ? agg.consumo : null
      const valor = agg ? agg.valor : null
      // Custo unitário só dentro de UMA utilidade: em Total Geral kWh e m³ se misturam.
      const tarifa =
        isUtilidadeEspecifica && consumo !== null && valor !== null && consumo > 0 && valor > 0
          ? valor / consumo
          : null

      let valorConcessionaria: number | null = null
      let consumoConcessionaria: number | null = null
      let valorMercadoLivre: number | null = null
      let consumoMercadoLivre: number | null = null
      if (temMercadoLivreEnergia && !semFatura) {
        const doMes = relevantes.filter((f) => mesKeyFromCompetencia(f.competencia) === key)
        const conc = doMes.filter((f) => getFaturaTipoEnergia(f) !== 'mercado_livre')
        const ml = doMes.filter((f) => getFaturaTipoEnergia(f) === 'mercado_livre')
        if (conc.length) {
          valorConcessionaria = conc.reduce((a, f) => a + toSafeNumber(f.valor_total, 0), 0)
          const c = conc.reduce((a, f) => a + toSafeNumber(getFaturaConsumoReal(f).consumo, 0), 0)
          consumoConcessionaria = c > 0 ? c : null
        }
        if (ml.length) {
          valorMercadoLivre = ml.reduce((a, f) => a + toSafeNumber(f.valor_total, 0), 0)
          const c = ml.reduce((a, f) => a + toSafeNumber(getFaturaConsumoReal(f).consumo, 0), 0)
          consumoMercadoLivre = c > 0 ? c : null
        }
      }

      return {
        key,
        label: labelMes(key),
        shortMonth: MESES_CURTOS[ref.mes - 1],
        valor,
        consumo,
        tarifa,
        semFatura,
        qtdFaturas: agg?.qtd || 0,
        qtdCreditos: agg?.creditos || 0,
        valorConcessionaria,
        consumoConcessionaria,
        valorMercadoLivre,
        consumoMercadoLivre,
      }
    })

    const comValor = monthPoints.filter((p) => p.valor !== null)
    const comConsumo = monthPoints.filter((p) => p.consumo !== null)
    const comTarifa = monthPoints.filter((p) => p.tarifa !== null)

    const totalPeriodo = comValor.reduce((a, p) => a + (p.valor || 0), 0)
    const totalConsumoPeriodo = comConsumo.reduce((a, p) => a + (p.consumo || 0), 0)

    const maxPoint = comValor.length
      ? comValor.reduce((a, b) => ((b.valor || 0) > (a.valor || 0) ? b : a))
      : null
    const minPoint = comValor.length
      ? comValor.reduce((a, b) => ((b.valor || 0) < (a.valor || 0) ? b : a))
      : null
    const maxConsumoPoint = comConsumo.length
      ? comConsumo.reduce((a, b) => ((b.consumo || 0) > (a.consumo || 0) ? b : a))
      : null
    const minConsumoPoint = comConsumo.length
      ? comConsumo.reduce((a, b) => ((b.consumo || 0) < (a.consumo || 0) ? b : a))
      : null
    const maxTarifaPoint = comTarifa.length
      ? comTarifa.reduce((a, b) => ((b.tarifa || 0) > (a.tarifa || 0) ? b : a))
      : null
    const minTarifaPoint = comTarifa.length
      ? comTarifa.reduce((a, b) => ((b.tarifa || 0) < (a.tarifa || 0) ? b : a))
      : null

    // Média divide pelo número de meses COM dado — nunca por constante
    const mediaMensal = mediaSobreMesesComDado(totalPeriodo, comValor.length)
    const mediaConsumoMensal = mediaSobreMesesComDado(totalConsumoPeriodo, comConsumo.length)

    let somaV = 0
    let somaC = 0
    comTarifa.forEach((p) => {
      if ((p.valor || 0) > 0 && (p.consumo || 0) > 0) {
        somaV += p.valor || 0
        somaC += p.consumo || 0
      }
    })
    const mediaTarifaPeriodo = somaC > 0 ? somaV / somaC : null

    // Comparativo: cada mês contra o MESMO mês do ano anterior
    const porChave = new Map(monthPoints.map((p) => [p.key, p]))
    const comparativoAnual: any[] = []
    const comparativoConsumoAnual: any[] = []
    monthPoints.forEach((p) => {
      const antKey = mesAnoAnterior(p.key)
      const ant = antKey ? porChave.get(antKey) : undefined
      if (!ant) return
      if (p.semFatura && ant.semFatura) return
      comparativoAnual.push({
        mes: p.shortMonth,
        atualLabel: p.label,
        atualValor: p.valor,
        anteriorLabel: ant.label,
        anteriorValor: ant.valor,
      })
      comparativoConsumoAnual.push({
        mes: p.shortMonth,
        atualLabel: p.label,
        atualConsumo: p.consumo,
        anteriorLabel: ant.label,
        anteriorConsumo: ant.consumo,
      })
    })

    // Tabela: linhas detalhadas (gás multi-fatura / energia mercado livre) ou mês a mês
    const slots = monthPoints.map((p) => ({
      key: p.key,
      label: p.label,
      valor: p.valor || 0,
      consumo: p.consumo || 0,
      tarifa: p.tarifa || 0,
    }))
    const detalhadas =
      isUtilidadeEspecifica && activeTab === activeTab
        ? buildLinhasDetalhamento(slots, relevantes, activeTab as TipoUtilidade)
        : []

    const base =
      detalhadas.length > 0
        ? detalhadas.map((r) => ({ ...r }))
        : [...monthPoints].reverse().map((p) => ({
            key: p.key,
            label: p.label,
            valor: p.valor || 0,
            consumo: p.consumo || 0,
            tarifa: p.tarifa || 0,
            variacaoPct: null,
            variacaoConsumoPct: null,
            isMax: false,
            isMin: false,
          }))

    // Variação contra o mês anterior DENTRO da janela; sem base → null
    const asc = [...base].reverse()
    const variacoes = new Map<string, { valor: number | null; consumo: number | null }>()
    let antV: number | null = null
    let antC: number | null = null
    asc.forEach((r) => {
      const ponto = porChave.get(r.key.split('#')[0])
      const vAtual = ponto?.semFatura ? null : r.valor
      const cAtual = ponto?.semFatura || !(r.consumo > 0) ? null : r.consumo
      variacoes.set(r.key, {
        valor: variacaoPercentual(vAtual, antV),
        consumo: variacaoPercentual(cAtual, antC),
      })
      if (vAtual !== null) antV = vAtual
      if (cAtual !== null) antC = cAtual
    })

    const tableRows = base.map((r) => {
      const ponto = porChave.get(r.key.split('#')[0])
      const semFatura = !!ponto?.semFatura
      const v = variacoes.get(r.key) || { valor: null, consumo: null }
      return {
        key: r.key,
        label: r.label,
        valor: semFatura ? null : r.valor,
        consumo: semFatura ? null : r.consumo > 0 ? r.consumo : null,
        tarifa: semFatura ? null : r.tarifa > 0 ? r.tarifa : null,
        semFatura,
        variacaoPct: v.valor,
        variacaoConsumoPct: v.consumo,
        isMax: !semFatura && !!maxPoint && r.key === maxPoint.key && r.valor > 0,
        isMin: !semFatura && !!minPoint && r.key === minPoint.key && r.valor > 0,
      }
    })

    // Resumo por utilidade — é o que substitui o "Total Geral" que somava kWh + m³
    const porUtilidade = UTILIDADES.map((u) => {
      const doPeriodo = relevantes.filter(
        (f) =>
          f.tipo_utilidade === u &&
          validacao.meses.includes(mesKeyFromCompetencia(f.competencia) || ''),
      )
      let consumoTotal = 0
      let valorTotal = 0
      let sV = 0
      let sC = 0
      const mesesC = new Set<string>()
      const mesesV = new Set<string>()
      doPeriodo.forEach((f) => {
        const k = mesKeyFromCompetencia(f.competencia) || ''
        const v = toSafeNumber(f.valor_total, 0)
        const c = toSafeNumber(getFaturaConsumoReal(f).consumo, 0)
        valorTotal += v
        if (v !== 0) mesesV.add(k)
        if (c > 0) {
          consumoTotal += c
          mesesC.add(k)
          if (v > 0) {
            sV += v
            sC += c
          }
        }
      })
      return {
        utilidade: u,
        unidade: getUnidadePorUtilidade(u),
        consumoTotal,
        mesesComConsumo: mesesC.size,
        mediaConsumo: mediaSobreMesesComDado(consumoTotal, mesesC.size),
        valorTotal,
        mesesComValor: mesesV.size,
        tarifaMedia: sC > 0 ? sV / sC : null,
        rotuloTarifa: getRotuloTarifa(u),
      }
    })

    let statsEnergiaSeries: any = null
    if (temMercadoLivreEnergia) {
      const pega = (f: (p: Ponto) => number | null) =>
        monthPoints.map((p) => ({ label: p.label, v: f(p) })).filter((x) => x.v !== null) as Array<{
          label: string
          v: number
        }>
      const maior = (arr: Array<{ label: string; v: number }>) =>
        arr.length ? arr.reduce((a, b) => (b.v > a.v ? b : a)) : null
      const menor = (arr: Array<{ label: string; v: number }>) =>
        arr.length ? arr.reduce((a, b) => (b.v < a.v ? b : a)) : null
      statsEnergiaSeries = {
        concessionaria: {
          totalValor: pega((p) => p.valorConcessionaria).reduce((a, b) => a + b.v, 0),
          totalConsumo: pega((p) => p.consumoConcessionaria).reduce((a, b) => a + b.v, 0),
          maxValor: maior(pega((p) => p.valorConcessionaria)),
          minValor: menor(pega((p) => p.valorConcessionaria)),
          maxConsumo: maior(pega((p) => p.consumoConcessionaria)),
          minConsumo: menor(pega((p) => p.consumoConcessionaria)),
        },
        mercadoLivre: {
          totalValor: pega((p) => p.valorMercadoLivre).reduce((a, b) => a + b.v, 0),
          totalConsumo: pega((p) => p.consumoMercadoLivre).reduce((a, b) => a + b.v, 0),
          maxValor: maior(pega((p) => p.valorMercadoLivre)),
          minValor: menor(pega((p) => p.valorMercadoLivre)),
          maxConsumo: maior(pega((p) => p.consumoMercadoLivre)),
          minConsumo: menor(pega((p) => p.consumoMercadoLivre)),
        },
      }
    }

    const cobertura = avaliarCobertura(validacao.meses, new Set(comValor.map((p) => p.key)))

    return {
      coverageText: `${labelMes(validacao.meses[0])} — ${labelMes(
        validacao.meses[validacao.meses.length - 1],
      )}`,
      monthPoints,
      maxPoint,
      minPoint,
      mediaMensal,
      totalPeriodo,
      mesesComValor: comValor.length,
      maxConsumoPoint,
      minConsumoPoint,
      mediaConsumoMensal,
      totalConsumoPeriodo,
      mesesComConsumo: comConsumo.length,
      maxTarifaPoint,
      minTarifaPoint,
      mediaTarifaPeriodo,
      comparativoAnual,
      comparativoConsumoAnual,
      tableRows,
      temMercadoLivreEnergia,
      statsEnergiaSeries,
      avisoCobertura: cobertura.aviso,
      temDados: comConsumo.length > 0 || comValor.length > 0,
      qtdMeses: validacao.meses.length,
      porUtilidade,
    }
  }, [empFiltered, activeTab, validacao, isUtilidadeEspecifica])

  const {
    coverageText,
    monthPoints,
    maxPoint,
    minPoint,
    mediaMensal,
    totalPeriodo,
    mesesComValor,
    maxConsumoPoint,
    minConsumoPoint,
    mediaConsumoMensal,
    totalConsumoPeriodo,
    mesesComConsumo,
    maxTarifaPoint,
    minTarifaPoint,
    mediaTarifaPeriodo,
    comparativoAnual,
    comparativoConsumoAnual,
    tableRows,
    temMercadoLivreEnergia,
    avisoCobertura,
    temDados,
    qtdMeses,
    porUtilidade,
  } = analise

  const dot = (params: any, campo: 'valor' | 'consumo' | 'tarifa') => {
    const { cx, cy, payload } = params
    if (!payload) return null
    const v = payload[campo]
    if (v === null || v === undefined) {
      return <circle cx={cx} cy={cy} r={2.5} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={1.5} />
    }
    const refMax =
      campo === 'valor' ? maxPoint : campo === 'consumo' ? maxConsumoPoint : maxTarifaPoint
    const refMin =
      campo === 'valor' ? minPoint : campo === 'consumo' ? minConsumoPoint : minTarifaPoint
    if (refMax && payload.key === refMax.key) {
      return <circle cx={cx} cy={cy} r={5.5} fill="#DC2626" stroke="#FFFFFF" strokeWidth={2} />
    }
    if (refMin && payload.key === refMin.key) {
      return <circle cx={cx} cy={cy} r={5.5} fill="#16A34A" stroke="#FFFFFF" strokeWidth={2} />
    }
    return null
  }

  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null
    const row: Ponto = payload[0].payload
    return (
      <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5 border border-gray-800">
        <div className="flex items-center justify-between gap-3 border-b border-gray-700 pb-1">
          <span className="font-semibold text-gray-200">{row.label}</span>
          {row.semFatura ? (
            <span className="px-1.5 py-0.5 rounded bg-gray-600/80 text-[10px] font-bold">
              sem fatura
            </span>
          ) : row.qtdCreditos > 0 ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-600/80 text-[10px] font-bold">
              contém crédito
            </span>
          ) : null}
        </div>
        {row.semFatura ? (
          <p className="text-gray-400 text-[11px]">Nenhuma fatura lançada — lacuna, não zero.</p>
        ) : (
          <>
            {row.valor !== null && (
              <p className="font-bold tabular-nums text-sm">
                Valor: {formatCurrencyBRL(row.valor)}
              </p>
            )}
            {isUtilidadeEspecifica && (
              <p className="text-gray-300 text-[11px]">
                Consumo:{' '}
                {row.consumo !== null
                  ? `${formatNumberBR(row.consumo)} ${unidadeConsumo}`
                  : 'não informado na fatura'}
              </p>
            )}
            {isUtilidadeEspecifica && row.tarifa !== null && (
              <p className="text-amber-300 text-[11px]">
                Custo unitário efetivo: {formatCurrencyBRL(row.tarifa)}/{unidadeConsumo}
              </p>
            )}
            {temMercadoLivreEnergia && (
              <div className="pt-1 border-t border-gray-800 space-y-1 text-[11px]">
                <div className="flex justify-between text-amber-300">
                  <span>Concessionária:</span>
                  <span className="tabular-nums">{fmtMoeda(row.valorConcessionaria)}</span>
                </div>
                <div className="flex justify-between text-purple-300">
                  <span>Mercado Livre:</span>
                  <span className="tabular-nums">{fmtMoeda(row.valorMercadoLivre)}</span>
                </div>
              </div>
            )}
            {row.qtdFaturas > 1 && (
              <p className="text-gray-400 text-[11px]">{row.qtdFaturas} faturas somadas no mês</p>
            )}
          </>
        )}
      </div>
    )
  }

  const nomeEmpreendimento =
    selectedEmpreendimento === 'todos'
      ? 'Todos os Empreendimentos'
      : empreendimentos.find((e) => e.id === selectedEmpreendimento)?.nome || 'Empreendimento'

  const eixoX = {
    dataKey: 'label',
    stroke: '#9CA3AF',
    fontSize: 10,
    tickLine: false,
    axisLine: { stroke: '#E5E7EB' },
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Análise por Período
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Período livre: escolha mês inicial e final. O app não corta histórico nem inventa mês
            sem fatura.
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
                {empreendimentos.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id} className="text-xs">
                    {emp.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={exportandoPdf || loading || !validacao.valido || !temDados}
            onClick={async () => {
              try {
                setExportandoPdf(true)
                await gerarRelatorioAnalisePeriodoPDF({
                  nomeEmpreendimento,
                  periodoCobertura: coverageText,
                  utilidadeSelecionada: activeTab,
                  unidadeConsumo,
                  rotuloTarifa,
                  qtdMeses,
                  mesesComValor,
                  mesesComConsumo,
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
                  comparativoAnual,
                  comparativoConsumoAnual,
                  tableRows: tableRows as any,
                  porUtilidade,
                  avisoCobertura,
                })
                toast({
                  title: 'Relatório PDF gerado',
                  description: 'O download da Análise por Período foi iniciado.',
                })
              } catch (err: any) {
                console.error('Erro ao gerar PDF:', err)
                toast({
                  title: 'Erro ao gerar PDF',
                  description: err.message || 'Falha ao construir o documento.',
                  variant: 'destructive',
                })
              } finally {
                setExportandoPdf(false)
              }
            }}
            className="h-9 text-xs font-semibold bg-white border-gray-200 hover:bg-gray-50 text-gray-700 shadow-sm flex items-center gap-1.5"
          >
            {exportandoPdf ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700" />
                <span>Gerando...</span>
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
                  ? `Histórico lançado: ${labelMes(disponivel.inicio, true)} a ${labelMes(disponivel.fim, true)}`
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
            {validacao.valido ? `${coverageText} • ${qtdMeses} competências` : 'Período inválido'}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200">
            Meses com fatura: {mesesComValor} de {qtdMeses}
          </span>
        </div>

        {validacao.erro && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800 font-medium">{validacao.erro}</p>
          </div>
        )}
        {!validacao.erro && validacao.aviso && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900">{validacao.aviso}</p>
          </div>
        )}
        {validacao.valido && avisoCobertura && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5">
            <Info className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-900">{avisoCobertura}</p>
          </div>
        )}
      </Card>

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
        <TabsList className="bg-gray-200/80 p-1 rounded-xl grid grid-cols-2 sm:grid-cols-4 w-full sm:w-auto">
          {[
            { v: 'Total Geral', label: 'Total Geral', Icon: Layers, cor: 'text-teal-700' },
            {
              v: 'Energia Elétrica',
              label: 'Energia Elétrica',
              Icon: Zap,
              cor: 'text-amber-500 fill-amber-500',
            },
            {
              v: 'Água e Esgoto',
              label: 'Água e Esgoto',
              Icon: Droplets,
              cor: 'text-sky-500 fill-sky-500',
            },
            { v: 'Gás', label: 'Gás Natural', Icon: Flame, cor: 'text-teal-600 fill-teal-600' },
          ].map(({ v, label, Icon, cor }) => (
            <TabsTrigger
              key={v}
              value={v}
              className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-teal-900 data-[state=active]:shadow-sm rounded-lg py-2"
            >
              <Icon className={`w-3.5 h-3.5 mr-1.5 ${cor}`} />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {validacao.valido && !temDados && (
        <Card className="p-8 border-amber-200 bg-amber-50/60 shadow-sm text-center">
          <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto mb-2" />
          <p className="text-sm font-bold text-amber-900">Período sem dados para {activeTab}</p>
          <p className="text-xs text-amber-800 mt-1">
            Nenhuma fatura lançada entre {coverageText}. Amplie o período ou troque a utilidade —
            nada aqui é estimado nem preenchido com zero.
          </p>
        </Card>
      )}

      {/* ---------------------------------------------------------- TOTAL GERAL */}
      {!isUtilidadeEspecifica && validacao.valido && temDados && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
            <div className="p-1.5 rounded-lg bg-slate-100">
              <Layers className="w-4 h-4 text-slate-700" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Resumo por Utilidade</h3>
              <p className="text-xs text-gray-500">
                Cada grandeza na sua unidade. Consumo físico não é somado entre utilidades
                diferentes.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {porUtilidade.map((u: any) => {
              const cor = corDe(u.utilidade)
              const Icon =
                u.utilidade === 'Energia Elétrica'
                  ? Zap
                  : u.utilidade === 'Água e Esgoto'
                    ? Droplets
                    : Flame
              return (
                <Card
                  key={u.utilidade}
                  className="p-5 border-[#E5E7EB] bg-white shadow-sm"
                  style={{ borderLeft: `5px solid ${cor}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {u.utilidade}
                    </span>
                    <div className="p-2 rounded-lg" style={{ backgroundColor: `${cor}1A` }}>
                      <Icon className="w-4 h-4" style={{ color: cor }} />
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {[
                      [
                        'Consumo',
                        u.mesesComConsumo > 0
                          ? `${formatNumberBR(u.consumoTotal)} ${u.unidade}`
                          : 'ND',
                      ],
                      [
                        'Média/mês (com dado)',
                        u.mediaConsumo !== null
                          ? `${formatNumberBR(u.mediaConsumo, 1)} ${u.unidade}`
                          : 'ND',
                      ],
                      [
                        'Valor faturado',
                        u.mesesComValor > 0 ? formatCurrencyBRL(u.valorTotal) : 'ND',
                      ],
                      [
                        `Custo unit. efetivo (${u.rotuloTarifa})`,
                        u.tarifaMedia !== null ? formatCurrencyBRL(u.tarifaMedia) : 'ND',
                      ],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] text-gray-500">{k}</span>
                        <span className="text-xs font-semibold text-gray-900 tabular-nums text-right">
                          {v}
                        </span>
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-100">
                      {u.mesesComConsumo} de {qtdMeses} meses com consumo lançado
                    </p>
                  </div>
                </Card>
              )
            })}
          </div>

          <Card className="p-3 border-sky-200 bg-sky-50/70 shadow-sm">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
              <p className="text-[11px] text-sky-900 leading-relaxed">
                <strong>Por que não existe um “Total Geral de consumo”:</strong> kWh e m³ são
                grandezas diferentes e não se somam sem conversão. Nesta aba apenas valores em R$
                são consolidados; o consumo físico é analisado na aba da respectiva utilidade.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------ CONSUMO */}
      {isUtilidadeEspecifica && validacao.valido && temDados && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-teal-50">
                <Gauge className="w-4 h-4 text-teal-700" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Consumo Físico Medido ({unidadeConsumo}/mês)
                </h3>
                <p className="text-xs text-gray-500">
                  Unidade nativa da fatura, antes de qualquer conversão para R$.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 self-start sm:self-auto">
              Unidade: {unidadeConsumo}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Kpi
              titulo="Maior Consumo"
              valor={
                <>
                  {fmtNum(maxConsumoPoint?.consumo ?? null)}{' '}
                  <span className="text-sm font-medium text-gray-500">{unidadeConsumo}</span>
                </>
              }
              sub={
                <>
                  <span className="font-semibold text-red-700">Mês de pico:</span>{' '}
                  {maxConsumoPoint?.label || 'ND'}
                </>
              }
              cor="#DC2626"
              icon={TrendingUp}
            />
            <Kpi
              titulo="Menor Consumo"
              valor={
                <>
                  {fmtNum(minConsumoPoint?.consumo ?? null)}{' '}
                  <span className="text-sm font-medium text-gray-500">{unidadeConsumo}</span>
                </>
              }
              sub={
                <>
                  <span className="font-semibold text-green-700">Mínimo apurado:</span>{' '}
                  {minConsumoPoint?.label || 'ND'}
                </>
              }
              cor="#16A34A"
              icon={TrendingDown}
            />
            <Kpi
              titulo="Média Mensal"
              valor={
                <>
                  {fmtNum(mediaConsumoMensal, 1)}{' '}
                  <span className="text-sm font-medium text-gray-500">{unidadeConsumo}/mês</span>
                </>
              }
              sub={`Soma ${formatNumberBR(totalConsumoPeriodo)} ${unidadeConsumo} ÷ ${mesesComConsumo} meses com dado`}
              cor={accentColor}
              icon={Activity}
            />
          </div>

          <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-sm font-bold text-gray-900">
                Evolução do Consumo Mensal
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                A linha quebra nos meses sem fatura — lacuna não é consumo zero.
              </CardDescription>
            </CardHeader>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthPoints} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradConsumo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis {...eixoX} />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: '#E5E7EB' }}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                  />
                  <RechartsTooltip content={tooltip} />
                  <Area
                    type="linear"
                    dataKey="consumo"
                    name="Consumo"
                    stroke={accentColor}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#gradConsumo)"
                    connectNulls={false}
                    dot={(p: any) => dot(p, 'consumo')}
                    activeDot={{ r: 5, stroke: '#FFFFFF', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------ CUSTO UNITÁRIO */}
      {isUtilidadeEspecifica && validacao.valido && temDados && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-50">
                <CircleDollarSign className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Custo Unitário Efetivo ({rotuloTarifa})
                </h3>
                <p className="text-xs text-gray-500">
                  Valor Total ÷ Consumo do mês. Não é a tarifa homologada.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 self-start sm:self-auto">
              Médio: {fmtMoeda(mediaTarifaPeriodo)}/{unidadeConsumo}
            </span>
          </div>

          <Card className="p-3 border-amber-200 bg-amber-50/70 shadow-sm">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-900 leading-relaxed space-y-1">
                <p>
                  <strong>O que está embutido:</strong>{' '}
                  {activeTab === 'Água e Esgoto' &&
                    'tarifa de água + tarifa de esgoto + tributos e encargos da conta.'}
                  {activeTab === 'Energia Elétrica' &&
                    'TUSD + TE, bandeiras tarifárias, encargos setoriais e tributos.'}
                  {activeTab === 'Gás' &&
                    'tarifa de gás, encargos, tributos e, quando houver, transporte/GLP.'}
                </p>
                <p>
                  <strong>Leia com cuidado:</strong> em tarifa escalonada por faixa, consumo menor
                  pode cair em faixa mais cara e elevar o R$/{unidadeConsumo}. Variação deste
                  indicador não é, sozinha, sinal de desperdício nem de ganho — cruze com o consumo
                  físico e com o ciclo tarifário.
                </p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Kpi
              titulo="Custo Unitário Mais Alto"
              valor={
                <>
                  {fmtMoeda(maxTarifaPoint?.tarifa ?? null)}
                  <span className="text-xs font-medium text-gray-500">/{unidadeConsumo}</span>
                </>
              }
              sub={maxTarifaPoint?.label || 'ND'}
              cor="#DC2626"
              icon={TrendingUp}
            />
            <Kpi
              titulo="Custo Unitário Mais Baixo"
              valor={
                <>
                  {fmtMoeda(minTarifaPoint?.tarifa ?? null)}
                  <span className="text-xs font-medium text-gray-500">/{unidadeConsumo}</span>
                </>
              }
              sub={minTarifaPoint?.label || 'ND'}
              cor="#16A34A"
              icon={TrendingDown}
            />
            <Kpi
              titulo="Média Ponderada"
              valor={
                <>
                  {fmtMoeda(mediaTarifaPeriodo)}
                  <span className="text-xs font-medium text-gray-500">/{unidadeConsumo}</span>
                </>
              }
              sub="Soma dos valores ÷ soma dos consumos"
              cor="#D97706"
              icon={Activity}
            />
          </div>

          <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-sm font-bold text-gray-900">
                Trajetória do Custo Unitário Efetivo
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Mês sem consumo ou sem valor fica sem ponto.
              </CardDescription>
            </CardHeader>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthPoints} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis {...eixoX} />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: '#E5E7EB' }}
                    tickFormatter={(v) => `R$ ${Number(v).toFixed(2)}`}
                    domain={['auto', 'auto']}
                  />
                  <RechartsTooltip content={tooltip} />
                  <Line
                    type="linear"
                    dataKey="tarifa"
                    name="Custo unitário"
                    stroke="#D97706"
                    strokeWidth={2.5}
                    connectNulls={false}
                    dot={(p: any) => dot(p, 'tarifa')}
                    activeDot={{ r: 5, stroke: '#FFFFFF', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* --------------------------------------------------------- FINANCEIRO */}
      {validacao.valido && temDados && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
            <div className="p-1.5 rounded-lg bg-teal-50">
              <BarChart3 className="w-4 h-4 text-teal-700" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Desembolso em Reais (R$)</h3>
              <p className="text-xs text-gray-500">
                Valores faturados por competência, picos e média do período.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Kpi
              titulo="Maior Desembolso"
              valor={fmtMoeda(maxPoint?.valor ?? null)}
              sub={maxPoint?.label || 'ND'}
              cor="#DC2626"
              icon={TrendingUp}
            />
            <Kpi
              titulo="Menor Desembolso"
              valor={fmtMoeda(minPoint?.valor ?? null)}
              sub={minPoint?.label || 'ND'}
              cor="#16A34A"
              icon={TrendingDown}
            />
            <Kpi
              titulo="Média Mensal"
              valor={fmtMoeda(mediaMensal)}
              sub={`Total ${formatCurrencyBRL(totalPeriodo)} ÷ ${mesesComValor} meses com fatura`}
              cor={accentColor}
              icon={Activity}
            />
          </div>

          <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-sm font-bold text-gray-900">
                Série de Desembolso por Competência
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                A linha quebra nos meses sem fatura lançada.
              </CardDescription>
            </CardHeader>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthPoints} margin={{ top: 20, right: 20, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradValor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={accentColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradConc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradMl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis {...eixoX} />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: '#E5E7EB' }}
                    tickFormatter={(v) => `R$ ${(v / 1000).toFixed(1)}k`}
                  />
                  <RechartsTooltip content={tooltip} />
                  {temMercadoLivreEnergia ? (
                    <>
                      <Area
                        type="linear"
                        dataKey="valorConcessionaria"
                        name="Concessionária"
                        stroke="#F59E0B"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#gradConc)"
                        connectNulls={false}
                      />
                      <Area
                        type="linear"
                        dataKey="valorMercadoLivre"
                        name="Mercado Livre"
                        stroke="#7C3AED"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#gradMl)"
                        connectNulls={false}
                      />
                    </>
                  ) : (
                    <Area
                      type="linear"
                      dataKey="valor"
                      name="Desembolso"
                      stroke={accentColor}
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#gradValor)"
                      connectNulls={false}
                      dot={(p: any) => dot(p, 'valor')}
                      activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* -------------------------------------------------- COMPARATIVO ANUAL */}
      {validacao.valido && temDados && comparativoAnual.length > 0 && (
        <Card className="p-5 border-[#E5E7EB] bg-white shadow-sm">
          <CardHeader className="p-0 mb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-gray-900">
                Comparativo com o mesmo mês do ano anterior
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Barra ausente = mês sem dado dos dois lados.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-gray-600">
                <span className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
                Ano anterior
              </span>
              <span className="flex items-center gap-1.5 text-gray-900 font-semibold">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: accentColor }} />
                Período
              </span>
            </div>
          </CardHeader>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={comparativoAnual}
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
                  tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`}
                />
                <RechartsTooltip
                  content={({ active, payload }: any) => {
                    if (!active || !payload || !payload.length) return null
                    const r = payload[0].payload
                    return (
                      <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5">
                        <div className="flex justify-between gap-4">
                          <span className="text-gray-400">{r.anteriorLabel}:</span>
                          <span className="font-bold tabular-nums">
                            {fmtMoeda(r.anteriorValor)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-teal-400">{r.atualLabel}:</span>
                          <span className="font-bold tabular-nums text-teal-300">
                            {fmtMoeda(r.atualValor)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 border-t border-gray-700 pt-1">
                          <span className="text-gray-400">Variação:</span>
                          <span className="font-bold tabular-nums">
                            {fmtPct(variacaoPercentual(r.atualValor, r.anteriorValor))}
                          </span>
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar
                  dataKey="anteriorValor"
                  name="Ano anterior"
                  fill="#9CA3AF"
                  radius={[4, 4, 0, 0]}
                />
                <Bar dataKey="atualValor" name="Período" fill={accentColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {isUtilidadeEspecifica && comparativoConsumoAnual.length > 0 && (
            <>
              <p className="mt-6 mb-2 text-sm font-bold text-gray-900">
                Comparativo de Consumo ({unidadeConsumo})
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparativoConsumoAnual}
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
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                    />
                    <RechartsTooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload || !payload.length) return null
                        const r = payload[0].payload
                        const f = (v: number | null) =>
                          v === null ? 'sem dado' : `${formatNumberBR(v)} ${unidadeConsumo}`
                        return (
                          <div className="bg-[#111827] text-white p-3 rounded-lg shadow-xl text-xs space-y-1.5">
                            <div className="flex justify-between gap-4">
                              <span className="text-gray-400">{r.anteriorLabel}:</span>
                              <span className="font-bold tabular-nums">{f(r.anteriorConsumo)}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-teal-400">{r.atualLabel}:</span>
                              <span className="font-bold tabular-nums text-teal-300">
                                {f(r.atualConsumo)}
                              </span>
                            </div>
                            <div className="flex justify-between gap-4 border-t border-gray-700 pt-1">
                              <span className="text-gray-400">Variação:</span>
                              <span className="font-bold tabular-nums">
                                {fmtPct(variacaoPercentual(r.atualConsumo, r.anteriorConsumo))}
                              </span>
                            </div>
                          </div>
                        )
                      }}
                    />
                    <Bar
                      dataKey="anteriorConsumo"
                      name="Ano anterior"
                      fill="#9CA3AF"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="atualConsumo"
                      name="Período"
                      fill={accentColor}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Card>
      )}

      {/* -------------------------------------------------------- DETALHAMENTO */}
      {validacao.valido && temDados && (
        <Card className="border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <CardTitle className="text-sm font-bold text-gray-900">
              Detalhamento Mensal ({qtdMeses} competências)
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              “—” é ausência de base de comparação; “sem fatura” é lacuna no período.
            </CardDescription>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-600">
                  <th className="py-3 px-4">Mês / Ano</th>
                  {isUtilidadeEspecifica && (
                    <th className="py-3 px-4 text-right">Consumo ({unidadeConsumo})</th>
                  )}
                  {isUtilidadeEspecifica && <th className="py-3 px-4 text-right">Var. Consumo</th>}
                  {isUtilidadeEspecifica && (
                    <th className="py-3 px-4 text-right">Custo Unit. ({rotuloTarifa})</th>
                  )}
                  <th className="py-3 px-4 text-right">Valor (R$)</th>
                  <th className="py-3 px-4 text-right">Var. Valor</th>
                  <th className="py-3 px-4 text-center">Classificação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tableRows.map((row: any) => {
                  const cls = row.isMax
                    ? 'bg-amber-50/80 hover:bg-amber-100/70 font-medium'
                    : row.isMin
                      ? 'bg-emerald-50/80 hover:bg-emerald-100/70 font-medium'
                      : row.semFatura
                        ? 'bg-gray-50/60 text-gray-400'
                        : 'hover:bg-gray-50/80'
                  const varCell = (v: number | null) =>
                    v === null ? (
                      <span className="text-gray-400">—</span>
                    ) : v > 0 ? (
                      <span className="inline-flex items-center text-red-600 font-semibold gap-0.5">
                        <ArrowUp className="w-3 h-3" />
                        {v.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-emerald-600 font-semibold gap-0.5">
                        <ArrowDown className="w-3 h-3" />
                        {v.toFixed(1)}%
                      </span>
                    )
                  return (
                    <tr key={row.key} className={cls}>
                      <td className="py-2.5 px-4 font-semibold text-gray-900">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{row.label}</span>
                          {row.semFatura && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-600">
                              sem fatura
                            </span>
                          )}
                        </div>
                      </td>
                      {isUtilidadeEspecifica && (
                        <td className="py-2.5 px-4 text-right text-gray-700 tabular-nums">
                          {row.consumo === null ? '—' : formatNumberBR(row.consumo)}
                        </td>
                      )}
                      {isUtilidadeEspecifica && (
                        <td className="py-2.5 px-4 text-right tabular-nums">
                          {varCell(row.variacaoConsumoPct)}
                        </td>
                      )}
                      {isUtilidadeEspecifica && (
                        <td className="py-2.5 px-4 text-right text-amber-900 tabular-nums">
                          {row.tarifa === null ? '—' : formatCurrencyBRL(row.tarifa)}
                        </td>
                      )}
                      <td className="py-2.5 px-4 text-right font-bold text-gray-900 tabular-nums">
                        {row.valor === null ? '—' : formatCurrencyBRL(row.valor)}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        {varCell(row.variacaoPct)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {row.isMax ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                            Maior valor
                          </span>
                        ) : row.isMin ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                            Menor valor
                          </span>
                        ) : row.semFatura ? (
                          <span className="text-gray-400 text-[11px]">sem dado</span>
                        ) : (
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
      )}
    </div>
  )
}
