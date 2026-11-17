/**
 * Coerência de gravação para faturas de Água e Esgoto (espelho do hook fatura_extract v0.0.101).
 *
 * PREMISSA v0.0.101 (prova aritmética no PDF TEFL_Sabeps 202506): na discriminização
 * Sabesp, linhas do tipo "De 0,00 até 10 ... Mínimo <X> <valor>" (colunas "(M3 x
 * Nro.Econ.) (M3) Tarifa (R$) Valor (R$)") trazem <X> = TARIFA em R$/m³ com vírgula
 * decimal pt-BR (ex.: R$ 3,796/m³ residencial; R$ 7,660/m³ comercial) — NÃO é volume,
 * NUNCA é milhar pt-BR e NUNCA vira 3.796. Volume do bloco = valor ÷ tarifa
 * (4.820,92 ÷ 3,796 = 1.270 m³; 76,60 ÷ 7,660 = 10 m³) e o consumo = soma dos volumes
 * dos blocos (1.270 + 10 = 1.280 m³). Esse cálculo é feito NO HOOK a partir do texto
 * do PDF; o frontend NUNCA reinterpreta esses números.
 *
 * O que o frontend espelha do hook:
 * 1. Coerência das leituras do hidrômetro: a diferença (atual − anterior) só confirma
 *    o consumo faturado quando está na mesma ordem de grandeza (desvio <= 50%).
 *    Leituras truncadas/contraditórias (ex.: 1254 → 1258 contra 1.280 m³ faturados,
 *    config MISTA com múltiplos medidores) são ANULADAS com aviso honesto — nunca
 *    inventar dígitos que o PDF não contém.
 * 2. Ao gravar (create/update): consumo_medido em dados_especificos não pode
 *    contradizer o consumo top-level do formulário — residual é anulado, nunca
 *    realinhado nem inventado.
 *
 * Codificação pt-BR: parseNumberValue decodifica o padrão do formulário
 * ("1.280" → 1280; "3,796" → 3.796 como impresso). A comparação usa o valor
 * DECODIFICADO de ambos os lados.
 */
import { parseNumberValue } from './cnpj'

/** Aviso honesto exibido quando as leituras impressas estão truncadas/contraditórias. */
export const AVISO_LEITURAS_TRUNCADAS_AGUA =
  'As leituras impressas na fatura parecem truncadas/incompletas no PDF (config MISTA com múltiplos medidores). Medição Anterior/Atual anuladas — preencha manualmente conforme a fatura.'

/**
 * Avalia as leituras do hidrômetro contra o consumo faturado (espelho do hook v0.0.101).
 * - Leituras ausentes ou sem diferença positiva: consumo mantido, leituras inválidas.
 * - Sem consumo de referência: a diferença coerente das leituras é a melhor estimativa.
 * - Diferença coerente (desvio <= 50%): confirma o consumo.
 * - Diferença contraditória: consumo mantido, leituras anuladas com aviso.
 */
export function avaliarLeiturasAgua(
  consumoFaturado: number | undefined | null,
  medicaoAnterior: number | undefined | null,
  medicaoAtual: number | undefined | null,
): { consumo: number | undefined; leiturasValidas: boolean; aviso?: string } {
  const cons =
    consumoFaturado !== undefined && consumoFaturado !== null && consumoFaturado > 0
      ? consumoFaturado
      : undefined
  const diff =
    medicaoAnterior !== undefined &&
    medicaoAnterior !== null &&
    medicaoAtual !== undefined &&
    medicaoAtual !== null &&
    medicaoAtual > medicaoAnterior
      ? medicaoAtual - medicaoAnterior
      : undefined

  if (diff === undefined || diff <= 0) {
    return { consumo: cons, leiturasValidas: false }
  }
  if (cons === undefined) {
    return { consumo: diff, leiturasValidas: true }
  }
  const desvio = Math.abs(diff - cons) / cons
  if (desvio <= 0.5) {
    return { consumo: diff, leiturasValidas: true }
  }
  return { consumo: cons, leiturasValidas: false, aviso: AVISO_LEITURAS_TRUNCADAS_AGUA }
}

/**
 * Decide o consumo_medido a gravar em dados_especificos de Água e Esgoto.
 * - Consumo_medido que contradiz o consumo top-level (desvio relativo > 50%) é
 *   ANULADO (undefined).
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
