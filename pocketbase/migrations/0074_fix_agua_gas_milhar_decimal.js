/**
 * Migração 0074 idempotente: corrige faturas de Água e Esgoto com consumo de milhar
 * pt-BR gravado como decimal — o padrão conhecido consumo < 10 com valor_total > 1000
 * (mesma assinatura já corrigida pela 0061, que reincidiu em gravações novas).
 *
 * Caso real (print do Dashboard "Água e Esgoto" Transamerica Faria Lima): as faturas
 * Sabesp TEFL das competências 2025-07 a 2026-07 foram gravadas com consumo 1.303,
 * 1.097, 1.266, ..., 1.09 (decimal) quando o real é o milhar pt-BR: 1.303 m³, 1.097 m³,
 * 1.090 m³ etc. (histórico plausível: ~1.000–1.500 m³/mês, faturas de R$ 8.500–12.000).
 * Com isso a tarifa média ficava absurda (R$ 9.224,17/m³ em vez de ~R$ 9,22/m³) e os
 * gráficos do Dashboard afundavam nesses meses.
 *
 * Seções:
 *  A) Água e Esgoto, NÃO manual, consumo (ou consumo_medido) em (0,10) e valor_total
 *     > 1000: consumo e consumo_medido × 1000 (arredondado), tarifa recalculada
 *     = valor_total ÷ consumo corrigido (6 casas), aviso_extracao honesto. Leituras só
 *     são escaladas quando suspeitas (3 casas decimais OU diferença bruta = consumo na
 *     escala errada) — mesmo critério da 0061.
 *  B) Água e Esgoto, MANUAL, consumo >= 10 e tarifa ≈ valor_total (|tarifa − valor_total|
 *     < 0,01): assinatura de lançamento com a tarifa digitada igual ao total (caso real
 *     9yesskuvf4ckivl, 2026-03, tarifa R$ 17.061,28/m³). Tarifa recalculada
 *     = valor_total ÷ consumo. Consumo intocado (foi digitado pelo usuário).
 *  C) Gás, NÃO manual, SEM consumo_corrigido válido (>= 10) e com consumo
 *     (ou consumo_medido) em (0,10) e valor_total > 1000: mesma correção da seção A.
 *     Registros de gás que já têm consumo_corrigido (LUM_GN, TESA Comgás — corrigidos
 *     por migrações anteriores) ficam INTACTOS.
 *
 * Idempotente: após a correção, consumo >= 10 (e tarifa ≠ valor_total), então
 * re-executar não mexe. No-op em base vazia. Não toca em energia nem mercado livre.
 */
