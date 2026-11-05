/**
 * Migração 0063 idempotente: corrige faturas de Água e Esgoto salvas com números
 * interpretados como decimais JSON (leituras com escala decimal e/ou consumo divergente da diferença das leituras).
 *
 * Caso real (fatura Sabesp TEFL_Sabeps 202608, id a83bqbnlzkbjzht, empreendimento Transamerica Faria Lima):
 * A fatura imprime:
 * - Leitura Anterior: 117.047 (hidrômetro E18B800712)
 * - Leitura Atual: 118.555
 * - Consumo medido = 1.508 m³ (118555 - 117047)
 * - Valor Total: R$ 13.449,14
 * - Ligação estimada de 620 m³ ignorada
 * O registro havia sido gravado com:
 * - medicao_anterior = 117.047
 * - medicao_atual = 118.555
 * - consumo = 1.206 (média de consumo impressa em outro campo)
 * - tarifa = 11.15
 *
 * Correção idempotente:
 * - Somente tipo_utilidade = 'Água e Esgoto'
 * - Somente registros NÃO manuais (lancamento_manual = false)
 * - Leituras multiplicadas por 1000 se estiverem em escala decimal (< 1000 com fração decimal de até 3 casas)
 * - Consumo medido ajustado para medicao_atual - medicao_anterior quando ambas existirem e medicao_atual > medicao_anterior
 * - Tarifa média calculada como valor_total ÷ consumo com até 6 casas decimais (13449.14 ÷ 1508 = 8.918528)
 * - Idempotente: registros que já têm leituras inteiras (ex.: 09/2026 c/ 118555->120086 e 10/2026 c/ 120086->121364)
 *   e consumo = diff permanecem inalterados.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Água e Esgoto'",
      '-created',
      500,
    )

    let corrigidas = 0

    for (const record of records) {
      if (record.getBool('lancamento_manual')) continue

      const valorTotal = record.getFloat('valor_total') || 0
      const consumoAtual = record.getFloat('consumo') || 0
      const rawJson = record.getString('dados_especificos') || ''
      if (!rawJson) continue

      let de = {}
      try {
        de = JSON.parse(rawJson)
      } catch (_) {
        continue
      }

      let modificado = false

      // 1. Corrigir medições se estiverem em escala decimal < 1000 (ex: 117.047 -> 117047, 118.555 -> 118555)
      const fixLeitura = (chave) => {
        const val = de[chave]
        if (val !== undefined && val !== null) {
          const n = Number(val)
          if (!isNaN(n) && n > 0 && n < 1000) {
            const parts = String(n).split('.')
            if (parts.length === 2 && (parts[1].length === 3 || (parts[1].length < 3 && n < 10))) {
              de[chave] = Math.round(n * 1000)
              modificado = true
            }
          }
        }
      }

      fixLeitura('medicao_anterior')
      fixLeitura('medicao_atual')

      const mAnt = Number(de.medicao_anterior) || 0
      const mAtu = Number(de.medicao_atual) || 0

      // 2. Validação cruzada: se leituras existem e mAtu > mAnt, o consumo medido DEVE ser a diferença
      let novoConsumo = consumoAtual
      if (mAtu > 0 && mAnt > 0 && mAtu > mAnt) {
        const diff = mAtu - mAnt
        if (
          Math.abs(consumoAtual - diff) > 0.001 ||
          Math.abs(Number(de.consumo_medido || 0) - diff) > 0.001
        ) {
          novoConsumo = diff
          record.set('consumo', diff)
          de.consumo_medido = diff
          modificado = true
        }
      } else if (consumoAtual > 0 && consumoAtual < 100 && valorTotal > 1000) {
        // Fallback para caso sem leituras mas com erro de escala x1000
        const fator = 1000
        if (valorTotal / (consumoAtual * fator) <= 100) {
          novoConsumo = Math.round(consumoAtual * fator)
          record.set('consumo', novoConsumo)
          de.consumo_medido = novoConsumo
          modificado = true
        }
      }

      // 3. Tarifa média analítica: se houve alteração no consumo/medições e valor_total > 0
      if (modificado && valorTotal > 0 && novoConsumo > 0) {
        const tarifaCalculada = Number((valorTotal / novoConsumo).toFixed(6))
        de.tarifa = tarifaCalculada
        modificado = true
      }

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidas++
        console.log(
          `[migrate-0063] Fatura de água corrigida (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo=${record.getFloat('consumo')}, medicao_anterior=${de.medicao_anterior}, medicao_atual=${de.medicao_atual}, tarifa=${de.tarifa}, valor_total=${valorTotal}`,
        )
      }
    }

    console.log(`[migrate-0063] Total de faturas de Água e Esgoto corrigidas: ${corrigidas}`)
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
