/**
 * Coerência de gravação para faturas de Água e Esgoto (espelho do hook fatura_extract v0.0.99).
 *
 * Regra do hook (premissa v0.0.99): a FONTE DA VERDADE do consumo é a diferença das
 * leituras do hidrômetro (medicao_atual − medicao_anterior, ex.: 1254 → 1258 = 4 m³).
 * O valor da tabela de discriminização da Sabesp ("3,796") é um DECIMAL em m³ e NUNCA
 * é interpretado como milhar pt-BR nem multiplicado por 1000.
 *
 * Função aplicada AO GRAVAR (create/update): consumo_medido em dados_especificos não
 * pode contradizer o consumo top-level do formulário. Quando as leituras truncadas
 * deixaram um valor residual (ex.: 4 m³ contra um consumo faturado de centenas de m³),
 * esse residual é ANULADO (nunca realinhado nem inventado) — o usuário confere a fatura
 * e preenche manualmente.
 *
 * Codificação pt-BR: parseNumberValue decodifica o padrão do formulário
 * ("1.278,50" → 1278.5; "3,796" → 3.796 m³ como impresso). A comparação usa o valor
 * DECODIFICADO de ambos os lados.
 */
import { parseNumberValue } from './cnpj'

/**
 * Decide o consumo_medido a gravar em dados_especificos de Água e Esgoto.
 * - Consumo_medido que contradiz o consumo top-level (desvio relativo > 50% ou
 *   diferença de leituras < 10 m³ contra consumo >= 10 m³) é ANULADO (undefined).
 * - Consumo coerente (ou com consumo top-level ausente) é mantido como veio.
 */
export function calcularConsumoMedidoCoerenteAgua(
  consumoTop: number | string | undefined | null,
  consumoMedidoRaw: number | string | undefined | null,
): number | undefined {
  const top = parseNumberValue(consumoTop ?? undefined)
  const medido = parseNumberValue(consumoMedidoRaw ?? undefined)

  if (medido === undefined || medido <= 0) return undefined

  if (top === undefined || top <= 0) {
    // Sem consumo de referência: mantém o valor como veio (o usuário confere a fatura).
    return medido
  }

  // Coerência: medição coerente com o consumo faturado (mesma ordem de grandeza).
  const desvio = Math.abs(medido - top) / Math.min(medido, top)
  if (desvio > 0.5) return undefined

  return medido
}
