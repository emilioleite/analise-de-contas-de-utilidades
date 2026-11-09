import { FaturaRecord, TipoUtilidade } from '@/types/entities'
import { toSafeNumber } from '@/lib/cnpj'
import { getFaturaConsumoReal, getFaturaTarifaMedia } from '@/lib/consumoTarifa'
import { agruparFaturasPorSerie, getFaturaIdentificacao } from '@/lib/faturaIdentificacao'

/**
 * Linha do "Detalhamento Mensal Completo" da Análise 24 Meses.
 * Mesma estrutura da tabela mensal agregada — quando há separação
 * (gás multi-fatura ou energia mercado livre), uma linha por fatura/série.
 */
export interface LinhaDetalhe {
  key: string
  label: string
  valor: number
  consumo: number
  tarifa: number
  variacaoPct: number
  variacaoConsumoPct: number
  isMax: boolean
  isMin: boolean
  isMaxConsumo: boolean
  isMinConsumo: boolean
}

function monthKey(competencia: string): string | null {
  if (!competencia) return null
  const d = new Date(competencia)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Constrói as linhas detalhadas da tabela conforme as decisões do usuário:
 *
 * - Gás: cada fatura do mesmo mês/empreendimento vira uma linha própria,
 *   rotulada pela identificação (destino/medidor; NFe quando for GLP).
 *   Quando o mês tem só 1 fatura (ou nenhuma), linha única como hoje.
 * - Energia Elétrica (mercado livre): uma linha por série — "Concessionária"
 *   e "Mercado Livre" — com consumo e valores somados por série, nunca misturados.
 *
 * Retorna [] quando não há separação aplicável (o chamador mantém a tabela mensal agregada).
 */
export function buildLinhasDetalhamento(
  slots: Array<{
    key: string
    label: string
    valor: number
    consumo: number
    tarifa: number
  }>,
  faturas: FaturaRecord[],
  activeTab: TipoUtilidade | 'Total Geral',
): LinhaDetalhe[] {
  if (activeTab !== 'Gás' && activeTab !== 'Energia Elétrica') return []

  const reversed = [...slots].reverse()
  const rows: Array<{
    key: string
    label: string
    valor: number
    consumo: number
    tarifa: number
  }> = []

  if (activeTab === 'Gás') {
    const porMes = new Map<string, FaturaRecord[]>()
    faturas.forEach((f) => {
      const k = monthKey(f?.competencia || '')
      if (!k) return
      if (!porMes.has(k)) porMes.set(k, [])
      porMes.get(k)!.push(f)
    })

    // Só separa quando algum mês tem 2+ faturas de gás
    let temMulti = false
    porMes.forEach((arr) => {
      if (arr.length > 1) temMulti = true
    })
    if (!temMulti) return []

    reversed.forEach((slot) => {
      const doMes = (porMes.get(slot.key) || []).slice().sort((a, b) => {
        const ra = getFaturaIdentificacao(a)
        const rb = getFaturaIdentificacao(b)
        if (ra !== rb) return ra.localeCompare(rb, 'pt-BR')
        return (a.created || '').localeCompare(b.created || '')
      })

      if (doMes.length <= 1) {
        rows.push({
          key: slot.key,
          label: slot.label,
          valor: slot.valor,
          consumo: slot.consumo,
          tarifa: slot.tarifa,
        })
        return
      }

      doMes.forEach((fat, idx) => {
        const consumo = toSafeNumber(getFaturaConsumoReal(fat).consumo, 0)
        const valor = toSafeNumber(fat.valor_total, 0)
        const id = getFaturaIdentificacao(fat)
        const numeroNf = String(fat.numero_fatura || '').trim()
        const rotulo = id || (numeroNf ? `NFe ${numeroNf}` : `Fatura ${idx + 1}`)
        let tarifa = getFaturaTarifaMedia(fat)
        if (!(tarifa > 0) && consumo > 0 && valor > 0) {
          tarifa = valor / consumo
        }
        rows.push({
          key: `${slot.key}#${idx + 1}`,
          label: `${slot.label} — ${rotulo}`,
          valor,
          consumo,
          tarifa,
        })
      })
    })
  } else {
    // Energia Elétrica — separa em séries Concessionária × Mercado Livre
    const agrup = agruparFaturasPorSerie(faturas, 'Energia Elétrica')
    if (!agrup.series.some((s) => s.key === 'mercado_livre')) return []

    reversed.forEach((slot) => {
      const serieMes = agrup.porMes[slot.key] || {}
      const conc = serieMes.concessionaria
      const ml = serieMes.mercado_livre

      if (!conc && !ml) {
        rows.push({ key: slot.key, label: slot.label, valor: 0, consumo: 0, tarifa: 0 })
        return
      }

      if (!ml) {
        // Mês só com concessionária: mantém os valores mensais agregados
        rows.push({
          key: slot.key,
          label: `${slot.label} — Concessionária`,
          valor: conc ? toSafeNumber(conc.valor, 0) : slot.valor,
          consumo: conc ? toSafeNumber(conc.consumo, 0) : slot.consumo,
          tarifa:
            conc && conc.consumo > 0
              ? toSafeNumber(conc.valor, 0) / toSafeNumber(conc.consumo, 0)
              : slot.tarifa,
        })
        return
      }

      if (conc) {
        const v = toSafeNumber(conc.valor, 0)
        const c = toSafeNumber(conc.consumo, 0)
        rows.push({
          key: `${slot.key}#concessionaria`,
          label: `${slot.label} — Concessionária`,
          valor: v,
          consumo: c,
          tarifa: c > 0 ? v / c : 0,
        })
      }
      const vm = toSafeNumber(ml.valor, 0)
      const cm = toSafeNumber(ml.consumo, 0)
      rows.push({
        key: `${slot.key}#mercado_livre`,
        label: `${slot.label} — Mercado Livre`,
        valor: vm,
        consumo: cm,
        tarifa: cm > 0 ? vm / cm : 0,
      })
    })
  }

  // Variações e destaques sobre as linhas exibidas.
  // Linhas do mesmo mês (sub-linhas de gás ou séries de energia) não geram variação
  // entre si — a comparação continua sendo mês a mês.
  const maxValor = Math.max(...rows.map((r) => r.valor), 0)
  const valoresPositivos = rows.map((r) => r.valor).filter((v) => v > 0)
  const minValor = valoresPositivos.length > 0 ? Math.min(...valoresPositivos) : 0
  const maxConsumo = Math.max(...rows.map((r) => r.consumo), 0)
  const consumosPositivos = rows.map((r) => r.consumo).filter((c) => c > 0)
  const minConsumo = consumosPositivos.length > 0 ? Math.min(...consumosPositivos) : 0

  return rows.map((row, idx) => {
    const prev = rows[idx + 1]
    const sameMonth = !!prev && prev.key.split('#')[0] === row.key.split('#')[0]

    let variacaoPct = 0
    if (prev && !sameMonth && prev.valor > 0) {
      variacaoPct = ((row.valor - prev.valor) / prev.valor) * 100
    }
    let variacaoConsumoPct = 0
    if (prev && !sameMonth && prev.consumo > 0) {
      variacaoConsumoPct = ((row.consumo - prev.consumo) / prev.consumo) * 100
    }

    return {
      ...row,
      variacaoPct,
      variacaoConsumoPct,
      isMax: maxValor > 0 && row.valor === maxValor,
      isMin: minValor > 0 && row.valor === minValor,
      isMaxConsumo: maxConsumo > 0 && row.consumo === maxConsumo,
      isMinConsumo: minConsumo > 0 && row.consumo === minConsumo,
    }
  })
}
