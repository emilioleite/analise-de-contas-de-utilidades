import { CalculoEmissaoFatura, EscopoGHG } from '@/types/entities'
import {
  MESES_CURTOS,
  labelMes,
  mediaSobreMesesComDado,
  mesAnoAnterior,
  mesKeyFromCompetencia,
  parseMesKey,
  variacaoPercentual,
} from '@/lib/analisePeriodo'

/**
 * Série de emissões de GEE dentro de uma janela de competências.
 *
 * Regras (as mesmas da Análise por Período):
 * - mês sem fatura é LACUNA (null), nunca zero;
 * - média divide por mês COM dado, nunca por constante;
 * - sem base de comparação o valor é null (ND), não 0%.
 *
 * Unidade: tCO₂e. Só tCO₂e é somado, e só entre escopos (mesma unidade).
 * Consumo (kWh / m³) viaja em campo próprio e nunca é somado entre utilidades.
 */

export interface PontoEmissao {
  key: string
  label: string
  shortMonth: string
  semFatura: boolean
  escopo1: number | null
  escopo2: number | null
  escopo3: number | null
  total: number | null
  /** Parcela do mês com fator oficial (IPCC / MCTI-SIRENE). */
  oficial: number | null
  /** Parcela do mês com estimativa setorial (água/esgoto, fallback de energia). */
  estimado: number | null
  consumoGasM3: number | null
  consumoEnergiaKwh: number | null
  consumoAguaM3: number | null
  fatorEnergiaAplicado: number | null
  fatorEnergiaOficial: boolean | null
  variacaoPct: number | null
}

export interface TotalEscopo {
  escopo: EscopoGHG
  total: number
  oficial: number
  estimado: number
  mesesComDado: number
}

export interface BreakdownEmpreendimento {
  empreendimentoId: string
  nome: string
  total: number
  escopo1: number
  escopo2: number
  escopo3: number
  oficial: number
  estimado: number
  mesesComDado: number
  mediaMensal: number | null
}

export interface ResumoEmissoes {
  periodoTexto: string
  meses: string[]
  qtdMeses: number
  pontos: PontoEmissao[]
  mesesComDado: number
  mesesSemDado: string[]
  totalPeriodo: number
  totalOficial: number
  totalEstimado: number
  misturaFontes: boolean
  porEscopo: Record<EscopoGHG, TotalEscopo>
  mediaMensal: number | null
  maxPoint: PontoEmissao | null
  minPoint: PontoEmissao | null
  comparativoData: Array<{
    mes: string
    atualLabel: string
    atualValor: number | null
    anteriorLabel: string
    anteriorValor: number | null
  }>
  breakdown: BreakdownEmpreendimento[]
  temDados: boolean
  aviso: string | null
  ignorados: number
}

interface AgregadoMes {
  escopo1: number
  escopo2: number
  escopo3: number
  e1Oficial: number
  e1Estimado: number
  e2Oficial: number
  e2Estimado: number
  e3Oficial: number
  e3Estimado: number
  consumoGas: number
  consumoEnergia: number
  consumoAgua: number
  qtd: number
  fatorEnergia: number
  fatorEnergiaOficial: boolean | null
  mesesComDado: number
}

const ESCOPOS: EscopoGHG[] = ['Escopo 1', 'Escopo 2', 'Escopo 3']

const CAMPOS: Record<
  EscopoGHG,
  { total: keyof AgregadoMes; oficial: keyof AgregadoMes; estimado: keyof AgregadoMes }
> = {
  'Escopo 1': { total: 'escopo1', oficial: 'e1Oficial', estimado: 'e1Estimado' },
  'Escopo 2': { total: 'escopo2', oficial: 'e2Oficial', estimado: 'e2Estimado' },
  'Escopo 3': { total: 'escopo3', oficial: 'e3Oficial', estimado: 'e3Estimado' },
}

