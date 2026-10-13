cronAdd('atualiza-fatores-sin-trimestral', '0 6 1 1,4,7,10 *', (app) => {
  const logPrefix = '[atualiza-fatores-sin-trimestral]'
  console.log(
    `${logPrefix} Iniciando rotina trimestral de verificação dos fatores oficiais do SIN...`,
  )

  try {
    const colecao = app.findCollectionByNameOrId('fatores_emissao')

    const fontesUrls = [
      'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/sirene/dados-e-ferramentas/fatores-de-emissao',
      'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/cgcl/paginas/fator-medio-inventarios-corporativos',
      'https://antigo.mctic.gov.br/mctic/opencms/ciencia/SEPED/clima/textogeral/emissao_corporativos.html',
    ]

    let responseBody = ''
    let urlUtilizada = ''
    let fetchSucesso = false

    for (let i = 0; i < fontesUrls.length; i++) {
      const url = fontesUrls[i]
      try {
        console.log(`${logPrefix} Consultando página do MCTI: ${url}`)
        const resp = $http.send({
          url: url,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.8',
          },
          timeout: 25,
        })

        if (resp && resp.statusCode >= 200 && resp.statusCode < 300 && resp.raw) {
          responseBody = resp.raw
          urlUtilizada = url
          fetchSucesso = true
          console.log(
            `${logPrefix} Sucesso ao consultar ${url} (status ${resp.statusCode}, tamanho ${responseBody.length} bytes).`,
          )
          break
        } else {
          console.log(
            `${logPrefix} Resposta não OK para ${url}: status ${resp ? resp.statusCode : 'sem resposta'}`,
          )
        }
      } catch (err) {
        console.log(`${logPrefix} Falha de conexão com ${url}: ${err.message || err}`)
      }
    }

    const mesesInfo = [
      { num: 1, nomes: ['janeiro', 'jan'] },
      { num: 2, nomes: ['fevereiro', 'fev'] },
      { num: 3, nomes: ['março', 'marco', 'mar'] },
      { num: 4, nomes: ['abril', 'abr'] },
      { num: 5, nomes: ['maio', 'mai'] },
      { num: 6, nomes: ['junho', 'jun'] },
      { num: 7, nomes: ['julho', 'jul'] },
      { num: 8, nomes: ['agosto', 'ago'] },
      { num: 9, nomes: ['setembro', 'set'] },
      { num: 10, nomes: ['outubro', 'out'] },
      { num: 11, nomes: ['novembro', 'nov'] },
      { num: 12, nomes: ['dezembro', 'dez'] },
    ]

    function parseNumeroBr(str) {
      if (!str) return null
      let s = String(str).trim()
      if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.')
      } else if (s.includes(',')) {
        s = s.replace(',', '.')
      }
      const val = parseFloat(s)
      return isNaN(val) || val <= 0 ? null : val
    }

    const fatoresEncontrados = []

    if (responseBody && responseBody.length > 50) {
      const regexTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      let matchTr
      while ((matchTr = regexTr.exec(responseBody)) !== null) {
        const conteudoTr = matchTr[1]
        const linhaTexto = conteudoTr
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!linhaTexto) continue

        const matchAno = linhaTexto.match(/\b(202[3-9]|203\d)\b/)
        const anoEncontrado = matchAno ? parseInt(matchAno[1], 10) : null

        for (let m = 0; m < mesesInfo.length; m++) {
          const itemMes = mesesInfo[m]
          let encontrouMes = false
          for (let n = 0; n < itemMes.nomes.length; n++) {
            const nm = itemMes.nomes[n]
            const re = new RegExp(`\\b${nm}\\b`, 'i')
            if (re.test(linhaTexto)) {
              encontrouMes = true
              break
            }
          }

          if (encontrouMes) {
            const matchNums = linhaTexto.match(/\b\d+[,.]\d+\b/g)
            if (matchNums) {
              for (let k = 0; k < matchNums.length; k++) {
                const numParsed = parseNumeroBr(matchNums[k])
                if (numParsed && numParsed > 0) {
                  let fatorTCO2 = numParsed
                  if (numParsed > 1.0) {
                    fatorTCO2 = Number((numParsed / 1000).toFixed(6))
                  }
                  if (fatorTCO2 >= 0.005 && fatorTCO2 <= 0.25) {
                    const anoVal = anoEncontrado || new Date().getFullYear()
                    fatoresEncontrados.push({
                      ano: anoVal,
                      mes: itemMes.num,
                      valor: fatorTCO2,
                      fonteTexto: `Fator médio do SIN — MCTI/SIRENE (${(fatorTCO2 * 1000).toFixed(1)} kgCO₂/MWh)`,
                    })
                    break
                  }
                }
              }
            }
            break
          }
        }
      }
    }

    console.log(
      `${logPrefix} Total de fatores candidatos extraídos da página: ${fatoresEncontrados.length}`,
    )

    let registrosInseridos = 0
    let registrosAtualizados = 0
    let registrosMantidos = 0

    for (let f = 0; f < fatoresEncontrados.length; f++) {
      const item = fatoresEncontrados[f]
      const chave = `sin_${item.ano}_${String(item.mes).padStart(2, '0')}`

      try {
        const existente = app.findFirstRecordByData('fatores_emissao', 'chave', chave)
        const valorAtual = existente.getFloat('valor')
        const isOficialAtual = existente.getBool('is_oficial')

        if (isOficialAtual && Math.abs(valorAtual - item.valor) < 0.00001) {
          registrosMantidos++
          continue
        }

        console.log(
          `${logPrefix} Atualizando registro oficial ${chave}: de ${valorAtual} para ${item.valor} tCO₂/MWh`,
        )
        existente.set('valor', item.valor)
        existente.set('is_oficial', true)
        existente.set('fonte', item.fonteTexto)
        existente.set(
          'descricao',
          `Atualizado automaticamente via rotina trimestral MCTI/SIRENE em ${new Date().toISOString()}`,
        )
        app.save(existente)
        registrosAtualizados++
      } catch (_) {
        console.log(
          `${logPrefix} Inserindo novo fator oficial do SIN ${chave}: ${item.valor} tCO₂/MWh`,
        )
        const novoRec = new Record(colecao)
        novoRec.set('chave', chave)
        novoRec.set('tipo', 'energia_mensal')
        novoRec.set('ano', item.ano)
        novoRec.set('mes', item.mes)
        novoRec.set('valor', item.valor)
        novoRec.set('unidade', 'tCO₂/MWh')
        novoRec.set('is_oficial', true)
        novoRec.set('fonte', item.fonteTexto)
        novoRec.set(
          'descricao',
          `${String(item.mes).padStart(2, '0')}/${item.ano} — Atualização automática trimestral MCTI`,
        )
        app.save(novoRec)
        registrosInseridos++
      }
    }

    if (!fetchSucesso) {
      console.warn(
        `${logPrefix} AVISO: Nenhuma página pública do MCTI respondeu com sucesso. Mantendo os fatores atuais. O fallback provisório de 0,0500 tCO₂/MWh continua ativo para meses não cadastrados.`,
      )
    } else if (fatoresEncontrados.length === 0) {
      console.warn(
        `${logPrefix} AVISO: Página pública do MCTI consultada (${urlUtilizada}), mas nenhum fator no formato esperado foi detectado. A base atual foi preservada integralmente sem valores inventados.`,
      )
    } else {
      console.log(
        `${logPrefix} Sincronização concluída com êxito. Inseridos: ${registrosInseridos}, Atualizados: ${registrosAtualizados}, Mantidos: ${registrosMantidos}.`,
      )
    }
  } catch (err) {
    console.error(`${logPrefix} Erro inesperado na rotina trimestral: ${err.message || err}`)
  }
})

