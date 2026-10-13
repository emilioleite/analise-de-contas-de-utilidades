migrate(
  (app) => {
    const empreendimentosCol = app.findCollectionByNameOrId('empreendimentos')

    const collection = new Collection({
      name: 'faturas',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'empreendimento',
          type: 'relation',
          required: true,
          collectionId: empreendimentosCol.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'tipo_utilidade',
          type: 'select',
          required: true,
          values: ['Energia Elétrica', 'Água e Esgoto', 'Gás'],
          maxSelect: 1,
        },
        { name: 'competencia', type: 'date', required: true },
        { name: 'valor_total', type: 'number', required: true },
        { name: 'consumo', type: 'number' },
        { name: 'unidade_consumo', type: 'text' },
        { name: 'numero_fatura', type: 'text' },
        { name: 'cnpj_fornecedor', type: 'text' },
        { name: 'cnpj_validado', type: 'bool' },
        { name: 'arquivo_nome', type: 'text' },
        { name: 'vencimento', type: 'date' },
        { name: 'dados_especificos', type: 'json' },
        {
          name: 'owner',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_faturas_tipo ON faturas (tipo_utilidade)',
        'CREATE INDEX idx_faturas_competencia ON faturas (competencia)',
        'CREATE INDEX idx_faturas_empreendimento ON faturas (empreendimento)',
        'CREATE INDEX idx_faturas_owner ON faturas (owner)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('faturas')
      app.delete(collection)
    } catch (_) {}
  },
)
