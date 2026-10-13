routerAdd(
  'POST',
  '/backend/v1/faturas/extract',
  (e) => {
    function callAiChat(modelAlias, messages) {
      // Tenta primeiro $ai.chat (se suportar os campos customizados)
      try {
        const res = $ai.chat({
          model: modelAlias,
          messages: messages,
        })
        if (res && res.choices && res.choices[0] && res.choices[0].message) {
          return res
        }
      } catch (sdkErr) {
        // Se $ai.chat falhar ou o SDK não repassar o array `images`, faz a chamada HTTP direta ao Skip AI Gateway
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
Responda APENAS com um objeto JSON válido, sem cercas de código markdown e sem comentários.
IMPORTANTE: Localize e extraia os dados REAIS presentes na imagem ou texto do documento. Preencha todos os campos que conseguir identificar. Apenas se um campo realmente não existir ou estiver ilegível utilize null (nunca sentinelas como "1900-01-01" ou 0 para valores ausentes).

LAYOUT ESPECÍFICO COMGÁS (Gás Natural Canalizado):
- A fatura da Comgás possui no topo o logo 'comgás' e o CNPJ da distribuidora Comgás: 61.856.571/0006-21 (ou 61.856.571/0001-17).
- Tipo de utilidade: "Gás".
- "Valor a pagar (R$)" ou valor total: destaque no quadro superior direito e no boleto (ex: R$ 4.363,05 -> 4363.05).
- "Data de apresentação" ou data de emissão/leitura: ex: 17.08.2026 -> competência "08/2026" ("2026-08-01").
- "Vencimento": data de vencimento destacada no quadro da fatura (ex: 08.09.2026 -> "2026-09-08").
- Número da fatura / conta: número no topo (ex: 150.238.010).
- Quadro "Consumo e tarifas" e "Detalhamento do consumo":
  * Leitura Anterior (ex: 431.304 -> 431.304)
  * Leitura Atual (ex: 432.014 -> 432.014)
  * Consumo Medido em m³ (ex: 710 -> 710)
  * Consumo Corrigido / Faturado em m³ (ex: 682,168 -> 682.168)
  * Tarifa aplicada com tributos / m³ (ex: 6,395871 -> 6.395871)
Se a imagem da fatura contiver estes dados característicos da Comgás, extraia-os fielmente.`

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
   - Layout Comgás detalhado:
     * Logo "comgás" no canto superior esquerdo com CNPJ Comgás 61.856.571/0006-21 (ou no boleto "CIA. DE GÁS DE SÃO PAULO COMGÁS CNPJ - 61.856.571/0006-21").
     * "NOTA FISCAL / CONTA DE GÁS": número no cabeçalho (ex: 150.238.010).
     * Competência / Mês de Referência: localizada em "Data de apresentação" ou "Data da leitura atual" (ex: 17.08.2026 ou 12.08.2026 -> competência "08/2026", "2026-08-01").
     * "Vencimento": no quadro superior direito ou no boleto (ex: 08.09.2026 ou 08/09/2026 -> "2026-09-08").
     * "Valor a pagar (R$)": valor destacado no quadro superior direito, ex: 4.363,05 -> 4363.05.
     * Bloco "Consumo e tarifas": "Consumo Corrigido/Faturado (m³)" (ex: 682,168 -> 682.168), "Tarifa Aplicada com ICMS" (ex: 6,395871 -> 6.395871).
     * Bloco "Detalhamento do consumo":
       - Colunas "Leitura": "Anterior" (ex: 431.304 -> 431.304) e "Atual" (ex: 432.014 -> 432.014).
       - Coluna "consumo medido (m³)" (ex: 710 -> 710).
       - Coluna "consumo corrigido (m³)" (ex: 682,168 -> 682.168).
   - "competencia": mês de referência (ex: 08/2026 -> "2026-08-01", competencia_formatada: "08/2026")
   - "valor_total": valor a pagar total (ex: R$ 4.363,05 -> 4363.05)
   - "fatura_total": 4363.05
   - "consumo": consumo faturado corrigido (ex: 682.168)
   - "unidade_consumo": "m³"
   - "numero_fatura": número da nota fiscal / conta de gás (ex: 150.238.010)
   - "cnpj_fornecedor": CNPJ da distribuidora (ex Comgás: 61.856.571/0006-21)
   - "vencimento": data de vencimento (ex: 08.09.2026 -> "2026-09-08")
   - "medicao_anterior": leitura anterior (ex: 431.304)
   - "medicao_atual": leitura atual (ex: 432.014)
   - "consumo_medido": consumo medido antes da correção (ex: 710)
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

REGRAS OBRIGATÓRIAS DE RESPOSTA:
1. Retorne APENAS os dados reais impressos na fatura. Se algum campo não estiver visível ou legível, retorne null (NÃO use 0, NÃO use "1900-01-01", NÃO use strings vazias).
2. Números decimais devem usar ponto (.) como separador decimal no JSON (ex: 6.395871, 4363.05).

Retorne rigorosamente esta estrutura JSON (com null nos campos ausentes):
{
  "tipo_utilidade": "Energia Elétrica" | "Gás" | "Água e Esgoto" | null,
  "competencia": "YYYY-MM-01" | null,
  "competencia_formatada": "MM/AAAA" | null,
  "valor_total": float | null,
  "consumo": float | null,
  "unidade_consumo": "kWh" | "m³" | null,
  "numero_fatura": string | null,
  "cnpj_fornecedor": string | null,
  "vencimento": "YYYY-MM-DD" | null,
  "medicao_anterior": float | null,
  "medicao_atual": float | null,
  "classificacao_consumo": string | null,
  "consumo_ponta": float | null,
  "tarifa_tusd_ponta": float | null,
  "tarifa_te_ponta": float | null,
  "consumo_fora_ponta": float | null,
  "tarifa_tusd_f_ponta": float | null,
  "tarifa_te_f_ponta": float | null,
  "adicional_bandeira": string | null,
  "consumo_medido": float | null,
  "consumo_corrigido": float | null,
  "tarifa": float | null,
  "fatura_total": float | null
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
          const textMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: textUserContent },
          ]
          try {
            aiTextResponse = callAiChat('fast', textMessages)
          } catch (fastErr) {
            console.log('[fatura_extract] Modelo fast falhou no texto, tentando reasoning...')
            aiTextResponse = callAiChat('reasoning', textMessages)
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
            // No gateway skip-ai-gateway:
            // 1. O campo `content` de mensagens de usuário DEVE ser uma string (arrays tipo OpenAI [{type:'text'}, {type:'image_url'}] são rejeitados com 400).
            // 2. Imagens são enviadas no array `images` dentro do objeto da mensagem do usuário: `images: [dataUrl]`.
            const visionUserText = `${instructions}\n\nExamine a imagem da fatura em anexo. Extraia todos os dados visíveis no documento:\n- Tipo de utilidade (Energia Elétrica, Gás ou Água e Esgoto)\n- Competência / mês de referência (ex: MM/AAAA ou YYYY-MM-01)\n- Valor total a pagar (R$)\n- Consumo faturado / apurado\n- Medição anterior e medição atual do medidor\n- Consumo medido e consumo corrigido (para faturas de gás)\n- Tarifa unitária por unidade de consumo\n- Número da fatura / nota fiscal\n- CNPJ da distribuidora / fornecedora\n- Data de vencimento\n\nRetorne o JSON preenchido com todos os valores numéricos e textuais identificados na imagem da conta. Se algum campo específico não constar no documento, use null.`
            const visionMessages = [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: visionUserText,
                images: validImages,
              },
            ]
            console.log(
              `[fatura_extract] Tentando visão multimodal com ${validImages.length} imagem(ns)...`,
              'Tamanho img 1:',
              validImages[0].length,
            )

            let aiVisionResponse = null
            // Para visão multimodal em faturas detalhadas ou escaneadas, usar preferencialmente modelo reasoning (maior capacidade visual de leitura de tabelas/números pequenos) com fallback para fast
            try {
              aiVisionResponse = callAiChat('reasoning', visionMessages)
              console.log('[fatura_extract] Modelo reasoning respondeu na visão.')
            } catch (reasoningErr) {
              console.log(
                '[fatura_extract] Modelo reasoning falhou na visão:',
                reasoningErr.message || reasoningErr,
                'Tentando modelo fast...',
              )
              try {
                aiVisionResponse = callAiChat('fast', visionMessages)
                console.log('[fatura_extract] Modelo fast respondeu na visão.')
              } catch (fastErr) {
                console.log(
                  '[fatura_extract] Modelo fast também falhou na visão:',
                  fastErr.message || fastErr,
                )
                throw fastErr
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
      console.log('[fatura_extract] Objeto extraído antes da normalização:', JSON.stringify(parsed))

      // Normalizações específicas para faturas brasileiras
      if (parsed && typeof parsed === 'object') {
        // Desembrulhar se vier aninhado em sub-objetos comuns
        if (parsed.dados && typeof parsed.dados === 'object' && !parsed.tipo_utilidade) {
          parsed = Object.assign({}, parsed.dados, parsed)
        }
        if (parsed.fatura && typeof parsed.fatura === 'object' && !parsed.tipo_utilidade) {
          parsed = Object.assign({}, parsed.fatura, parsed)
        }
        if (parsed.data && typeof parsed.data === 'object' && !parsed.tipo_utilidade) {
          parsed = Object.assign({}, parsed.data, parsed)
        }

        // Sanitização e parsing robusto para valores numéricos brasileiros (suporta vírgula decimal "682,168" e ponto de milhar "431.304")
        function parseBrazilianNumber(val) {
          if (val === undefined || val === null || val === '') return null
          if (typeof val === 'number') {
            return isNaN(val) || val <= 0 ? null : val
          }
          let s = String(val).trim()
          if (!s || s === 'null' || s === 'undefined' || s === '0') return null
          // Limpar símbolo de moeda R$, espaços, etc.
          s = s.replace(/^R\$\s*/i, '').trim()
          // Tratar padrões como "4.363,05" ou "682,168" ou "431.304" ou "6,395871"
          if (s.includes(',') && s.includes('.')) {
            // "4.363,05" -> remove ponto de milhar, substitui vírgula por ponto
            s = s.replace(/\./g, '').replace(',', '.')
          } else if (s.includes(',')) {
            // "682,168" ou "6,395871" -> vírgula decimal
            s = s.replace(',', '.')
          }
          const num = Number(s)
          if (isNaN(num) || num <= 0) return null
          return num
        }

        // Sanitização de valores-sentinela ("1900-01-01", datas de ano 1900, strings vazias)
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
        parsed.cnpj_fornecedor = sanitizeText(parsed.cnpj_fornecedor)
        parsed.classificacao_consumo = sanitizeText(parsed.classificacao_consumo)
        parsed.adicional_bandeira = sanitizeText(parsed.adicional_bandeira)

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

        // Desembrulhar campos com variações camelCase ou nomes alternativos
        if (parsed.consumoMedido !== undefined && parsed.consumo_medido === undefined) {
          parsed.consumo_medido = parsed.consumoMedido
        }
        if (parsed.consumoCorrigido !== undefined && parsed.consumo_corrigido === undefined) {
          parsed.consumo_corrigido = parsed.consumoCorrigido
        }
        if (parsed.medicaoAnterior !== undefined && parsed.medicao_anterior === undefined) {
          parsed.medicao_anterior = parsed.medicaoAnterior
        }
        if (parsed.medicaoAtual !== undefined && parsed.medicao_atual === undefined) {
          parsed.medicao_atual = parsed.medicaoAtual
        }
        if (parsed.valorTotal !== undefined && parsed.valor_total === undefined) {
          parsed.valor_total = parsed.valorTotal
        }
        if (parsed.faturaTotal !== undefined && parsed.fatura_total === undefined) {
          parsed.fatura_total = parsed.faturaTotal
        }
        if (parsed.cnpjFornecedor !== undefined && parsed.cnpj_fornecedor === undefined) {
          parsed.cnpj_fornecedor = parsed.cnpjFornecedor
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

        // Garantir compatibilidade de fatura_total e valor_total
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

          // Para Gás: consumo principal geralmente é o consumo_corrigido ou consumo_medido
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

          // Consumo medido e corrigido preenchimentos recíprocos se um estiver ausente
          if (parsed.consumo !== undefined && parsed.consumo_medido === undefined) {
            parsed.consumo_medido = parsed.consumo
          }
          if (parsed.consumo !== undefined && parsed.consumo_corrigido === undefined) {
            parsed.consumo_corrigido = parsed.consumo
          }

          // Se leitura anterior e atual existirem mas consumo medido não
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

          // Calcular tarifa se ausente
          if (
            (!parsed.tarifa || Number(parsed.tarifa) === 0) &&
            parsed.valor_total > 0 &&
            (parsed.consumo_corrigido > 0 || parsed.consumo > 0)
          ) {
            const baseCons = Number(parsed.consumo_corrigido || parsed.consumo)
            parsed.tarifa = Number((Number(parsed.valor_total) / baseCons).toFixed(6))
          }
        }

        // Se for Água e Esgoto ou detectado Sabesp / saneamento
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

        // Se for Energia Elétrica
        const isEnergia =
          parsed.tipo_utilidade === 'Energia Elétrica' ||
          rawTipo.includes('energia') ||
          rawTipo.includes('eletric') ||
          rawTipo.includes('enel') ||
          rawTipo.includes('cpfl') ||
          rawTipo.includes('light') ||
          rawTipo.includes('cemig') ||
          requestedUtility === 'Energia Elétrica'

        if (
          isEnergia &&
          parsed.tipo_utilidade !== 'Gás' &&
          parsed.tipo_utilidade !== 'Água e Esgoto'
        ) {
          parsed.tipo_utilidade = 'Energia Elétrica'
          parsed.unidade_consumo = 'kWh'
        }

        // Validação final de campos essenciais extraídos (evita falso sucesso com sentinelas ou campos nulos)
        let realFieldCount = 0
        const essentialKeys = [
          'valor_total',
          'consumo',
          'numero_fatura',
          'vencimento',
          'medicao_anterior',
          'medicao_atual',
          'consumo_medido',
          'consumo_corrigido',
          'tarifa',
          'competencia',
          'competencia_formatada',
        ]
        for (const k of essentialKeys) {
          const val = parsed[k]
          if (val !== undefined && val !== null && val !== '') {
            if (typeof val === 'number' && val > 0) {
              realFieldCount++
            } else if (typeof val === 'string' && val.trim().length > 0 && !val.includes('1900')) {
              realFieldCount++
            }
          }
        }

        if (realFieldCount === 0) {
          console.log('[fatura_extract] Nenhum campo essencial válido extraído após sanitização.')
          throw new BadRequestError(
            'Não foi possível extrair dados automaticamente desta fatura. Por favor, revise o arquivo ou insira as medições e valores manualmente.',
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
