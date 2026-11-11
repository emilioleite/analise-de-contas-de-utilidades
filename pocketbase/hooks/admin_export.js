// Rota TEMPORÁRIA de exportação/snapshot dos dados do PocketBase (etapa 1 da migração
// para Supabase). Somente LEITURA: não altera coleções, regras ou registros.
// Rota: GET /backend/v1/admin/export — exige usuário autenticado com role = admin.
// O dump NUNCA inclui passwordHash, tokenKey ou qualquer outro campo sensível.
//
// Parâmetros:
//   ?integrity=1  → devolve apenas as contagens e o resultado da verificação de integridade
//   ?entidade=X   → devolve apenas uma entidade (users | empreendimentos | faturas | fatores_emissao)
//
// Contém também um CRON TEMPORÁRIO (admin-export-dump) que executa a MESMA função de
// dump do lado do servidor e escreve o resultado no log de hooks, em blocos marcados
// com o prefixo "DUMP::", para captura dos arquivos de migração. O cron será REMOVIDO
// no deploy seguinte, após a captura.

// Converte um registro em objeto plano, usando apenas os campos do schema da coleção
// (ou apenas os campos listados em onlyFields, quando informado).
function adminExportRecordToPlain(record, onlyFields) {
  const out = {}
  const fields = onlyFields || null
  const schemaFields = record.collection().fields
  for (let i = 0; i < schemaFields.length; i++) {
    const f = schemaFields[i]
    const name = f.name
    if (fields && fields.indexOf(name) === -1) continue
    if (f.type === 'select') {
      out[name] = record.getString(name)
    } else if (f.type === 'number') {
      out[name] = record.getFloat(name)
    } else if (f.type === 'bool') {
      out[name] = record.getBool(name)
    } else if (f.type === 'relation') {
      out[name] = record.getString(name)
    } else if (f.type === 'json') {
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
function adminExportFetchAll(app, collectionName, pageSize, onlyFields) {
  const all = []
  let offset = 0
  const size = pageSize || 500
  while (true) {
    const batch = app.findRecordsByFilter(collectionName, '', 'created,id', size, offset)
    for (let i = 0; i < batch.length; i++) {
      all.push(adminExportRecordToPlain(batch[i], onlyFields))
    }
    if (batch.length < size) break
    offset += size
  }
  return all
}

// Monta o dump completo + verificação de integridade. Somente leitura.
function adminExportBuildDump(app) {
  const users = adminExportFetchAll(app, 'users', 500, [
    'id',
    'name',
    'email',
    'role',
    'status',
    'verified',
    'created',
    'updated',
  ])
  const empreendimentos = adminExportFetchAll(app, 'empreendimentos')
  const faturas = adminExportFetchAll(app, 'faturas')
  const fatores = adminExportFetchAll(app, 'fatores_emissao')

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
  const faturasPorUtilidade = { 'Energia Elétrica': 0, 'Água e Esgoto': 0, 'Gás': 0 }

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
    if (f.empreendimento && !empIds[f.empreendimento]) {
      refsOrfasEmpreendimento++
    }
    if (f.owner && !usersIds[f.owner]) {
      refsOrfasOwner++
    }
  }

  for (let i = 0; i < empreendimentos.length; i++) {
    const emp = empreendimentos[i]
    if (emp.owner && !usersIds[emp.owner]) {
      empreendimentosComOwnerOrfao++
    }
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
  }

  return { users, empreendimentos, faturas, fatores_emissao: fatores, integridade }
}

// Escreve um array no log em blocos JSON, um por linha, para reconstrução posterior.
function adminExportLogChunks(nome, arr, porChunk) {
  const total = Math.ceil(arr.length / porChunk) || 1
  for (let i = 0; i < total; i++) {
    const slice = arr.slice(i * porChunk, (i + 1) * porChunk)
    console.log(
      'DUMP::' + nome + '::' + i + '/' + total + '::' + JSON.stringify(slice) + '::END',
    )
  }
}

// ---------------------------------------------------------------------------
// CRON TEMPORÁRIO — gera o dump no log de hooks para captura dos arquivos de
// migração. Será REMOVIDO no próximo deploy (não faz nenhuma escrita no banco).
// ---------------------------------------------------------------------------
cronAdd('admin-export-dump', '*/3 * * * *', (e) => {
  try {
    const dump = adminExportBuildDump(e.app)
    const manifest = {
      gerado_em: new Date().toISOString(),
      integridade: dump.integridade,
      chunks: {
        users: Math.ceil(dump.users.length / 10) || 1,
        empreendimentos: Math.ceil(dump.empreendimentos.length / 10) || 1,
        faturas: Math.ceil(dump.faturas.length / 8) || 1,
        fatores_emissao: Math.ceil(dump.fatores_emissao.length / 12) || 1,
      },
    }
    console.log('DUMP::manifest::' + JSON.stringify(manifest))
    adminExportLogChunks('users', dump.users, 10)
    adminExportLogChunks('empreendimentos', dump.empreendimentos, 10)
    adminExportLogChunks('faturas', dump.faturas, 8)
    adminExportLogChunks('fatores_emissao', dump.fatores_emissao, 12)
  } catch (err) {
    console.error('[admin-export-cron] Erro: ' + (err.message || err))
  }
})

// ---------------------------------------------------------------------------
// Rota de exportação (autenticada, somente admin, somente leitura)
// ---------------------------------------------------------------------------
routerAdd(
  'GET',
  '/backend/v1/admin/export',
  (e) => {
    const logPrefix = '[admin-export]'
    const authRecord = e.auth
    const role = authRecord ? authRecord.getString('role') : ''
    if (role !== 'admin') {
      return e.json(403, {
        sucesso: false,
        erro: 'Apenas administradores podem exportar os dados.',
      })
    }

    const info = e.requestInfo()
    const query = (info && info.query) || {}
    const integrityOnly = query.integrity === '1' || query.integrity === 'true'
    const entidade = query.entidade || ''

    try {
      const dump = adminExportBuildDump(e.app)
      console.log(logPrefix + ' Export executado: ' + JSON.stringify(dump.integridade))

      if (integrityOnly) {
        return e.json(200, { sucesso: true, modo: 'integrity', integridade: dump.integridade })
      }

      if (entidade && dump[entidade]) {
        const filtro = {}
        filtro[entidade] = dump[entidade]
        return e.json(200, { sucesso: true, gerado_em: new Date().toISOString(), dados: filtro })
      }

      return e.json(200, {
        sucesso: true,
        gerado_em: new Date().toISOString(),
        integridade: dump.integridade,
        dados: {
          users: dump.users,
          empreendimentos: dump.empreendimentos,
          faturas: dump.faturas,
          fatores_emissao: dump.fatores_emissao,
        },
      })
    } catch (err) {
      console.error(logPrefix + ' Erro na exportação: ' + (err.message || err))
      return e.json(500, {
        sucesso: false,
        erro: err.message || String(err),
      })
    }
  },
  $apis.requireAuth(),
)
