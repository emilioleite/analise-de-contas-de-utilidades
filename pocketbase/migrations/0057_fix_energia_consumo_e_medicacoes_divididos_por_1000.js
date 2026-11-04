/**
 * Migração idempotente: corrige faturas de Energia Elétrica cujos valores de
 * consumo e/ou leituras de medidor foram gravados divididos por 1000.
 *
 * Caso desta rodada: Enel / Transamerica Faria Lima, competências 08/2026,
 * 09/2026 e 10/2026 (NF 090420585, 098976595, 107559730). A fatura imprime o
 * consumo como "20.160,000 kWh" e o modelo transcreveu como "20,160" /
 * "20,160.000" (vírgula como milhar em estilo en-US), que o parser lê como
 * decimal -> 20,16. As leituras (impressas como "84.129" etc.) vieram como
 * 84,129 / 84,381 etc.
 *
 * Estratégia em dois blocos independentes e conservadores:
 * 1) CONSUMO: 0 < consumo < 1000, lancamento_manual = false, valor_total > 1000
 *    e (consumo×1000 × (TUSD+TE)) reproduz valor_total dentro de 60%–160%.
 *    Multiplica consumo e consumo_medido (em dados_especificos) por 1000.
 * 2) MEDIÇÕES: 0 < leitura < 1000 e o par (anterior, atual) é crescente e
 *    coerente (diferença = consumo corrigido, com tolerância). Multiplica
 *    medicao_anterior e medicao_atual por 1000, inclusive em dados_especificos.
 *    Trata também os registros TESA_Enel, cujas leituras estão divididas
 *    (ex.: 65,222 em vez de 65222) mas o consumo já está correto.
 *
 * Gás e Água e Esgoto NÃO são tocados. Registros com consumo já correto
 * (≥ 1000) não têm o consumo alterado.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Energia Elétrica' && lancamento_manual = false && consumo > 0 && consumo < 1000",
      '-created',
      500,
    )

    let consumoCorrigidos = 0
    let medicoesCorrigidas = 0
    let ignorados = 0

    // Bloco 1 — consumo dividido por 1000
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
            `[migrate-0057] ${numero} (${comp}): tarifas não confirmam erro de escala do consumo (razao=${razao.toFixed(2)}), ignorado`,
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
          if (!isNaN(cm) && cm > 0 && cm < 1000) {
            de.consumo_medido = Number((cm * 1000).toFixed(3))
          }
        }
        if (de.consumo_corrigido !== undefined && de.consumo_corrigido !== null) {
          const cc = Number(de.consumo_corrigido)
          if (!isNaN(cc) && cc > 0 && cc < 1000) {
            de.consumo_corrigido = Number((cc * 1000).toFixed(3))
          }
        }
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        consumoCorrigidos++
        console.log(
          `[migrate-0057] consumo corrigido: ${numero} (${comp}): ${consumo} -> ${novo} kWh (valor_total=${valorTotal})`,
        )
      }
    }

    // Bloco 2 — leituras de medidor divididas por 1000 (mesmo com consumo correto,
    // como nos registros TESA_Enel). Percorre TODAS as faturas de energia não-manuais.
    const todos = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Energia Elétrica' && lancamento_manual = false",
      '-created',
      500,
    )

    for (const record of todos) {
      let de = {}
      try {
        de = JSON.parse(record.getString('dados_especificos') || '{}') || {}
      } catch (_) {
        de = {}
      }

      const campo = (v) => {
        if (v === undefined || v === null) return undefined
        const n = Number(v)
        return isNaN(n) ? undefined : n
      }

      const medAnt = campo(de.medicao_anterior)
      const medAtu = campo(de.medicao_atual)
      const numero = record.getString('numero_fatura') || record.id
      const comp = String(record.getString('competencia') || '').slice(0, 7)

      if (medAnt === undefined || medAtu === undefined) continue
      if (!(medAnt > 0 && medAtu > 0 && medAnt < 1000 && medAtu < 1000)) continue
      if (!(medAtu > medAnt)) continue

      // Coerência: a diferença de leituras deve ser plausível com o consumo
      // corrigido da fatura. Como as leituras estão divididas por 1000, a
      // diferença também está — o par corrigido gera diferenca*1000.
      const consumoAtual = record.getFloat('consumo')
      const diferencaCorrigida = (medAtu - medAnt) * 1000
      const consumoAlvo = consumoAtual >= 1000 ? consumoAtual : consumoAtual * 1000
      const coerente =
        consumoAlvo > 0
          ? diferencaCorrigida > consumoAlvo * 0.5 && diferencaCorrigida < consumoAlvo * 2
          : true

      if (!coerente) {
        console.log(
          `[migrate-0057] ${numero} (${comp}): leituras ${medAnt}/${medAtu} não coerentes com consumo ${consumoAlvo} (diferença corrigida=${diferencaCorrigida.toFixed(3)}), ignorado`,
        )
        continue
      }

      const novoAnt = Number((medAnt * 1000).toFixed(0))
      const novoAtu = Number((medAtu * 1000).toFixed(0))
      de.medicao_anterior = novoAnt
      de.medicao_atual = novoAtu
      record.set('dados_especificos', JSON.stringify(de))
      app.save(record)
      medicoesCorrigidas++
      console.log(
        `[migrate-0057] medições corrigidas: ${numero} (${comp}): ${medAnt}/${medAtu} -> ${novoAnt}/${novoAtu}`,
      )
    }

    console.log(
      `[migrate-0057] faturas com consumo corrigido: ${consumoCorrigidos}; com medições corrigidas: ${medicoesCorrigidas}; ignoradas: ${ignorados}`,
    )
  },
  (app) => {
    // rollback no-op (idempotente)
  },
)
