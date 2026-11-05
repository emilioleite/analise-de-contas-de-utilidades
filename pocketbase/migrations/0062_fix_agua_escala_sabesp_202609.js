/**
 * Migração 0062 idempotente: corrige faturas de Água e Esgoto salvas com números
 * interpretados como decimais JSON (escala 1000x menor que a real).
 *
 * Caso real (fatura Sabesp TEFL_Sabeps 202609, id ktylr799bcjuwdg, empreendimento Transamerica Faria Lima):
 * A fatura imprime Leitura Anterior 118.555, Leitura Atual 120.086, Consumo medido 1.531 m³,
 * valor total R$ 13.748,46 e ligação estimada de 620 m³ ignorada.
 * Foi gravado consumo=1.531, medicao_anterior=118.555, medicao_atual=120.086 e tarifa=8.98
 * (calculada sobre o consumo 1.531).
 *
 * Critério conservador:
 * - Somente tipo_utilidade = 'Água e Esgoto'
 * - Somente registros NÃO manuais (lancamento_manual = false)
 * - consumo (ou consumo_medido) > 0 e < 100 E valor_total > 1000
 * - Só age se a tarifa implícita (valor_total ÷ consumo) for > 100 R$/m³ E a tarifa após
 *   correção ×1000 ficar em faixa plausível de saneamento (R$ 2/m³ a R$ 100/m³).
 * - Leituras são multiplicadas por 1000 se tiverem casas decimais (ex: 118.555 -> 118555)
 *   ou se forem menores que 1000 e a diferença coincidir com o consumo.
 * - Tarifa média recalculada como valor_total ÷ novo_consumo com até 6 casas decimais.
 * - Idempotente: após a correção, consumo >= 100, logo re-execuções não alteram nada.
 * - Fatura 202610 (id t5nzq6nhdb167b3) já tem consumo=1278 e fica intocada.
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

      // Só age no padrão do erro: consumo < 100 com fatura de valor alto (> 1000)
      if (!(consumoRef > 0 && consumoRef < 100 && valorTotal > 1000)) continue

      const tarifaImplicitaAtual = valorTotal / consumoRef
      const fator = 1000
      const novoConsumoRef = consumoRef * fator
      const tarifaImplicitaCorrigida = valorTotal / novoConsumoRef

      // Validação de coerência: a tarifa atual deve ser absurda (> 100 R$/m³)
      // e a tarifa corrigida deve ser plausível para saneamento (entre 2 e 100 R$/m³)
      if (
        !(
          tarifaImplicitaAtual > 100 &&
          tarifaImplicitaCorrigida >= 2 &&
          tarifaImplicitaCorrigida <= 100
        )
      ) {
        continue
      }

      const novoConsumo = Math.round(consumo * fator)
      const novoMedido = consumoMedido > 0 ? Math.round(consumoMedido * fator) : 0
      let modificado = false

      if (consumo > 0 && consumo < 100) {
        record.set('consumo', novoConsumo)
        modificado = true
      }
      if (consumoMedido > 0 && consumoMedido < 100) {
        de.consumo_medido = novoMedido
        modificado = true
      }

      // Leituras anterior e atual: se vieram como decimal ou escala /1000
      const fixLeitura = (chave) => {
        const val = de[chave]
        if (val !== undefined && val !== null) {
          const n = Number(val)
          if (!isNaN(n) && n > 0 && n < 1000) {
            de[chave] = Math.round(n * fator)
            modificado = true
          }
        }
      }
      fixLeitura('medicao_anterior')
      fixLeitura('medicao_atual')

      // Se após corrigir leituras a diferença bater com o consumo
      const mAnt = Number(de.medicao_anterior) || 0
      const mAtu = Number(de.medicao_atual) || 0
      if (mAtu > mAnt) {
        const diff = mAtu - mAnt
        // Se a diferença bate com o novo consumo (com pequena tolerância)
        if (Math.abs(diff - novoConsumo) <= 1) {
          record.set('consumo', diff)
          de.consumo_medido = diff
        }
      }

      // Tarifa média recalculada: valor_total ÷ consumo com 6 casas decimais
      const baseCons = record.getFloat('consumo') || de.consumo_medido || novoConsumo
      if (baseCons > 0 && valorTotal > 0) {
        de.tarifa = Number((valorTotal / baseCons).toFixed(6))
        modificado = true
      }

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidas++
        console.log(
          `[migrate-0062] Fatura de água corrigida (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo=${record.getFloat('consumo')}, medicao_anterior=${de.medicao_anterior}, medicao_atual=${de.medicao_atual}, tarifa=${de.tarifa}, valor_total=${valorTotal}`,
        )
      }
    }

    console.log(
      `[migrate-0062] Total de faturas de Água e Esgoto corrigidas (escala 1000x Sabesp): ${corrigidas}`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
