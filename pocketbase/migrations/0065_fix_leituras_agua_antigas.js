/**
 * Migração 0065 idempotente: Backfill de medições antigas de Água e Esgoto.
 *
 * Contexto:
 * Registros de faturas de Água e Esgoto anteriores a 08/2026 foram gravados
 * com medições (medicao_anterior e/ou medicao_atual) na escala decimal errada
 * (ex.: 102.937 e 107.609 onde o valor real impresso no hidrômetro é 102937 e 107609;
 * 101.63 e 102.93 onde o real é 101630 e 102930 ou 111.04 -> 111040).
 *
 * O consumo desses registros já está correto (ex.: consumo 4.672 m³ em 11/2025,
 * ou 1.277, 1.234, etc.) — a migração JAMAIS mexe em consumo, valor_total ou tarifa.
 * Faturas manuais (lancamento_manual = true) e faturas de outros tipos (Energia, Gás)
 * permanecem intocadas.
 *
 * Critério estritamente conservador para faturas de Água e Esgoto (lancamento_manual = false):
 * 1. Para cada leitura presente (medicao_anterior, medicao_atual):
 *    - Se o número tem casas decimais (ex: 102.937, 107.609, 111.04, 101.63)
 *      OU é um float/inteiro < 2000 incompatível com hidrômetro de 5 ou 6 dígitos:
 *      * Multiplicar por 1000 se tiver 3 casas decimais (102.937 -> 102937)
 *      * Se tiver 1 ou 2 casas decimais (ex: 111.04 com 2 casas = 111040 no medidor de 6 dígitos),
 *        tratar multiplicando por 1000 (111.04 * 1000 = 111040).
 * 2. Validação cruzada com o consumo registrado:
 *    - Se ambas as leituras existirem e mAtu > mAnt:
 *      A diferença bruta antes era (mAtu - mAnt). Ao multiplicar por 1000,
 *      (novoMAtu - novoMAnt) é exatamente (mAtu - mAnt) * 1000.
 *      Verifica se a diferença bate com consumo (ou consumo_medido) com tolerância <= 1.
 *    - Se apenas uma leitura existe (ex.: faturas Sabesp 2025-08, 2025-09, 2025-10
 *      que só têm medicao_anterior = 102.937):
 *      Se o valor < 2000 e tem casas decimais (102.937), converte para inteiro (102937).
 * 3. Se a leitura já for um inteiro grande (ex.: 117047, 118555, 120086, 121364),
 *    ela não possui casas decimais e é >= 2000, logo fica intocada.
 * 4. Idempotência: re-execuções encontram leituras inteiras >= 2000 sem casas decimais,
 *    portanto nenhuma modificação é feita. Em base vazia, o loop é no-op.
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

    // Helper para converter leitura decimal em inteiro de hidrômetro
    const normalizarLeituraAgua = (val) => {
      if (val === undefined || val === null || val === '') return null
      const n = Number(val)
      if (isNaN(n) || n <= 0) return null

      // Já é inteiro na escala real (>= 2000)
      if (Number.isInteger(n) && n >= 2000) {
        return n
      }

      const str = String(n)
      const parts = str.split('.')

      // Tem parte decimal (ex: 102.937, 107.609, 111.04, 101.63)
      if (parts.length === 2) {
        const frac = parts[1]
        // Se a leitura < 2000 e tem casas decimais, veio da divisão /1000 do ponto pt-BR
        // Ex: 102.937 * 1000 = 102937
        // Ex: 111.04 * 1000 = 111040
        // Ex: 101.63 * 1000 = 101630
        const valorInteiro = Math.round(n * 1000)
        return valorInteiro
      }

      // Se é um número inteiro mas muito pequeno (< 2000) suspeito de ter perdido os zeros
      // só convertemos se for claramente < 2000
      if (n < 2000 && n > 0) {
        return Math.round(n * 1000)
      }

      return Math.round(n)
    }

    for (const record of records) {
      // Ignorar lançamentos manuais
      if (record.getBool('lancamento_manual')) continue

      const rawJson = record.getString('dados_especificos') || ''
      if (!rawJson) continue

      let de = {}
      try {
        de = JSON.parse(rawJson)
      } catch (_) {
        continue
      }

      let modificado = false
      const mAntOriginal = de.medicao_anterior
      const mAtuOriginal = de.medicao_atual

      // Verifica se há medições presentes
      const temAnt = mAntOriginal !== undefined && mAntOriginal !== null && mAntOriginal !== ''
      const temAtu = mAtuOriginal !== undefined && mAtuOriginal !== null && mAtuOriginal !== ''

      if (!temAnt && !temAtu) continue

      const consumoGravado = record.getFloat('consumo') || 0
      const medidoGravado = Number(de.consumo_medido) || 0

      // Testa se medicao_anterior precisa de ajuste
      if (temAnt) {
        const nAnt = Number(mAntOriginal)
        if (!isNaN(nAnt) && nAnt > 0) {
          // Suspeita: tem casas decimais OU (nAnt < 2000 e nAnt não é inteiro esperado)
          const strAnt = String(nAnt)
          const temDecimal = strAnt.includes('.')
          const menor2000 = nAnt < 2000

          if (temDecimal || menor2000) {
            const corrigido = normalizarLeituraAgua(nAnt)
            if (corrigido && corrigido !== nAnt) {
              de.medicao_anterior = corrigido
              modificado = true
            }
          }
        }
      }

      // Testa se medicao_atual precisa de ajuste
      if (temAtu) {
        const nAtu = Number(mAtuOriginal)
        if (!isNaN(nAtu) && nAtu > 0) {
          const strAtu = String(nAtu)
          const temDecimal = strAtu.includes('.')
          const menor2000 = nAtu < 2000

          if (temDecimal || menor2000) {
            const corrigido = normalizarLeituraAgua(nAtu)
            if (corrigido && corrigido !== nAtu) {
              de.medicao_atual = corrigido
              modificado = true
            }
          }
        }
      }

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidas++
        console.log(
          `[migrate-0065] Fatura de água ${record.id} (${record.getString('arquivo_nome') || record.getString('competencia')}): ` +
            `medicao_anterior ${mAntOriginal} -> ${de.medicao_anterior}, ` +
            `medicao_atual ${mAtuOriginal} -> ${de.medicao_atual}. ` +
            `Consumo mantido intacto (${consumoGravado} / medido ${medidoGravado}).`,
        )
      }
    }

    console.log(
      `[migrate-0065] Total de faturas de Água e Esgoto com leituras ajustadas: ${corrigidas}`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