function n(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

const arred = (v: number) => Math.round(v * 1000) / 1000

function agregadoVazio(): AgregadoMes {
  return {
    escopo1: 0,
    escopo2: 0,
    escopo3: 0,
    e1Oficial: 0,
    e1Estimado: 0,
    e2Oficial: 0,
    e2Estimado: 0,
    e3Oficial: 0,
    e3Estimado: 0,
    consumoGas: 0,
    consumoEnergia: 0,
    consumoAgua: 0,
    qtd: 0,
    fatorEnergia: 0,
    fatorEnergiaOficial: null,
    mesesComDado: 0,
  }
}

/**
 * Constrói a série mensal de emissões para a janela `meses` ('YYYY-MM', em ordem).
 * `calculos` já vem filtrado pelo recorte que o usuário pediu (empreendimento).
 */
export function construirSerieEmissoes(params: {
  calculos: CalculoEmissaoFatura[]
  meses: string[]
  empreendimentos: Array<{ id: string; nome?: string }>
}): ResumoEmissoes {
  const { calculos, meses, empreendimentos } = params

  const periodoTexto =
    meses.length > 0
      ? `${labelMes(meses[0])} — ${labelMes(meses[meses.length - 1])}`
      : 'Sem período'

  const vazio = (aviso: string | null, ignorados = 0): ResumoEmissoes => ({
    periodoTexto,
    meses,
    qtdMeses: meses.length,
    pontos: [],
    mesesComDado: 0,
    mesesSemDado: meses,
    totalPeriodo: 0,
    totalOficial: 0,
    totalEstimado: 0,
    misturaFontes: false,
    porEscopo: {
      'Escopo 1': { escopo: 'Escopo 1', total: 0, oficial: 0, estimado: 0, mesesComDado: 0 },
      'Escopo 2': { escopo: 'Escopo 2', total: 0, oficial: 0, estimado: 0, mesesComDado: 0 },
      'Escopo 3': { escopo: 'Escopo 3', total: 0, oficial: 0, estimado: 0, mesesComDado: 0 },
    },
    mediaMensal: null,
    maxPoint: null,
    minPoint: null,
    comparativoData: [],
    breakdown: [],
    temDados: false,
    aviso,
    ignorados,
  })

  if (meses.length === 0) return vazio('Período inválido.')

  const janela = new Set(meses)
  const porMes = new Map<string, AgregadoMes>()
  const porEmpreendimento = new Map<string, AgregadoMes>()
  let ignorados = 0

  calculos.forEach((calc) => {
    if (!calc) return
    const key = mesKeyFromCompetencia(calc.competencia)
    if (!key) {
      ignorados++
      return
    }
    if (!janela.has(key)) return

    const emissao = Math.max(0, n(calc.emissoesTCO2e))
    const consumo = Math.max(0, n(calc.consumoConsiderado))
    const oficial = !!calc.isFatorOficial

    const mes = porMes.get(key) || agregadoVazio()
    mes.qtd += 1
    mes.mesesComDado = 1
    if (calc.escopo === 'Escopo 1') {
      mes.escopo1 += emissao
      mes.consumoGas += consumo
      if (oficial) mes.e1Oficial += emissao
      else mes.e1Estimado += emissao
    } else if (calc.escopo === 'Escopo 2') {
      mes.escopo2 += emissao
      mes.consumoEnergia += consumo
      mes.fatorEnergia = n(calc.fatorAplicado)
      mes.fatorEnergiaOficial = oficial
      if (oficial) mes.e2Oficial += emissao
      else mes.e2Estimado += emissao
    } else if (calc.escopo === 'Escopo 3') {
      mes.escopo3 += emissao
      mes.consumoAgua += consumo
      if (oficial) mes.e3Oficial += emissao
      else mes.e3Estimado += emissao
    }
    porMes.set(key, mes)

    const empId = calc.empreendimentoId || 'sem-empreendimento'
    const emp = porEmpreendimento.get(empId) || agregadoVazio()
    emp.mesesComDado = 1
    if (calc.escopo === 'Escopo 1') {
      emp.escopo1 += emissao
      if (oficial) emp.e1Oficial += emissao
      else emp.e1Estimado += emissao
    } else if (calc.escopo === 'Escopo 2') {
      emp.escopo2 += emissao
      if (oficial) emp.e2Oficial += emissao
      else emp.e2Estimado += emissao
    } else if (calc.escopo === 'Escopo 3') {
      emp.escopo3 += emissao
      if (oficial) emp.e3Oficial += emissao
      else emp.e3Estimado += emissao
    }
    porEmpreendimento.set(empId, emp)
  })

  // Meses distintos com dado por empreendimento (para a média por empreendimento)
  const mesesPorEmpreendimento = new Map<string, Set<string>>()
  calculos.forEach((calc) => {
    const key = mesKeyFromCompetencia(calc?.competencia)
    if (!key || !janela.has(key)) return
    const empId = calc.empreendimentoId || 'sem-empreendimento'
    if (!mesesPorEmpreendimento.has(empId)) mesesPorEmpreendimento.set(empId, new Set())
    mesesPorEmpreendimento.get(empId)!.add(key)
  })

  const base: PontoEmissao[] = meses.map((key) => {
    const ref = parseMesKey(key)!
    const agg = porMes.get(key)
    if (!agg) {
      return {
        key,
        label: labelMes(key),
        shortMonth: MESES_CURTOS[ref.mes - 1],
        semFatura: true,
        escopo1: null,
        escopo2: null,
        escopo3: null,
        total: null,
        oficial: null,
        estimado: null,
        consumoGasM3: null,
        consumoEnergiaKwh: null,
        consumoAguaM3: null,
        fatorEnergiaAplicado: null,
        fatorEnergiaOficial: null,
        variacaoPct: null,
      }
    }
    return {
      key,
      label: labelMes(key),
      shortMonth: MESES_CURTOS[ref.mes - 1],
      semFatura: false,
      escopo1: arred(agg.escopo1),
      escopo2: arred(agg.escopo2),
      escopo3: arred(agg.escopo3),
      total: arred(agg.escopo1 + agg.escopo2 + agg.escopo3),
      oficial: arred(agg.e1Oficial + agg.e2Oficial + agg.e3Oficial),
      estimado: arred(agg.e1Estimado + agg.e2Estimado + agg.e3Estimado),
      consumoGasM3: arred(agg.consumoGas),
      consumoEnergiaKwh: arred(agg.consumoEnergia),
      consumoAguaM3: arred(agg.consumoAgua),
      fatorEnergiaAplicado: agg.fatorEnergia > 0 ? agg.fatorEnergia : null,
      fatorEnergiaOficial: agg.fatorEnergiaOficial,
      variacaoPct: null,
    }
  })

  // Variação contra o mês anterior COM dado dentro da janela; sem base → null
  let anterior: number | null = null
  base.forEach((p) => {
    p.variacaoPct = p.semFatura ? null : variacaoPercentual(p.total, anterior)
    if (!p.semFatura && p.total !== null) anterior = p.total
  })

  const comDado = base.filter((p) => !p.semFatura)
  if (comDado.length === 0) {
    return vazio('Nenhuma fatura lançada neste período para a seleção.', ignorados)
  }

  const totalPeriodo = comDado.reduce((a, p) => a + (p.total || 0), 0)
  const totalOficial = comDado.reduce((a, p) => a + (p.oficial || 0), 0)
  const totalEstimado = comDado.reduce((a, p) => a + (p.estimado || 0), 0)

  const mapaMeses = meses.map((k) => porMes.get(k)).filter(Boolean) as AgregadoMes[]

  const porEscopo = ESCOPOS.reduce(
    (acc, escopo) => {
      const c = CAMPOS[escopo]
      acc[escopo] = {
        escopo,
        total: arred(mapaMeses.reduce((a, v) => a + n(v[c.total]), 0)),
        oficial: arred(mapaMeses.reduce((a, v) => a + n(v[c.oficial]), 0)),
        estimado: arred(mapaMeses.reduce((a, v) => a + n(v[c.estimado]), 0)),
        mesesComDado: mapaMeses.filter((v) => n(v[c.total]) > 0).length,
      }
      return acc
    },
    {} as Record<EscopoGHG, TotalEscopo>,
  )

  const mediaMensal = mediaSobreMesesComDado(totalPeriodo, comDado.length)
  const maxPoint = comDado.reduce((a, b) => ((b.total || 0) > (a.total || 0) ? b : a))
  const minPoint = comDado.reduce((a, b) => ((b.total || 0) < (a.total || 0) ? b : a))

  const porChave = new Map(base.map((p) => [p.key, p]))
  const comparativoData: ResumoEmissoes['comparativoData'] = []
  base.forEach((p) => {
    const antKey = mesAnoAnterior(p.key)
    const ant = antKey ? porChave.get(antKey) : undefined
    if (!ant) return
    if (p.semFatura && ant.semFatura) return
    comparativoData.push({
      mes: p.shortMonth,
      atualLabel: p.label,
      atualValor: p.total,
      anteriorLabel: ant.label,
      anteriorValor: ant.total,
    })
  })

  const nomes = new Map(empreendimentos.map((e) => [e.id, e.nome || 'Sem nome']))
  const breakdown: BreakdownEmpreendimento[] = Array.from(porEmpreendimento.entries())
    .map(([id, v]) => {
      const total = v.escopo1 + v.escopo2 + v.escopo3
      const mesesCom = mesesPorEmpreendimento.get(id)?.size || 0
      return {
        empreendimentoId: id,
        nome: nomes.get(id) || 'Empreendimento não identificado',
        total: arred(total),
        escopo1: arred(v.escopo1),
        escopo2: arred(v.escopo2),
        escopo3: arred(v.escopo3),
        oficial: arred(v.e1Oficial + v.e2Oficial + v.e3Oficial),
        estimado: arred(v.e1Estimado + v.e2Estimado + v.e3Estimado),
        mesesComDado: mesesCom,
        mediaMensal: mediaSobreMesesComDado(total, mesesCom),
      }
    })
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total)

  const misturaFontes = totalOficial > 0 && totalEstimado > 0
  const mesesSemDado = base.filter((p) => p.semFatura).map((p) => p.key)

  return {
    periodoTexto,
    meses,
    qtdMeses: meses.length,
    pontos: base,
    mesesComDado: comDado.length,
    mesesSemDado,
    totalPeriodo: arred(totalPeriodo),
    totalOficial: arred(totalOficial),
    totalEstimado: arred(totalEstimado),
    misturaFontes,
    porEscopo,
    mediaMensal,
    maxPoint,
    minPoint,
    comparativoData,
    breakdown,
    temDados: true,
    aviso:
      mesesSemDado.length > 0
        ? `${mesesSemDado.length} de ${meses.length} meses do período não têm fatura lançada — contados como lacuna, não como zero.`
        : null,
    ignorados,
  }
}
