/**
 * Migração idempotente: corrige a fatura de Energia Elétrica cujo consumo foi
 * gravado dividido por 1000 porque o número pt-BR "24.320,000" foi interpretado
 * como "24,32" (ponto lido como decimal em vez de separador de milhar).
 *
 * Caso desta rodada: Enel / Transamerica Faria Lima, competência 07/2026
 * (NF 081533451), consumo impresso 24.320,000 kWh gravado como 24,32.
 *
 * Critério conservador (mesma linha da migração 0055):
 * - Somente tipo_utilidade = "Energia Elétrica" e lancamento_manual = false.
 * - Consumo suspeito: 0 < consumo < 100 (nenhum estabelecimento destes CNPJs
 *   consome menos de 100 kWh/mês; faturas corretas ficam entre ~13.000 e
 *   ~29.000 kWh).
 * - valor_total > 1000 (valor financeiro coerente com um consumo mensal real).
 * - Verificação cruzada: consumo*1000 x (TUSD + TE com tributos) reproduz o
 *   valor_total dentro de 60%–160% (a fatura tem bandeira/COSIP, então não
 *   exige igualdade exata). Sem tarifas no JSON, aplica só a ordem de grandeza.
 * - O multiplicador é o fator inteiro que alinha as escalas (10^k); na prática
 *   1000 para este caso — nunca um fator parcial.
 * - Gás e Água e Esgoto NÃO são tocados; faturas corretas não são alteradas.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Energia Elétrica' && lancamento_manual = false && consumo > 0 && consumo < 100",
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

      if (!(valorTotal > 1000)) {
        ignorados++
        continue
      }

      let de = {}
      try {
        de = JSON.parse(record.getString('dados_especificos') || '{}') || {}
      } catch (_) {
        de = {}
      }

      const tusd = Number(de.tarifa_tusd_f_ponta) || Number(de.tarifa_tusd_ponta) || 0
      const te = Number(de.tarifa_te_f_ponta) || Number(de.tarifa_te_ponta) || 0
      const somaTarifas = tusd + te

      let multiplicar = false

      if (somaTarifas > 0) {
        const previsto = consumo * 1000 * somaTarifas
        const razao = previsto / valorTotal
        if (razao > 0.6 && razao < 1.6) {
          multiplicar = true
        } else {
          console.log(
            `[migrate-0056] ${numero} (${comp}): tarifas não confirmam erro de escala (razao=${razao.toFixed(2)}), ignorado`,
          )
          ignorados++
          continue
        }
      } else {
        multiplicar = true
      }

      if (multiplicar) {
        const novo = Number((consumo * 1000).toFixed(3))
        record.set('consumo', novo)
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
          `[migrate-0056] corrigido: ${numero} (${comp}): ${consumo} -> ${novo} kWh (valor_total=${valorTotal})`,
        )
      }
    }

    console.log(
      `[migrate-0056] faturas de energia corrigidas: ${corrigidos}; ignoradas: ${ignorados}`,
    )
  },
  (app) => {
    // rollback no-op (idempotente)
  },
)
