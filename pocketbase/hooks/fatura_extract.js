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

    let textContent = ''
    let textExtracted = false
    let toMarkdownError = null

    // Try $documents.toMarkdown first whenever uploadedFile is a document
    if (uploadedFile && ['pdf', 'xlsx', 'xls', 'docx'].includes(ext)) {
      try {
        console.log(`[fatura_extract] Tentando $documents.toMarkdown para ${fileName}...`)
        const docRes = $documents.toMarkdown({ file: uploadedFile })
        if (docRes && docRes.markdown && docRes.markdown.trim().length > 20) {
          textContent = docRes.markdown
          textExtracted = true
          console.log(
            `[fatura_extract] $documents.toMarkdown obteve ${textContent.length} caracteres de texto.`,
          )
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
    } else if (uploadedFile && (ext === 'csv' || ext === 'txt')) {
      try {
        const bytes = uploadedFile.bytes ? uploadedFile.bytes() : null
        if (bytes) {
          textContent = String.fromCharCode.apply(null, bytes)
          textExtracted = true
        }
      } catch (_) {}
    }

    const systemPrompt = `Você é um extrator de dados especialista e ultra-preciso para faturas de utilidades brasileiras (Energia Elétrica como Enel/CPFL/Light/Cemig, Gás Canalizado como Comgás/Naturgy, e Água/Saneamento como Sabesp/Sanepar).
Você analisa imagens escaneadas e faturas digitais com máxima atenção a números decimais, datas, medições e tarifas regulatórias.
Responda APENAS com um objeto JSON válido, sem cercas de código markdown e sem comentários.`

    const instructions = `Analise a fatura anexada (arquivo "${fileName}").
Tipo de utilidade sugerido: "${requestedUtility || 'Detectar automaticamente da fatura'}".

Orientações cruciais de extração:
1. Identifique o tipo de utilidade:
   - "Energia Elétrica" (se houver kWh, Enel, CPFL, Light, Cemig, TUSD, TE, Bandeira Tarifária, etc.)
   - "Gás" (se houver Comgás, Naturgy, Gás Natural, m³, fator de correção PTZ/PCS, etc.)
   - "Água e Esgoto" (se Sabesp, Sanepar, Copasa, m³, ligação de água/esgoto)

2. Para ENERGIA ELÉTRICA (ex: Enel Brasil / Eletropaulo):
   - "competencia": mês de referência (ex: MÊS/ANO 09/2026 -> "2026-09-01", "09/2026")
   - "valor_total": valor TOTAL A PAGAR (ex: R$ 22.347,38 -> 22347.38)
   - "fatura_total": mesmo valor total float (22347.38)
   - "consumo": consumo faturado ativo total em kWh (ex: 20.438,40 -> 20438.40)
   - "unidade_consumo": "kWh"
   - "numero_fatura": número do documento / nota fiscal / número da conta (ex: 519519027339 ou 095039445)
   - "cnpj_fornecedor": CNPJ da distribuidora (ex Enel: 61.695.227/0001-93) ou do cliente
   - "vencimento": data de vencimento (ex: 25/09/2026 -> "2026-09-25")
   - "medicao_anterior": leitura anterior do medidor (ex: 65891.700 -> 65891.7)
   - "medicao_atual": leitura atual do medidor (ex: 66743.300 -> 66743.3)
   - "classificacao_consumo": classificação da unidade consumidora (ex: "B3 - CONVENCIONAL - Comercial", "B3", "A4", etc. Se B3 retorne "B3", se A4 retorne "A4")
   - "consumo_ponta": consumo no posto tarifário ponta em kWh (se convencional/único sem separação de ponta, pode ser 0 ou o consumo total se tarifado único)
   - "consumo_fora_ponta": consumo no posto fora-ponta em kWh (se aplicável, ou o consumo total convencional)
   - "tarifa_tusd_ponta": tarifa unitária TUSD com tributos (ex: se único/ponta: 0.60078 ou 0.47242 sem trib)
   - "tarifa_te_ponta": tarifa unitária TE com tributos (ex: 0.40912 ou 0.31696 sem trib)
   - "tarifa_tusd_f_ponta": tarifa TUSD fora de ponta (se não diferenciado, igual a TUSD)
   - "tarifa_te_f_ponta": tarifa TE fora de ponta (se não diferenciado, igual a TE)
   - "adicional_bandeira": bandeira tarifária indicada nas mensagens (ex: "AMARELA", "Bandeira Amarela", "Bandeira Verde", "Bandeira Vermelha")

3. Para GÁS NATURAL (ex: Comgás):
   - "competencia": mês de referência / apresentação (ex: 08/2026 -> "2026-08-01", "08/2026")
   - "valor_total": valor a pagar total (ex: R$ 4.363,05 -> 4363.05)
   - "fatura_total": 4363.05
   - "consumo": consumo faturado corrigido (ex: 682.168 -> 682.17 ou 682.168)
   - "unidade_consumo": "m³"
   - "numero_fatura": número da nota fiscal / conta de gás (ex: 150.238.010 ou 150238010)
   - "cnpj_fornecedor": CNPJ da distribuidora (ex Comgás: 61.856.571/0006-21)
   - "vencimento": data de vencimento (ex: 08/09/2026 -> "2026-09-08")
   - "medicao_anterior": leitura anterior (ex: 431.304 -> 431.304)
   - "medicao_atual": leitura atual (ex: 432.014 -> 432.014)
   - "consumo_medido": consumo medido antes da correção (ex: 710 -> 710)
   - "consumo_corrigido": consumo corrigido por temperatura/pressão (ex: 682.168 -> 682.168)
   - "tarifa": tarifa aplicada com ICMS por m³ (ex: 6,395871 -> 6.395871)

4. Para ÁGUA E ESGOTO:
   - "competencia", "valor_total", "consumo", "unidade_consumo": "m³", "numero_fatura", "cnpj_fornecedor", "vencimento"
   - "medicao_anterior", "medicao_atual", "consumo_medido", "tarifa", "fatura_total"

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

      // Prioridade 1: Se o documento gerou texto via $documents.toMarkdown, usar texto direto no $ai.chat
      // Isso é muito mais rápido, confiável e não consome cota multimodal.
      if (textExtracted && textContent && textContent.trim().length > 20) {
        try {
          const txt = textContent.slice(0, 14000)
          const textUserContent = `${instructions}\n\nConteúdo textual extraído da fatura:\n"""\n${txt}\n"""`
          console.log(
            `[fatura_extract] Executando $ai.chat com texto (${txt.length} caracteres)...`,
          )
          const aiTextResponse = $ai.chat({
            model: 'fast',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: textUserContent },
            ],
          })

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

      // Prioridade 2: Se não obteve texto ou se falhou, tentar visão computacional com as imagens (PDF escaneado)
      if (!rawText && pageImages && pageImages.length > 0) {
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
            )
            const aiVisionResponse = $ai.chat({
              model: 'fast',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: multimodalUserContent },
              ],
            })

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
          const vMsg = visionErr.message || String(visionErr)
          console.log('[fatura_extract] Visão falhou:', vMsg)
        }
      }

      // Se ambas as vias falharam
      if (!rawText) {
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

      // Se já for uma BadRequestError com mensagem amigável criada por nós, repassar diretamente
      if (
        msg.includes('Não foi possível') ||
        msg.includes('Por favor') ||
        msg.includes('camada de texto')
      ) {
        throw new BadRequestError(msg)
      }

      // Friendly translation of gateway errors
      if (msg.includes('skip-ai-gateway') || msg.includes('400')) {
        throw new BadRequestError(
          'Não foi possível processar a fatura com o assistente de IA no momento. Por favor, preencha os campos manualmente.',
        )
      }
      throw new BadRequestError(
        aiErr.message || 'Falha ao processar o documento. Tente novamente ou preencha manualmente.',
      )
    }
  },
  $apis.requireAuth(),
)
