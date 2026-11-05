import { FaturaRecord, TipoUtilidade } from '@/types/entities'
import { parseNumberValue } from '@/lib/cnpj'

export interface FaturaConsumoTarifa {
  consumo: number
  unidade: string
  tarifaAplicada: number // R$ por unidade (R$/kWh ou R$/m³)
}

/**
 * Extrai o consumo efetivo de uma fatura respeitando as regras de negócio:
 * - Energia Elétrica:
 *   * Se Grupo A (classificacao_consumo A1-A4 ou ponta/fora-ponta preenchidos): soma consumo_ponta + consumo_fora-ponta.
 *   * Se Grupo B (B1-B4) ou geral: consumo único registrado (fatura.consumo).
 * - Água e Esgoto:
 *   * Consumo medido (dados_especificos.consumo_medido) ou fatura.consumo em m³.
 * - Gás Natural:
 *   * Consumo corrigido quando disponível (> 0); senão consumo medido; senão fatura.consumo em m³.
 */
export function getFaturaConsumoReal(fatura: FaturaRecord): { consumo: number; unidade: string } {
  let de: any = fatura.dados_especificos
  if (typeof de === 'string') {
    try {
      de = JSON.parse(de)
    } catch {
      de = {}
    }
  }
  de = de || {}

  const tipo = fatura.tipo_utilidade

  if (tipo === 'Energia Elétrica') {
    const cPonta = Number(de.consumo_ponta) || 0
    const cForaPonta = Number(de.consumo_fora_ponta) || 0
    const classif = (de.classificacao_consumo || '').toUpperCase()
    const isGrupoA = classif.startsWith('A')

    let consumoKwh = Number(fatura.consumo) || 0
    if (isGrupoA || cPonta > 0 || cForaPonta > 0) {
      const soma = cPonta + cForaPonta
      if (soma > 0) {
        consumoKwh = soma
      }
    }

    return {
      consumo: Math.max(0, consumoKwh),
      unidade: 'kWh',
    }
  }

  if (tipo === 'Gás') {
    const cCorrigido =
      de.consumo_corrigido !== undefined && de.consumo_corrigido !== null
        ? Number(de.consumo_corrigido)
        : null
    const cMedido =
      de.consumo_medido !== undefined && de.consumo_medido !== null
        ? Number(de.consumo_medido)
        : null

    let consumoM3 = Number(fatura.consumo) || 0
    if (cCorrigido !== null && !isNaN(cCorrigido) && cCorrigido > 0) {
      consumoM3 = cCorrigido
    } else if (cMedido !== null && !isNaN(cMedido) && cMedido > 0) {
      consumoM3 = cMedido
    }

    return {
      consumo: Math.max(0, consumoM3),
      unidade: 'm³',
    }
  }

  // Água e Esgoto ou padrão
  const cMedido =
    de.consumo_medido !== undefined && de.consumo_medido !== null ? Number(de.consumo_medido) : null
  let consumoM3 = Number(fatura.consumo) || 0
  if (cMedido !== null && !isNaN(cMedido) && cMedido > 0) {
    consumoM3 = cMedido
  }

  return {
    consumo: Math.max(0, consumoM3),
    unidade: 'm³',
  }
}

/**
 * Retorna a unidade padrão de consumo para uma utilidade
 */
export function getUnidadePorUtilidade(utilidade: TipoUtilidade | 'Total Geral'): string {
  if (utilidade === 'Energia Elétrica') return 'kWh'
  if (utilidade === 'Água e Esgoto') return 'm³'
  if (utilidade === 'Gás') return 'm³'
  return 'unidades'
}

/**
 * Retorna o rótulo da unidade tarifária (ex: R$/kWh ou R$/m³)
 */
export function getRotuloTarifa(utilidade: TipoUtilidade | 'Total Geral'): string {
  if (utilidade === 'Energia Elétrica') return 'R$/kWh'
  if (utilidade === 'Água e Esgoto') return 'R$/m³'
  if (utilidade === 'Gás') return 'R$/m³'
  return 'R$/un'
}

/**
 * Retorna a tarifa média unitária efetiva de uma fatura (R$/kWh ou R$/m³).
 * Se a fatura for de Água e Esgoto e a tarifa estiver vazia ou 0 nos dados específicos,
 * calcula analiticamente: valor_total ÷ volume consumido (com proteção para divisão por zero).
 */
export function getFaturaTarifaMedia(fatura: FaturaRecord): number {
  let de: any = fatura.dados_especificos
  if (typeof de === 'string') {
    try {
      de = JSON.parse(de)
    } catch {
      de = {}
    }
  }
  de = de || {}

  const tipo = fatura.tipo_utilidade
  const valorTotal = Number(fatura.valor_total) || 0
  const realConsumo = getFaturaConsumoReal(fatura)
  const consumo = realConsumo.consumo

  if (tipo === 'Água e Esgoto') {
    const tarifaInformada =
      typeof de.tarifa === 'string' ? parseNumberValue(de.tarifa) : Number(de.tarifa)
    if (tarifaInformada !== undefined && !isNaN(tarifaInformada) && tarifaInformada > 0) {
      return tarifaInformada
    }
    // Quando tarifa vazia ou ausente para água: valor_total ÷ consumo
    if (valorTotal > 0 && consumo > 0) {
      return valorTotal / consumo
    }
    return 0
  }

  if (tipo === 'Gás') {
    const tarifaInformada = Number(de.tarifa)
    if (!isNaN(tarifaInformada) && tarifaInformada > 0) {
      return tarifaInformada
    }
    if (valorTotal > 0 && consumo > 0) {
      return valorTotal / consumo
    }
    return 0
  }

  // Energia Elétrica
  const tTusd = Number(de.tarifa_tusd_ponta || de.tarifa_tusd_f_ponta) || 0
  const tTe = Number(de.tarifa_te_ponta || de.tarifa_te_f_ponta) || 0
  const somaT = tTusd + tTe
  if (somaT > 0) {
    return somaT
  }

  if (valorTotal > 0 && consumo > 0) {
    return valorTotal / consumo
  }

  return 0
}
