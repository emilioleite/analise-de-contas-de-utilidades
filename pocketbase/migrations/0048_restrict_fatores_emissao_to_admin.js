migrate(
  (app) => {
    const fatores = app.findCollectionByNameOrId('fatores_emissao')

    // Manter leitura para qualquer usuário autenticado
    // Restringir escrita (create, update, delete) exclusivamente para admin
    fatores.listRule = "@request.auth.id != ''"
    fatores.viewRule = "@request.auth.id != ''"
    fatores.createRule = "@request.auth.role = 'admin'"
    fatores.updateRule = "@request.auth.role = 'admin'"
    fatores.deleteRule = "@request.auth.role = 'admin'"

    app.save(fatores)
  },
  (app) => {
    try {
      const fatores = app.findCollectionByNameOrId('fatores_emissao')
      fatores.createRule = "@request.auth.id != ''"
      fatores.updateRule = "@request.auth.id != ''"
      fatores.deleteRule = "@request.auth.id != ''"
      app.save(fatores)
    } catch (_) {}
  },
)
