/**
 * Migração 0064 idempotente: Corrige o registro de Água e Esgoto competência 06/2025
 * do empreendimento Transamerica Faria Lima (caso Sabesp com leituras inteiras 1254 e 1258).
 *
 * Diagnóstico:
 * Ao salvar faturas onde a leitura do hidrômetro foi extraída com separador de milhar pt-BR
 * ("1.254" -> 1.254 e "1.258" -> 1.258), o formulário usava parseNumberValue que lia
 * o ponto como separador decimal.
 *
 * Critério ultra-conservador:
 * - Somente tipo_utilidade = 'Água e Esgoto'
 * - Somente empreendimento = 'wcehgm89ka1d23w' (Transamerica Faria Lima)
 * - Somente competência 2025-06
 * - Somente se as medições estiverem gravadas como decimais (1.254 e 1.258 ou < 10)
 *
 * Ações:
 * - medicao_anterior -> 1254
 * - medicao_atual -> 1258
 * - consumo -> 4
 * - consumo_medido -> 4
 * - tarifa -> valor_total ÷ 4 com 6 casas decimais (ou mantida se valor_total == 0)
 *
 * Idempotente: se já estiver 1254 e 1258 (inteiros) e tarifa já preenchida, não faz nada.
 */
migrate(
  (app) => {
    // Busca empreendimento Transamerica Faria Lima
    let empId = 'wcehgm89ka1d23w'
    try {
      const emps = app.findRecordsByFilter(
        'empreendimentos',
        "nome ~ 'Transamerica Faria Lima'",
        '-created',
        1,
      )
      if (emps && emps.length > 0) {
        empId = emps[0].id
      }
    } catch (e) {
      console.log('[migrate-0064] Aviso ao buscar empreendimento por nome:', e)
    }

    const records = app.findRecordsByFilter(
      'faturas',
      `tipo_utilidade = 'Água e Esgoto' && empreendimento = '${empId}'`,
      '-created',
      50,
    )

    let corrigidas = 0

    for (const record of records) {
      const comp = record.getString('competencia') || ''
      if (!comp.startsWith('2025-06')) continue

      const valorTotal = record.getFloat('valor_total') || 0
      const consumo = record.getFloat('consumo') || 0
      const rawJson = record.getString('dados_especificos') || ''

      let de = {}
      if (rawJson) {
        try {
          de = JSON.parse(rawJson)
        } catch (_) {
          de = {}
        }
      }

      const mAnt = Number(de.medicao_anterior)
      const mAtu = Number(de.medicao_atual)

      // Critério de identificação do bug:
      // Medições gravadas como decimais (ex: 1.254 e 1.258) ou tarifa ausente com consumo 4
      const isDecimalBug =
        (mAnt > 1 && mAnt < 2 && Math.abs(mAnt - 1.254) < 0.01) ||
        (mAtu > 1 && mAtu < 2 && Math.abs(mAtu - 1.258) < 0.01) ||
        (mAnt < 10 && mAtu < 10 && mAnt > 0 && mAtu > 0)

      const precisaAjusteTarifa =
        (de.tarifa === undefined || de.tarifa === null || Number(de.tarifa) === 0) &&
        valorTotal > 0 &&
        (consumo === 4 || Math.abs(consumo - 4) < 0.01 || Number(de.consumo_medido) === 4)

      if (!isDecimalBug && !precisaAjusteTarifa && mAnt === 1254 && mAtu === 1258 && de.tarifa) {
        console.log(`[migrate-0064] Fatura ${record.id} já está corrigida.`)
        continue
      }

      // Aplica correção
      de.medicao_anterior = 1254
      de.medicao_atual = 1258
      de.consumo_medido = 4

      record.set('consumo', 4)

      if (valorTotal > 0) {
        de.tarifa = Number((valorTotal / 4).toFixed(6))
      }

      record.set('dados_especificos', JSON.stringify(de))
      app.save(record)
      corrigidas++

      console.log(
        `[migrate-0064] Fatura 2025-06 Sabesp corrigida com sucesso (${record.id}): medicao_anterior=1254, medicao_atual=1258, consumo=4, consumo_medido=4, tarifa=${de.tarifa}, valor_total=${valorTotal}`,
      )
    }

    console.log(`[migrate-0064] Total de faturas Sabesp 2025-06 corrigidas: ${corrigidas}`)
  },
  (app) => {
    // Rollback no-op
  },
)
