routerAdd(
  'POST',
  '/backend/v1/faturas/extract',
  (e) => {
    const files = e.findUploadedFiles('arquivo')
    const uploadedFile = files && files.length > 0 ? files[0] : null
    const fileName = uploadedFile ? uploadedFile.name || 'arquivo' : 'arquivo'
    const ext = fileName.toLowerCase().split('.').pop()

    const body = e.requestInfo().body || {}
    const requestedUtility = body.tipo_utilidade || ''

    // Check for images provided in body (e.g. from vision conversion in client or payload)
    // Could be a JSON string array of data URLs in body.images or uploaded image files
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

    // Client-provided OCR or extracted text in body
    let clientProvidedText = body.client_text || body.extracted_text || ''

    let textContent = ''
    let textExtracted = false
    let toMarkdownError = null

    // Heurística de validação de qualidade de texto (detecta texto cifrado / fontes embaralhadas como Sabesp)
    function isQualityText(raw) {
      if (!raw || typeof raw !== 'string') return false
      const trimmed = raw.trim()
      if (trimmed.length < 30) return false

      // Proporção de caracteres alfanuméricos e espaços vs símbolos bizarros
      const normalChars = trimmed.match(/[a-zA-Z0-9À-ÿ\s,.\-:/\(\)%$]/g) || []
      const normalRatio = normalChars.length / trimmed.length
      if (normalRatio < 0.65) {
        console.log(
          '[fatura_extract] Texto rejeitado por baixa proporção de caracteres normais:',
          normalRatio,
        )
        return false
      }

      // Procurar termos comuns de faturas brasileiras
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
        'energia',
        'gas',
        'cnpj',
        'tarifa',
        'tributos',
      ]
      let termsFound = 0
      for (const term of commonTerms) {
        if (lower.includes(term)) termsFound++
      }

      // Se o texto for longo mas não contém termos básicos reconhecíveis, é provavelmente texto embaralhado
      if (trimmed.length > 100 && termsFound === 0) {
        console.log(
          '[fatura_extract] Texto rejeitado: nenhum termo reconhecível de faturas encontrado',
        )
        return false
      }

      return true
    }

    // Se o cliente forneceu texto extraído/OCR de boa qualidade, usar como candidato
    if (clientProvidedText && isQualityText(clientProvidedText)) {
      textContent = clientProvidedText
      textExtracted = true
      console.log(
        `[fatura_extract] Usando texto pré-extraído pelo cliente (${textContent.length} chars).`,
      )
    }

    // Try $documents.toMarkdown first whenever uploadedFile is a document (se ainda não temos texto confiável)
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

    const systemPrompt = `Você é um extrator de dados especialista e ultra-preciso para faturas de utilidades brasileiras (Energia Elétrica como Enel/CPFL/Light/Cemig, Gás Canalizado como Comgás/Naturgy, e Água e Esgoto como Sabesp/Sanepar/Copasa).
Você analisa faturas digitais e escaneadas com máxima atenção a números decimais, datas de medição, leituras de hidrômetro/medidor, volumes faturados e valores totais.
Responda APENAS com um objeto JSON válido, sem cercas de código markdown e sem comentários.`

    const instructions = `Analise a fatura anexada (arquivo "${fileName}").
Tipo de utilidade sugerido: "${requestedUtility || 'Detectar automaticamente da fatura'}".

Orientações cruciais de extração:
1. Identifique o tipo de utilidade:
   - "Energia Elétrica" (se houver kWh, Enel, CPFL, Light, Cemig, TUSD, TE, Bandeira Tarifária, etc.)
   - "Gás" (se houver Comgás, Naturgy, Gás Natural, m³, fator de correção PTZ/PCS, etc.)
   - "Água e Esgoto" (se Sabesp, Sanepar, Copasa, Cia de Saneamento, Fornecimento, Pde/Rgi, Hidrômetro, Leitura Anterior, Leitura Atual, Consumo m³, Água/Esgoto)

2. Para ENERGIA ELÉTRICA (ex: Enel Brasil / CPFL / Light):
   - "competencia": mês de referência (ex: MÊS/ANO 09/2026 -> "2026-09-01", "09/2026")
   - "valor_total": valor TOTAL A PAGAR (ex: R$ 22.347,38 -> 22347.38)
   - "fatura_total": 22347.38
   - "consumo": consumo faturado ativo total em kWh (ex: 20.438,40 -> 20438.40)
   - "unidade_consumo": "kWh"
   - "numero_fatura": número do documento / nota fiscal / número da conta (ex: 519519027339 ou 095039445)
   - "cnpj_fornecedor": CNPJ da distribuidora (ex Enel: 61.695.227/0001-93) ou do cliente
   - "vencimento": data de vencimento (ex: 25/09/2026 -> "2026-09-25")
   - "medicao_anterior": leitura anterior do medidor (ex: 65891.700 -> 65891.7)
   - "medicao_atual": leitura atual do medidor (ex: 66743.300 -> 66743.3)
   - "classificacao_consumo": classificação da unidade consumidora (ex: "B3 - CONVENCIONAL - Comercial", "B3", "A4", etc.)
   - "consumo_ponta": consumo no posto tarifário ponta em kWh
   - "consumo_fora_ponta": consumo no posto fora-ponta em kWh
   - "tarifa_tusd_ponta": tarifa unitária TUSD com tributos
   - "tarifa_te_ponta": tarifa unitária TE com tributos
   - "tarifa_tusd_f_ponta": tarifa TUSD fora de ponta
   - "tarifa_te_f_ponta": tarifa TE fora de ponta
   - "adicional_bandeira": bandeira tarifária indicada (ex: "Bandeira Amarela", "Bandeira Verde", "Bandeira Vermelha")

3. Para GÁS NATURAL (ex: Comgás / Naturgy):
   - "competencia": mês de referência / apresentação (ex: 08/2026 -> "2026-08-01", "08/2026")
   - "valor_total": valor a pagar total (ex: R$ 4.363,05 -> 4363.05)
   - "fatura_total": 4363.05
   - "consumo": consumo faturado corrigido (ex: 682.168 -> 682.17)
   - "unidade_consumo": "m³"
   - "numero_fatura": número da nota fiscal / conta de gás (ex: 150.238.010)
   - "cnpj_fornecedor": CNPJ da distribuidora (ex Comgás: 61.856.571/0006-21)
   - "vencimento": data de vencimento (ex: 08/09/2026 -> "2026-09-08")
   - "medicao_anterior": leitura anterior (ex: 431.304 -> 431.304)
   - "medicao_atual": leitura atual (ex: 432.014 -> 432.014)
   - "consumo_medido": consumo medido antes da correção (ex: 710 -> 710)
   - "consumo_corrigido": consumo corrigido por temperatura/pressão (ex: 682.168)
   - "tarifa": tarifa aplicada com ICMS por m³ (ex: 6,395871 -> 6.395871)

4. Para ÁGUA E ESGOTO (ex: Sabesp - Companhia de Saneamento Básico do Estado de São Paulo):
   - "tipo_utilidade": "Água e Esgoto"
   - "competencia": mês/ano de referência ou faturamento. Exemplo Sabesp: "05/2024" ou da data de emissão/leitura -> "2024-05-01", "competencia_formatada": "05/2024"
   - "valor_total": valor TOTAL ou TOTAL A PAGAR do documento (ex: R$ 2.143,97 -> 2143.97)
   - "fatura_total": 2143.97
   - "consumo": volume faturado ou consumo medido em m³ (ex: 157 m³ -> 157.0)
   - "consumo_medido": consumo medido em m³ (ex: Consumo (M3) 157 -> 157.0)
   - "unidade_consumo": "m³"
   - "numero_fatura": No. Documento ou Fatura Tipo ou Fornecimento / PDE (ex: "SOR202458365156" ou "58088806001")
   - "cnpj_fornecedor": CNPJ da concessionária de água (ex Sabesp: "43.776.517/0001-80" ou CNPJ no topo)
   - "vencimento": data de vencimento no campo VENCIMENTO (ex: 21/06/2024 -> "2024-06-21")
   - "medicao_anterior": Leitura Anterior do hidrômetro (ex: 5564)
   - "medicao_atual": Leitura Atual do hidrômetro (ex: 5721)
   - "tarifa": valor unitário médio por m³ (ex: se fatura é 2.143,97 e consumo é 157 m³, tarifa é ~ 13.6558) ou taxa unitária discriminada

Retorne rigorosamente esta estrutura JSON:
{
  "tipo_utilidade": "Energia Elétrica" | "Gás" | "Água e Esgoto",
  "competencia": "YYYY-MM-01",
  "competencia_formatada": "MM/AAAA",
  "valor_total": float,
  "consumo": float,
  "unidade_consumo": "kWh" ou "m³",
  "numero_fatura": string,
  "cnpj_fornecedor": string,
  "vencimento": "YYYY-MM-DD",
  "medicao_anterior": float,
  "medicao_atual": float,
  "classificacao_consumo": string,
  "consumo_ponta": float,
  "tarifa_tusd_ponta": float,
  "tarifa_te_ponta": float,
  "consumo_fora_ponta": float,
  "tarifa_tusd_f_ponta": float,
  "tarifa_te_f_ponta": float,
  "adicional_bandeira": string,
  "consumo_medido": float,
  "consumo_corrigido": float,
  "tarifa": float,
  "fatura_total": float
}`

    try {
      let rawText = ''
      let aiMethodUsed = 'none'

      // Prioridade 1: Se o documento gerou texto via $documents.toMarkdown ou OCR cliente, usar texto direto no $ai.chat
      if (textExtracted && textContent && textContent.trim().length > 20) {
        try {
          const txt = textContent.slice(0, 14000)
          const textUserContent = `${instructions}\n\nConteúdo textual extraído da fatura:\n"""\n${txt}\n"""`
          console.log(
            `[fatura_extract] Executando $ai.chat com texto (${txt.length} caracteres)...`,
          )

          let aiTextResponse = null
          try {
            aiTextResponse = $ai.chat({
              model: 'fast',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: textUserContent },
              ],
            })
          } catch (fastErr) {
            console.log('[fatura_extract] Modelo fast falhou no texto, tentando reasoning...')
            aiTextResponse = $ai.chat({
              model: 'reasoning',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: textUserContent },
              ],
            })
          }

          if (
            aiTextResponse &&
            aiTextResponse.choices &&
            aiTextResponse.choices[0] &&
            aiTextResponse.choices[0].message
          ) {
            rawText = aiTextResponse.choices[0].message.content || ''
            aiMethodUsed = 'document_text'
            console.log('[fatura_extract] Sucesso na extração por texto.')
          }
        } catch (textErr) {
          console.log('[fatura_extract] Extração por texto falhou:', textErr.message || textErr)
        }
      }
      // Prioridade 2: Se não obteve texto ou se falhou, tentar visão computacional com as imagens (PDF escaneado / rasterizado)
      let visionAttempted = false
      let visionErrorMsg = null
      if (!rawText && pageImages && pageImages.length > 0) {
        visionAttempted = true
        try {
          const validImages = []
          // Limitar a no máximo 2 páginas principais (a página 1 quase sempre contém todos os dados cruciais)
          const maxPages = Math.min(pageImages.length, 2)
          for (let i = 0; i < maxPages; i++) {
            const imgUrl = pageImages[i]
            if (typeof imgUrl === 'string' && imgUrl.startsWith('data:image/')) {
              validImages.push(imgUrl)
            }
          }

          if (validImages.length > 0) {
            const multimodalUserContent = [
              {
                type: 'text',
                text: `${instructions}\n\nAnalise visualmente as ${validImages.length} página(s) anexadas da fatura com precisão cirúrgica.`,
              },
            ]
            for (let i = 0; i < validImages.length; i++) {
              multimodalUserContent.push({
                type: 'image_url',
                image_url: {
                  url: validImages[i],
                },
              })
            }

            console.log(
              `[fatura_extract] Tentando visão multimodal com ${validImages.length} imagem(ns)...`,
              'Tamanho img 1:',
              validImages[0].length,
            )

            let aiVisionResponse = null
            // Tentativa 1: Modelo fast
            try {
              aiVisionResponse = $ai.chat({
                model: 'fast',
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: multimodalUserContent },
                ],
              })
            } catch (fastErr) {
              console.log(
                '[fatura_extract] Modelo fast falhou na visão:',
                fastErr.message || fastErr,
                'Tentando modelo reasoning...',
              )
              // Tentativa 2: Modelo reasoning
              try {
                aiVisionResponse = $ai.chat({
                  model: 'reasoning',
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: multimodalUserContent },
                  ],
                })
              } catch (reasoningErr) {
                console.log(
                  '[fatura_extract] Modelo reasoning também falhou na visão:',
                  reasoningErr.message || reasoningErr,
                )
                throw reasoningErr
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

      // Se ambas as vias falharam
      if (!rawText) {
        // Se tentou visão computacional e o gateway retornou erro ou não suportou a imagem:
        if (visionAttempted) {
          throw new BadRequestError(
            'Não foi possível extrair os dados visuais desta fatura escaneada no momento. Por favor, preencha os dados manualmente no formulário abaixo ou utilize uma fatura com texto selecionável.',
          )
        }

        // Se falhou no toMarkdown e não havia imagens do cliente:
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

      // Strip markdown code fences if model enclosed in ```json or ```
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
        // Try regex extraction of JSON object {...}
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0])
          } catch (e2) {
            parsed = {}
          }
        }
      }

      // Normalizações específicas para faturas brasileiras
      if (parsed && typeof parsed === 'object') {
        // Garantir compatibilidade de fatura_total e valor_total
        if (parsed.valor_total !== undefined && parsed.fatura_total === undefined) {
          parsed.fatura_total = parsed.valor_total
        }
        if (parsed.fatura_total !== undefined && parsed.valor_total === undefined) {
          parsed.valor_total = parsed.fatura_total
        }

        // Se for Água e Esgoto ou detectado Sabesp / saneamento
        const isAgua =
          parsed.tipo_utilidade === 'Água e Esgoto' ||
          requestedUtility === 'Água e Esgoto' ||
          (parsed.cnpj_fornecedor && parsed.cnpj_fornecedor.includes('43.776.517'))

        if (isAgua) {
          parsed.tipo_utilidade = 'Água e Esgoto'
          parsed.unidade_consumo = 'm³'

          // Consumo medido vs consumo faturado
          if (parsed.consumo_medido !== undefined && !parsed.consumo) {
            parsed.consumo = parsed.consumo_medido
          }
          if (parsed.consumo !== undefined && !parsed.consumo_medido) {
            parsed.consumo_medido = parsed.consumo
          }

          // Se a tarifa não veio explicitamente, calcular tarifa média (fatura_total / consumo)
          if (
            (!parsed.tarifa || Number(parsed.tarifa) === 0) &&
            parsed.fatura_total > 0 &&
            parsed.consumo > 0
          ) {
            parsed.tarifa = Number((parsed.fatura_total / parsed.consumo).toFixed(4))
          }
        }
      }
      if (!parsed || Object.keys(parsed).length === 0) {
        parsed = {
          tipo_utilidade: requestedUtility || 'Energia Elétrica',
          valor_total: 0,
          consumo: 0,
          unidade_consumo: requestedUtility === 'Energia Elétrica' ? 'kWh' : 'm³',
        }
      }

      return e.json(200, {
        sucesso: true,
        arquivo_nome: fileName,
        dados: parsed,
      })
    } catch (aiErr) {
      const msg = aiErr.message || String(aiErr)
      console.log('[fatura_extract] Erro capturado no handler:', msg)

      // Se já for uma mensagem limpa em pt-BR criada por nós, repassar diretamente
      if (
        msg.includes('Não foi possível') ||
        msg.includes('Por favor') ||
        msg.includes('camada de texto') ||
        msg.includes('escaneada')
      ) {
        throw new BadRequestError(msg)
      }

      // Friendly translation of any gateway or unexpected errors
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
