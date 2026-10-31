migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('faturas')
    const field = col.fields.getByName('valor_total')
    if (field) {
      field.required = false
      app.save(col)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('faturas')
      const field = col.fields.getByName('valor_total')
      if (field) {
        field.required = true
        app.save(col)
      }
    } catch (_) {}
  },
)
