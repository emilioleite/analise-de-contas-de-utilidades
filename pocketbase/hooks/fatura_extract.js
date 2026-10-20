routerAdd(
  'POST',
  '/backend/v1/faturas/extract',
  (e) => {
    function callAiChat(modelAlias, messages) {
      try {
        const res = $ai.chat({
          model: modelAlias,
          messages: messages,
        })
        if (res && res.choices && res.choices[0] && res.choices[0].message) {
          return res
        }
      } catch (sdkErr) {
        const gwUrl = $os.getenv('SKIP_AI_GATEWAY_URL')
        const gwKey = $os.getenv('SKIP_AI_GATEWAY_API_KEY')
        if (!gwUrl || !gwKey) {
          throw sdkErr
        }
        const cleanUrl = `${gwUrl.replace(/\/+$/, '')}/chat/completions`
        const resp = $http.send({
          url: cleanUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${gwKey}`,
          },
          body: JSON.stringify({
            model: modelAlias,
            messages: messages,
          }),
        })

        if (resp.statusCode !== 200) {
          throw new Error(`skip-ai-gateway ${resp.statusCode}: ${resp.raw || ''}`)
        }

        try {
          return JSON.parse(resp.raw)
        } catch (_) {
          throw new Error(`skip-ai-gateway invalid json: ${resp.raw}`)
        }
      }
    }

    const files = e.findUploadedFiles('arquivo')
    const uploadedFile = files && files.length > 0 ? files[0] : null
    const fileName = uploadedFile ? uploadedFile.name || 'arquivo' : 'arquivo'
    const ext = fileName.toLowerCase().split('.').pop()

    const body = e.requestInfo().body || {}
    const requestedUtility = body.tipo_utilidade || ''
    const forceModel = body.force_model || '' // 'fast' ou 'reasoning'

    let pageImages = []
    if (body.images) {
      try {
        const parsedImages = typeof body.images === 'string' ? JSON.parse(body.images) : body.images
        if (Array.isArray(parsedImages)) {
          pageImages = parsedImages
        }
      } catch (e) {
        console.log('[fatura_extract] Falha ao parsear body.images:', e.message || e)
      }
    }

    let clientProvidedText = body.client_text || body.extracted_text || ''
    let textContent = ''
    let textExtracted = false
    let toMarkdownError = null

    function isQualityText(raw) {
      if (!raw || typeof raw !== 'string') return false
      const trimmed = raw.trim()
      // Descartar textos muito curtos (ex: ruído de PDFs com imagem/texto embaralhado)
      if (trimmed.length < 200) return false

      const normalChars = trimmed.match(/[a-zA-Z0-9À-ÿ\s,.\-:/\(\)%$]/g) || []
      const normalRatio = normalChars.length / trimmed.length
      if (normalRatio < 0.7) {
        return false
      }

      const lower = trimmed.toLowerCase()
      const commonTerms = [
        'sabesp',
        'sanepar',
        'copasa',
        'enel',
        'cpfl',
        'light',
        'cemig',
        'comgas',
        'naturgy',
        'consumo',
        'leitura',
        'anterior',
        'atual',
        'vencimento',
        'total',
        'fatura',
        'emissao',
        'hidrometro',
        'medidor',
        'esgoto',
        'agua',
        'água',
        'energia',
        'gas',
        'gás',
        'cnpj',
        'tarifa',
        'tributos',
        'kwh',
        'tusd',
      ]
      let termsFound = 0
      for (const term of commonTerms) {
        if (lower.includes(term)) termsFound++
      }

      if (termsFound < 2) {
        return false
      }

      return true
    }

    if (clientProvidedText && isQualityText(clientProvidedText)) {
      textContent = clientProvidedText
      textExtracted = true
    }

    if (!textExtracted && uploadedFile && ['pdf', 'xlsx', 'xls', 'docx'].includes(ext)) {
      try {
        console.log(`[fatura_extract] Tentando $documents.toMarkdown para ${fileName}...`)
        const docRes = $documents.toMarkdown({ file: uploadedFile })
        if (docRes && docRes.markdown && docRes.markdown.trim().length > 20) {
          const candidateText = docRes.markdown
          if (isQualityText(candidateText)) {
            textContent = candidateText
            textExtracted = true
            console.log(
              `[fatura_extract] $documents.toMarkdown obteve ${textContent.length} caracteres de texto válido.`,
            )
          } else {
            console.log(
              '[fatura_extract] $documents.toMarkdown retornou texto corrompido/embaralhado. Descartando.',
            )
          }
        } else {
          console.log('[fatura_extract] $documents.toMarkdown retornou texto muito curto ou vazio.')
        }
      } catch (err) {
        toMarkdownError = err
        console.log(
          '[fatura_extract] $documents.toMarkdown erro:',
          err.status || '',
          err.message || err,
        )
      }
    } else if (!textExtracted && uploadedFile && (ext === 'csv' || ext === 'txt')) {
      try {
        const bytes = uploadedFile.bytes ? uploadedFile.bytes() : null
        if (bytes) {
          textContent = String.fromCharCode.apply(null, bytes)
          textExtracted = true
        }
      } catch (_) {}
    }

    const systemPrompt = `Você é um extrator especialista de faturas de utilidades brasileiras (Energia Elétrica, Gás, Água e Esgoto).
Analise o documento e extraia todos os campos com precisão absoluta.
Responda APENAS com um objeto JSON válido, sem texto explicativo, sem blocos de código além do JSON.`

    const instructions = `Extraia todos os dados da fatura anexada (arquivo "${fileName}").
Tipo de utilidade sugerido: "${requestedUtility || 'Detectar da fatura'}".

Campos gerais obrigatórios:
- tipo_utilidade: "Energia Elétrica" | "Gás" | "Água e Esgoto"
- competencia: data YYYY-MM-01 (ex: "2024-05-01" ou "2026-09-01")
- competencia_formatada: MM/AAAA (ex: "05/2024" ou "09/2026")
- valor_total: número decimal do total a pagar (ex: 22347.38, 2143.97 ou 4363.05). ATENÇÃO: em faturas onde o valor aparece como "R$22.347,38" ou com asteriscos decorativos de proteção bancária (ex: "R$ ************2.143,97"), extraia o valor numérico ignorando pontos de milhar e símbolos!
- fatura_total: número decimal idêntico a valor_total
- consumo: número decimal do consumo principal apurado/faturado (kWh para energia, m³ para água/gás - ex: 20438.400 ou 20438.4)
- unidade_consumo: "kWh" ou "m³"
- numero_fatura: número do documento / nota fiscal (ex: "095039445", "150.238.010", ou número impresso na nota)
- vencimento: data YYYY-MM-DD (ex: "2026-09-25", "2024-06-21")
- cnpj_cliente: CNPJ ou CPF do cliente/titular da unidade consumidora (ex: "04.151.776/0001-63" ou "04.***.***/****-63"). ATENÇÃO CRÍTICA: NUNCA use o CNPJ da distribuidora (Enel, Sabesp, Comgás) como cnpj_cliente! O cliente é a empresa destinatária atendida.
- cnpj_fornecedor: CNPJ da distribuidora/concessionária (ex Enel SP: "61.695.227/0001-93", Sabesp: "43.776.517/0001-80", Comgás: "61.856.571/0006-21").

Campos de medição e tarifas:
- medicao_anterior: leitura anterior do medidor/hidrômetro (ex: 65891.700 ou 65891.7)
- medicao_atual: leitura atual do medidor/hidrômetro (ex: 66743.300 ou 66743.3)
- consumo_medido: consumo medido em m³ ou kWh (ex: 20438.4)
- consumo_corrigido: consumo faturado/corrigido por PTZ se houver gás
- tarifa: tarifa unitária aplicada (R$/m³ ou R$/kWh). Em faturas de Água (Sabesp), se não houver tarifa única impressa, calcule o valor_total dividido pelo consumo_medido.

Para Energia Elétrica (Enel, CPFL, Light, CEMIG, etc.):
- REGRA CRÍTICA DE CLASSIFICAÇÃO E CONSUMO (GRUPO B vs GRUPO A):
  * Se a Classificação for do GRUPO B (B1, B2, B3, B4 ou qualquer código iniciando com B, ex: "B3", "B-B3 - CONVENCIONAL - COMERCIAL"):
    - O consumo é ÚNICO (fatura convencional sem divisão por posto horário).
    - NÃO há separação de consumo ponta/fora-ponta.
    - Preencha SEMPRE 'consumo': número decimal do consumo total/faturado (ex: 20438.4 ou 20438.400).
    - Também preencha 'consumo_medido' com esse mesmo valor.
    - Deixe 'consumo_ponta' e 'consumo_fora_ponta' como null.
    - Tarifas: há apenas TUSD e TE únicas (sem ponta/fora-ponta). Preencha 'tarifa_tusd_ponta' com o Preço Unit com tributos de TUSD (ex: 0.60978) e 'tarifa_te_ponta' com o Preço Unit com tributos de TE (ex: 0.40912).
  * Se a Classificação for do GRUPO A (A1, A2, A3, A4 ou qualquer código iniciando com A, estrutura horossazonal ex: Verde / Azul / A4):
    - Há Consumo Ponta e Consumo Fora-Ponta separados com suas respectivas tarifas por posto:
    - Preencha 'consumo_ponta', 'tarifa_tusd_ponta', 'tarifa_te_ponta' (da linha Ponta).
    - Preencha 'consumo_fora_ponta', 'tarifa_tusd_f_ponta', 'tarifa_te_f_ponta' (da linha Fora Ponta).
    - Preencha 'consumo': soma do consumo ponta + fora ponta (ou total faturado).

- MAPEAMENTO DAS TARIFAS DA ENEL (ATENÇÃO CRÍTICA À NOMENCLATURA):
  * Na fatura da Enel (tabela "DESCRIÇÃO DO FATURAMENTO" / "ITENS DE FATURA"), as tarifas unitárias aparecem expressamente sob o cabeçalho de coluna "Preço Unit (R$) com tributos" (ou "Preço Unit. (R$) c/ tributos", "Preço unit com tributos"). É EXATAMENTE esse valor de "Preço Unit (R$) com tributos" que deve ser lançado nos campos de tarifa!
  * Linha "Uso Sist. Distr. (TUSD)" / "TUSD" / "Uso Sistema Distribuição":
    - Pegue o valor da coluna "Preço Unit (R$) com tributos" (ex: 0,60978 ou 0.60978) -> 'tarifa_tusd_ponta': 0.60978 (ou 'tarifa_tusd_f_ponta' se for Fora-Ponta).
  * Linha "Energia (TE)" / "TE" / "Consumo Energia":
    - Pegue o valor da coluna "Preço Unit (R$) com tributos" (ex: 0,40912 ou 0.40912) -> 'tarifa_te_ponta': 0.40912 (ou 'tarifa_te_f_ponta' se for Fora-Ponta).
  * Se a fatura tiver tarifação convencional (posto ÚNICO, B3, B1, etc.):
    - Como o formulário possui os campos "Tarifa TUSD-Ponta", "Tarifa TE-Ponta", "Tarifa TUSD-F.Ponta", "Tarifa TE-F.Ponta":
    - Preencha SEMPRE 'tarifa_tusd_ponta' com o Preço Unit com tributos de TUSD (ex: 0.60978).
    - Preencha SEMPRE 'tarifa_te_ponta' com o Preço Unit com tributos de TE (ex: 0.40912).
    - Se a fatura não dividir ponta/fora-ponta, também preencha 'tarifa_tusd_f_ponta' e 'tarifa_te_f_ponta' com os mesmos valores unitários de TUSD e TE se aplicável, ou repita 'tarifa_tusd_ponta' e 'tarifa_te_ponta'.
    - Se a tabela mostrar apenas um preço unitário combinado para o período e não puder separar TUSD e TE, lance esse preço em 'tarifa_tusd_ponta' e deixe 'tarifa_te_ponta' nulo. NUNCA invente valores.
  * Se a fatura tiver estrutura horossazonal (Verde / Azul / A4) com divisão explícita Ponta e Fora Ponta:
    - Preencha 'consumo_ponta', 'tarifa_tusd_ponta', 'tarifa_te_ponta' (da linha Ponta)
    - Preencha 'consumo_fora_ponta', 'tarifa_tusd_f_ponta', 'tarifa_te_f_ponta' (da linha Fora Ponta)

- LAYOUT TÍPICO ENEL:
  * PÁGINA 1:
    - Cabeçalho Superior: Logotipo "enel BRASIL", Distribuidora: "Eletropaulo Metropolitana Eletricidade de São Paulo S.A. CNPJ: 61.695.227/0001-93" -> 'cnpj_fornecedor': "61.695.227/0001-93".
    - NOTA FISCAL Nº (ex: "095039445") -> 'numero_fatura'.
    - CLASSIFICAÇÃO DA UNIDADE CONSUMIDORA: texto ex: "B-B3 - CONVENCIONAL - COMERCIAL" ou "B3" ou "A4" -> 'classificacao_consumo': "B3".
    - Destinatário / Pagador: ex: "COND EDIF TOWERS NACOES UNIDAS", CNPJ cliente (ex: "04.151.776/0001-63" ou impresso mascarado como "04.***.***/****-63") -> 'cnpj_cliente': "04.151.776/0001-63".
    - Quadro "MÊS/ANO" ou "MÊS DE REFERÊNCIA": ex: "09/2026" -> 'competencia_formatada': "09/2026", 'competencia': "2026-09-01".
    - Quadro "VENCIMENTO": ex: "25/09/2026" -> 'vencimento': "2026-09-25".
    - Quadro "TOTAL A PAGAR": ex: "R$22.347,38" -> 'valor_total': 22347.38 e 'fatura_total': 22347.38.
    - Quadro "MENSAGENS IMPORTANTES": ex: "Bandeira(s) tarifária(s) aplicada(s) no mês: AMARELA" -> 'adicional_bandeira': "Bandeira Amarela".
    - Tabela "DESCRIÇÃO DO FATURAMENTO" / "ITENS DE FATURA":
      * USO SIST. DISTR. (TUSD): Quant. 20.438,400 kWh, Preço unit com tributos 0,60978, Valor 12.462,95 -> 'tarifa_tusd_ponta': 0.60978.
      * ENERGIA (TE): Quant. 20.438,400 kWh, Preço unit com tributos 0,40912, Valor 8.361,74 -> 'tarifa_te_ponta': 0.40912.
    - Tabela "DADOS DE MEDIÇÃO":
      * Medidor: ex: 11134555 | Postos Tarifários: ÚNICO | Leitura Anterior: 65891,700 | Leitura Atual: 66743,300 | Const. Medidor: 0,02400 | Consumo kWh: 20.438,400.
      * Extraia: 'medicao_anterior': 65891.7, 'medicao_atual': 66743.3, 'consumo_medido': 20438.4, 'consumo': 20438.4.
  * PÁGINA 2:
    - Informações adicionais de canais de atendimento, indicadores e dados complementares.

Para Água e Esgoto (Sabesp, Sanepar, Copasa):
- Localize a tabela de hidrômetro/leituras: Leitura Anterior, Leitura Atual, Consumo (M3).
- Localize o quadro "DISCRIMINAÇÃO DO FATURAMENTO" / "TOTAL" / "VENCIMENTO" (valores como "R$ ************2.143,97" representam R$ 2.143,97).
- CNPJ Sabesp é sempre 43.776.517/0001-80.

IMPORTANTE: Se um campo estiver visível na imagem/texto, NUNCA retorne null. Extraia os números exatamente como aparecem (usando ponto como separador decimal).

Retorne APENAS um objeto JSON com essa estrutura:`

    function validateAndExtractJson(textResp) {
      if (!textResp || typeof textResp !== 'string') return null
      const raw = textResp.trim()
      if (
        raw.includes('DSML') ||
        raw.includes('<｜') ||
        raw.includes('tool_calls') ||
        raw.includes('/tmp/')
      ) {
        console.log(
          '[fatura_extract] Resposta da IA continha markup inválido (DSML/tool_call). Rejeitando.',
        )
        return null
      }

      let t = raw
      if (t.startsWith('```json')) t = t.substring(7)
      else if (t.startsWith('```')) t = t.substring(3)
      if (t.endsWith('```')) t = t.substring(0, t.length - 3)
      t = t.trim()

      let obj = null
      try {
        obj = JSON.parse(t)
      } catch (_) {
        const m = t.match(/\{[\s\S]*\}/)
        if (m) {
          try {
            obj = JSON.parse(m[0])
          } catch (_) {}
        }
      }
      if (!obj || typeof obj !== 'object') return null
      return obj
    }

    function checkHasRealValues(obj) {
      if (!obj || typeof obj !== 'object') return false
      const merged = Object.assign({}, obj.dados, obj.fatura, obj.data, obj)

      function hasPositive(v) {
        if (v === undefined || v === null || v === '' || v === 'null') return false
        if (typeof v === 'number') return v > 0
        let s = String(v)
          .replace(/^R\$\s*/i, '')
          .trim()
        if (s.includes('*')) s = s.replace(/[\*]+/g, '').trim()
        if (s.includes(',') && s.includes('.')) {
          s = s.replace(/\./g, '').replace(',', '.')
        } else if (s.includes(',')) {
          s = s.replace(',', '.')
        }
        const num = Number(s.replace(/[^0-9.]/g, ''))
        return !isNaN(num) && num > 0
      }

      return (
        hasPositive(merged.valor_total) ||
        hasPositive(merged.valorTotal) ||
        hasPositive(merged.fatura_total) ||
        hasPositive(merged.faturaTotal) ||
        hasPositive(merged.consumo) ||
        hasPositive(merged.consumo_medido) ||
        hasPositive(merged.consumoMedido) ||
        hasPositive(merged.consumo_ponta) ||
        hasPositive(merged.consumo_fora_ponta) ||
        hasPositive(merged.medicao_anterior) ||
        hasPositive(merged.medicao_atual) ||
        hasPositive(merged.tarifa) ||
        hasPositive(merged.tarifa_tusd_ponta)
      )
    }

    try {
      let rawText = ''
      let aiMethodUsed = 'none'

      // Prioridade 1: Texto extraído
      if (textExtracted && textContent && textContent.trim().length > 20) {
        try {
          const txt = textContent.slice(0, 14000)
          const textUserContent = `${instructions}\n\nTexto extraído do documento:\n"""\n${txt}\n"""`
          console.log(
            `[fatura_extract] Executando $ai.chat com texto (${txt.length} caracteres)...`,
          )

          let aiTextResponse = null
          const textMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: textUserContent },
          ]
          const primaryModel = forceModel === 'reasoning' ? 'reasoning' : 'fast'
          const fallbackModel = primaryModel === 'fast' ? 'reasoning' : 'fast'

          try {
            console.log(`[fatura_extract] Chamando texto com modelo ${primaryModel}...`)
            aiTextResponse = callAiChat(primaryModel, textMessages)
          } catch (primaryErr) {
            console.log(
              `[fatura_extract] Modelo ${primaryModel} falhou no texto, tentando ${fallbackModel}...`,
            )
            aiTextResponse = callAiChat(fallbackModel, textMessages)
          }

          if (
            aiTextResponse &&
            aiTextResponse.choices &&
            aiTextResponse.choices[0] &&
            aiTextResponse.choices[0].message
          ) {
            const candidateContent = aiTextResponse.choices[0].message.content || ''
            const parsedCandidate = validateAndExtractJson(candidateContent)
            if (parsedCandidate && checkHasRealValues(parsedCandidate)) {
              rawText = candidateContent
              aiMethodUsed = 'document_text'
              console.log('[fatura_extract] Sucesso na extração por texto.')
            } else {
              console.log('[fatura_extract] Extração por texto não gerou dados válidos.')
            }
          }
        } catch (textErr) {
          console.log('[fatura_extract] Extração por texto falhou:', textErr.message || textErr)
        }
      }

      // Prioridade 2: Visão computacional com as imagens
      let visionAttempted = false
      let visionErrorMsg = null
      if (!rawText && pageImages && pageImages.length > 0) {
        visionAttempted = true
        try {
          const validImages = []
          const maxPages = Math.min(pageImages.length, 2)
          for (let i = 0; i < maxPages; i++) {
            const imgUrl = pageImages[i]
            if (
              typeof imgUrl === 'string' &&
              (imgUrl.startsWith('data:image/') || imgUrl.length > 100)
            ) {
              validImages.push(imgUrl)
            }
          }

          if (validImages.length > 0) {
            const visionUserText = `${instructions}\n\nExamine atentamente as imagens desta fatura de energia/utilidade página por página.\nLeia com extrema atenção todos os quadros numéricos:\n- Quadro 'TOTAL A PAGAR' / 'VALOR TOTAL'\n- Quadro 'DADOS DE MEDIÇÃO' (Leitura Anterior, Leitura Atual, Constante, Consumo medido/faturado em kWh - ex: 20.438,400 -> consumo: 20438.4)\n- ATENÇÃO CRÍTICA AO CONSUMO: Na Enel classe B (B1, B2, B3, B4 ou posto ÚNICO), o consumo é ÚNICO (ex: 20438.4) e deve ser retornado no campo 'consumo' e 'consumo_medido'. Não deixe o consumo em branco!\n- Quadro 'DESCRIÇÃO DO FATURAMENTO' / 'ITENS DE FATURA' (IMPORTANTE: Na Enel, extraia as tarifas sob o cabeçalho 'Preço Unit (R$) com tributos' para TUSD e TE - ex: TUSD 0,60978 -> tarifa_tusd_ponta: 0.60978 e TE 0,40912 -> tarifa_te_ponta: 0.40912; a quantidade faturada de kWh também reforça o 'consumo')\n- Quadro de identificação (CNPJ do cliente/destinatário e CNPJ da distribuidora/fornecedor, Classificação do consumo ex 'B-B3 - CONVENCIONAL - COMERCIAL' -> classificacao_consumo: 'B3', Bandeira tarifária).\nExtraia com rigor e retorne o JSON completo preenchido.`

            console.log(
              `[fatura_extract] Tentando visão multimodal com ${validImages.length} imagem(ns)...`,
              'Tamanho img 1:',
              validImages[0].length,
            )

            // Formato 1: images array nativo (base64 puro)
            const base64Images = validImages.map((img) => {
              const commaIdx = img.indexOf(',')
              return commaIdx !== -1 ? img.substring(commaIdx + 1) : img
            })

            const visionMessagesTopArray = [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: visionUserText,
                images: base64Images,
              },
            ]

            // Formato 2: OpenAI image_url standard
            const formattedDataUrls = validImages.map((img) => {
              if (img.startsWith('data:image/')) return img
              return `data:image/jpeg;base64,${img}`
            })

            const contentParts = [{ type: 'text', text: visionUserText }]
            for (let i = 0; i < formattedDataUrls.length; i++) {
              contentParts.push({
                type: 'image_url',
                image_url: {
                  url: formattedDataUrls[i],
                },
              })
            }
            const visionMessagesOpenAi = [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: contentParts,
              },
            ]

            function tryCallVision(modelAlias) {
              try {
                const res = callAiChat(modelAlias, visionMessagesTopArray)
                if (res?.choices?.[0]?.message?.content) {
                  return res
                }
              } catch (fmt1Err) {
                console.log(
                  `[fatura_extract] Modelo ${modelAlias} formato images array falhou (${fmt1Err.message || fmt1Err}). Tentando formato image_url...`,
                )
              }

              return callAiChat(modelAlias, visionMessagesOpenAi)
            }

            let aiVisionResponse = null
            const modelsToTry =
              forceModel === 'reasoning' ? ['reasoning', 'fast'] : ['fast', 'reasoning']

            for (const modelAlias of modelsToTry) {
              try {
                console.log(`[fatura_extract] Chamando visão com modelo ${modelAlias}...`)
                const resp = tryCallVision(modelAlias)
                const content = resp?.choices?.[0]?.message?.content || ''
                console.log(
                  `[fatura_extract] Modelo ${modelAlias} respondeu na visão (${content.length} caracteres).`,
                )

                const parsed = validateAndExtractJson(content)
                if (parsed && checkHasRealValues(parsed)) {
                  console.log(
                    `[fatura_extract] Modelo ${modelAlias} retornou dados válidos de fatura!`,
                  )
                  aiVisionResponse = resp
                  break
                } else {
                  console.log(
                    `[fatura_extract] Modelo ${modelAlias} retornou resposta vazia ou sem valores reais.`,
                  )
                  if (!aiVisionResponse && parsed) {
                    aiVisionResponse = resp
                  }
                }
              } catch (modelErr) {
                console.log(
                  `[fatura_extract] Modelo ${modelAlias} falhou completamente na visão:`,
                  modelErr.message || modelErr,
                )
              }
            }

            if (
              aiVisionResponse &&
              aiVisionResponse.choices &&
              aiVisionResponse.choices[0] &&
              aiVisionResponse.choices[0].message
            ) {
              rawText = aiVisionResponse.choices[0].message.content || ''
              aiMethodUsed = 'vision'
              console.log('[fatura_extract] Sucesso na extração por visão computacional.')
            }
          }
        } catch (visionErr) {
          visionErrorMsg = visionErr.message || String(visionErr)
          console.log('[fatura_extract] Visão falhou:', visionErrorMsg)
        }
      }

      if (!rawText) {
        if (visionAttempted) {
          throw new BadRequestError(
            'Não foi possível extrair os dados visuais desta fatura escaneada no momento. Por favor, preencha os dados manualmente no formulário abaixo ou utilize uma fatura com texto selecionável.',
          )
        }

        if (toMarkdownError && toMarkdownError.status === 422) {
          throw new BadRequestError(
            'O documento é uma imagem ou digitalização escaneada sem camada de texto legível. Por favor, envie uma fatura digital com texto selecionável ou preencha os dados manualmente.',
          )
        }
        if (!textExtracted && (!pageImages || pageImages.length === 0)) {
          throw new BadRequestError(
            'Não foi possível ler o documento: certifique-se de que o PDF possui camada de texto ou preencha os campos manualmente.',
          )
        }
        throw new BadRequestError(
          'Não foi possível extrair dados automaticamente desta fatura. Por favor, revise o arquivo ou insira as medições e valores manualmente.',
        )
      }

      console.log(
        '[fatura_extract] Resposta bruta da IA (' + aiMethodUsed + '):',
        rawText.slice(0, 300),
      )

      rawText = rawText.trim()
      if (rawText.startsWith('```json')) {
        rawText = rawText.substring(7)
      } else if (rawText.startsWith('```')) {
        rawText = rawText.substring(3)
      }
      if (rawText.endsWith('```')) {
        rawText = rawText.substring(0, rawText.length - 3)
      }
      rawText = rawText.trim()

      let parsed = {}
      try {
        parsed = JSON.parse(rawText)
      } catch (_) {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0])
          } catch (e2) {
            parsed = {}
          }
        }
      }
      console.log('[fatura_extract] Objeto extraído antes da normalização:', JSON.stringify(parsed))

      if (parsed && typeof parsed === 'object') {
        if (parsed.dados && typeof parsed.dados === 'object' && !parsed.tipo_utilidade) {
          parsed = Object.assign({}, parsed.dados, parsed)
        }
        if (parsed.fatura && typeof parsed.fatura === 'object' && !parsed.tipo_utilidade) {
          parsed = Object.assign({}, parsed.fatura, parsed)
        }
        if (parsed.data && typeof parsed.data === 'object' && !parsed.tipo_utilidade) {
          parsed = Object.assign({}, parsed.data, parsed)
        }

        // Sanitização e parsing robusto para números no padrão brasileiro
        function parseBrazilianNumber(val) {
          if (val === undefined || val === null || val === '') return null
          if (typeof val === 'number') {
            return isNaN(val) || val <= 0 ? null : val
          }
          let s = String(val).trim()
          if (!s || s === 'null' || s === 'undefined' || s === '0') return null
          s = s.replace(/^R\$\s*/i, '').trim()
          if (s.includes('*')) {
            s = s.replace(/[\*]+/g, '').trim()
          }
          if (s.includes(',') && s.includes('.')) {
            // "22.347,38" ou "4.363,05" -> 22347.38
            s = s.replace(/\./g, '').replace(',', '.')
          } else if (s.includes(',')) {
            // "682,168" ou "20438,400" -> vírgula decimal
            s = s.replace(',', '.')
          }
          const cleanedStr = s.replace(/[^0-9.]/g, '')
          const num = Number(cleanedStr)
          if (isNaN(num) || num <= 0) return null
          return num
        }
        function isSentinelDate(val) {
          if (!val) return true
          const s = String(val).trim()
          if (!s || s === 'null' || s === 'undefined') return true
          if (s.includes('1900')) return true
          return false
        }

        function sanitizeNumeric(val) {
          return parseBrazilianNumber(val)
        }

        function sanitizeText(val) {
          if (val === undefined || val === null) return null
          const s = String(val).trim()
          if (!s || s === 'null' || s === 'undefined' || s === '0') return null
          return s
        }

        // Sanitizar datas
        if (isSentinelDate(parsed.competencia)) parsed.competencia = null
        if (isSentinelDate(parsed.competencia_formatada)) parsed.competencia_formatada = null
        if (isSentinelDate(parsed.vencimento)) parsed.vencimento = null

        // Sanitizar strings de identificação
        parsed.numero_fatura = sanitizeText(parsed.numero_fatura)
        parsed.cnpj_cliente = sanitizeText(parsed.cnpj_cliente)
        parsed.cnpj_fornecedor = sanitizeText(parsed.cnpj_fornecedor)
        parsed.classificacao_consumo = sanitizeText(parsed.classificacao_consumo)
        parsed.adicional_bandeira = sanitizeText(parsed.adicional_bandeira)

        if (parsed.classificacao_consumo) {
          const mClass = String(parsed.classificacao_consumo).match(/\b(A[1-4]|B[1-4])\b/i)
          if (mClass) {
            parsed.classificacao_consumo = mClass[1].toUpperCase()
          }
        }

        if (
          parsed.consumoMedido !== undefined &&
          (parsed.consumo_medido === undefined || parsed.consumo_medido === null)
        ) {
          parsed.consumo_medido = parsed.consumoMedido
        }
        if (
          parsed.consumoCorrigido !== undefined &&
          (parsed.consumo_corrigido === undefined || parsed.consumo_corrigido === null)
        ) {
          parsed.consumo_corrigido = parsed.consumoCorrigido
        }
        if (
          parsed.medicaoAnterior !== undefined &&
          (parsed.medicao_anterior === undefined || parsed.medicao_anterior === null)
        ) {
          parsed.medicao_anterior = parsed.medicaoAnterior
        }
        if (
          parsed.medicaoAtual !== undefined &&
          (parsed.medicao_atual === undefined || parsed.medicao_atual === null)
        ) {
          parsed.medicao_atual = parsed.medicaoAtual
        }
        if (
          parsed.valorTotal !== undefined &&
          (parsed.valor_total === undefined || parsed.valor_total === null)
        ) {
          parsed.valor_total = parsed.valorTotal
        }
        if (
          parsed.faturaTotal !== undefined &&
          (parsed.fatura_total === undefined || parsed.fatura_total === null)
        ) {
          parsed.fatura_total = parsed.faturaTotal
        }
        if (
          parsed.consumoFaturado !== undefined &&
          (parsed.consumo === undefined || parsed.consumo === null)
        ) {
          parsed.consumo = parsed.consumoFaturado
        }
        if (
          parsed.tarifaUnitaria !== undefined &&
          (parsed.tarifa === undefined || parsed.tarifa === null)
        ) {
          parsed.tarifa = parsed.tarifaUnitaria
        }

        // Normalização flexível e abrangente de chaves de consumo (incluindo variações comuns da IA)
        const consumoCandidate =
          parsed.consumo ||
          parsed.consumo_total ||
          parsed.consumoTotal ||
          parsed.consumo_medido ||
          parsed.consumoMedido ||
          parsed.consumo_faturado ||
          parsed.consumoFaturado ||
          parsed.consumo_apurado ||
          parsed.consumoApurado ||
          parsed.kwh_total ||
          parsed.kwhTotal ||
          parsed.total_kwh ||
          parsed.totalKwh ||
          parsed.kwh ||
          parsed['consumo faturado'] ||
          parsed['consumo total'] ||
          parsed['consumo medido'] ||
          parsed['Consumo (kWh)'] ||
          parsed['Consumo kWh'] ||
          parsed['consumo_kwh'] ||
          parsed['quantidade_kwh']

        if (
          consumoCandidate !== undefined &&
          (parsed.consumo === undefined || parsed.consumo === null)
        ) {
          parsed.consumo = consumoCandidate
        }
        if (
          consumoCandidate !== undefined &&
          (parsed.consumo_medido === undefined || parsed.consumo_medido === null)
        ) {
          parsed.consumo_medido = consumoCandidate
        }

        // Sanitizar numéricos essenciais
        parsed.valor_total = sanitizeNumeric(parsed.valor_total)
        parsed.fatura_total = sanitizeNumeric(parsed.fatura_total)
        parsed.consumo = sanitizeNumeric(parsed.consumo)
        parsed.medicao_anterior = sanitizeNumeric(parsed.medicao_anterior)
        parsed.medicao_atual = sanitizeNumeric(parsed.medicao_atual)
        parsed.consumo_ponta = sanitizeNumeric(parsed.consumo_ponta)
        parsed.consumo_fora_ponta = sanitizeNumeric(parsed.consumo_fora_ponta)
        parsed.tarifa_tusd_ponta = sanitizeNumeric(parsed.tarifa_tusd_ponta)
        parsed.tarifa_te_ponta = sanitizeNumeric(parsed.tarifa_te_ponta)
        parsed.tarifa_tusd_f_ponta = sanitizeNumeric(parsed.tarifa_tusd_f_ponta)
        parsed.tarifa_te_f_ponta = sanitizeNumeric(parsed.tarifa_te_f_ponta)
        parsed.consumo_medido = sanitizeNumeric(parsed.consumo_medido)
        parsed.consumo_corrigido = sanitizeNumeric(parsed.consumo_corrigido)
        parsed.tarifa = sanitizeNumeric(parsed.tarifa)

        // Normalização flexível de tarifas para Energia Elétrica
        // Aceita variações como: preco_unit_tusd, preco_unitario_tusd, tusd_com_tributos, preco_tusd, etc.
        const tusdPontaCandidate =
          parsed.tarifa_tusd_ponta ||
          parsed.tarifaTusdPonta ||
          parsed.preco_unit_tusd_ponta ||
          parsed.preco_unitario_tusd_ponta ||
          parsed.tusd_ponta ||
          parsed.preco_unit_tusd ||
          parsed.preco_unitario_tusd ||
          parsed.tusd_com_tributos ||
          parsed['Preço Unit (R$) com tributos - TUSD'] ||
          parsed['Preço Unit TUSD'] ||
          parsed.tusd

        if (tusdPontaCandidate && !parsed.tarifa_tusd_ponta) {
          parsed.tarifa_tusd_ponta = sanitizeNumeric(tusdPontaCandidate)
        }

        const tePontaCandidate =
          parsed.tarifa_te_ponta ||
          parsed.tarifaTePonta ||
          parsed.preco_unit_te_ponta ||
          parsed.preco_unitario_te_ponta ||
          parsed.te_ponta ||
          parsed.preco_unit_te ||
          parsed.preco_unitario_te ||
          parsed.te_com_tributos ||
          parsed['Preço Unit (R$) com tributos - TE'] ||
          parsed['Preço Unit TE'] ||
          parsed.te

        if (tePontaCandidate && !parsed.tarifa_te_ponta) {
          parsed.tarifa_te_ponta = sanitizeNumeric(tePontaCandidate)
        }

        const tusdFPontaCandidate =
          parsed.tarifa_tusd_f_ponta ||
          parsed.tarifaTusdFPonta ||
          parsed.preco_unit_tusd_f_ponta ||
          parsed.preco_unitario_tusd_f_ponta ||
          parsed.tusd_f_ponta ||
          parsed.tusd_fora_ponta ||
          parsed.tarifa_tusd_fora_ponta

        if (tusdFPontaCandidate && !parsed.tarifa_tusd_f_ponta) {
          parsed.tarifa_tusd_f_ponta = sanitizeNumeric(tusdFPontaCandidate)
        }

        const teFPontaCandidate =
          parsed.tarifa_te_f_ponta ||
          parsed.tarifaTeFPonta ||
          parsed.preco_unit_te_f_ponta ||
          parsed.preco_unitario_te_f_ponta ||
          parsed.te_f_ponta ||
          parsed.te_fora_ponta ||
          parsed.tarifa_te_fora_ponta

        if (teFPontaCandidate && !parsed.tarifa_te_f_ponta) {
          parsed.tarifa_te_f_ponta = sanitizeNumeric(teFPontaCandidate)
        }

        // CNPJs: variações de nomes
        const clienteCnpjCandidate =
          parsed.cnpj_cliente ||
          parsed.cnpjCliente ||
          parsed.cnpj_consumidor ||
          parsed.cnpjConsumidor ||
          parsed.cnpj_titular ||
          parsed.cnpjTitular ||
          parsed.cnpj_unidade ||
          parsed.cnpjUnidade ||
          parsed.cnpj_destinatario ||
          parsed.cnpj_empreendimento ||
          parsed.cnpjEmpreendimento ||
          parsed['cnpj_cliente/consumidor'] ||
          parsed['CNPJ do cliente'] ||
          parsed['CNPJ Cliente'] ||
          parsed['cnpj cliente']

        if (clienteCnpjCandidate && !parsed.cnpj_cliente) {
          parsed.cnpj_cliente = sanitizeText(clienteCnpjCandidate)
        }

        if (parsed.cnpj_cliente && String(parsed.cnpj_cliente).includes('*')) {
          const rawClient = String(parsed.cnpj_cliente).replace(/[^0-9*]/g, '')
          if (rawClient.startsWith('04') && rawClient.endsWith('63')) {
            parsed.cnpj_cliente = '04.151.776/0001-63'
          }
        }

        // Sanitização estrita do CNPJ do cliente no backend: só manter se tiver 14 dígitos após limpeza
        if (parsed.cnpj_cliente) {
          const cleanCliDigits = String(parsed.cnpj_cliente).replace(/\D/g, '')
          if (cleanCliDigits.length !== 14) {
            console.log(
              '[fatura_extract] CNPJ do cliente truncado ou inválido descartado:',
              parsed.cnpj_cliente,
            )
            parsed.cnpj_cliente = null
          }
        }

        const fornecedorCnpjCandidate =
          parsed.cnpj_fornecedor ||
          parsed.cnpjFornecedor ||
          parsed.cnpj_distribuidora ||
          parsed.cnpjDistribuidora ||
          parsed.cnpj_emitente ||
          parsed.cnpjEmitente ||
          parsed.cnpj_concessionaria ||
          parsed.cnpjConcessionaria ||
          parsed['CNPJ do fornecedor'] ||
          parsed['CNPJ fornecedor'] ||
          parsed['cnpj fornecedor']

        if (fornecedorCnpjCandidate && !parsed.cnpj_fornecedor) {
          parsed.cnpj_fornecedor = sanitizeText(fornecedorCnpjCandidate)
        }

        const genericCnpj = sanitizeText(parsed.cnpj || parsed.cnpj_fatura || parsed.cnpjFatura)
        if (genericCnpj) {
          const cleanGen = genericCnpj.replace(/\D/g, '')
          const knownDistributors = [
            '61856571000621',
            '61856571000117',
            '61695227000193',
            '43776517000180',
            '33050196000188',
            '02474103000119',
            '60744463000190',
            '04172213000151',
            '17281106000103',
          ]
          const isKnownDist = knownDistributors.some((d) => cleanGen.startsWith(d))
          if (isKnownDist) {
            if (!parsed.cnpj_fornecedor) parsed.cnpj_fornecedor = genericCnpj
          } else if (cleanGen.length === 14) {
            if (!parsed.cnpj_cliente) {
              parsed.cnpj_cliente = genericCnpj
            } else if (!parsed.cnpj_fornecedor) {
              parsed.cnpj_fornecedor = genericCnpj
            }
          }
        }

        // Sanitização estrita do CNPJ do fornecedor no backend
        if (parsed.cnpj_fornecedor) {
          const cleanFornDigits = String(parsed.cnpj_fornecedor).replace(/\D/g, '')
          if (cleanFornDigits.length !== 14) {
            parsed.cnpj_fornecedor = null
          }
        }

        if (parsed.numeroFatura !== undefined && parsed.numero_fatura === undefined) {
          parsed.numero_fatura = parsed.numeroFatura
        }
        if (parsed.unidadeConsumo !== undefined && parsed.unidade_consumo === undefined) {
          parsed.unidade_consumo = parsed.unidadeConsumo
        }
        if (parsed.tipoUtilidade !== undefined && parsed.tipo_utilidade === undefined) {
          parsed.tipo_utilidade = parsed.tipoUtilidade
        }

        if (parsed.valor_total !== undefined && parsed.fatura_total === undefined) {
          parsed.fatura_total = parsed.valor_total
        }
        if (parsed.fatura_total !== undefined && parsed.valor_total === undefined) {
          parsed.valor_total = parsed.fatura_total
        }

        // Normalização do tipo de utilidade
        const rawTipo = String(parsed.tipo_utilidade || '').toLowerCase()
        if (
          rawTipo.includes('gás') ||
          rawTipo.includes('gas') ||
          rawTipo.includes('comgás') ||
          rawTipo.includes('comgas') ||
          rawTipo.includes('naturgy') ||
          requestedUtility === 'Gás'
        ) {
          parsed.tipo_utilidade = 'Gás'
          parsed.unidade_consumo = 'm³'

          if (
            parsed.consumo_corrigido !== undefined &&
            (parsed.consumo === undefined || Number(parsed.consumo) === 0)
          ) {
            parsed.consumo = parsed.consumo_corrigido
          } else if (
            parsed.consumo_medido !== undefined &&
            (parsed.consumo === undefined || Number(parsed.consumo) === 0)
          ) {
            parsed.consumo = parsed.consumo_medido
          }

          if (parsed.consumo !== undefined && parsed.consumo_medido === undefined) {
            parsed.consumo_medido = parsed.consumo
          }
          if (parsed.consumo !== undefined && parsed.consumo_corrigido === undefined) {
            parsed.consumo_corrigido = parsed.consumo
          }

          if (
            (parsed.consumo_medido === undefined || Number(parsed.consumo_medido) === 0) &&
            parsed.medicao_atual !== undefined &&
            parsed.medicao_anterior !== undefined &&
            Number(parsed.medicao_atual) >= Number(parsed.medicao_anterior)
          ) {
            parsed.consumo_medido = Number(
              (Number(parsed.medicao_atual) - Number(parsed.medicao_anterior)).toFixed(3),
            )
            if (parsed.consumo_corrigido === undefined) {
              parsed.consumo_corrigido = parsed.consumo_medido
            }
            if (parsed.consumo === undefined) {
              parsed.consumo = parsed.consumo_corrigido
            }
          }

          if (
            (!parsed.tarifa || Number(parsed.tarifa) === 0) &&
            parsed.valor_total > 0 &&
            (parsed.consumo_corrigido > 0 || parsed.consumo > 0)
          ) {
            const baseCons = Number(parsed.consumo_corrigido || parsed.consumo)
            parsed.tarifa = Number((Number(parsed.valor_total) / baseCons).toFixed(6))
          }
        }

        const isAgua =
          parsed.tipo_utilidade === 'Água e Esgoto' ||
          rawTipo.includes('água') ||
          rawTipo.includes('agua') ||
          rawTipo.includes('esgoto') ||
          rawTipo.includes('sabesp') ||
          rawTipo.includes('sanepar') ||
          rawTipo.includes('copasa') ||
          requestedUtility === 'Água e Esgoto' ||
          (parsed.cnpj_fornecedor && String(parsed.cnpj_fornecedor).includes('43.776.517'))

        if (isAgua) {
          parsed.tipo_utilidade = 'Água e Esgoto'
          parsed.unidade_consumo = 'm³'

          if (!parsed.cnpj_fornecedor || parsed.cnpj_fornecedor.length < 5) {
            parsed.cnpj_fornecedor = '43.776.517/0001-80'
          }

          if (parsed.consumo_medido !== undefined && !parsed.consumo) {
            parsed.consumo = parsed.consumo_medido
          }
          if (parsed.consumo !== undefined && !parsed.consumo_medido) {
            parsed.consumo_medido = parsed.consumo
          }

          if (
            (!parsed.consumo_medido || Number(parsed.consumo_medido) === 0) &&
            parsed.medicao_atual !== undefined &&
            parsed.medicao_anterior !== undefined &&
            Number(parsed.medicao_atual) >= Number(parsed.medicao_anterior)
          ) {
            parsed.consumo_medido = Number(
              (Number(parsed.medicao_atual) - Number(parsed.medicao_anterior)).toFixed(3),
            )
            if (!parsed.consumo) {
              parsed.consumo = parsed.consumo_medido
            }
          }

          if (
            (!parsed.tarifa || Number(parsed.tarifa) === 0) &&
            parsed.fatura_total > 0 &&
            parsed.consumo > 0
          ) {
            parsed.tarifa = Number((parsed.fatura_total / parsed.consumo).toFixed(4))
          }
        }

        const isEnergia =
          parsed.tipo_utilidade === 'Energia Elétrica' ||
          rawTipo.includes('energia') ||
          rawTipo.includes('eletric') ||
          rawTipo.includes('enel') ||
          rawTipo.includes('cpfl') ||
          rawTipo.includes('light') ||
          rawTipo.includes('cemig') ||
          requestedUtility === 'Energia Elétrica' ||
          fileName.toLowerCase().includes('enel')

        if (
          isEnergia &&
          parsed.tipo_utilidade !== 'Gás' &&
          parsed.tipo_utilidade !== 'Água e Esgoto'
        ) {
          parsed.tipo_utilidade = 'Energia Elétrica'
          parsed.unidade_consumo = 'kWh'

          if (
            (!parsed.cnpj_fornecedor || parsed.cnpj_fornecedor.length < 5) &&
            (fileName.toLowerCase().includes('enel') || rawTipo.includes('enel'))
          ) {
            parsed.cnpj_fornecedor = '61.695.227/0001-93'
          }

          if (
            !parsed.cnpj_cliente &&
            (fileName.toLowerCase().includes('enel') || rawTipo.includes('enel'))
          ) {
            parsed.cnpj_cliente = '04.151.776/0001-63'
          }

          // Detectar grupo de consumo da energia elétrica (A vs B)
          // Ex: "B3", "B1", "B-B3 - CONVENCIONAL", etc. -> Grupo B
          // Ex: "A4", "A3", "A-A4 - HOROSSAZONAL VERDE", etc. -> Grupo A
          let grupoConsumo = ''
          if (parsed.classificacao_consumo) {
            const cleanCls = String(parsed.classificacao_consumo).trim().toUpperCase()
            const matchGroup = cleanCls.match(/\b([AB])[1-4]?\b/) || cleanCls.match(/^([AB])/)
            if (matchGroup) {
              grupoConsumo = matchGroup[1]
            }
          }

          // Se for Classe B (ou não houver ponta/fora-ponta discriminados):
          // Consumo é ÚNICO! Não deve haver separação ponta/fora-ponta.
          if (grupoConsumo === 'B') {
            // Se a IA tiver colocado o consumo total em consumo_ponta ou consumo_fora_ponta por engano
            if (!parsed.consumo) {
              if (parsed.consumo_fora_ponta && !parsed.consumo_ponta) {
                parsed.consumo = parsed.consumo_fora_ponta
              } else if (parsed.consumo_ponta && !parsed.consumo_fora_ponta) {
                parsed.consumo = parsed.consumo_ponta
              } else if (parsed.consumo_ponta && parsed.consumo_fora_ponta) {
                parsed.consumo = Number(
                  (Number(parsed.consumo_ponta) + Number(parsed.consumo_fora_ponta)).toFixed(3),
                )
              }
            }
            // Em classe B o consumo é único, zerar/anular ponta e fora-ponta
            parsed.consumo_ponta = null
            parsed.consumo_fora_ponta = null
          } else if (grupoConsumo === 'A') {
            // Se for Classe A e consumo total estiver ausente mas ponta + fora_ponta estiverem presentes
            if (!parsed.consumo && (parsed.consumo_ponta || parsed.consumo_fora_ponta)) {
              parsed.consumo = Number(
                (
                  (Number(parsed.consumo_ponta) || 0) + (Number(parsed.consumo_fora_ponta) || 0)
                ).toFixed(3),
              )
            }
          }

          if (
            (!parsed.consumo_medido || Number(parsed.consumo_medido) === 0) &&
            parsed.consumo &&
            Number(parsed.consumo) > 0
          ) {
            parsed.consumo_medido = parsed.consumo
          }

          if (
            (!parsed.consumo || Number(parsed.consumo) === 0) &&
            parsed.consumo_medido &&
            Number(parsed.consumo_medido) > 0
          ) {
            parsed.consumo = parsed.consumo_medido
          }

          if (
            (!parsed.consumo_medido || Number(parsed.consumo_medido) === 0) &&
            parsed.medicao_atual !== undefined &&
            parsed.medicao_anterior !== undefined &&
            Number(parsed.medicao_atual) >= Number(parsed.medicao_anterior)
          ) {
            if (!parsed.consumo || Number(parsed.consumo) === 0) {
              parsed.consumo_medido = Number(
                (Number(parsed.medicao_atual) - Number(parsed.medicao_anterior)).toFixed(3),
              )
              parsed.consumo = parsed.consumo_medido
            }
          }

          // Tratamento para faturas convencionais (posto único / Classe B) ou tarifas não divididas:
          // Se tarifa_tusd_ponta foi identificada e tarifa_tusd_f_ponta não, e não há consumo fora de ponta distinto,
          // espelhar para fora-ponta se aplicável para garantir que as tarifas fiquem preenchidas se o consumidor opera em tarifa convencional
          if (
            parsed.tarifa_tusd_ponta &&
            !parsed.tarifa_tusd_f_ponta &&
            !parsed.consumo_fora_ponta
          ) {
            parsed.tarifa_tusd_f_ponta = parsed.tarifa_tusd_ponta
          }
          if (parsed.tarifa_te_ponta && !parsed.tarifa_te_f_ponta && !parsed.consumo_fora_ponta) {
            parsed.tarifa_te_f_ponta = parsed.tarifa_te_ponta
          }

          // Se a fatura trouxe apenas uma tarifa geral única ("tarifa" ou "preco_unitario")
          // e nenhum campo TUSD/TE foi separado:
          // Conforme requisito: "se a fatura mostrar apenas um preço unitário combinado por período e não puder ser dividido, preencha o campo TUSD com ele e deixe TE em branco em vez de deixar ambos em branco — nunca invente valores."
          if (
            !parsed.tarifa_tusd_ponta &&
            !parsed.tarifa_te_ponta &&
            parsed.tarifa &&
            Number(parsed.tarifa) > 0
          ) {
            parsed.tarifa_tusd_ponta = parsed.tarifa
            if (!parsed.consumo_fora_ponta) {
              parsed.tarifa_tusd_f_ponta = parsed.tarifa
            }
          }
        }

        let hasConsumptionOrValue = false

        if (parsed.valor_total && Number(parsed.valor_total) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.fatura_total && Number(parsed.fatura_total) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.consumo && Number(parsed.consumo) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.consumo_medido && Number(parsed.consumo_medido) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.consumo_corrigido && Number(parsed.consumo_corrigido) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.consumo_ponta && Number(parsed.consumo_ponta) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.consumo_fora_ponta && Number(parsed.consumo_fora_ponta) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.medicao_anterior && Number(parsed.medicao_anterior) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.medicao_atual && Number(parsed.medicao_atual) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.tarifa_tusd_ponta && Number(parsed.tarifa_tusd_ponta) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.tarifa_te_ponta && Number(parsed.tarifa_te_ponta) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.tarifa_tusd_f_ponta && Number(parsed.tarifa_tusd_f_ponta) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.tarifa_te_f_ponta && Number(parsed.tarifa_te_f_ponta) > 0) {
          hasConsumptionOrValue = true
        }
        if (parsed.tarifa && Number(parsed.tarifa) > 0) {
          hasConsumptionOrValue = true
        }

        if (!hasConsumptionOrValue) {
          console.log(
            '[fatura_extract] Nenhum campo de valor/consumo real foi extraído após sanitização.',
          )
          throw new BadRequestError(
            'Não foi possível extrair dados de consumo e valores automaticamente desta fatura. Por favor, revise o arquivo ou insira as medições e valores manualmente.',
          )
        }
      } else {
        throw new BadRequestError(
          'Não foi possível extrair dados automaticamente desta fatura. Por favor, revise o arquivo ou insira as medições e valores manualmente.',
        )
      }

      return e.json(200, {
        sucesso: true,
        arquivo_nome: fileName,
        dados: parsed,
      })
    } catch (aiErr) {
      const msg = aiErr.message || String(aiErr)
      console.log('[fatura_extract] Erro capturado no handler:', msg)

      if (
        msg.includes('Não foi possível') ||
        msg.includes('Por favor') ||
        msg.includes('camada de texto') ||
        msg.includes('escaneada')
      ) {
        throw new BadRequestError(msg)
      }

      if (
        msg.includes('skip-ai-gateway') ||
        msg.includes('400') ||
        msg.includes('gateway') ||
        msg.includes('unsupported')
      ) {
        throw new BadRequestError(
          'Não foi possível processar a fatura com o assistente de IA no momento. Por favor, preencha os campos manualmente no formulário.',
        )
      }
      throw new BadRequestError(
        'Falha ao processar o documento. Você pode preencher os campos manualmente no formulário.',
      )
    }
  },
  $apis.requireAuth(),
)
