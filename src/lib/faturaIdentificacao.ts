import { FaturaRecord, TipoUtilidade } from '@/types/entities'

/**
 * Identificação complementar da fatura (além do mês/empreendimento):
 * - Gás: destino/medidor da fatura (ex.: "Caldeira", "Piscina", "Cozinha", "NFe 12345")
 * - Energia Elétrica: origem da fatura — Concessionária (distribuidora) ou Mercado Livre
 *   (comercializadora). Faturas antigas sem marcação = Concessionária.
 */
export type TipoFaturaEnergia = 'concessionaria' | 'mercado_livre'

export const ROTULO_FATURA_PADRAO = 'Geral'

export function getFaturaIdentificacao(fatura: FaturaRecord | null | undefined): string {
  if (!fatura) return ''
  const raw = (fatura as any)?.identificacao
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value
}

/** Rótulo exibido na lista/detalhes e na Análise 24 Meses (nunca vazio). */
export function getFaturaRotulo(fatura: FaturaRecord | null | undefined): string {
  return getFaturaIdentificacao(fatura) || ROTULO_FATURA_PADRAO
}

/** Tipo de fatura de energia; faturas antigas sem marcação = concessionária. */
export function getFaturaTipoEnergia(fatura: FaturaRecord | null | undefined): TipoFaturaEnergia {
  const raw = (fatura as any)?.tipo_fatura_energia
  return raw === 'mercado_livre' ? 'mercado_livre' : 'concessionaria'
}

export const TIPOS_FATURA_ENERGIA: { value: TipoFaturaEnergia; label: string }[] = [
  { value: 'concessionaria', label: 'Concessionária' },
  { value: 'mercado_livre', label: 'Mercado Livre' },
]

export function getLabelTipoFaturaEnergia(tipo: TipoFaturaEnergia): string {
  return TIPOS_FATURA_ENERGIA.find((t) => t.value === tipo)?.label || 'Concessionária'
}

/**
 * Agrupa faturas em séries de análise por competência:
 * - Energia: uma série "Concessionária" e uma "Mercado Livre" (quando houver faturas).
 * - Outras utilidades: uma série única da utilidade (consumo somado no mês).
 * Retorna mapas: chave competência (YYYY-MM) -> {consumo, valor} por série.
 */
export interface SerieConsumoMensal {
  consumo: number
  valor: number
}

export function agruparFaturasPorSerie(
  faturas: FaturaRecord[],
  tipoUtilidade: TipoUtilidade,
): {
  series: { key: string; label: string; color: string }[]
  porMes: Record<string, Record<string, SerieConsumoMensal>>
} {
  const series: { key: string; label: string; color: string }[] = []
  const porMes: Record<string, Record<string, SerieConsumoMensal>> = {}

  const seriesEnergia: Record<TipoFaturaEnergia, { key: string; label: string; color: string }> = {
    concessionaria: {
      key: 'concessionaria',
      label: 'Concessionária',
      color: '#F59E0B',
    },
    mercado_livre: { key: 'mercado_livre', label: 'Mercado Livre', color: '#7C3AED' },
  }

  faturas.forEach((f) => {
    if (!f || f.tipo_utilidade !== tipoUtilidade || !f.competencia) return
    const d = new Date(f.competencia)
    if (isNaN(d.getTime())) return
    const mesKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    let serieKey = 'padrao'
    let serieMeta: { key: string; label: string; color: string } | null = null

    if (tipoUtilidade === 'Energia Elétrica') {
      const tipo = getFaturaTipoEnergia(f)
      serieKey = tipo
      serieMeta = seriesEnergia[tipo]
    } else {
      serieKey = 'padrao'
      serieMeta = { key: 'padrao', label: 'Consumo', color: '#14B8A6' }
    }

    if (serieMeta && !series.find((s) => s.key === serieMeta!.key)) {
      series.push(serieMeta)
    }

    if (!porMes[mesKey]) porMes[mesKey] = {}
    if (!porMes[mesKey][serieKey]) porMes[mesKey][serieKey] = { consumo: 0, valor: 0 }

    porMes[mesKey][serieKey].consumo += Number((f as any).consumo) || 0
    porMes[mesKey][serieKey].valor += Number(f.valor_total) || 0
  })

  return { series, porMes }
}
