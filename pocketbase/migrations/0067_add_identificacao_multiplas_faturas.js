/**
 * Migração 0067 idempotente: campos de identificação de múltiplas faturas por mês.
 *
 * Contexto:
 * O modelo passa a permitir várias faturas da mesma utilidade no mesmo
 * empreendimento/competência:
 * - Gás: GLP com 2-4 NFe mensais e GN setorizado por medidor/destino
 *   (caldeira, piscina, cozinha...). Cada fatura recebe uma "identificacao"
 *   (nome do destino/setor ou número do medidor/NFe).
 * - Energia Elétrica: clientes em mercado livre têm 2 faturas mensais —
 *   Concessionária (TUSD / uso da rede) e Mercado Livre (TE / energia).
 *   O campo "tipo_fatura_energia" distingue as duas séries na análise.
 *
 * A migração apenas garante que os campos existam na coleção `faturas`
 * (texto simples, vazio por padrão). Faturas antigas ficam como estão:
 * sem identificacao = rótulo padrão "Geral"; sem tipo_fatura_energia =
 * tratadas como Concessionária.
 *
 * Idempotente: criarField só é chamado quando a coluna ainda não existe;
 * em re-execuções (ou em base vazia) nenhuma alteração é feita.
 */
migrate(
  (app) => {
    const colecao = app.findCollectionByNameOrId('faturas')

    const temCampo = (nome) => colecao.fields.some((f) => f.name === nome)

    if (!temCampo('identificacao')) {
      const campo = new Field({
        name: 'identificacao',
        type: 'text',
        required: false,
        presentable: false,
      })
      colecao.fields.add(campo)
      console.log('[migrate-0067] Campo "identificacao" criado na coleção faturas')
    }

    if (!temCampo('tipo_fatura_energia')) {
      const campo = new Field({
        name: 'tipo_fatura_energia',
        type: 'text',
        required: false,
        presentable: false,
      })
      colecao.fields.add(campo)
      console.log('[migrate-0067] Campo "tipo_fatura_energia" criado na coleção faturas')
    }

    app.save(colecao)
  },
  (app) => {
    // Rollback no-op: preserva dados em re-execuções (idempotente)
  },
)
