/**
 * Migração 0073 idempotente: corrige a fatura de Água e Esgoto Sabesp competência
 * 2025-06 (ex.: id `1ok4mi48u1m7y59`, empreendimento `wcehgm89ka1d23w` — caso
 * TEFL_Sabeps 202506) que ainda carrega a premissa antiga ERRADA de milhar pt-BR:
 * consumo 3.796 e tarifa 1,27.
 *
 * Prova aritmética contra a fatura (validada com o usuário):
 *  - discriminização: "De 0,00 até 10 ... Mínimo 3,796 4.820,92" (residencial)
 *    e "Mínimo 7,660 76,60" (comercial) — "3,796" e "7,660" são TARIFAS R$/m³,
 *    NUNCA milhar de volume;
 *  - 127 economias × 10 m³ = 1.270 m³; 1.270 × 3,796 = 4.820,92 (exato);
 *  - bloco comercial: 10 m³ × 7,660 = 76,60 (exato);
 *  - consumo total faturado = 1.270 + 10 = 1.280 m³;
 *  - tarifa do campo específico = tarifa impressa do bloco de maior valor (3,796).
 *
 * Critério de seleção (por condição, nunca id fixo — no-op em base vazia):
 *  - tipo_utilidade = 'Água e Esgoto', não manual;
 *  - competência 2025-06;
 *  - assinatura do erro antigo: consumo ≈ 3.796 (>= 1000) OU consumo_medido ≈ 3.796,
 *    com valor_total ≈ 9.844,01 (a fatura TEFL_Sabeps 202506);
 *  - leituras truncadas (diferença ≈ 4 m³) são anuladas, como faz o hook v0.0.104.
 *
 * Correção (preserva o restante do JSON `dados_especificos`):
 *  - consumo (top-level) e consumo_medido -> 1280;
 *  - tarifa -> 3,796 (tarifa impressa do bloco residencial, que é o de maior valor);
 *  - medições (medicao_anterior/medicao_atual) -> null (truncadas: 1254/1258);
 *  - aviso_extracao explica a correção, no padrão honesto do sistema.
 *
 * Idempotente: após a correção, consumo = 1280 (integer, fora da assinatura do erro),
 * então re-executar não mexe. Não toca nas outras 16 faturas Sabesp nem em mais nada.
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
      const comp = record.getString('competencia') || ''
      if (!comp.startsWith('2025-06')) continue
      if (record.getBool('lancamento_manual')) continue

      const valorTotal = record.getFloat('valor_total') || 0
      // A fatura-alvo tem valor_total 9844,01; aceita pequena variação de leitura/gravação.
      if (!(valorTotal > 9800 && valorTotal < 9890)) continue

      const rawJson = record.getString('dados_especificos') || ''
      let de = {}
      if (rawJson) {
        try {
          de = JSON.parse(rawJson)
        } catch (_) {
          de = {}
        }
      }

      const consumoTop = record.getFloat('consumo') || 0
      const cm = Number(de.consumo_medido) || 0
      const tarifaAntiga = Number(de.tarifa) || 0

      // Assinatura do erro da premissa antiga (milhar pt-BR): consumo ~ 3.796
      // e tarifa derivada dele (~ 1,27). Já corrigida => consumo ~ 1280, tarifa ~ 3,796.
      const consumoErrado = (consumoTop > 3700 && consumoTop < 3800) || (cm > 3700 && cm < 3800)
      const tarifaErrada = tarifaAntiga > 0 && tarifaAntiga < 2
      const jaCorreta = Math.round(consumoTop) === 1280 && tarifaAntiga > 3.5 && tarifaAntiga < 4

      if (jaCorreta) {
        console.log(
          `[migrate-0073] Fatura ${record.id} já está correta (consumo 1280, tarifa ${tarifaAntiga}). Nada a fazer.`,
        )
        continue
      }
      if (!consumoErrado && !tarifaErrada) continue

      de.consumo_medido = 1280
      de.tarifa = 3.796
      // Tarifa analítica antiga (1,27) era calculada sobre o consumo errado — removida.
      de.tarifa_analitica = null
      de.tarifaUnitaria = null
      de.valor_agua = 4820.92
      // Medições truncadas no PDF (1254 → 1258): anuladas, como no hook v0.0.104.
      de.medicao_anterior = null
      de.medicao_atual = null
      de.aviso_leituras =
        'As leituras impressas na fatura parecem truncadas/incompletas no PDF (config MISTA com múltiplos medidores). Medição Anterior/Atual anuladas — preencha manualmente conforme a fatura.'
      de.aviso_extracao =
        'Consumo corrigido para 1280 m³ e tarifa para R$ 3,796/m³ (tarifa impressa do bloco residencial da discriminização: 127 economias × 10 m³ × 3,796 = 4.820,92; bloco comercial 10 × 7,660 = 76,60). O valor anterior (3.796 m³ / tarifa 1,27) veio da premissa errada de milhar pt-BR — "3,796" da discriminização é TARIFA, não volume.'

      record.set('consumo', 1280)
      record.set('dados_especificos', JSON.stringify(de))
      app.save(record)
      corrigidas++

      console.log(
        `[migrate-0073] Fatura Sabesp 2025-06 corrigida (${record.id} - ${
          record.getString('arquivo_nome') || 'sem arquivo'
        }): consumo ${consumoTop} -> 1280; consumo_medido ${cm} -> 1280; tarifa ${tarifaAntiga} -> 3.796; medições anuladas (truncadas).`,
      )
    }

    console.log(
      `[migrate-0073] Total de faturas Sabesp 2025-06 corrigidas: ${corrigidas} (no-op em base vazia).`,
    )
  },
  (app) => {
    // Rollback no-op (idempotente)
  },
)
