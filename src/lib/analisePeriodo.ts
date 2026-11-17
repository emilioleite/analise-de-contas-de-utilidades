import { FaturaRecord } from '@/types/entities'

/**
 * Janela de competências (mês/ano) da Análise por Período.
 *
 * Regra: nenhuma função aqui inventa dado. Mês sem fatura é mês SEM dado
 * (lacuna → null), nunca zero. Zero só existe quando a fatura existe e vale zero.
 */

export const MESES_CURTOS = [
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

/** Limite de segurança da janela (10 anos). */
export const MAX_MESES_JANELA = 120

/** Competência da fatura em 'YYYY-MM'; null se inválida. */
export function mesKeyFromCompetencia(competencia?: string | null): string | null {
  if (!competencia) return null
  const d = new Date(competencia)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function parseMesKey(key: string): { key: string; ano: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec((key || '').trim())
  if (!m) return null
  const ano = Number(m[1])
  const mes = Number(m[2])
  if (!Number.isFinite(ano) || mes < 1 || mes > 12) return null
  return { key: `${ano}-${String(mes).padStart(2, '0')}`, ano, mes }
}

export function mesKey(chaveAno: number, chaveMes: number): string {
  return `${chaveAno}-${String(chaveMes).padStart(2, '0')}`
}

export function labelMes(key: string, longo = false): string {
  const ref = parseMesKey(key)
  if (!ref) return key
  return longo
    ? `${MESES_CURTOS[ref.mes - 1]} de ${ref.ano}`
    : `${MESES_CURTOS[ref.mes - 1]}/${String(ref.ano).slice(-2)}`
}

function indiceMes(key: string): number {
  const ref = parseMesKey(key)
  return ref ? ref.ano * 12 + (ref.mes - 1) : NaN
}

function keyFromIndice(indice: number): string {
  return mesKey(Math.floor(indice / 12), (indice % 12) + 1)
}

/** Competências entre `inicio` e `fim`, inclusive, em ordem cronológica. */
export function listarMeses(inicio: string, fim: string): string[] {
  const i = indiceMes(inicio)
  const f = indiceMes(fim)
  if (!Number.isFinite(i) || !Number.isFinite(f) || i > f) return []
  if (f - i + 1 > MAX_MESES_JANELA) return []
  const out: string[] = []
  for (let k = i; k <= f; k++) out.push(keyFromIndice(k))
  return out
}

/** Mesmo mês do ano anterior ('2025-07' → '2024-07'). */
export function mesAnoAnterior(key: string): string | null {
  const ref = parseMesKey(key)
  return ref ? mesKey(ref.ano - 1, ref.mes) : null
}

/** Desloca n meses a partir de uma competência. */
export function deslocarMes(key: string, n: number): string | null {
  const idx = indiceMes(key)
  return Number.isFinite(idx) ? keyFromIndice(idx + n) : null
}

export interface ValidacaoPeriodo {
  valido: boolean
  erro: string | null
  aviso: string | null
  meses: string[]
  qtdMeses: number
}

/** Formato, ordem (início ≤ fim) e tamanho da janela. Não olha dado. */
export function validarPeriodo(inicio: string, fim: string): ValidacaoPeriodo {
  const i = parseMesKey(inicio)
  const f = parseMesKey(fim)
  if (!i || !f) {
    return {
      valido: false,
      erro: 'Informe o mês/ano inicial e o mês/ano final do período.',
      aviso: null,
      meses: [],
      qtdMeses: 0,
    }
  }
  if (i.key > f.key) {
    return {
      valido: false,
      erro: `O início (${labelMes(i.key, true)}) é posterior ao fim (${labelMes(
        f.key,
        true,
      )}). Ajuste o período.`,
      aviso: null,
      meses: [],
      qtdMeses: 0,
    }
  }
  const meses = listarMeses(i.key, f.key)
  if (meses.length === 0) {
    return {
      valido: false,
      erro: `Período acima do limite de ${MAX_MESES_JANELA} meses. Reduza a janela.`,
      aviso: null,
      meses: [],
      qtdMeses: 0,
    }
  }
  return {
    valido: true,
    erro: null,
    aviso:
      meses.length > 36
        ? `${meses.length} meses no período: a tabela continua confiável, mas o gráfico fica carregado acima de 36.`
        : null,
    meses,
    qtdMeses: meses.length,
  }
}

/** Primeira e última competência com fatura. */
export function limitesDisponiveis(
  faturas: FaturaRecord[],
): { inicio: string; fim: string } | null {
  let min: string | null = null
  let max: string | null = null
  faturas.forEach((f) => {
    const k = mesKeyFromCompetencia(f?.competencia)
    if (!k) return
    if (!min || k < min) min = k
    if (!max || k > max) max = k
  })
  return min && max ? { inicio: min, fim: max } : null
}

export interface Cobertura {
  mesesNoPeriodo: number
  mesesComDado: number
  mesesSemDado: string[]
  temDados: boolean
  aviso: string | null
}

/** Quantos meses da janela têm fatura desta utilidade. */
export function avaliarCobertura(meses: string[], comDado: Set<string>): Cobertura {
  const presentes = meses.filter((m) => comDado.has(m))
  const ausentes = meses.filter((m) => !comDado.has(m))
  const temDados = presentes.length > 0
  let aviso: string | null = null
  if (!temDados) {
    aviso = 'Nenhuma fatura lançada neste período para a seleção.'
  } else if (ausentes.length > 0) {
    aviso = `${ausentes.length} de ${meses.length} meses do período não têm fatura lançada — contados como lacuna, não como zero.`
  }
  return {
    mesesNoPeriodo: meses.length,
    mesesComDado: presentes.length,
    mesesSemDado: ausentes,
    temDados,
    aviso,
  }
}

/** Média que só conta mês com dado. */
export function mediaSobreMesesComDado(soma: number, qtd: number): number | null {
  if (!Number.isFinite(soma) || qtd <= 0) return null
  return soma / qtd
}

/** Variação percentual só quando existe base (>0). Caso contrário null = sem comparação. */
export function variacaoPercentual(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null) return null
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null
  if (anterior === 0) return null
  return ((atual - anterior) / Math.abs(anterior)) * 100
}
