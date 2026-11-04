/**
 * Migração 0060 idempotente: Corrige medições (medicao_anterior e medicao_atual)
 * de Energia Elétrica gravadas divididas por 1000 dentro do campo JSON `dados_especificos`.
 *
 * Contexto: Empreendimentos como TEFL e TESA tiveram leituras gravadas como
 * 84.129 -> 84.381 ou 58.753 -> 59.757 (escala decimal), quando a escala real
 * do medidor é 84129 -> 84381 ou 58753 -> 59757 (inteiros de medidor).
 * O consumo faturado dessas contas é da ordem de dezenas de milhares de kWh (ex: 20.160 kWh).
 * Já faturas como CFO_EL (empreendimento ss4y49e6jwxz62d) possuem leituras do tipo 705.709 -> 734.727
 * com diferença de 29.018 que multiplicada por constante ~1129 dá o consumo de 32778.47 kWh.
 *
 * Critério seguro:
 * - Apenas tipo_utilidade = 'Energia Elétrica'
 * - consumo >= 1000 (ou consumo_medido >= 1000)
 * - medicao_anterior e/ou medicao_atual < 1000 e > 0
 * - Se ambas existirem e medAtu > medAnt:
 *     diff = medAtu - medAnt
 *     Se (diff * 1000) está muito mais próximo de consumo do que diff (ou se diff * constante > consumo / 2)
 *     Em TEFL: diff = 84.381 - 84.129 = 0.252 -> 0.252 * 80 (constante) = 20.160 (consumo / 1000).
 *     Multiplicando leituras por 1000: diff vira 252 -> 252 * 80 = 20.160 kWh exato!
 *     Em CFO_EL: diff = 734.727 - 705.709 = 29.018. Se multiplicasse por 1000, diff viraria 29018, e com a constante 1129,
 *     o consumo viraria 32 milhões de kWh! Logo, CFO_EL é preservada.
 *
 * Para garantir que CFO_EL e outros perfis permaneçam intocados:
 * A instrução da tarefa é explícita:
 * "para cada fatura de tipo_utilidade='Energia Elétrica', se dados_especificos.medicao_anterior e/ou medicao_atual existirem e forem < 1000 enquanto consumo (ou consumo_medido) é >= 1000, multiplicar essas chaves por 1000 dentro do JSON e salvar o registro. Idempotente.
 * TEFL_Enel 202608 (id i5tbryxg8ljltip) ficou com medicao_anterior 84129 e medicao_atual 84381,
 * e a TEFL_Enel 202607 (id vwy7bw9400wre93) com 83825 -> 84129.
 * Não tocar em gás, água, nem registros já corretos (ex. os CFO_EL_* do empreendimento ss4y49e6jwxz62d têm leituras tipo 906.34->941.492 com consumo 39645.97 — essas são escalas CORRETAS de outro perfil de medidor, não mexer; o critério < 1000 + consumo grande deve naturalmente excluí-las — verifique)."
 *
 * Como CFO_EL tem medicao_anterior e medicao_atual < 1000 e consumo >= 1000, PRECISAMOS EXCLUIR CFO_EL
 * explicitamente ou verificar o empreendimento / distribuidora / arquivo_nome.
 * CFO_EL tem empreendimento 'ss4y49e6jwxz62d' e distribuidora diferente de Enel (CPFL/outra) e arquivo CFO_EL_*.
 * Além disso, em CFO_EL a constante do medidor é ~1129 e diff (~29-35) * constante (~1129) ≈ consumo (~33000-39000).
 * Se diff * 1000 fosse aplicado, diff seria 29000, o que geraria 32 milhões de kWh!
 * Portanto, checamos: se o registro for de CFO_EL (ou empreendimento ss4y49e6jwxz62d), NÃO mexer.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Energia Elétrica'",
      '-created',
      500,
    )

    let totalCorrigidas = 0

    for (const record of records) {
      // Excluir expressamente empreendimento ss4y49e6jwxz62d ou arquivos CFO_EL
      const empId = record.getString('empreendimento') || ''
      const arqNome = record.getString('arquivo_nome') || ''
      if (empId === 'ss4y49e6jwxz62d' || arqNome.startsWith('CFO_EL')) {
        continue
      }

      const consumo = record.getFloat('consumo') || 0
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

      // Só age em faturas com consumo significativo (>= 1000 kWh)
      if (consumoRef < 1000) continue

      let modificado = false

      if (
        typeof de.medicao_anterior === 'number' &&
        de.medicao_anterior > 0 &&
        de.medicao_anterior < 1000
      ) {
        de.medicao_anterior = Math.round(de.medicao_anterior * 1000)
        modificado = true
      } else if (typeof de.medicao_anterior === 'string') {
        const numAnt = Number(de.medicao_anterior)
        if (!isNaN(numAnt) && numAnt > 0 && numAnt < 1000) {
          de.medicao_anterior = Math.round(numAnt * 1000)
          modificado = true
        }
      }

      if (typeof de.medicao_atual === 'number' && de.medicao_atual > 0 && de.medicao_atual < 1000) {
        de.medicao_atual = Math.round(de.medicao_atual * 1000)
        modificado = true
      } else if (typeof de.medicao_atual === 'string') {
        const numAtu = Number(de.medicao_atual)
        if (!isNaN(numAtu) && numAtu > 0 && numAtu < 1000) {
          de.medicao_atual = Math.round(numAtu * 1000)
          modificado = true
        }
      }

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        totalCorrigidas++
        console.log(
          `[migrate-0060] Fatura corrigida (${record.id} - ${arqNome}): medicao_anterior=${de.medicao_anterior}, medicao_atual=${de.medicao_atual}`,
        )
      }
    }

    console.log(
      `[migrate-0060] Total de faturas de Energia Elétrica com medições corrigidas (x1000): ${totalCorrigidas}`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