migrate(
  (app) => {
    let corrigidasA = 0
    let corrigidasB = 0
    let corrigidasC = 0

    const temTresCasas = (v) => {
      const p = String(Number(v)).split('.')
      return p.length === 2 && p[1].length === 3
    }

    // A JSVM (goja) não suporta toLocaleString com locale — formatar à mão
    const fmtInt = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    const fmtMoeda = (v) => {
      const n = Number(v) || 0
      const int = fmtInt(Math.floor(n))
      const cent = String(Math.round((n - Math.floor(n)) * 100)).padStart(2, '0')
      return int + ',' + cent
    }
    const fmtDec = (v) => {
      const n = Number(v) || 0
      const int = fmtInt(Math.floor(n))
      const frac = String(Math.round((n - Math.floor(n)) * 1e6))
        .padStart(6, '0')
        .replace(/0+$/, '')
      return frac ? int + ',' + frac : int
    }

    const parseDe = (record) => {
      const rawJson = record.getString('dados_especificos') || ''
      if (!rawJson) return null
      try {
        return JSON.parse(rawJson)
      } catch (_) {
        return null
      }
    }

    // -----------------------------------------------------------------
    // Seções A e B: Água e Esgoto
    // -----------------------------------------------------------------
    const recordsAgua = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Água e Esgoto'",
      '-created',
      500,
    )

    for (const record of recordsAgua) {
      const de = parseDe(record)
      if (!de) continue
      const valorTotal = record.getFloat('valor_total') || 0
      const consumo = record.getFloat('consumo') || 0

      // Seção B: manual com tarifa = valor_total (erro de digitação do lançamento)
      if (record.getBool('lancamento_manual')) {
        const tarifa = Number(de.tarifa) || 0
        if (
          consumo >= 10 &&
          valorTotal > 1000 &&
          tarifa > 0 &&
          Math.abs(tarifa - valorTotal) < 0.01
        ) {
          const novaTarifa = Number((valorTotal / consumo).toFixed(6))
          de.tarifa = novaTarifa
          de.aviso_extracao =
            'Tarifa corrigida de R$ ' +
            fmtDec(tarifa) +
            '/m³ (estava igual ao valor total da fatura — erro de lançamento) para R$ ' +
            fmtDec(novaTarifa) +
            '/m³ (valor_total ÷ consumo). Confira na fatura.'
          record.set('dados_especificos', JSON.stringify(de))
          app.save(record)
          corrigidasB++
          console.log(
            `[migrate-0074] Água MANUAL (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): tarifa ${tarifa} (= valor_total) -> ${novaTarifa}`,
          )
        }
        continue
      }

      // Seção A: não manual, milhar pt-BR gravada como decimal
      const consumoMedido = Number(de.consumo_medido) || 0
      const consumoRef = Math.max(consumo, consumoMedido)
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

      // Leituras: suspeitas quando têm exatamente 3 casas decimais OU quando a
      // diferença bruta reproduz o consumo na escala errada (critério da 0061)
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

      // Tarifa recalculada sobre o consumo corrigido (a antiga derivou do consumo errado)
      const baseCons = novoConsumo || novoMedido
      if (baseCons > 0 && valorTotal > 0) {
        de.tarifa = Number((valorTotal / baseCons).toFixed(6))
      }

      de.aviso_extracao =
        'Consumo corrigido de ' +
        fmtDec(consumoRef) +
        ' m³ para ' +
        fmtInt(baseCons || 0) +
        ' m³ (milhar pt-BR gravada como decimal; fatura de R$ ' +
        fmtMoeda(valorTotal) +
        '). Tarifa recalculada = valor_total ÷ consumo. Confira na fatura.'

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidasA++
        console.log(
          `[migrate-0074] Água (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo ${consumo} -> ${novoConsumo}, consumo_medido ${consumoMedido} -> ${novoMedido}, tarifa -> ${de.tarifa}`,
        )
      }
    }

    // -----------------------------------------------------------------
    // Seção C: Gás (defensiva — hoje no-op; registros com consumo_corrigido intocados)
    // -----------------------------------------------------------------
    const recordsGas = app.findRecordsByFilter('faturas', "tipo_utilidade = 'Gás'", '-created', 500)

    for (const record of recordsGas) {
      if (record.getBool('lancamento_manual')) continue
      const de = parseDe(record)
      if (!de) continue

      // Já tem valor corrigido válido => registro tratado por migração anterior: não tocar
      const consumoCorrigido = Number(de.consumo_corrigido) || 0
      if (consumoCorrigido >= 10) continue

      const consumo = record.getFloat('consumo') || 0
      const consumoMedido = Number(de.consumo_medido) || 0
      const consumoRef = Math.max(consumo, consumoMedido)
      const valorTotal = record.getFloat('valor_total') || 0
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
      if (novoConsumo > 0) {
        de.consumo_corrigido = novoConsumo
      }

      const baseCons = novoConsumo || novoMedido
      if (baseCons > 0 && valorTotal > 0) {
        de.tarifa = Number((valorTotal / baseCons).toFixed(6))
      }

      de.aviso_extracao =
        'Consumo corrigido de ' +
        fmtDec(consumoRef) +
        ' m³ para ' +
        fmtInt(baseCons || 0) +
        ' m³ (milhar pt-BR gravada como decimal; fatura de R$ ' +
        fmtMoeda(valorTotal) +
        '). Tarifa recalculada = valor_total ÷ consumo. Confira na fatura.'

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidasC++
        console.log(
          `[migrate-0074] Gás (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo ${consumo} -> ${novoConsumo}, consumo_medido ${consumoMedido} -> ${novoMedido}, tarifa -> ${de.tarifa}`,
        )
      }
    }

    console.log(
      `[migrate-0074] Totais corrigidos — água não manual (seção A): ${corrigidasA}; água manual tarifa=total (seção B): ${corrigidasB}; gás (seção C): ${corrigidasC}. No-op em base vazia.`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
