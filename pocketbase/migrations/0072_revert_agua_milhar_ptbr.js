/**
 * Migração 0072 idempotente: DESFAZ a premissa ERRADA de milhar pt-BR aplicada às
 * faturas de Água e Esgoto Sabesp (v0.0.94/0.0.95, migrações 0061/0064/0069).
 *
 * Comprovado pela própria fatura (TEFL_Sabeps 202506): o histórico mostra consumo mensal
 * de 985–1.401 m³, então 3.796 m³ é impossível. O "3,796" da tabela de discriminização
 * (coluna "M3 x Nro.Econ.") NÃO é milhar pt-BR do consumo — o valor correto vem das
 * LEITURAS do hidrômetro (1258 − 1254 = 4 m³).
 *
 * Critério (ultra-conservador, afeta apenas o padrão do erro):
 * - Somente tipo_utilidade = 'Água e Esgoto'
 * - Somente registros NÃO manuais (lancamento_manual = false)
 * - consumo_medido >= 1000 E proveniente da conversão de milhar (não inteiro liso):
 *   tem parte decimal "de milhar" (3.796, 1.303, 1.09) OU contradiz as leituras do JSON
 *   (|consumo_medido − (medição_atual − medição_anterior)| > 50% com leituras presentes)
 * - Correção:
 *   - com leituras (medição_atual − medição_anterior) > 0 no JSON:
 *       consumo_medido = diferença das leituras (e consumo top-level idem)
 *   - sem leituras: consumo_medido = null (com aviso)
 *   - consumo top-level segue o mesmo destino; tarifa em dados_especificos é anulada
 *     quando foi calculada sobre o consumo errado (era > R$ 100/m³ ou o consumo mudou)
 * - Idempotente: após a correção o valor passa a ser a diferença das leituras (ou null),
 *   então re-executar não mexe (padrão "tem parte decimal" também passa a não bater).
 * - No-op em banco vazio.
 * - Não toca em outras faturas (energia, gás, manuais).
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

      const rawJson = record.getString('dados_especificos') || ''
      if (!rawJson) continue

      let de = {}
      try {
        de = JSON.parse(rawJson)
      } catch (_) {
        continue
      }

      const cm = Number(de.consumo_medido)
      if (!(cm > 0) || cm < 1000) continue

      // Proveniência da conversão de milhar: parte decimal "de milhar" (3.796, 1.303,
      // 1.09) OU desacordo frontal com as leituras gravadas no próprio JSON.
      const parts = String(cm).split('.')
      const fracMilhar =
        parts.length === 2 && (parts[1].length === 3 || (parts[1].length < 3 && cm < 10))
      const mAnt = Number(de.medicao_anterior) || 0
      const mAtu = Number(de.medicao_atual) || 0
      const diffLeituras = mAtu > mAnt ? Math.round(mAtu - mAnt) : 0
      const contradizLeituras =
        diffLeituras > 0 && Math.abs(cm - diffLeituras) / Math.min(cm, diffLeituras) > 0.5

      if (!fracMilhar && !contradizLeituras) continue

      // Idempotência: já reflete a diferença das leituras (ou já foi anulado)
      if (contradizLeituras && diffLeituras > 0 && cm === diffLeituras) continue

      const consumoTop = record.getFloat('consumo') || 0
      const antigo = cm

      if (diffLeituras > 0) {
        de.consumo_medido = diffLeituras
        if (consumoTop > 0 && Math.abs(consumoTop - antigo) / Math.min(consumoTop, antigo) <= 0.5) {
          // consumo top-level veio da mesma conversão errada — corrigir junto
          record.set('consumo', diffLeituras)
        }
        de.aviso_extracao =
          'Consumo Medido corrigido para a diferença das leituras do hidrômetro (' +
          mAnt +
          ' → ' +
          mAtu +
          ' = ' +
          diffLeituras +
          ' m³). O valor anterior (' +
          antigo +
          ') veio da tabela de discriminização interpretada como milhar pt-BR — premissa revertida: "3,796" da discriminização NÃO é 3.796 m³.'
        // Tarifa antiga foi calculada sobre o consumo errado — anular (o app recalcula
        // analiticamente, ou o usuário preenche manualmente).
        de.tarifa = null
        console.log(
          `[migrate-0072] Fatura de água (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo_medido ${antigo} -> ${diffLeituras} (diferença das leituras ${mAnt} → ${mAtu}); consumo top-level ${consumoTop} -> ${record.getFloat('consumo') || consumoTop}; tarifa anulada.`,
        )
      } else {
        // Sem leituras no JSON: anular o valor impossível (com aviso)
        de.consumo_medido = null
        if (consumoTop > 0 && Math.abs(consumoTop - antigo) / Math.min(consumoTop, antigo) <= 0.5) {
          record.set('consumo', null)
        }
        de.aviso_extracao =
          'Consumo Medido anterior (' +
          antigo +
          ') veio da tabela de discriminização interpretada como milhar pt-BR — premissa revertida (ex.: "3,796" da discriminização NÃO é 3.796 m³). Sem leituras no registro, o consumo foi ANULADO — preencher manualmente conforme a fatura.'
        de.tarifa = null
        console.log(
          `[migrate-0072] Fatura de água (${record.id} - ${record.getString('arquivo_nome') || 'sem arquivo'}): consumo_medido ${antigo} ANULADO (sem leituras no JSON); consumo top-level ${consumoTop} anulado; tarifa anulada.`,
        )
      }

      record.set('dados_especificos', JSON.stringify(de))
      app.save(record)
      corrigidas++
    }

    console.log(
      `[migrate-0072] Total de faturas de Água e Esgoto revertidas da premissa de milhar pt-BR: ${corrigidas}`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
