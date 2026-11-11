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
routerAdd('GET', '/backend/v1/admin/export-full', (e) => {
  const logPrefix = '[admin-export-full]'

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
        const raw = record.getString(name)
        if (raw === '' || raw === 'null') {
          out[name] = null
        } else {
          try {
            out[name] = JSON.parse(raw)
          } catch (_) {
            out[name] = raw
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
        out.passwordHash = record.passwordHash()
        out.tokenKey = record.tokenKey()
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
          passwordHash: record.passwordHash(),
          tokenKey: record.tokenKey(),
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
  const info = e.requestInfo()
  const query = (info && info.query) || {}
  const expectedKey = $os.getenv('SNAPSHOT_EXPORT_KEY') || ''
  const providedKey = query.senha || ''
  const authorizedViaKey = expectedKey !== '' && providedKey === expectedKey
  console.log(
    logPrefix +
      ' autorizacao: role=' +
      role +
      ', chave_presente=' +
      (expectedKey !== '') +
      ', chave_conferiu=' +
      authorizedViaKey,
  )

  if (role !== 'admin' && !authorizedViaKey) {
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
      return e.json(200, {
        sucesso: true,
        gerado_em: new Date().toISOString(),
        dados: { faturas: faturas },
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
