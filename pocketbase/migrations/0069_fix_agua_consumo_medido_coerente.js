/**
 * Migração 0069 idempotente: alinha consumo_medido de dados_especificos ao consumo
 * top-level da fatura de Água e Esgoto, quando ele contradiz o consumo.
 *
 * Caso real (fatura Sabesp TEFL_Sabeps 202506, id 1ok4mi48u1m7y59): o hook anulou as
 * leituras truncadas (1254 → 1258, dif. 4 m³) pela regra de coerência da v0.0.95, mas o
 * consumo_medido em dados_especificos ficou 4 (a diferença das leituras anuladas),
 * enquanto o consumo top-level ficou correto. Como getFaturaConsumoReal prefere
 * consumo_medido para Água e Esgoto, a Análise 24 Meses exibia 4 m³ para 06/2025.
 *
 * Codificação pt-BR: neste projeto o consumo de água do grupo Sabesp é gravado como
 * "double" pt-BR (ex.: 3.796 = 3.796 m³, 1.303 = 1.303 m³) — exibido corretamente por
 * formatNumberBR como "3,796". A comparação usa o valor DECODIFICADO (float com parte
 * decimal < 1000 → × 1000), mas a correção grava o consumo_medido IGUAL ao consumo
 * armazenado (mesma codificação da família de registros — nunca inventa valor).
 *
 * Critério (padrão 0061, conservador):
 * - Somente tipo_utilidade = 'Água e Esgoto'
 * - Somente registros NÃO manuais (lancamento_manual = false)
 * - consumo top-level decodificado >= 100 (referência plausível)
 * - consumo_medido > 0 e contradiz o consumo decodificado: consumo_medido < 10
 *   OU desvio relativo > 50%
 * - Correção: consumo_medido = consumo (valor bruto armazenado, coerente entre si)
 * - O restante do JSON (medições, tarifa, fatura_total) é preservado intacto
 * - Idempotente: após a correção consumo_medido == consumo, então re-executar não mexe.
 */
migrate(
  (app) => {
    // Decodifica o "double" pt-BR: 3.796 -> 3796; 1.09 -> 1090; inteiros ficam como estão.
    const decodAgua = (v) => {
      const n = Number(v)
      if (!isFinite(n) || n <= 0) return 0
      if (!Number.isInteger(n) && n < 1000) return Math.round(n * 1000)
      return n
    }

    const records = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Água e Esgoto'",
      '-created',
      500,
    )

    let corrigidas = 0

    for (const record of records) {
      if (record.getBool('lancamento_manual')) continue

      const consumoRaw = record.getFloat('consumo') || 0
      const consumoDec = decodAgua(consumoRaw)
      const rawJson = record.getString('dados_especificos') || ''
      if (!rawJson) continue

      let de = {}
      try {
        de = JSON.parse(rawJson)
      } catch (_) {
        continue
      }

      const consumoMedido = Number(de.consumo_medido)
      if (!(consumoMedido > 0)) continue

      // Idempotência estrita: já alinhado ao consumo (mesma codificação) -> não mexe
      if (consumoMedido === consumoRaw) continue

      // Referência plausível para alinhar
      if (consumoDec < 100) continue

      // Contradição: consumo_medido minúsculo diante de consumo grande,
      // ou desvio relativo acima de 50% (comparação em escala decodificada)
      const desvio = Math.abs(consumoMedido - consumoDec) / Math.min(consumoMedido, consumoDec)
      const contradiz = consumoMedido < 10 || desvio > 0.5
      if (!contradiz) continue

      de.consumo_medido = consumoRaw
      record.set('dados_especificos', JSON.stringify(de))
      app.save(record)
      corrigidas++
      console.log(
        `[migrate-0069] Fatura de água corrigida (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo_medido ${consumoMedido} -> ${consumoRaw} (alinhado ao consumo top-level, decodificado ${consumoDec} m³).`,
      )
    }

    console.log(
      `[migrate-0069] Total de faturas de Água e Esgoto com consumo_medido realinhado ao consumo: ${corrigidas}`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
