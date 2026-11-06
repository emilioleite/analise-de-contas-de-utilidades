/**
 * Migração 0066 idempotente: Backfill de medições antigas de faturas de Gás (Comgás).
 *
 * Contexto:
 * Registros de faturas de Gás (especialmente Comgás TESA, TEFL e LUM) gravados
 * anteriormente possuem medições (medicao_anterior e/ou medicao_atual) na escala
 * decimal incorreta devido à interpretação do ponto de milhar pt-BR como separador decimal
 * (ex.: "401.571" e "403.000" gravados como 401.571 e 403, quando os valores reais de
 * medidor de gás são 401571 e 403000; "95.328" e "95.444" -> 95328 e 95444;
 * "18.064" e "19.792" -> 18064 e 19792; etc.).
 *
 * O consumo desses registros (consumo / consumo_corrigido faturado) já está correto.
 * Esta migração preserva estritamente:
 * - consumo
 * - valor_total
 * - tarifa
 * - lancamento_manual = true (nunca mexer)
 * - faturas de Água e Energia (nunca mexer)
 *
 * Critério estritamente conservador (espelhando a migração 0065 de água):
 * 1. Filtrar faturas com tipo_utilidade = 'Gás' e lancamento_manual = false.
 * 2. Ler medicao_anterior e medicao_atual de dados_especificos.
 * 3. Normalização de escala:
 *    - Se uma leitura já for inteiro na escala real (>= 2000 sem parte decimal), fica intacta.
 *    - Se tiver casas decimais OU for inteiro/float < 2000 incompatível com medidor de gás cumulativo:
 *      Multiplicar por 1000 (ex: 401.571 * 1000 = 401571; 403 * 1000 = 403000; 113 * 1000 = 113000).
 * 4. Validação cruzada estrita de coerência:
 *    - Quando ambas as leituras existem:
 *      Calcula a nova diferença diff = Math.abs(novoAtu - novoAnt).
 *      A diferença DEVE bater com consumo_medido (com tolerância <= 2 m³)
 *      OU com consumo registrado / consumo_corrigido (tolerância do fator de correção PTZ <= 25%).
 *      Se a diferença não for coerente com o consumo, NÃO mexe.
 *    - Se apenas uma medição existe (ex: só anterior ou só atual):
 *      Só corrige se for número com casas decimais (ex: 102.937 -> 102937).
 * 5. Idempotência:
 *    Re-execuções encontram leituras inteiras >= 2000 sem casas decimais, logo nenhuma
 *    alteração é feita. Em base vazia, o loop é no-op.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter('faturas', "tipo_utilidade = 'Gás'", '-created', 500)

    let corrigidas = 0

    // Helper para converter leitura de medidor de gás para inteiro na escala real
    const normalizarLeituraGas = (val) => {
      if (val === undefined || val === null || val === '') return null
      const n = Number(val)
      if (isNaN(n) || n <= 0) return null

      // Já é inteiro na escala real (>= 2000 e sem parte decimal)
      if (Number.isInteger(n) && n >= 2000) {
        return n
      }

      const str = String(n)
      const parts = str.split('.')

      // Tem parte decimal (ex: 401.571, 95.328, 18.064, 429.209)
      if (parts.length === 2) {
        return Math.round(n * 1000)
      }

      // Se é um número inteiro mas < 2000 (ex: 403, 113, 500) suspeito de ter perdido os zeros
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

      const mAntOriginal = de.medicao_anterior
      const mAtuOriginal = de.medicao_atual

      const temAnt = mAntOriginal !== undefined && mAntOriginal !== null && mAntOriginal !== ''
      const temAtu = mAtuOriginal !== undefined && mAtuOriginal !== null && mAtuOriginal !== ''

      if (!temAnt && !temAtu) continue

      const consumoGravado = record.getFloat('consumo') || 0
      const medidoGravado = Number(de.consumo_medido) || 0
      const consumoCorrigidoGravado = Number(de.consumo_corrigido) || 0

      let novoAnt = temAnt ? normalizarLeituraGas(mAntOriginal) : null
      let novoAtu = temAtu ? normalizarLeituraGas(mAtuOriginal) : null

      let modificado = false

      // Se ambas as leituras existem, aplicar validação cruzada estrita
      if (temAnt && temAtu && novoAnt !== null && novoAtu !== null) {
        const precisaAjusteAnt = novoAnt !== Number(mAntOriginal)
        const precisaAjusteAtu = novoAtu !== Number(mAtuOriginal)

        if (precisaAjusteAnt || precisaAjusteAtu) {
          const diffNovo = Math.abs(novoAtu - novoAnt)

          // 1. diffNovo bate com consumo_medido gravado (ex: medido=1029 e diff=1429? Ou medido=869 e diff=869?)
          const medidoNormalizado =
            medidoGravado > 0 && medidoGravado < 10 && String(medidoGravado).includes('.')
              ? Math.round(medidoGravado * 1000)
              : medidoGravado

          const bateComMedido = medidoNormalizado > 0 && Math.abs(diffNovo - medidoNormalizado) <= 2

          // 2. diffNovo bate com consumo_corrigido / consumo gravado (com tolerância do Fator PTZ ~25%)
          const refConsumo = consumoGravado || consumoCorrigidoGravado
          const bateComConsumo =
            refConsumo > 0 && Math.abs(diffNovo - refConsumo) <= Math.max(5, refConsumo * 0.25)

          // 3. Ou a diferença original multiplicada por 1000 bate
          const diffOriginal = Math.abs(Number(mAtuOriginal) - Number(mAntOriginal))
          const diffOriginal1000 = Math.round(diffOriginal * 1000)
          const bateOriginal1000 =
            (medidoNormalizado > 0 && Math.abs(diffOriginal1000 - medidoNormalizado) <= 2) ||
            (refConsumo > 0 &&
              Math.abs(diffOriginal1000 - refConsumo) <= Math.max(5, refConsumo * 0.25))

          if (bateComMedido || bateComConsumo || bateOriginal1000) {
            de.medicao_anterior = novoAnt
            de.medicao_atual = novoAtu
            modificado = true
          } else {
            console.log(
              `[migrate-0066] Fatura de gás ${record.id} (${record.getString('arquivo_nome') || record.getString('competencia')}): ` +
                `Leituras não bateram com consumo (diffNovo=${diffNovo}, medido=${medidoGravado}, consumo=${consumoGravado}). Mantendo intocada.`,
            )
          }
        }
      } else {
        // Se apenas uma medição existe (ex: só anterior ou só atual)
        if (temAnt && novoAnt !== null && novoAnt !== Number(mAntOriginal)) {
          const n = Number(mAntOriginal)
          if (String(n).includes('.')) {
            de.medicao_anterior = novoAnt
            modificado = true
          }
        }
        if (temAtu && novoAtu !== null && novoAtu !== Number(mAtuOriginal)) {
          const n = Number(mAtuOriginal)
          if (String(n).includes('.')) {
            de.medicao_atual = novoAtu
            modificado = true
          }
        }
      }

      if (modificado) {
        record.set('dados_especificos', JSON.stringify(de))
        app.save(record)
        corrigidas++
        console.log(
          `[migrate-0066] Fatura de gás Comgás ${record.id} (${record.getString('arquivo_nome') || record.getString('competencia')}): ` +
            `medicao_anterior ${mAntOriginal} -> ${de.medicao_anterior}, ` +
            `medicao_atual ${mAtuOriginal} -> ${de.medicao_atual}. ` +
            `Consumo mantido intacto (${consumoGravado}).`,
        )
      }
    }

    console.log(`[migrate-0066] Total de faturas de Gás com leituras ajustadas: ${corrigidas}`)
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
