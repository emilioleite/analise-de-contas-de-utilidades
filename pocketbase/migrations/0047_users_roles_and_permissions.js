migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    // 1. Adicionar campos 'role' e 'status' à coleção users
    if (!users.fields.getByName('role')) {
      users.fields.add(
        new SelectField({
          name: 'role',
          values: ['admin', 'user'],
          maxSelect: 1,
        }),
      )
    }

    if (!users.fields.getByName('status')) {
      users.fields.add(
        new SelectField({
          name: 'status',
          values: ['active', 'inactive', 'pending'],
          maxSelect: 1,
        }),
      )
    }

    // 2. Regras de acesso em users:
    // list/view: Qualquer usuário logado pode ver outros usuários (necessário para listagem corporativa / admin)
    // create: Admin pode criar
    // update: Usuário pode atualizar a si mesmo (mas não pode mudar seu próprio role/status), OU Admin pode atualizar qualquer usuário
    // delete: Admin pode deletar, ou usuário pode deletar a si mesmo (se for permitido, mas usamos desativação lógica)
    users.listRule = "@request.auth.id != ''"
    users.viewRule = "@request.auth.id != ''"
    users.createRule = "@request.auth.id != '' && @request.auth.role = 'admin'"
    users.updateRule =
      "@request.auth.role = 'admin' || (@request.auth.id = id && @request.body.role:changed = false && @request.body.status:changed = false)"
    users.deleteRule = "@request.auth.role = 'admin'"

    app.save(users)

    // 3. Atualizar regras de empreendimentos:
    // list/view: Todos autenticados veem
    // create: Apenas admin
    // update: Apenas admin
    // delete: Apenas admin
    const empreendimentos = app.findCollectionByNameOrId('empreendimentos')
    empreendimentos.listRule = "@request.auth.id != ''"
    empreendimentos.viewRule = "@request.auth.id != ''"
    empreendimentos.createRule = "@request.auth.role = 'admin'"
    empreendimentos.updateRule = "@request.auth.role = 'admin'"
    empreendimentos.deleteRule = "@request.auth.role = 'admin'"
    app.save(empreendimentos)

    // 4. Atualizar regras de faturas:
    // list/view: Todos autenticados veem
    // create/update: Qualquer autenticado (pois colaboradores lançam faturas e extraem)
    // delete: Apenas admin
    const faturas = app.findCollectionByNameOrId('faturas')
    faturas.listRule = "@request.auth.id != ''"
    faturas.viewRule = "@request.auth.id != ''"
    faturas.createRule = "@request.auth.id != ''"
    faturas.updateRule = "@request.auth.id != ''"
    faturas.deleteRule = "@request.auth.role = 'admin'"
    app.save(faturas)

    // 5. Atualizar o usuário andino@aquecetecnica.com.br para admin e active
    try {
      const adminUser = app.findAuthRecordByEmail('_pb_users_auth_', 'andino@aquecetecnica.com.br')
      adminUser.set('role', 'admin')
      adminUser.set('status', 'active')
      app.save(adminUser)
    } catch (_) {}

    // 6. Atualizar todos os usuários existentes sem role para 'user' ou 'admin', e status 'active'
    try {
      app
        .db()
        .newQuery(
          "UPDATE users SET role = 'user' WHERE role IS NULL OR role = '' AND email != 'andino@aquecetecnica.com.br'",
        )
        .execute()
      app
        .db()
        .newQuery("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''")
        .execute()
    } catch (_) {}
  },
  (app) => {
    // Reverter
    try {
      const users = app.findCollectionByNameOrId('_pb_users_auth_')
      users.listRule = 'id = @request.auth.id'
      users.viewRule = 'id = @request.auth.id'
      users.createRule = ''
      users.updateRule = 'id = @request.auth.id'
      users.deleteRule = 'id = @request.auth.id'
      const roleField = users.fields.getByName('role')
      if (roleField) users.fields.remove(roleField)
      const statusField = users.fields.getByName('status')
      if (statusField) users.fields.remove(statusField)
      app.save(users)

      const empreendimentos = app.findCollectionByNameOrId('empreendimentos')
      empreendimentos.createRule = "@request.auth.id != ''"
      empreendimentos.updateRule = "@request.auth.id != ''"
      empreendimentos.deleteRule = "@request.auth.id != ''"
      app.save(empreendimentos)

      const faturas = app.findCollectionByNameOrId('faturas')
      faturas.deleteRule = "@request.auth.id != ''"
      app.save(faturas)
    } catch (_) {}
  },
)
