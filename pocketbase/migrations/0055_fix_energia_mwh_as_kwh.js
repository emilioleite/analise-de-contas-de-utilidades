/**
 * Migração idempotente: corrige faturas de Energia Elétrica cujo consumo total
 * foi gravado em MWh como se fosse kWh (o número impresso "20,320 MWh" virou 20,32).
 *
 * Critério conservador aplicado (documentado para o usuário):
 * - Afeta apenas tipo_utilidade = "Energia Elétrica" com lancamento_manual = false
 *   (lançamentos manuais digitados pelo usuário não são alterados).
 * - Só multiplica por 1000 registros cujo consumo é claramente um valor de MWh
 *   gravado como kWh: consumo < 100 kWh (nenhum estabelecimento comercial/industrial
 *   destes CNPJs consome menos de 100 kWh/mês — as faturas corretas do banco estão
 *   na faixa de 13.000 a 29.000 kWh) E valor_total > 1000 (valor financeiro coerente
 *   com um consumo mensal real, descartando lançamentos de teste).
 * - Verificação cruzada: consumo*1000 x (TUSD + TE com tributos) reproduz o valor
 *   total da fatura dentro de uma faixa plausível (a fatura inclui iluminação
 *   pública/bandeiras, então não exige igualdade exata). Se as tarifas não estiverem
 *   disponíveis, aplica apenas o critério de ordem de grandeza acima.
 * - Faturas de Gás e Água e Esgoto NÃO são tocadas.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Energia Elétrica' && lancamento_manual = false && consumo < 100",
      '-created',
      500,
    )

    let corrigidos = 0
    let ignorados = 0

    for (const record of records) {
      const consumo = record.getFloat('consumo')
      const valorTotal = record.getFloat('valor_total')
      const numero = record.getString('numero_fatura') || record.id
      const comp = String(record.getString('competencia') || '').slice(0, 7)

      // Registros sem consumo positivo ou sem valor financeiro não são afetados
      if (!(consumo > 0) || !(valorTotal > 0) || valorTotal <= 1000) {
        ignorados++
        continue
      }

      let multiplicar = false

      // Verificação cruzada por tarifas quando disponível
      const deRaw = record.getString('dados_especificos') || '{}'
      let de = {}
      try {
        de = JSON.parse(deRaw) || {}
      } catch (_) {
        de = {}
      }

      const tusd = Number(de.tarifa_tusd_f_ponta) || Number(de.tarifa_tusd_ponta) || 0
      const te = Number(de.tarifa_te_f_ponta) || Number(de.tarifa_te_ponta) || 0
      const somaTarifas = tusd + te

      if (somaTarifas > 0) {
        // Consumo corrigido x tarifas deve aproximar-se do valor da fatura
        // (a fatura também tem bandeira/iluminação, então aceita-se de 60% a 160%)
        const previsto = consumo * 1000 * somaTarifas
        const razao = previsto / valorTotal
        if (razao > 0.6 && razao < 1.6) {
          multiplicar = true
        } else {
          console.log(
            `[migrate-0055] ${numero} (${comp}): tarifas não confirmam MWh (razao=${razao.toFixed(2)}), ignorado`,
          )
          ignorados++
        }
      } else {
        // Sem tarifas: critério de ordem de grandeza (consumo < 100 kWh com
        // valor de fatura de milhares de reais é um MWh gravado como kWh)
        multiplicar = true
      }

      if (multiplicar) {
        const novo = Number((consumo * 1000).toFixed(3))
        record.set('consumo', novo)
        // Espelhar no JSON de dados_especificos, quando houver consumo_medido
        if (de.consumo_medido !== undefined && de.consumo_medido !== null) {
          const cm = Number(de.consumo_medido)
          if (!isNaN(cm) && cm > 0 && cm < 100) {
            de.consumo_medido = Number((cm * 1000).toFixed(3))
          }
        }
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidos++
        console.log(
          `[migrate-0055] corrigido: ${numero} (${comp}): ${consumo} -> ${novo} kWh (valor_total=${valorTotal})`,
        )
      }
    }

    console.log(
      `[migrate-0055] faturas de energia corrigidas: ${corrigidos}; ignoradas: ${ignorados}`,
    )
  },
  (app) => {
    // rollback no-op (idempotente)
  },
)