// Rota manual sob demanda POST /atualiza-fatores-sin
routerAdd('POST', '/atualiza-fatores-sin', (e) => {
  const logPrefix = '[atualiza-fatores-sin-manual]'
  console.log(`${logPrefix} Executando verificação dos fatores oficiais do SIN sob demanda...`)

  try {
    const colecao = e.app.findCollectionByNameOrId('fatores_emissao')

    const fontesUrls = [
      'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/sirene/dados-e-ferramentas/fatores-de-emissao',
      'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/cgcl/paginas/fator-medio-inventarios-corporativos',
      'https://antigo.mctic.gov.br/mctic/opencms/ciencia/SEPED/clima/textogeral/emissao_corporativos.html',
    ]

    let responseBody = ''
    let urlUtilizada = ''
    let fetchSucesso = false

    for (let i = 0; i < fontesUrls.length; i++) {
      const url = fontesUrls[i]
      try {
        console.log(`${logPrefix} Consultando página do MCTI: ${url}`)
        const resp = $http.send({
          url: url,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.8',
          },
          timeout: 25,
        })

        if (resp && resp.statusCode >= 200 && resp.statusCode < 300 && resp.raw) {
          responseBody = resp.raw
          urlUtilizada = url
          fetchSucesso = true
          console.log(
            `${logPrefix} Sucesso ao consultar ${url} (status ${resp.statusCode}, tamanho ${responseBody.length} bytes).`,
          )
          break
        } else {
          console.log(
            `${logPrefix} Resposta não OK para ${url}: status ${resp ? resp.statusCode : 'sem resposta'}`,
          )
        }
      } catch (err) {
        console.log(`${logPrefix} Falha de conexão com ${url}: ${err.message || err}`)
      }
    }

    const mesesInfo = [
      { num: 1, nomes: ['janeiro', 'jan'] },
      { num: 2, nomes: ['fevereiro', 'fev'] },
      { num: 3, nomes: ['março', 'marco', 'mar'] },
      { num: 4, nomes: ['abril', 'abr'] },
      { num: 5, nomes: ['maio', 'mai'] },
      { num: 6, nomes: ['junho', 'jun'] },
      { num: 7, nomes: ['julho', 'jul'] },
      { num: 8, nomes: ['agosto', 'ago'] },
      { num: 9, nomes: ['setembro', 'set'] },
      { num: 10, nomes: ['outubro', 'out'] },
      { num: 11, nomes: ['novembro', 'nov'] },
      { num: 12, nomes: ['dezembro', 'dez'] },
    ]

    function parseNumeroBr(str) {
      if (!str) return null
      let s = String(str).trim()
      if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.')
      } else if (s.includes(',')) {
        s = s.replace(',', '.')
      }
      const val = parseFloat(s)
      return isNaN(val) || val <= 0 ? null : val
    }

    const fatoresEncontrados = []

    if (responseBody && responseBody.length > 50) {
      const regexTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      let matchTr
      while ((matchTr = regexTr.exec(responseBody)) !== null) {
        const conteudoTr = matchTr[1]
        const linhaTexto = conteudoTr
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!linhaTexto) continue

        const matchAno = linhaTexto.match(/\b(202[3-9]|203\d)\b/)
        const anoEncontrado = matchAno ? parseInt(matchAno[1], 10) : null

        for (let m = 0; m < mesesInfo.length; m++) {
          const itemMes = mesesInfo[m]
          let encontrouMes = false
          for (let n = 0; n < itemMes.nomes.length; n++) {
            const nm = itemMes.nomes[n]
            const re = new RegExp(`\\b${nm}\\b`, 'i')
            if (re.test(linhaTexto)) {
              encontrouMes = true
              break
            }
          }

          if (encontrouMes) {
            const matchNums = linhaTexto.match(/\b\d+[,.]\d+\b/g)
            if (matchNums) {
              for (let k = 0; k < matchNums.length; k++) {
                const numParsed = parseNumeroBr(matchNums[k])
                if (numParsed && numParsed > 0) {
                  let fatorTCO2 = numParsed
                  if (numParsed > 1.0) {
                    fatorTCO2 = Number((numParsed / 1000).toFixed(6))
                  }
                  if (fatorTCO2 >= 0.005 && fatorTCO2 <= 0.25) {
                    const anoVal = anoEncontrado || new Date().getFullYear()
                    fatoresEncontrados.push({
                      ano: anoVal,
                      mes: itemMes.num,
                      valor: fatorTCO2,
                      fonteTexto: `Fator médio do SIN — MCTI/SIRENE (${(fatorTCO2 * 1000).toFixed(1)} kgCO₂/MWh)`,
                    })
                    break
                  }
                }
              }
            }
            break
          }
        }
      }
    }

    console.log(
      `${logPrefix} Total de fatores candidatos extraídos da página: ${fatoresEncontrados.length}`,
    )

    let registrosInseridos = 0
    let registrosAtualizados = 0
    let registrosMantidos = 0

    for (let f = 0; f < fatoresEncontrados.length; f++) {
      const item = fatoresEncontrados[f]
      const chave = `sin_${item.ano}_${String(item.mes).padStart(2, '0')}`

      try {
        const existente = e.app.findFirstRecordByData('fatores_emissao', 'chave', chave)
        const valorAtual = existente.getFloat('valor')
        const isOficialAtual = existente.getBool('is_oficial')

        if (isOficialAtual && Math.abs(valorAtual - item.valor) < 0.00001) {
          registrosMantidos++
          continue
        }

        console.log(
          `${logPrefix} Atualizando registro oficial ${chave}: de ${valorAtual} para ${item.valor} tCO₂/MWh`,
        )
        existente.set('valor', item.valor)
        existente.set('is_oficial', true)
        existente.set('fonte', item.fonteTexto)
        existente.set(
          'descricao',
          `Atualizado automaticamente via rotina trimestral MCTI/SIRENE em ${new Date().toISOString()}`,
        )
        e.app.save(existente)
        registrosAtualizados++
      } catch (_) {
        console.log(
          `${logPrefix} Inserindo novo fator oficial do SIN ${chave}: ${item.valor} tCO₂/MWh`,
        )
        const novoRec = new Record(colecao)
        novoRec.set('chave', chave)
        novoRec.set('tipo', 'energia_mensal')
        novoRec.set('ano', item.ano)
        novoRec.set('mes', item.mes)
        novoRec.set('valor', item.valor)
        novoRec.set('unidade', 'tCO₂/MWh')
        novoRec.set('is_oficial', true)
        novoRec.set('fonte', item.fonteTexto)
        novoRec.set(
          'descricao',
          `${String(item.mes).padStart(2, '0')}/${item.ano} — Atualização automática trimestral MCTI`,
        )
        e.app.save(novoRec)
        registrosInseridos++
      }
    }

    if (!fetchSucesso) {
      console.warn(
        `${logPrefix} AVISO: Nenhuma página pública do MCTI respondeu com sucesso. Mantendo os fatores atuais. O fallback provisório de 0,0500 tCO₂/MWh continua ativo para meses não cadastrados.`,
      )
    } else if (fatoresEncontrados.length === 0) {
      console.warn(
        `${logPrefix} AVISO: Página pública do MCTI consultada (${urlUtilizada}), mas nenhum fator no formato esperado foi detectado. A base atual foi preservada integralmente sem valores inventados.`,
      )
    } else {
      console.log(
        `${logPrefix} Sincronização concluída com êxito. Inseridos: ${registrosInseridos}, Atualizados: ${registrosAtualizados}, Mantidos: ${registrosMantidos}.`,
      )
    }

    return e.json(200, {
      sucesso: true,
      dataExecucao: new Date().toISOString(),
      urlConsultada: urlUtilizada || 'nenhuma',
      paginaAcessada: fetchSucesso,
      fatoresIdentificados: fatoresEncontrados.length,
      registrosInseridos: registrosInseridos,
      registrosAtualizados: registrosAtualizados,
      registrosIgnorados: registrosMantidos,
      aviso: !fetchSucesso
        ? 'A página pública do MCTI/SIRENE não respondeu com código de sucesso. A base de fatores de emissão existente foi mantida sem alterações.'
        : fatoresEncontrados.length === 0
          ? 'A página pública do MCTI foi acessada, mas não continha novos fatores no formato tabular esperado. A base existente foi mantida integralmente sem inventar valores.'
          : 'Fatores atualizados com sucesso.',
    })
  } catch (err) {
    console.error(`${logPrefix} Erro na rota manual: ${err.message || err}`)
    return e.json(500, {
      sucesso: false,
      erro: err.message || String(err),
    })
  }
})

