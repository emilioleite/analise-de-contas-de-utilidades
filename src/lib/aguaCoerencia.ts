/**
 * Coerência de gravação para faturas de Água e Esgoto (espelho do hook fatura_extract).
 *
 * Problema real (fatura Sabesp TEFL_Sabeps 202506): o consumo_medido extraído vem da
 * DIFERENÇA das leituras truncadas (1254 → 1258 = 4 m³) e, quando a regra de coerência
 * anula as medições, esse valor residual não pode sobreviver em dados_especificos —
 * tem que refletir o consumo corrigido (ex.: 3.796 m³) ou ser anulado/omitido.
 *
 * Codificação pt-BR: neste projeto o consumo de água do grupo Sabesp é gravado como
 * "double" pt-BR (ex.: 3.796 = 3.796 m³) — exibido por formatNumberBR como "3,796".
 * A comparação usa o valor DECODIFICADO; o retorno mantém a codificação do consumo
 * top-level (mesma família do registro — nunca inventa valor).
 */
import { parseNumberValue } from './cnpj'

/** Decodifica o "double" pt-BR: 3.796 -> 3796; 1.09 -> 1090; inteiros ficam como estão. */
function decodificarMilharPtBr(v: number): number {
  if (!Number.isInteger(v) && v < 1000) return Math.round(v * 1000)
  return v
}

/**
 * Decide o consumo_medido a gravar em dados_especificos de Água e Esgoto.
 * - Sem consumo top-level: valor residual < 10 m³ (diferença de leituras truncadas) é
 *   ANULADO (undefined); valor plausível é mantido.
 * - Com consumo top-level plausível (>= 100 m³ decodificado): consumo_medido que
 *   contradiz (< 10 m³ ou desvio relativo > 50%) é realinhado ao consumo top-level.
 * - Caso contrário, mantém o valor como veio (nada a corrigir).
 */
export function calcularConsumoMedidoCoerenteAgua(
  consumoTop: number | string | undefined | null,
  consumoMedidoRaw: number | string | undefined | null,
): number | undefined {
  const top = parseNumberValue(consumoTop ?? undefined)
  const medido = parseNumberValue(consumoMedidoRaw ?? undefined)

  if (medido === undefined || medido <= 0) return undefined

  if (top === undefined || top <= 0) {
    // Sem consumo de referência: valor residual das leituras truncadas é anulado
    return medido < 10 ? undefined : medido
  }

  const topDec = decodificarMilharPtBr(top)
  const medidoDec = decodificarMilharPtBr(medido)

  if (topDec >= 100) {
    const desvio = Math.abs(medidoDec - topDec) / Math.min(medidoDec, topDec)
    const contradiz = medidoDec < 10 || desvio > 0.5
    if (contradiz) return top
  }

  return medido
}
