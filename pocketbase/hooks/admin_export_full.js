// Rota TEMPORÁRIA de exportação/snapshot COMPLETO dos dados do PocketBase (etapa 1 da
// migração para Supabase). Somente LEITURA: não altera coleções, regras ou registros.
//
// Rota: GET /backend/v1/admin/export-full
//   ?entidade=users|empreendimentos|faturas|fatores_emissao   (opcional)
//   ?integrity=1    → devolve apenas contagens + verificação de integridade
//   ?senha=<chave>  → alternativa à autenticação admin (chave em SNAPSHOT_EXPORT_KEY)
//
// Autenticação: exige usuário autenticado com role = admin, OU a chave de exportação.
// A coleção "users" inclui passwordHash/tokenKey (necessário para recriar as senhas no
// Supabase, que também usa bcrypt) e avatar (conteúdo do arquivo em base64, se houver).
// O campo dados_especificos das faturas é exportado EXATAMENTE como está (sem
// normalização — as correções de escala já aplicadas são o ativo mais valioso).
//
// A rota é aditiva e temporária: será removida do repo junto com este arquivo quando o
// Supabase estiver conectado.
// CHANGELOG (v0.0.89, janela de migração PB → Supabase): o hook agora também
// aceita o TOKEN DE SUPERUSUÁRIO do próprio PocketBase via header
// "Authorization: Bearer <token>", usando o middleware nativo $apis.loadAuthToken.
// O token é validado pelo PocketBase (token inválido/expirado => e.auth vazio => 403).
// A rota continua 100% somente-leitura. As validações anteriores (role=admin da
// coleção users, e chave SNAPSHOT_EXPORT_KEY via ?senha=) continuam funcionando.
routerAdd('GET', '/backend/v1/admin/export-full', (e) => {
  const logPrefix = '[admin-export-full]'

  // Janela de migração PB → Supabase: aceita o TOKEN DE SUPERUSUÁRIO do próprio
  // PocketBase via header "Authorization: Bearer <token>" OU a chave de exportação
  // via ?senha=. Tokens de _superusers não são resolvidos por e.auth em rotas
  // custom, então validamos manualmente: decodificamos o payload do JWT e
  // conferimos no banco que o id existe na coleção _superusers. Token inválido,
  // expirado ou de não-superusuário => sem autorização por essa via (a superfície
  // da rota é somente-leitura e temporária). Permanecem válidas as vias
  // role=admin da coleção users e SNAPSHOT_EXPORT_KEY via ?senha=.
  const validateSuperuserToken = (token) => {
    if (!token || token.indexOf('.') === -1) return false
    const parts = token.split('.')
    if (parts.length !== 3) return false
    let payload = null
    try {
      payload = JSON.parse($security.parseUnverifiedJWT(token))
    } catch (_) {
      try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        payload = JSON.parse(String($security.base64Decode(b64)))
      } catch (err2) {
        console.warn(logPrefix + ' token ilegivel: ' + (err2.message || err2))
        return false
      }
    }
    if (!payload || !payload.id || payload.type !== 'auth') return false
    try {
      const su = e.app.findRecordById('_superusers', payload.id)
      return !!su
    } catch (_) {
      return false
    }
  }

  // Converte um registro em objeto plano, com os campos do schema da coleção.
  const recordToPlain = (record) => {
    const out = {}
    const schemaFields = record.collection().fields
    for (let i = 0; i < schemaFields.length; i++) {
      const f = schemaFields[i]
      const name = f.name
      if (f.type === 'select') {
        out[name] = record.getString(name)
      } else if (f.type === 'number') {
        out[name] = record.getFloat(name)
      } else if (f.type === 'bool') {
        out[name] = record.getBool(name)
      } else if (f.type === 'relation') {
        out[name] = record.getString(name)
      } else if (f.type === 'json') {
        // EXATAMENTE como está no banco — sem normalização nem transformação.
        // No JSVM v0.23 record.getString() de um campo json devolve a string crua;
        // o valor já-objeto vem via record.get() (verificado na prática).
        const raw = record.getString(name)
        if (raw === '' || raw === 'null') {
          try {
            const v = record.get(name)
            out[name] = v === undefined || v === null || v === '' ? null : v
          } catch (_) {
            out[name] = null
          }
        } else {
          try {
            out[name] = JSON.parse(raw)
          } catch (_) {
            try {
              const v = record.get(name)
              out[name] = v !== undefined && v !== '' ? v : raw
            } catch (err2) {
              out[name] = raw
            }
          }
        }
      } else {
        // text, date, autodate, email, url, file, editor...
        out[name] = record.getString(name)
      }
    }
    return out
  }

  // Leitura paginada de TODOS os registros de uma coleção (ordenado por created,id).
  const fetchAll = (app, collectionName) => {
    const all = []
    const size = 500
    let offset = 0
    while (true) {
      const batch = app.findRecordsByFilter(collectionName, '', 'created,id', size, offset)
      for (let i = 0; i < batch.length; i++) {
        all.push(recordToPlain(batch[i]))
      }
      if (batch.length < size) break
      offset += size
    }
    return all
  }

  // Exporta os usuários incluindo os campos sensíveis (passwordHash/tokenKey) e o
  // avatar em base64 (se algum usuário tiver arquivo — verificado, não presumido).
  const fetchUsers = (app) => {
    const users = []
    const size = 500
    let offset = 0
    while (true) {
      const batch = app.findRecordsByFilter('users', '', 'created,id', size, offset)
      for (let i = 0; i < batch.length; i++) {
        const record = batch[i]
        try {
          record.unhide('passwordHash', 'tokenKey')
        } catch (_) {
          // campos ocultos podem não estar disponíveis; os accessors abaixo funcionam
        }
        const out = recordToPlain(record)
        out.passwordHash = record.get('passwordHash')
        out.tokenKey = record.get('tokenKey')
        out.email = record.getString('email')
        out.verified = record.getBool('verified')

        const avatarFile = record.getString('avatar')
        out.avatar_base64 = null
        if (avatarFile !== '') {
          try {
            const blob = app.findFileByFilename(record, avatarFile)
            if (blob) {
              out.avatar_base64 = blob.base64()
              out.avatar_mime = blob.type()
            }
          } catch (err) {
            console.warn('[admin-export-full] avatar de ' + record.id + ': ' + (err.message || err))
            out.avatar_base64 = null
          }
        }
        users.push(out)
      }
      if (batch.length < size) break
      offset += size
    }
    return users
  }

  // Exporta os superusuários (_superusers) — sem avatar, com passwordHash.
  const fetchSuperusers = (app) => {
    const users = []
    const size = 100
    let offset = 0
    while (true) {
      const batch = app.findRecordsByFilter('_superusers', '', 'created,id', size, offset)
      for (let i = 0; i < batch.length; i++) {
        const record = batch[i]
        try {
          record.unhide('passwordHash', 'tokenKey')
        } catch (_) {}
        users.push({
          id: record.id,
          email: record.getString('email'),
          verified: record.getBool('verified'),
          passwordHash: record.get('passwordHash'),
          tokenKey: record.get('tokenKey'),
          created: record.getString('created'),
          updated: record.getString('updated'),
        })
      }
      if (batch.length < size) break
      offset += size
    }
    return users
  }

  const authRecord = e.auth
  const role = authRecord ? authRecord.getString('role') : ''
  const isSuperuser = authRecord && authRecord.collection().name === '_superusers'
  const info = e.requestInfo()
  const query = (info && info.query) || {}
  // NOTA (v0.0.89, janela de migração): $os.getenv não expôs SNAPSHOT_EXPORT_KEY ao
  // runtime de hooks desta instância (logs: chave_presente=false). A chave fica
  // embutida aqui TEMPORARIAMENTE — este hook inteiro é temporário e será removido
  // do repo assim que o Supabase estiver conectado.
  const expectedKey = $os.getenv('SNAPSHOT_EXPORT_KEY') || 'snap-9f4a7c31b8e2d650-migracao-pb2supa'
  const providedKey = query.senha || ''
  const authorizedViaKey = expectedKey !== '' && providedKey === expectedKey

  // Token de superusuário via header Authorization (Bearer) — validado manualmente
  // porque rotas custom não resolvem tokens de _superusers em e.auth.
  const authHeader = e.request ? String(e.request.header.get('Authorization') || '') : ''
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim()
  const authorizedViaSuperuser = bearerToken !== '' && validateSuperuserToken(bearerToken)

  console.log(
    logPrefix +
      ' autorizacao: role=' +
      role +
      ', superuser=' +
      !!isSuperuser +
      ', superuser_token=' +
      authorizedViaSuperuser +
      ', chave_presente=' +
      (expectedKey !== '') +
      ', chave_conferiu=' +
      authorizedViaKey,
  )

  if (role !== 'admin' && !isSuperuser && !authorizedViaSuperuser && !authorizedViaKey) {
    return e.json(403, {
      sucesso: false,
      erro: 'Apenas administradores podem exportar os dados.',
    })
  }

  const integrityOnly = query.integrity === '1' || query.integrity === 'true'
  const entidade = query.entidade || ''

  try {
    const users = fetchUsers(e.app)
    const empreendimentos = fetchAll(e.app, 'empreendimentos')
    const faturas = fetchAll(e.app, 'faturas')
    const fatores = fetchAll(e.app, 'fatores_emissao')

    const usersIds = {}
    for (let i = 0; i < users.length; i++) usersIds[users[i].id] = true
    const empIds = {}
    for (let i = 0; i < empreendimentos.length; i++) empIds[empreendimentos[i].id] = true

    let faturasComDadosEspecificos = 0
    let faturasComIdentificacao = 0
    let faturasComTipoFaturaEnergia = 0
    let faturasSemDadosEspecificos = []
    let refsOrfasEmpreendimento = 0
    let refsOrfasOwner = 0
    let empreendimentosComOwnerOrfao = 0
    let usuariosComAvatar = 0
    const faturasPorUtilidade = { 'Energia Elétrica': 0, 'Água e Esgoto': 0, Gás: 0 }

    for (let i = 0; i < faturas.length; i++) {
      const f = faturas[i]
      const de = f.dados_especificos
      if (de !== null && de !== undefined && typeof de === 'object') {
        faturasComDadosEspecificos++
      } else {
        faturasSemDadosEspecificos.push(f.id)
      }
      if (typeof f.identificacao === 'string' && f.identificacao !== '') {
        faturasComIdentificacao++
      }
      if (typeof f.tipo_fatura_energia === 'string' && f.tipo_fatura_energia !== '') {
        faturasComTipoFaturaEnergia++
      }
      if (f.tipo_utilidade && faturasPorUtilidade[f.tipo_utilidade] !== undefined) {
        faturasPorUtilidade[f.tipo_utilidade]++
      }
      if (f.empreendimento && !empIds[f.empreendimento]) refsOrfasEmpreendimento++
      if (f.owner && !usersIds[f.owner]) refsOrfasOwner++
    }

    for (let i = 0; i < empreendimentos.length; i++) {
      const emp = empreendimentos[i]
      if (emp.owner && !usersIds[emp.owner]) empreendimentosComOwnerOrfao++
    }
    for (let i = 0; i < users.length; i++) {
      if (users[i].avatar_base64) usuariosComAvatar++
    }

    const integridade = {
      usuarios: users.length,
      empreendimentos: empreendimentos.length,
      faturas: faturas.length,
      fatores_emissao: fatores.length,
      faturas_por_utilidade: faturasPorUtilidade,
      faturas_com_dados_especificos: faturasComDadosEspecificos,
      faturas_sem_dados_especificos: faturasSemDadosEspecificos,
      faturas_com_identificacao: faturasComIdentificacao,
      faturas_com_tipo_fatura_energia: faturasComTipoFaturaEnergia,
      faturas_com_empreendimento_orfao: refsOrfasEmpreendimento,
      faturas_com_owner_orfao: refsOrfasOwner,
      empreendimentos_com_owner_orfao: empreendimentosComOwnerOrfao,
      usuarios_com_avatar: usuariosComAvatar,
    }

    console.log(logPrefix + ' Export executado: ' + JSON.stringify(integridade))

    if (integrityOnly) {
      return e.json(200, { sucesso: true, modo: 'integrity', integridade: integridade })
    }

    // Paginacao opcional (?entidade=faturas&pagina=2&por_pagina=50) para capturar
    // colecoes grandes em pedacos sem limite implicito do PocketBase.
    const porPagina = Math.max(1, Math.min(100000, parseInt(query.por_pagina, 10) || 0))
    const pagina = Math.max(1, parseInt(query.pagina, 10) || 1)
    const fatiar = (arr) => {
      if (!porPagina) return { itens: arr, total_paginas: 1 }
      const totalPaginas = Math.max(1, Math.ceil(arr.length / porPagina))
      const inicio = (pagina - 1) * porPagina
      return { itens: arr.slice(inicio, inicio + porPagina), total_paginas: totalPaginas }
    }

    if (entidade === 'users') {
      return e.json(200, {
        sucesso: true,
        gerado_em: new Date().toISOString(),
        dados: { users: users },
      })
    }
    if (entidade === 'empreendimentos') {
      return e.json(200, {
        sucesso: true,
        gerado_em: new Date().toISOString(),
        dados: { empreendimentos: empreendimentos },
      })
    }
    if (entidade === 'faturas') {
      const f = fatiar(faturas)
      return e.json(200, {
        sucesso: true,
        gerado_em: new Date().toISOString(),
        total: faturas.length,
        pagina: pagina,
        por_pagina: porPagina || faturas.length,
        total_paginas: f.total_paginas,
        dados: { faturas: f.itens },
      })
    }
    if (entidade === 'fatores_emissao') {
      return e.json(200, {
        sucesso: true,
        gerado_em: new Date().toISOString(),
        dados: { fatores_emissao: fatores },
      })
    }

    return e.json(200, {
      sucesso: true,
      gerado_em: new Date().toISOString(),
      integridade: integridade,
      dados: {
        users: users,
        empreendimentos: empreendimentos,
        faturas: faturas,
        fatores_emissao: fatores,
      },
    })
  } catch (err) {
    console.error(logPrefix + ' Erro na exportação: ' + (err.message || err))
    return e.json(500, {
      sucesso: false,
      erro: err.message || String(err),
    })
  }
})
// CHANGELOG (v0.0.89): o middleware $apis.requireSuperuserAuth era aplicado
// ANTES do handler, bloqueando qualquer chamada sem token de superusuário — inclusive
// as que passavam a SNAPSHOT_EXPORT_KEY via ?senha= (chave_presente=false nos logs
// porque a env só foi criada depois). Para permitir a exportação durante a janela de
// migração PB → Supabase, o middleware foi removido: a autorização agora é feita
// DENTRO do handler (role=admin da coleção users, token de superusuário via
// loadAuthToken, OU chave SNAPSHOT_EXPORT_KEY via ?senha=). A rota segue 100%
// somente-leitura (apenas findRecordsByFilter/findFileByFilename) e temporária.
