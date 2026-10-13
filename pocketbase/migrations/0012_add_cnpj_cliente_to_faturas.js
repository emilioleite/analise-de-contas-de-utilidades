migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('faturas')
    if (!col.fields.getByName('cnpj_cliente')) {
      col.fields.add(
        new TextField({
          name: 'cnpj_cliente',
          required: false,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('faturas')
      const field = col.fields.getByName('cnpj_cliente')
      if (field) {
        col.fields.removeByName('cnpj_cliente')
        app.save(col)
      }
    } catch (_) {}
  },
)
