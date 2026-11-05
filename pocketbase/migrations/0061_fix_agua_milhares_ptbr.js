/**
 * Migração 0061 idempotente: corrige faturas de Água e Esgoto salvas com números pt-BR
 * de ponto de milhar interpretados como decimais pelo caminho de extração.
 *
 * Caso real (fatura Sabesp TEFL_Sabeps 202610, id t5nzq6nhdb167b3): a fatura imprime
 * Leitura Anterior 120.086, Leitura Atual 121.364, Consumo 1.278 m³ e o ponto de milhar
 * foi lido como separador decimal, gravando consumo=1.278, medicao_anterior=120.086,
 * medicao_atual=121.364 e tarifa=8.2 (calculada sobre o consumo errado).
 *
 * Critério conservador:
 * - Somente tipo_utilidade = 'Água e Esgoto'
 * - Somente registros NÃO manuais (lancamento_manual = false)
 * - consumo (ou consumo_medido) > 0 e < 10 E valor_total > 1000
 *   (lançamentos manuais plausíveis, ex. CFO com consumo 939/753/1051 e leituras de 4
 *   dígitos, ficam intocados — consumo >= 10 os exclui naturalmente)
 * - Leituras só são multiplicadas por 1000 quando suspeitas: têm exatamente 3 casas
 *   decimais (ex.: 120.086) OU a diferença bruta entre elas coincide com o consumo errado
 *   (consumo = leitura_atual − leitura_anterior na escala errada)
 * - Idempotente: após a correção, consumo >= 10, então a migração re-executada não mexe.
 *
 * Resultado esperado para t5nzq6nhdb167b3:
 *   consumo=1278, consumo_medido=1278, medicao_anterior=120086, medicao_atual=121364,
 *   tarifa=8.203411 (10481.96 ÷ 1278, 6 casas), valor_total=10481.96 (intacto).
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

      const consumo = record.getFloat('consumo') || 0
      const valorTotal = record.getFloat('valor_total') || 0
      const rawJson = record.getString('dados_especificos') || ''
      if (!rawJson) continue

      let de = {}
      try {
        de = JSON.parse(rawJson)
      } catch (_) {
        continue
      }

      const consumoMedido = Number(de.consumo_medido) || 0
      const consumoRef = Math.max(consumo, consumoMedido)

      // Só age no padrão do erro: consumo < 10 com fatura de valor alto (> 1000)
      if (!(consumoRef > 0 && consumoRef < 10 && valorTotal > 1000)) continue

      const fator = 1000
      const novoConsumo = Math.round(consumo * fator)
      const novoMedido = consumoMedido > 0 ? Math.round(consumoMedido * fator) : 0
      let modificado = false

      if (consumo > 0 && consumo < 10) {
        record.set('consumo', novoConsumo)
        modificado = true
      }
      if (consumoMedido > 0 && consumoMedido < 10) {
        de.consumo_medido = novoMedido
        modificado = true
      }

      // Leituras: suspeitas quando têm exatamente 3 casas decimais (120.086) OU quando a
      // diferença bruta entre elas reproduz o consumo na escala errada (validação pelo documento)
      const temTresCasas = (v) => {
        const p = String(Number(v)).split('.')
        return p.length === 2 && p[1].length === 3
      }
      const diffBruta = (Number(de.medicao_atual) || 0) - (Number(de.medicao_anterior) || 0)
      const leiturasSuspeitas =
        (de.medicao_anterior !== undefined &&
          de.medicao_anterior !== null &&
          temTresCasas(de.medicao_anterior)) ||
        (de.medicao_atual !== undefined &&
          de.medicao_atual !== null &&
          temTresCasas(de.medicao_atual)) ||
        (diffBruta > 0 && Math.abs(diffBruta - consumoRef) <= Math.max(1, consumoRef * 0.05))

      if (leiturasSuspeitas) {
        const fixLeitura = (chave) => {
          const n = Number(de[chave])
          if (de[chave] !== undefined && de[chave] !== null && !isNaN(n) && n > 0 && n < 1000) {
            de[chave] = Math.round(n * fator)
            modificado = true
          }
        }
        fixLeitura('medicao_anterior')
        fixLeitura('medicao_atual')
      }

      // Tarifa média recalculada com o consumo corrigido: valor_total ÷ consumo, 6 casas
      // (a tarifa antiga, ex.: 8.2, foi calculada sobre o consumo errado de 1.278)
      const baseCons = novoConsumo || novoMedido
      if (baseCons > 0 && valorTotal > 0) {
        de.tarifa = Number((valorTotal / baseCons).toFixed(6))
      }

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidas++
        console.log(
          `[migrate-0061] Fatura de água corrigida (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo=${record.getFloat('consumo')}, medicao_anterior=${de.medicao_anterior}, medicao_atual=${de.medicao_atual}, tarifa=${de.tarifa}`,
        )
      }
    }

    console.log(
      `[migrate-0061] Total de faturas de Água e Esgoto corrigidas (milhar pt-BR lida como decimal): ${corrigidas}`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
