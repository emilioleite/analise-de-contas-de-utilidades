migrate(
  (app) => {
    const collection = new Collection({
      name: 'empreendimentos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'nome', type: 'text', required: true },
        { name: 'cnpj', type: 'text', required: true },
        { name: 'endereco', type: 'text' },
        {
          name: 'tipo',
          type: 'select',
          values: ['Comercial', 'Industrial', 'Residencial', 'Misto'],
          maxSelect: 1,
        },
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
        'CREATE UNIQUE INDEX idx_empreendimentos_cnpj ON empreendimentos (cnpj)',
        'CREATE INDEX idx_empreendimentos_owner ON empreendimentos (owner)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('empreendimentos')
      app.delete(collection)
    } catch (_) {}
  },
)