// Rota GET /atualiza-fatores-sin para teste rápido no navegador
routerAdd('GET', '/atualiza-fatores-sin', (e) => {
  const logPrefix = '[atualiza-fatores-sin-get]'
  console.log(`${logPrefix} Executando verificação dos fatores oficiais do SIN via GET...`)

  try {
    const colecao = e.app.findCollectionByNameOrId('fatores_emissao')

    const fontesUrls = [
      'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/sirene/dados-e-ferramentas/fatores-de-emissao',
      'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/cgcl/paginas/fator-medio-inventarios-corporativos',
      'https://antigo.mctic.gov.br/mctic/opencms/ciencia/SEPED/clima/textogeral/emissao_corporativos.html',
    ]

    let responseBody = ''
    let urlUtilizada = ''
    let fetchSucesso = false

    for (let i = 0; i < fontesUrls.length; i++) {
      const url = fontesUrls[i]
      try {
        console.log(`${logPrefix} Consultando página do MCTI: ${url}`)
        const resp = $http.send({
          url: url,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.8',
          },
          timeout: 25,
        })

        if (resp && resp.statusCode >= 200 && resp.statusCode < 300 && resp.raw) {
          responseBody = resp.raw
          urlUtilizada = url
          fetchSucesso = true
          console.log(
            `${logPrefix} Sucesso ao consultar ${url} (status ${resp.statusCode}, tamanho ${responseBody.length} bytes).`,
          )
          break
        } else {
          console.log(
            `${logPrefix} Resposta não OK para ${url}: status ${resp ? resp.statusCode : 'sem resposta'}`,
          )
        }
      } catch (err) {
        console.log(`${logPrefix} Falha de conexão com ${url}: ${err.message || err}`)
      }
    }

    const mesesInfo = [
      { num: 1, nomes: ['janeiro', 'jan'] },
      { num: 2, nomes: ['fevereiro', 'fev'] },
      { num: 3, nomes: ['março', 'marco', 'mar'] },
      { num: 4, nomes: ['abril', 'abr'] },
      { num: 5, nomes: ['maio', 'mai'] },
      { num: 6, nomes: ['junho', 'jun'] },
      { num: 7, nomes: ['julho', 'jul'] },
      { num: 8, nomes: ['agosto', 'ago'] },
      { num: 9, nomes: ['setembro', 'set'] },
      { num: 10, nomes: ['outubro', 'out'] },
      { num: 11, nomes: ['novembro', 'nov'] },
      { num: 12, nomes: ['dezembro', 'dez'] },
    ]

    function parseNumeroBr(str) {
      if (!str) return null
      let s = String(str).trim()
      if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.')
      } else if (s.includes(',')) {
        s = s.replace(',', '.')
      }
      const val = parseFloat(s)
      return isNaN(val) || val <= 0 ? null : val
    }

    const fatoresEncontrados = []

    if (responseBody && responseBody.length > 50) {
      const regexTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      let matchTr
      while ((matchTr = regexTr.exec(responseBody)) !== null) {
        const conteudoTr = matchTr[1]
        const linhaTexto = conteudoTr
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!linhaTexto) continue

        const matchAno = linhaTexto.match(/\b(202[3-9]|203\d)\b/)
        const anoEncontrado = matchAno ? parseInt(matchAno[1], 10) : null

        for (let m = 0; m < mesesInfo.length; m++) {
          const itemMes = mesesInfo[m]
          let encontrouMes = false
          for (let n = 0; n < itemMes.nomes.length; n++) {
            const nm = itemMes.nomes[n]
            const re = new RegExp(`\\b${nm}\\b`, 'i')
            if (re.test(linhaTexto)) {
              encontrouMes = true
              break
            }
          }

          if (encontrouMes) {
            const matchNums = linhaTexto.match(/\b\d+[,.]\d+\b/g)
            if (matchNums) {
              for (let k = 0; k < matchNums.length; k++) {
                const numParsed = parseNumeroBr(matchNums[k])
                if (numParsed && numParsed > 0) {
                  let fatorTCO2 = numParsed
                  if (numParsed > 1.0) {
                    fatorTCO2 = Number((numParsed / 1000).toFixed(6))
                  }
                  if (fatorTCO2 >= 0.005 && fatorTCO2 <= 0.25) {
                    const anoVal = anoEncontrado || new Date().getFullYear()
                    fatoresEncontrados.push({
                      ano: anoVal,
                      mes: itemMes.num,
                      valor: fatorTCO2,
                      fonteTexto: `Fator médio do SIN — MCTI/SIRENE (${(fatorTCO2 * 1000).toFixed(1)} kgCO₂/MWh)`,
                    })
                    break
                  }
                }
              }
            }
            break
          }
        }
      }
    }

    console.log(
      `${logPrefix} Total de fatores candidatos extraídos da página: ${fatoresEncontrados.length}`,
    )

    let registrosInseridos = 0
    let registrosAtualizados = 0
    let registrosMantidos = 0

    for (let f = 0; f < fatoresEncontrados.length; f++) {
      const item = fatoresEncontrados[f]
      const chave = `sin_${item.ano}_${String(item.mes).padStart(2, '0')}`

      try {
        const existente = e.app.findFirstRecordByData('fatores_emissao', 'chave', chave)
        const valorAtual = existente.getFloat('valor')
        const isOficialAtual = existente.getBool('is_oficial')

        if (isOficialAtual && Math.abs(valorAtual - item.valor) < 0.00001) {
          registrosMantidos++
          continue
        }

        console.log(
          `${logPrefix} Atualizando registro oficial ${chave}: de ${valorAtual} para ${item.valor} tCO₂/MWh`,
        )
        existente.set('valor', item.valor)
        existente.set('is_oficial', true)
        existente.set('fonte', item.fonteTexto)
        existente.set(
          'descricao',
          `Atualizado automaticamente via rotina trimestral MCTI/SIRENE em ${new Date().toISOString()}`,
        )
        e.app.save(existente)
        registrosAtualizados++
      } catch (_) {
        console.log(
          `${logPrefix} Inserindo novo fator oficial do SIN ${chave}: ${item.valor} tCO₂/MWh`,
        )
        const novoRec = new Record(colecao)
        novoRec.set('chave', chave)
        novoRec.set('tipo', 'energia_mensal')
        novoRec.set('ano', item.ano)
        novoRec.set('mes', item.mes)
        novoRec.set('valor', item.valor)
        novoRec.set('unidade', 'tCO₂/MWh')
        novoRec.set('is_oficial', true)
        novoRec.set('fonte', item.fonteTexto)
        novoRec.set(
          'descricao',
          `${String(item.mes).padStart(2, '0')}/${item.ano} — Atualização automática trimestral MCTI`,
        )
        e.app.save(novoRec)
        registrosInseridos++
      }
    }

    if (!fetchSucesso) {
      console.warn(
        `${logPrefix} AVISO: Nenhuma página pública do MCTI respondeu com sucesso. Mantendo os fatores atuais. O fallback provisório de 0,0500 tCO₂/MWh continua ativo para meses não cadastrados.`,
      )
    } else if (fatoresEncontrados.length === 0) {
      console.warn(
        `${logPrefix} AVISO: Página pública do MCTI consultada (${urlUtilizada}), mas nenhum fator no formato esperado foi detectado. A base atual foi preservada integralmente sem valores inventados.`,
      )
    } else {
      console.log(
        `${logPrefix} Sincronização concluída com êxito. Inseridos: ${registrosInseridos}, Atualizados: ${registrosAtualizados}, Mantidos: ${registrosMantidos}.`,
      )
    }

    return e.json(200, {
      sucesso: true,
      dataExecucao: new Date().toISOString(),
      urlConsultada: urlUtilizada || 'nenhuma',
      paginaAcessada: fetchSucesso,
      fatoresIdentificados: fatoresEncontrados.length,
      registrosInseridos: registrosInseridos,
      registrosAtualizados: registrosAtualizados,
      registrosIgnorados: registrosMantidos,
      aviso: !fetchSucesso
        ? 'A página pública do MCTI/SIRENE não respondeu com código de sucesso. A base de fatores de emissão existente foi mantida sem alterações.'
        : fatoresEncontrados.length === 0
          ? 'A página pública do MCTI foi acessada, mas não continha novos fatores no formato tabular esperado. A base existente foi mantida integralmente sem inventar valores.'
          : 'Fatores atualizados com sucesso.',
    })
  } catch (err) {
    console.error(`${logPrefix} Erro na rota manual: ${err.message || err}`)
    return e.json(500, {
      sucesso: false,
      erro: err.message || String(err),
    })
  }
})

