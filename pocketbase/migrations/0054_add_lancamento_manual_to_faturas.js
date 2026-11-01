migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('faturas')
    if (!col.fields.getByName('lancamento_manual')) {
      col.fields.add(
        new BoolField({
          name: 'lancamento_manual',
          required: false,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('faturas')
      const field = col.fields.getByName('lancamento_manual')
      if (field) {
        col.fields.removeByName('lancamento_manual')
        app.save(col)
      }
    } catch (_) {}
  },
)
