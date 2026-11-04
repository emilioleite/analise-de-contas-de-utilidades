/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0058: Corrige medições (leitura anterior e atual) de energia elétrica divididas por 1000.
 *
 * Contexto: Nas faturas de Energia Elétrica (ex: Enel Grupo B3), as medições foram extraídas
 * em MWh ou com separador decimal indevido (ex: 84.67 e 84.938 em vez de 84670 e 84938),
 * enquanto o consumo já foi corrigido e está na casa de dezenas de milhares de kWh (ex: 20.160 kWh).
 *
 * Critério conservador e idempotente:
 * 1. Apenas faturas de tipo 'Energia Elétrica';
 * 2. Somente registros onde consumo >= 1000 ou valor_total >= 1000;
 * 3. Somente medições > 0 e < 1000 (escala incorreta);
 * 4. Multiplica por 1000 arredondando para inteiro / 3 decimais conforme necessário;
 * 5. Não toca em Gás, Água nem em faturas que já estejam na escala correta (>= 1000).
 */
migrate(
  (app) => {
    const faturas = app.findRecordsByFilter(
      'faturas',
      "tipo_utilidade = 'Energia Elétrica'",
      '-created',
      500,
      0,
    )

    let totalCorrigidas = 0

    for (const fatura of faturas) {
      let rawDados = fatura.get('dados_especificos')
      if (!rawDados) continue

      let dados = null
      let wasString = false

      if (typeof rawDados === 'string') {
        wasString = true
        try {
          dados = JSON.parse(rawDados)
        } catch (_) {
          continue
        }
      } else if (typeof rawDados === 'object') {
        dados = Object.assign({}, rawDados)
      }

      if (!dados || typeof dados !== 'object') continue

      const consumo = Number(fatura.get('consumo') || dados.consumo_medido || 0)
      const valorTotal = Number(fatura.get('valor_total') || dados.fatura_total || 0)

      // Se consumo ou valor total não estiverem no patamar de fatura comercial / milhares, não altera
      if (consumo < 1000 && valorTotal < 1000) continue

      let changed = false

      // Leitura Anterior
      const medAnt = Number(dados.medicao_anterior)
      if (!isNaN(medAnt) && medAnt > 0 && medAnt < 1000) {
        dados.medicao_anterior = Math.round(medAnt * 1000 * 1000) / 1000
        changed = true
      }

      // Leitura Atual
      const medAtu = Number(dados.medicao_atual)
      if (!isNaN(medAtu) && medAtu > 0 && medAtu < 1000) {
        dados.medicao_atual = Math.round(medAtu * 1000 * 1000) / 1000
        changed = true
      }

      if (changed) {
        fatura.set('dados_especificos', wasString ? JSON.stringify(dados) : dados)
        app.save(fatura)
        totalCorrigidas++
      }
    }

    console.log(
      `[migracao_0058] Medições de Energia Elétrica corrigidas (x1000): ${totalCorrigidas} registro(s).`,
    )
  },
  (app) => {
    // Reversão opcional (não destrutiva)
  },
)