// Rota autenticada POST /backend/v1/emissoes/atualizar-fatores-sin
routerAdd(
  'POST',
  '/backend/v1/emissoes/atualizar-fatores-sin',
  (e) => {
    const logPrefix = '[atualiza-fatores-sin-auth]'
    console.log(
      `${logPrefix} Executando verificação dos fatores oficiais do SIN sob demanda (auth)...`,
    )

    try {
      const colecao = e.app.findCollectionByNameOrId('fatores_emissao')

      const fontesUrls = [
        'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/sirene/dados-e-ferramentas/fatores-de-emissao',
        'https://www.gov.br/mcti/pt-br/acompanhe-o-mcti/cgcl/paginas/fator-medio-inventarios-corporativos',
        'https://antigo.mctic.gov.br/mctic/opencms/ciencia/SEPED/clima/textogeral/emissao_corporativos.html',
      ]

      let responseBody = ''
      let urlUtilizada = ''
      let fetchSucesso = false

      for (let i = 0; i < fontesUrls.length; i++) {
        const url = fontesUrls[i]
        try {
          console.log(`${logPrefix} Consultando página do MCTI: ${url}`)
          const resp = $http.send({
            url: url,
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.8',
            },
            timeout: 25,
          })

          if (resp && resp.statusCode >= 200 && resp.statusCode < 300 && resp.raw) {
            responseBody = resp.raw
            urlUtilizada = url
            fetchSucesso = true
            console.log(
              `${logPrefix} Sucesso ao consultar ${url} (status ${resp.statusCode}, tamanho ${responseBody.length} bytes).`,
            )
            break
          } else {
            console.log(
              `${logPrefix} Resposta não OK para ${url}: status ${resp ? resp.statusCode : 'sem resposta'}`,
            )
          }
        } catch (err) {
          console.log(`${logPrefix} Falha de conexão com ${url}: ${err.message || err}`)
        }
      }

      const mesesInfo = [
        { num: 1, nomes: ['janeiro', 'jan'] },
        { num: 2, nomes: ['fevereiro', 'fev'] },
        { num: 3, nomes: ['março', 'marco', 'mar'] },
        { num: 4, nomes: ['abril', 'abr'] },
        { num: 5, nomes: ['maio', 'mai'] },
        { num: 6, nomes: ['junho', 'jun'] },
        { num: 7, nomes: ['julho', 'jul'] },
        { num: 8, nomes: ['agosto', 'ago'] },
        { num: 9, nomes: ['setembro', 'set'] },
        { num: 10, nomes: ['outubro', 'out'] },
        { num: 11, nomes: ['novembro', 'nov'] },
        { num: 12, nomes: ['dezembro', 'dez'] },
      ]

      function parseNumeroBr(str) {
        if (!str) return null
        let s = String(str).trim()
        if (s.includes(',') && s.includes('.')) {
          s = s.replace(/\./g, '').replace(',', '.')
        } else if (s.includes(',')) {
          s = s.replace(',', '.')
        }
        const val = parseFloat(s)
        return isNaN(val) || val <= 0 ? null : val
      }

      const fatoresEncontrados = []

      if (responseBody && responseBody.length > 50) {
        const regexTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
        let matchTr
        while ((matchTr = regexTr.exec(responseBody)) !== null) {
          const conteudoTr = matchTr[1]
          const linhaTexto = conteudoTr
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (!linhaTexto) continue

          const matchAno = linhaTexto.match(/\b(202[3-9]|203\d)\b/)
          const anoEncontrado = matchAno ? parseInt(matchAno[1], 10) : null

          for (let m = 0; m < mesesInfo.length; m++) {
            const itemMes = mesesInfo[m]
            let encontrouMes = false
            for (let n = 0; n < itemMes.nomes.length; n++) {
              const nm = itemMes.nomes[n]
              const re = new RegExp(`\\b${nm}\\b`, 'i')
              if (re.test(linhaTexto)) {
                encontrouMes = true
                break
              }
            }

            if (encontrouMes) {
              const matchNums = linhaTexto.match(/\b\d+[,.]\d+\b/g)
              if (matchNums) {
                for (let k = 0; k < matchNums.length; k++) {
                  const numParsed = parseNumeroBr(matchNums[k])
                  if (numParsed && numParsed > 0) {
                    let fatorTCO2 = numParsed
                    if (numParsed > 1.0) {
                      fatorTCO2 = Number((numParsed / 1000).toFixed(6))
                    }
                    if (fatorTCO2 >= 0.005 && fatorTCO2 <= 0.25) {
                      const anoVal = anoEncontrado || new Date().getFullYear()
                      fatoresEncontrados.push({
                        ano: anoVal,
                        mes: itemMes.num,
                        valor: fatorTCO2,
                        fonteTexto: `Fator médio do SIN — MCTI/SIRENE (${(fatorTCO2 * 1000).toFixed(1)} kgCO₂/MWh)`,
                      })
                      break
                    }
                  }
                }
              }
              break
            }
          }
        }
      }

      console.log(
        `${logPrefix} Total de fatores candidatos extraídos da página: ${fatoresEncontrados.length}`,
      )

      let registrosInseridos = 0
      let registrosAtualizados = 0
      let registrosMantidos = 0

      for (let f = 0; f < fatoresEncontrados.length; f++) {
        const item = fatoresEncontrados[f]
        const chave = `sin_${item.ano}_${String(item.mes).padStart(2, '0')}`

        try {
          const existente = e.app.findFirstRecordByData('fatores_emissao', 'chave', chave)
          const valorAtual = existente.getFloat('valor')
          const isOficialAtual = existente.getBool('is_oficial')

          if (isOficialAtual && Math.abs(valorAtual - item.valor) < 0.00001) {
            registrosMantidos++
            continue
          }

          console.log(
            `${logPrefix} Atualizando registro oficial ${chave}: de ${valorAtual} para ${item.valor} tCO₂/MWh`,
          )
          existente.set('valor', item.valor)
          existente.set('is_oficial', true)
          existente.set('fonte', item.fonteTexto)
          existente.set(
            'descricao',
            `Atualizado automaticamente via rotina trimestral MCTI/SIRENE em ${new Date().toISOString()}`,
          )
          e.app.save(existente)
          registrosAtualizados++
        } catch (_) {
          console.log(
            `${logPrefix} Inserindo novo fator oficial do SIN ${chave}: ${item.valor} tCO₂/MWh`,
          )
          const novoRec = new Record(colecao)
          novoRec.set('chave', chave)
          novoRec.set('tipo', 'energia_mensal')
          novoRec.set('ano', item.ano)
          novoRec.set('mes', item.mes)
          novoRec.set('valor', item.valor)
          novoRec.set('unidade', 'tCO₂/MWh')
          novoRec.set('is_oficial', true)
          novoRec.set('fonte', item.fonteTexto)
          novoRec.set(
            'descricao',
            `${String(item.mes).padStart(2, '0')}/${item.ano} — Atualização automática trimestral MCTI`,
          )
          e.app.save(novoRec)
          registrosInseridos++
        }
      }

      if (!fetchSucesso) {
        console.warn(
          `${logPrefix} AVISO: Nenhuma página pública do MCTI respondeu com sucesso. Mantendo os fatores atuais. O fallback provisório de 0,0500 tCO₂/MWh continua ativo para meses não cadastrados.`,
        )
      } else if (fatoresEncontrados.length === 0) {
        console.warn(
          `${logPrefix} AVISO: Página pública do MCTI consultada (${urlUtilizada}), mas nenhum fator no formato esperado foi detectado. A base atual foi preservada integralmente sem valores inventados.`,
        )
      } else {
        console.log(
          `${logPrefix} Sincronização concluída com êxito. Inseridos: ${registrosInseridos}, Atualizados: ${registrosAtualizados}, Mantidos: ${registrosMantidos}.`,
        )
      }

      return e.json(200, {
        sucesso: true,
        dataExecucao: new Date().toISOString(),
        urlConsultada: urlUtilizada || 'nenhuma',
        paginaAcessada: fetchSucesso,
        fatoresIdentificados: fatoresEncontrados.length,
        registrosInseridos: registrosInseridos,
        registrosAtualizados: registrosAtualizados,
        registrosIgnorados: registrosMantidos,
        aviso: !fetchSucesso
          ? 'A página pública do MCTI/SIRENE não respondeu com código de sucesso. A base de fatores de emissão existente foi mantida sem alterações.'
          : fatoresEncontrados.length === 0
            ? 'A página pública do MCTI foi acessada, mas não continha novos fatores no formato tabular esperado. A base existente foi mantida integralmente sem inventar valores.'
            : 'Fatores atualizados com sucesso.',
      })
    } catch (err) {
      console.error(`${logPrefix} Erro na rota manual: ${err.message || err}`)
      return e.json(500, {
        sucesso: false,
        erro: err.message || String(err),
      })
    }
  },
  $apis.requireAuth(),
)
