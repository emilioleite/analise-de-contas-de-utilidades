// Hook de extração de faturas de utilidades via IA (Visão + Texto) - deploy v0.0.47 sync
routerAdd(
  'POST',
  '/backend/v1/faturas/extract',
  (e) => {
    function callAiChat(modelAlias, messages) {
      try {
        const res = $ai.chat({
          model: modelAlias,
          messages: messages,
          temperature: 0.0,
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
            temperature: 0.0,
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

    const reqUniqueToken = $security.randomString(16)
    const reqTimestamp = new Date().toISOString()

    const systemPrompt = `Você é um extrator especialista de faturas de utilidades brasileiras (Energia Elétrica, Gás, Água e Esgoto).
Sessão isolada única: ${reqUniqueToken} (${reqTimestamp}).
Analise EXCLUSIVAMENTE o documento fornecido nesta requisição e extraia todos os campos visíveis com máxima fidelidade.
Responda OBRIGATORIAMENTE com um objeto JSON válido, contendo as chaves especificadas preenchidas com os valores reais da fatura.
NUNCA invente números, nunca use valores de faturas anteriores ou exemplos fictícios.`

    const instructions = `[Sessão de Extração Independente: ${reqUniqueToken}]
Arquivo atual: "${fileName}".
Tipo de utilidade sugerido: "${requestedUtility || 'Detectar da fatura'}".

REFORÇO ANTI-ALUCINAÇÃO E ISOLAMENTO TOTAL (OBRIGATÓRIO):
- Extraia APENAS dados legíveis NESTE documento anexado.
- Se um campo não estiver legível ou não existir nesta fatura, retorne null ou vazio.
- NUNCA utilize valores de outras faturas, de faturas processadas anteriormente, de exemplos ou de memória.
- Cada campo deve corresponder estritamente ao que está impresso neste arquivo específico.

Campos gerais:
- tipo_utilidade: "Energia Elétrica" | "Gás" | "Água e Esgoto"
- competencia: data no formato "YYYY-MM-01" correspondente ao Mês de Referência da fatura impressa.
- competencia_formatada: "MM/AAAA" correspondente ao Mês de Referência impresso.
- valor_total: número decimal do VALOR FINAL A PAGAR da fatura após todos os créditos, devoluções, descontos e saldos (exemplo: fornecimento X − devolução de faturas anteriores Y ± saldo = total final a pagar). Se o total final for R$ 0,00 (fatura de crédito/estorno com compensação total), preencha 0.00 — zero é um valor legítimo! NUNCA preencha com o valor parcial de fornecimento ou subtotal quando houver créditos/devoluções deduzidos.
- fatura_total: número decimal idêntico a valor_total
- consumo: número decimal do consumo faturado principal impresso (kWh para energia, m³ para gás e água). Em Gás (Comgás), extraia do campo "Consumo Corrigido/Faturado" do bloco "Consumo e tarifas".
- unidade_consumo: "kWh" ou "m³"
- REGRA DE UNIDADE DO CONSUMO DE ENERGIA ELÉTRICA (CRÍTICA):
  * O campo consumo (e consumo_medido) deve refletir EXATAMENTE o consumo impresso na fatura convertido para kWh.
  * Se a fatura expressar o consumo em MWh (ex.: "20,320 MWh"), multiplique por 1000 e grave em kWh (20.320 kWh -> 20320). NUNCA divida por 1000, NUNCA grave MWh como se fosse kWh.
  * Se a fatura já expressar em kWh (ex.: "24.098,400 kWh"), grave o valor exatamente como impresso, sem multiplicar nem dividir.
  * Confira a coerência: consumo_kwh * (tarifa_tusd + tarifa_te) deve aproximar-se do valor de fornecimento/total da fatura. Um consumo mil vezes menor gera valores absurdos.
- numero_fatura: número impresso sob "NOTA FISCAL / CONTA DE GÁS Nº" ou "NOTA FISCAL Nº" ou "CONTA CONTRATO". NUNCA invente números.
- identificacao: identificador de destino/medidor da fatura, para permitir várias faturas da mesma utilidade no mesmo mês. Em GÁS (GLP com várias NFe ou GN setorizado), extraia o nome do destino/setor de consumo impresso (ex.: "Caldeira", "Piscina", "Cozinha", "Aquecimento") ou, se não houver destino impresso, o número do medidor/da NFe (ex.: "NFe 12345", "Medidor 401571"). Em ENERGIA ELÉTRICA, NÃO preencha (use 'tipo_fatura_energia'). Em ÁGUA E ESGOTO, NÃO preencha. Se não houver identificador legível, retorne null. NUNCA invente.
- tipo_fatura_energia (SOMENTE Energia Elétrica): "concessionaria" quando a fatura é da distribuidora/concessionária (Enel, CPFL, Light, CEMIG, Equatorial...) cobrando o uso da rede de distribuição (TUSD, consumo de referência) ou fatura convencional; "mercado_livre" quando a fatura é de comercializadora de energia do Mercado Livre/ACL (ex.: CCEE, Comerc, Matery, Watt, Enel X não-distribuidora...) cobrando pela energia consumida (TE/energia). Se não houver indicação clara, retorne null.
- vencimento: data no formato "YYYY-MM-DD" correspondente ao Vencimento impresso na fatura.
- cnpj_cliente: CNPJ ou CPF do destinatário/cliente (titular da unidade consumidora). Extraia do bloco de nome/endereço do cliente ou da seção PAGADOR (ex.: sob "COND EDIF...", "PAGADOR:").
  * ATENÇÃO CRÍTICA: NUNCA use o CNPJ da distribuidora (que fica no cabeçalho ou seção BENEFICIÁRIO) como cnpj_cliente!
  * Se o CNPJ do cliente vier parcialmente mascarado (exemplo: "04.***.***/****-63" ou "04***63"), retorne o valor mascarado EXATAMENTE como está ou vazio/null — NUNCA substitua pelo CNPJ do fornecedor/distribuidora!
- cnpj_fornecedor: CNPJ da distribuidora emissora (exemplo Comgás: "61.856.571/0006-21", Enel SP: "61.695.227/0001-93", Sabesp: "43.776.517/0001-80"). Fica no cabeçalho superior ou seção BENEFICIÁRIO.

Campos de medição e tarifas:
- medicao_anterior: leitura anterior do medidor impressa no quadro "Detalhamento do consumo" -> "Leitura" -> "Anterior" (atenção: em medidores de gás o ponto pode ser separador de milhar inteiro!).
- medicao_atual: leitura atual do medidor impressa no quadro "Detalhamento do consumo" -> "Leitura" -> "Atual" (atenção: em medidores de gás o ponto pode ser separador de milhar inteiro!).
- consumo_medido: consumo medido impresso (diferença Atual − Anterior, ou coluna "consumo medido (m³)").
- consumo_corrigido: consumo faturado/corrigido por PTZ do bloco "Consumo e tarifas".
- tarifa: tarifa unitária aplicada. Em Gás (Comgás), use o valor da linha "Tarifa Aplicada com ICMS" do bloco "Consumo e tarifas", não a tarifa da linha "Dados tarifários". Em Água (Sabesp), se não houver tarifa única impressa, calcule o valor_total dividido pelo consumo_medido.
- valor_fornecimento: valor monetário do fornecimento (exemplo: linha "Fornecimento de Gás Natural")
- valor_a_pagar: total a pagar impresso (ou 0.00 se houver devolução total)
- adicional_bandeira: bandeira tarifária aplicada. DEVE ser lida do campo impresso "Bandeira(s) tarifária(s) aplicada(s) no mês" (exemplo: "AMARELA" -> "Bandeira Amarela", "VERDE" -> "Bandeira Verde", "VERMELHA" -> "Bandeira Vermelha"). NÃO use valor padrão ou assumido!

Para Energia Elétrica (Enel, CPFL, Light, CEMIG, etc.):
- REGRA DE CLASSIFICAÇÃO E CONSUMO (GRUPO B vs GRUPO A):
  * Se a Classificação for do GRUPO B (B1, B2, B3, B4 ou código iniciando com B):
    - O consumo é SEMPRE ÚNICO (fatura convencional sem divisão por posto horário).
    - Consumo Total Faturado em kWh: extraia da linha correspondente ao mês de referência no quadro histórico, da coluna "Consumo kWh" na tabela "DADOS DE MEDIÇÃO", ou da coluna "Quant. (kWh)" das linhas TUSD e TE.
    - NÃO há separação de consumo ponta/fora-ponta.
    - ATENÇÃO À UNIDADE: algumas faturas da Enel impressas para Grupo B trazem o consumo em MWh (ex.: "20,320 MWh"). Nesse caso, multiplique por 1000 e grave em kWh (20.320 MWh equivale a 20320 kWh). O campo consumo/consumo_medido deve ficar SEMPRE em kWh — nunca divida, apenas converta MWh para kWh multiplicando por 1000. Se estiver em kWh, copie o valor como está.
    - Preencha 'consumo' com o valor faturado impresso convertido para kWh e 'consumo_medido' com esse mesmo valor.
    - Deixe 'consumo_ponta' e 'consumo_fora_ponta' como null.
    - Tarifas: preencha 'tarifa_tusd_ponta' com o Preço Unit com tributos de TUSD e 'tarifa_te_ponta' com o Preço Unit com tributos de TE.
  * Se a Classificação for do GRUPO A (A1, A2, A3, A4 ou horossazonal Verde/Azul):
    - Consumo Ponta e Consumo Fora-Ponta separados com suas respectivas tarifas por posto:
    - Preencha 'consumo_ponta', 'tarifa_tusd_ponta', 'tarifa_te_ponta' da linha Ponta.
    - Preencha 'consumo_fora_ponta', 'tarifa_tusd_f_ponta', 'tarifa_te_f_ponta' da linha Fora Ponta.
    - Preencha 'consumo': soma do consumo ponta + fora ponta.

- BANDEIRA TARIFÁRIA NA ENERGIA ELÉTRICA:
  * Procure na seção "MENSAGENS IMPORTANTES" ou cabeçalho a frase "Bandeira(s) tarifária(s) aplicada(s) no mês: [COR]".
  * Extraia a cor exata (ex.: se estiver impresso "AMARELA" ou item "ADICIONAL BANDEIRA AMARELA", preencha "Bandeira Amarela"; se estiver "VERDE", "Bandeira Verde"; se "VERMELHA 1" / "VERMELHA 2", "Bandeira Vermelha 1" / "Bandeira Vermelha 2").
  * NUNCA assuma Verde se houver outra cor indicada explicitamente na fatura!

- MAPEAMENTO DAS TARIFAS DA ENEL:
  * Na fatura da Enel (tabela "DESCRIÇÃO DO FATURAMENTO" / "ITENS DE FATURA"), extraia os valores sob a coluna "Preço Unit (R$) com tributos".
  * Linha "Uso Sist. Distr. (TUSD)": extraia a tarifa unitária com tributos em 'tarifa_tusd_ponta' (ou 'tarifa_tusd_f_ponta' se Fora-Ponta).
  * Linha "Energia (TE)": extraia a tarifa unitária com tributos em 'tarifa_te_ponta' (ou 'tarifa_te_f_ponta' se Fora-Ponta).
  * Se tarifação convencional (posto ÚNICO): preencha 'tarifa_tusd_ponta' e 'tarifa_te_ponta'.

Para Gás Canalizado (Comgás, Naturgy, etc.):
- REGRA DO VALOR TOTAL DA FATURA (VALOR FINAL A PAGAR / CRÉDITOS E DEVOLUÇÕES):
  * O campo 'valor_total' (e 'fatura_total') deve conter SEMPRE o VALOR FINAL A PAGAR impresso na fatura, após deduzidos todos os créditos, devoluções de faturas anteriores, compensações e saldos.
  * Se o valor final a pagar for 0,00 (fatura com devoluções/créditos compensando integralmente o fornecimento):
    - O 'valor_total' e 'fatura_total' é 0.00 (ZERO), pois é o valor final a pagar desta fatura! Zero é legítimo.
    - NUNCA use o valor isolado de fornecimento como valor_total quando o Total / Valor a Pagar impresso for 0,00 ou quando houver devoluções deduzidas.
    - Lance o fornecimento em 'valor_fornecimento' e o valor final em 'valor_total', 'fatura_total' e 'valor_a_pagar'.
  * Se a fatura tiver valor a pagar positivo normal, extraia esse valor final a pagar impresso.

- REGRA DE MEDIÇÕES E CONSUMO (GÁS COMGÁS):
  * O bloco "Consumo e tarifas" traz o "Consumo Corrigido/Faturado" em m³ -> 'consumo_corrigido' e 'consumo'.
  * Tarifa: extraia da linha "Tarifa Aplicada com ICMS" impressa nesta fatura.
  * Medições Atual e Anterior: leituras inteiras do medidor.
  * Consumo Medido: diferença Atual − Anterior ou coluna "consumo medido (m³)".

Para Água e Esgoto (Sabesp, Sanepar, Copasa):
- Múltiplas ligações e hidrômetro: quando a fatura de água/esgoto tiver mais de uma ligação, use APENAS o consumo medido por hidrômetro (medido). Ignore ligações marcadas como ESTIMATIVA/estimadas (sem hidrômetro). NUNCA some consumos de ligações diferentes; o campo de consumo deve conter só o volume medido pelo hidrômetro. Se houver leituras do hidrômetro, extraia da ligação medida.
- Medições de hidrômetro: extraia Leitura Anterior e Leitura Atual APENAS se estiverem explicitamente impressas no documento. Quando a fatura NÃO as apresentar (exemplo comum na Sabesp e contas escalonadas), deixe medicao_anterior e medicao_atual vazias/null — NUNCA invente números de medição! Em leituras com separador de milhar (ex.: 117.047 -> 117047, 118.555 -> 118555, 120.086 -> 120086), retorne o número inteiro na escala real (sem ponto decimal).
- Consumo m³: extraia apenas o volume medido pelo hidrômetro. Quando leitura anterior e leitura atual estiverem presentes, o consumo medido DEVE ser exatamente a diferença leitura_atual − leitura_anterior (ex.: 118555 − 117047 = 1508; não confunda com médias de consumo como 1206 nem com outros números da página).
- Números em padrão pt-BR: o PONTO é separador de MILHAR e a VÍRGULA é decimal. Transcreva números inteiros de medição e consumo na sua escala real inteira (ex: "1.508" m³ = 1508, NUNCA 1.508; "117.047" = 117047; "118.555" = 118555; "120.086" = 120086; "121.364" = 121364; "13.449,14" = 13449.14). NUNCA converta ponto de milhar para ponto decimal; preserve o valor inteiro real.
- Tarifa média / unitária: se a fatura não apresentar uma tarifa única impressa (devido a faixas escalonadas), pode deixar vazia/null ou calcular [valor_total / consumo] — o sistema calcula a tarifa média analítica automaticamente como valor_total ÷ consumo com até 6 casas decimais.
- Quadro de total a pagar e vencimento.
- CNPJ Sabesp padrão: 43.776.517/0001-80.

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

      function hasValidNumber(v, allowZero = false) {
        if (v === undefined || v === null || v === '' || v === 'null') return false
        if (typeof v === 'number') return allowZero ? !isNaN(v) && v >= 0 : v > 0
        let s = String(v)
          .replace(/^R\$\s*/i, '')
          .trim()
        if (s.includes('*')) s = s.replace(/[\*]+/g, '').trim()
        if (s.includes(',') && s.includes('.')) {
          s = s.replace(/\./g, '').replace(',', '.')
        } else if (s.includes(',')) {
          s = s.replace(',', '.')
        } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
          // Ponto como separador de MILHAR pt-BR sem parte decimal (ex: "24.320").
          s = s.replace(/\./g, '')
        }
        const num = Number(s.replace(/[^0-9.]/g, ''))
        return !isNaN(num) && (allowZero ? num >= 0 : num > 0)
      }

      function hasPositive(v) {
        return hasValidNumber(v, false)
      }

      const hasFornecimento =
        hasPositive(merged.valor_fornecimento) ||
        hasPositive(merged.valorFornecimento) ||
        hasPositive(merged.fornecimento_gas) ||
        hasPositive(merged['Fornecimento de Gás Natural'])

      const hasTotalOrCreditZero =
        hasValidNumber(merged.valor_total, true) ||
        hasValidNumber(merged.valorTotal, true) ||
        hasValidNumber(merged.fatura_total, true) ||
        hasValidNumber(merged.faturaTotal, true) ||
        hasValidNumber(merged.valor_a_pagar, true)

      return (
        hasTotalOrCreditZero ||
        hasFornecimento ||
        hasPositive(merged.consumo) ||
        hasPositive(merged.consumo_corrigido) ||
        hasPositive(merged.consumoCorrigido) ||
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
            const visionUserText = `${instructions}

DIRETRIZES DE LEITURA VISUAL E ISOLAMENTO DESTA FATURA:
Extraia EXCLUSIVAMENTE o que está impresso nas imagens DESTE arquivo ("${fileName}"). NUNCA complete com valores de outras faturas.

1. Se for fatura Comgás (Gás):
  - No quadro do cliente / destinatário (localizado geralmente na página 2 ou cabeçalho superior):
    * "CPF/CNPJ": extraia EXATAMENTE os dígitos impressos nesta fatura específica (se não estiver legível, retorne null). NUNCA pegue CNPJ de outra fatura!
    * Razão social / Nome do cliente e endereço.
  - Distribuidora Comgás: CNPJ 61.856.571/0006-21 -> 'cnpj_fornecedor'.
  - "NOTA FISCAL / CONTA DE GÁS Nº": extraia o número exato impresso nesta imagem -> 'numero_fatura'.
  - Datas e Totais:
    * "Vencimento": data impressa no formato YYYY-MM-DD.
    * "Mês de referência": mês/ano de referência impresso (ex: MM/AAAA -> 'competencia': YYYY-MM-01, 'competencia_formatada': MM/AAAA).
    * "Valor a pagar (R$)" ou "Total R$": valor final a pagar impresso. Se houver crédito/devoluções que resultem em 0,00, use 0.00.
  - Quadro "Consumo e tarifas":
    * "Consumo Corrigido/Faturado (m³)" impresso nesta fatura -> 'consumo_corrigido' e 'consumo'.
    * "Tarifa Aplicada com ICMS" impressa nesta fatura -> 'tarifa'.
    * "Fornecimento de gás natural (R$)" impresso nesta fatura -> 'valor_fornecimento'.
  - Quadro "Detalhamento do consumo" (linha do medidor):
    * "Leitura Anterior": leitura inteira anterior impressa nesta fatura específica (ponto é separador de milhar).
    * "Leitura Atual": leitura inteira atual impressa nesta fatura específica (ponto é separador de milhar).
    * "consumo medido (m³)" -> 'consumo_medido'.
  - IDENTIFICAÇÃO DA FATURA DE GÁS ('identificacao'):
    * Se o documento identificar o destino/setor de consumo (ex.: "Caldeira", "Piscina", "Cozinha", "Aquecimento", nome do setor impresso na fatura), use esse nome.
    * Caso contrário, use a numeração impressa do medidor ou da NFe (ex.: "NFe 12345", "Medidor 401571"). NUNCA invente.

2. Se for Energia Elétrica (Enel, CPFL, Light, CEMIG):
  - Quadro "TOTAL A PAGAR" / "VALOR TOTAL" -> 'valor_total'.
  - CNPJ do cliente no quadro de destinatário (COND EDIF...) ou no canhoto de pagamento sob PAGADOR -> 'cnpj_cliente'.
    * NUNCA use o CNPJ da distribuidora (que fica no cabeçalho ou BENEFICIÁRIO) como cnpj_cliente!
    * Se o CNPJ do cliente vier mascarado (ex: "04.***.***/****-63"), retorne o valor mascarado como está ou null — NUNCA substitua pelo CNPJ do fornecedor.
  - CNPJ da distribuidora emissora (ex Enel 61.695.227/0001-93) -> 'cnpj_fornecedor'.
  - "DADOS DE MEDIÇÃO" e quadro de consumo: Leitura Anterior, Leitura Atual, Consumo medido/faturado em kWh -> 'consumo'.
  - Na Enel classe B, o consumo é SEMPRE ÚNICO.
  - Tarifas sob coluna "Preço Unit (R$) com tributos" para TUSD e TE.
  - Bandeira tarifária: leia do texto "Bandeira(s) tarifária(s) aplicada(s) no mês: [COR]" ou do item "ADICIONAL BANDEIRA [COR]" -> 'adicional_bandeira' (ex: "Bandeira Amarela", "Bandeira Verde").
  - TIPO DE FATURA DE ENERGIA ('tipo_fatura_energia'):
    * Se a fatura é emitida por uma DISTRIBUIDORA/CONCESsionária (Enel, CPFL, Light, CEMIG, Equatorial...) -> 'concessionaria'.
    * Se a fatura é emitida por uma COMERCIALIZADORA do Mercado Livre/ACL (CCEE, Comerc, Matery, Watt...) -> 'mercado_livre'.
    * Na dúvida, 'concessionaria'.

3. Se for Água e Esgoto (Sabesp, Sanepar, Copasa):
  - Múltiplas ligações: quando a fatura de água/esgoto tiver mais de uma ligação, use APENAS o consumo medido por hidrômetro (medido). Ignore ligações marcadas como ESTIMATIVA/estimadas (sem hidrômetro). NUNCA some consumos de ligações diferentes; o campo de consumo deve conter só o volume medido pelo hidrômetro. Se houver leituras do hidrômetro, extraia da ligação medida.
  - Medições de hidrômetro: extrair Leitura Anterior e Leitura Atual SOMENTE se legíveis no documento. Se a fatura não exibir medições anterior/atual (ex.: Sabesp com faixas escalonadas), retorne null para ambas — NUNCA invente medições. Em leituras com separador de milhar (ex: 117.047 -> 117047, 118.555 -> 118555, 120.086 -> 120086), retorne o inteiro na escala real (sem ponto decimal).
  - Consumo faturado em m³: apenas o medido pelo hidrômetro (NUNCA somar com ligações estimadas; ex: 1.508 -> 1508, nunca 1.508 decimal). Se houver leituras anterior e atual, o consumo medido é a diferença leitura_atual − leitura_anterior (ex: 118555 − 117047 = 1508; não use campos de média como 1206).
  - Tarifa: se não houver tarifa única impressa, pode retornar null ou calcular valor_total / consumo.
  - Quadro de total a pagar e vencimento.
  - CNPJ do cliente e CNPJ da distribuidora (ex Sabesp 43.776.517/0001-80).

Extraia com rigor e retorne APENAS o JSON preenchido com os dados desta imagem.`
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
              forceModel === 'reasoning'
                ? ['reasoning', 'fast']
                : forceModel === 'fast'
                  ? ['fast', 'reasoning']
                  : ['reasoning', 'fast']

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
                  // Se não contém valores reais, NÃO aceitar como resposta de visão bem-sucedida!
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
            'Não foi possível extrair os dados visuais desta fatura escaneada. Por favor, tente novamente ou insira os dados no formulário.',
          )
        }

        if (toMarkdownError && toMarkdownError.status === 422) {
          throw new BadRequestError(
            'O documento é uma imagem ou digitalização escaneada sem camada de texto legível. As imagens da página não puderam ser processadas para leitura visual. Por favor, tente novamente ou preencha os dados manualmente.',
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
        function parseBrazilianNumber(val, allowZero = false) {
          if (val === undefined || val === null || val === '') return null
          if (typeof val === 'number') {
            if (isNaN(val)) return null
            if (val === 0) return allowZero ? 0 : null
            return val < 0 ? null : val
          }
          let s = String(val).trim()
          if (!s || s === 'null' || s === 'undefined') return null
          s = s.replace(/^R\$\s*/i, '').trim()
          if (s.includes('*')) {
            s = s.replace(/[\*]+/g, '').trim()
          }
          if (s.includes(',') && s.includes('.')) {
            // "20,160.000": vírgula como MILHAR (estilo en-US transposto do pt-BR "20.160,000")
            // com parte decimal toda em zeros — caso da Enel Grupo B. Sem esta regra,
            // o parser trunca após a vírgula (20,160 -> 20.16) e o consumo sai dividido por 1000.
            const mSwap = s.match(/^(\d{1,3}(?:,\d{3})+)\.(\d{3})$/)
            if (mSwap && /^0+$/.test(mSwap[2])) {
              s = mSwap[1].replace(/,/g, '')
            } else {
              s = s.replace(/\./g, '').replace(',', '.')
            }
          } else if (s.includes(',')) {
            s = s.replace(',', '.')
          } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
            // Ponto como separador de MILHAR pt-BR sem parte decimal (ex: "24.320" ou "1.146.303").
            // Sem esta regra, "24.320" virava 24,32 (divisão por 1000 disfarçada).
            s = s.replace(/\./g, '')
          }
          const cleanedStr = s.replace(/[^0-9.]/g, '')
          if (cleanedStr === '') return null
          const num = Number(cleanedStr)
          if (isNaN(num)) return null
          if (num === 0) return allowZero ? 0 : null
          return num < 0 ? null : num
        }
        function isSentinelDate(val) {
          if (!val) return true
          const s = String(val).trim()
          if (!s || s === 'null' || s === 'undefined') return true
          if (s.includes('1900')) return true
          return false
        }

        function sanitizeNumeric(val) {
          return parseBrazilianNumber(val, false)
        }

        function sanitizeMonetary(val) {
          return parseBrazilianNumber(val, true)
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
        parsed.identificacao = sanitizeText(parsed.identificacao)
        parsed.tipo_fatura_energia = sanitizeText(parsed.tipo_fatura_energia)
        parsed.cnpj_cliente = sanitizeText(parsed.cnpj_cliente)
        parsed.cnpj_fornecedor = sanitizeText(parsed.cnpj_fornecedor)
        parsed.classificacao_consumo = sanitizeText(parsed.classificacao_consumo)
        parsed.adicional_bandeira = sanitizeText(parsed.adicional_bandeira)

        // Se CNPJ do cliente for idêntico ao CNPJ do fornecedor (distribuidora copiada no cliente por engano), anular
        if (
          parsed.cnpj_cliente &&
          parsed.cnpj_fornecedor &&
          String(parsed.cnpj_cliente).replace(/\D/g, '') !== '' &&
          String(parsed.cnpj_cliente).replace(/\D/g, '') ===
            String(parsed.cnpj_fornecedor).replace(/\D/g, '')
        ) {
          console.log(
            '[fatura_extract] CNPJ do cliente veio igual ao CNPJ do fornecedor (' +
              parsed.cnpj_cliente +
              '). Limpando cnpj_cliente.',
          )
          parsed.cnpj_cliente = null
        }

        // Normalização antecipada de tipo de utilidade para apoiar o desmascaramento e detecções
        const rawTipoEarly = String(
          parsed.tipo_utilidade || requestedUtility || fileName || '',
        ).toLowerCase()

        // Se a competência vier em formato por extenso (ex: "fev/2026", "fev/26", "fevereiro/2026")
        function parseExtensoCompetencia(val) {
          if (!val || typeof val !== 'string') return null
          const s = val.trim().toLowerCase()
          const meses = {
            jan: '01',
            janeiro: '01',
            fev: '02',
            fevereiro: '02',
            mar: '03',
            marco: '03',
            março: '03',
            abr: '04',
            abril: '04',
            mai: '05',
            maio: '05',
            jun: '06',
            junho: '06',
            jul: '07',
            julho: '07',
            ago: '08',
            agosto: '08',
            set: '09',
            setembro: '09',
            out: '10',
            outubro: '10',
            nov: '11',
            novembro: '11',
            dez: '12',
            dezembro: '12',
          }
          const m = s.match(/([a-zçãé]+)\s*[\/\-.]?\s*(\d{2,4})/)
          if (m) {
            const mesNome = m[1]
            let ano = m[2]
            if (ano.length === 2) ano = '20' + ano
            const mesNum = meses[mesNome]
            if (mesNum) {
              return {
                competencia: `${ano}-${mesNum}-01`,
                competencia_formatada: `${mesNum}/${ano}`,
              }
            }
          }
          return null
        }

        const extComp =
          parseExtensoCompetencia(parsed.competencia) ||
          parseExtensoCompetencia(parsed.competencia_formatada)
        if (extComp) {
          parsed.competencia = extComp.competencia
          parsed.competencia_formatada = extComp.competencia_formatada
        }

        // Tratar vencimento no formato brasileiro DD.MM.YYYY ou DD/MM/YYYY se a IA retornar texto sem ISO
        if (parsed.vencimento && typeof parsed.vencimento === 'string') {
          const strVenc = parsed.vencimento.trim()
          const mVenc = strVenc.match(/^(\d{2})[./\-](\d{2})[./\-](\d{4})$/)
          if (mVenc) {
            parsed.vencimento = `${mVenc[3]}-${mVenc[2]}-${mVenc[1]}`
          }
        }
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

        // Sanitizar numéricos essenciais (valor total aceita 0)
        parsed.valor_total = sanitizeMonetary(parsed.valor_total)
        parsed.fatura_total = sanitizeMonetary(parsed.fatura_total)
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
          parsed.cnpj_destinatário ||
          parsed.cnpj_pagador ||
          parsed.cnpjPagador ||
          parsed.cnpj_empreendimento ||
          parsed.cnpjEmpreendimento ||
          parsed['cnpj_cliente/consumidor'] ||
          parsed['CNPJ do cliente'] ||
          parsed['CNPJ Cliente'] ||
          parsed['cnpj cliente'] ||
          parsed['cnpj_pagador'] ||
          parsed['cpf_cnpj_cliente']

        if (clienteCnpjCandidate && !parsed.cnpj_cliente) {
          parsed.cnpj_cliente = sanitizeText(clienteCnpjCandidate)
        }

        // Identificar se é fatura Enel (por nome do arquivo, fornecedor, tipo ou texto da resposta bruta)
        const isEnelDoc =
          fileName.toLowerCase().includes('enel') ||
          rawTipoEarly.includes('enel') ||
          (parsed.tipo_utilidade && String(parsed.tipo_utilidade).toLowerCase().includes('enel')) ||
          (parsed.cnpj_fornecedor &&
            String(parsed.cnpj_fornecedor).replace(/\D/g, '').startsWith('61695227')) ||
          rawText.toLowerCase().includes('enel') ||
          rawText.includes('61.695.227')

        // Se CNPJ do cliente veio mascarado (ex: 04.***.***/****-63), preservar a máscara para o frontend sugerir por correspondência parcial
        // ou se não houver asteriscos, manter apenas se tiver 14 dígitos válidos
        if (parsed.cnpj_cliente) {
          const sCli = String(parsed.cnpj_cliente).trim()
          if (sCli.includes('*')) {
            // Preservar o valor mascarado original para conferência parcial no frontend
            parsed.cnpj_cliente = sCli
          } else {
            const cleanCliDigits = sCli.replace(/\D/g, '')
            if (cleanCliDigits.length === 14) {
              parsed.cnpj_cliente = cleanCliDigits.replace(
                /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
                '$1.$2.$3/$4-$5',
              )
            } else {
              console.log(
                '[fatura_extract] CNPJ do cliente truncado ou inválido descartado:',
                parsed.cnpj_cliente,
              )
              parsed.cnpj_cliente = null
            }
          }
        }

        // Se CNPJ do cliente não foi capturado ou veio nulo, tentar extração no texto do documento (se houver texto extraído válido)
        if (
          !parsed.cnpj_cliente &&
          textExtracted &&
          textContent &&
          typeof textContent === 'string'
        ) {
          const cnpjMatch =
            textContent.match(/CPF\/CNPJ:\s*([0-9.*\/ -]{11,20})/i) ||
            textContent.match(/CNPJ:\s*([0-9.*\/ -]{11,20})/i)
          if (cnpjMatch) {
            const matchStr = cnpjMatch[1].trim()
            if (matchStr.includes('*')) {
              parsed.cnpj_cliente = matchStr
            } else {
              const rawClean = matchStr.replace(/[^0-9]/g, '')
              if (rawClean.length === 14) {
                parsed.cnpj_cliente = rawClean.replace(
                  /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
                  '$1.$2.$3/$4-$5',
                )
              }
            }
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
        if (parsed.tipoFaturaEnergia !== undefined && parsed.tipo_fatura_energia === undefined) {
          parsed.tipo_fatura_energia = parsed.tipoFaturaEnergia
        }
        if (parsed.identificador !== undefined && parsed.identificacao === undefined) {
          parsed.identificacao = parsed.identificador
        }
        if (parsed.destino !== undefined && parsed.identificacao === undefined) {
          parsed.identificacao = parsed.destino
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

          // Tratamento especial de valores monetários de gás (fornecimento, devoluções e valor final a pagar)
          const valorFornecimento = sanitizeNumeric(
            parsed.valor_fornecimento ||
              parsed.valorFornecimento ||
              parsed.fornecimento_gas ||
              parsed.fornecimentoGas ||
              parsed['Fornecimento de Gás Natural'] ||
              parsed['fornecimento_de_gas_natural'],
          )

          // Se valor_total veio explicitamente 0 (fatura de crédito / estorno / devolução), 0 é legítimo!
          // NUNCA substituir 0.00 pelo valor de fornecimento isolado.
          // Somente se valor_total estiver null/undefined (não veio na extração), tentar usar o valor_a_pagar
          if (parsed.valor_total === null || parsed.valor_total === undefined) {
            if (parsed.valor_a_pagar !== null && parsed.valor_a_pagar !== undefined) {
              parsed.valor_total = sanitizeMonetary(parsed.valor_a_pagar)
              parsed.fatura_total = parsed.valor_total
            } else if (valorFornecimento && valorFornecimento > 0) {
              parsed.valor_total = valorFornecimento
              parsed.fatura_total = valorFornecimento
            }
          }

          // Regra C: Tarifa de gás - preferir sempre 'Tarifa Aplicada com ICMS' sobre a tarifa variável de Dados Tarifários
          if (textExtracted && textContent && typeof textContent === 'string') {
            const icmsTarMatch = textContent.match(
              /Tarifa\s+Aplicada\s+(?:com\s+ICMS)?[\s\S]{0,30}?(?:R\$\s*)?([0-9]+[.,][0-9]+)/i,
            )
            if (icmsTarMatch) {
              const parsedIcmsTar = Number(icmsTarMatch[1].replace(',', '.'))
              if (!isNaN(parsedIcmsTar) && parsedIcmsTar > 0) {
                console.log(
                  '[fatura_extract] Tarifa com ICMS detectada explicitamente no texto:',
                  parsedIcmsTar,
                )
                parsed.tarifa = parsedIcmsTar
              }
            }
          }

          // Se número da fatura não foi identificado na Comgás, buscar no texto "NOTA FISCAL / CONTA DE GÁS [Nº] ..." (apenas se houver texto válido)
          if (
            !parsed.numero_fatura &&
            textExtracted &&
            textContent &&
            typeof textContent === 'string'
          ) {
            const nfMatch = textContent.match(
              /(?:NOTA\s+FISCAL\s*\/\s*CONTA\s+DE\s+G[AÁ]S|Conta\s+de\s+G[aá]s\s*N[ºo°]?)\s*[:.]?\s*N?[ºo°]?\s*([0-9]{2,3}[.,][0-9]{3}[.,][0-9]{3}|[0-9]{7,10})/i,
            )
            if (nfMatch) {
              parsed.numero_fatura = nfMatch[1].trim()
            }
          }
          // Regra A: Medições Anterior e Atual de gás são inteiros cumulativos (ponto de milhar, nunca decimal!)
          function parseGasCumulativeReading(val) {
            if (val === undefined || val === null || val === '') return null
            let s = String(val).trim()
            // Se veio com ponto e 3 dígitos, era ponto de milhar -> ex: "123.456" vira 123456
            if (/^\d{1,3}\.\d{3}$/.test(s)) {
              return Number(s.replace(/\./g, ''))
            }
            // Se veio como decimal float porque algum parser converteu, e o número é < 1000 com 3 casas
            if (typeof val === 'number') {
              const strVal = String(val)
              const parts = strVal.split('.')
              if (parts.length === 2 && parts[1].length === 3 && val < 1000 && val > 10) {
                return Math.round(val * 1000)
              }
              return Math.round(val)
            }
            // Se veio string com separador de milhar ou vírgula
            s = s.replace(/\D/g, '')
            const n = Number(s)
            return !isNaN(n) && n > 0 ? n : null
          }

          if (parsed.medicao_anterior !== undefined && parsed.medicao_anterior !== null) {
            parsed.medicao_anterior = parseGasCumulativeReading(parsed.medicao_anterior)
          }
          if (parsed.medicao_atual !== undefined && parsed.medicao_atual !== null) {
            parsed.medicao_atual = parseGasCumulativeReading(parsed.medicao_atual)
          }

          // Se a IA não pegou medição_atual e medição_anterior, tentar extrair diretamente do texto da fatura (apenas se houver texto extraído válido)
          if (
            (!parsed.medicao_anterior || !parsed.medicao_atual) &&
            textExtracted &&
            textContent &&
            typeof textContent === 'string'
          ) {
            // Padrão típico Comgás na linha de medição:
            const medMatch = textContent.match(
              /(\d{2,3}[.,]\d{3})\s+(\d{2,3}[.,]\d{3})\s+(\d{1,3}[.,]\d{3}|\d+)/,
            )
            if (medMatch) {
              const val1 = Number(medMatch[1].replace(/\D/g, ''))
              const val2 = Number(medMatch[2].replace(/\D/g, ''))
              const rawDiff = medMatch[3].replace(/\D/g, '')
              const valDiff = Number(rawDiff)
              if (!isNaN(val1) && !isNaN(val2)) {
                const maior = Math.max(val1, val2)
                const menor = Math.min(val1, val2)
                if (!parsed.medicao_atual) parsed.medicao_atual = maior
                if (!parsed.medicao_anterior) parsed.medicao_anterior = menor
                if (!parsed.consumo_medido && valDiff > 0) parsed.consumo_medido = valDiff
              }
            }
          }
          // Regra B: Consumo Medido de gás: calcular/validar como Medição Atual - Medição Anterior quando ambos presentes
          if (
            parsed.medicao_atual &&
            parsed.medicao_anterior &&
            Number(parsed.medicao_atual) >= Number(parsed.medicao_anterior)
          ) {
            const diffLeituras = Number(parsed.medicao_atual) - Number(parsed.medicao_anterior)
            // Se consumo_medido foi extraído incorretamente por erro de milhar, corrigir para a diferença exata
            parsed.consumo_medido = diffLeituras
          } else if (parsed.consumo_medido && Number(parsed.consumo_medido) < 10) {
            if (parsed.consumo_corrigido && Number(parsed.consumo_corrigido) > 100) {
              const candidateMedido = Math.round(Number(parsed.consumo_medido) * 1000)
              if (
                Math.abs(candidateMedido - Number(parsed.consumo_corrigido)) <
                candidateMedido * 0.5
              ) {
                parsed.consumo_medido = candidateMedido
              }
            }
          }

          // Regra B: Correção de escala 1000x NUNCA deve se aplicar ao consumo medido!
          // Somente ao consumo corrigido/faturado, e somente quando a checagem de coerência
          // (consumo * tarifa com ICMS ≈ fornecimento) falhar em 3 ordens de grandeza.
          function adjustGasConsumptionScale(c) {
            if (!c || isNaN(c) || c <= 0) return c
            const targetVal = Number(
              valorFornecimento ||
                (parsed.valor_total && parsed.valor_total > 0 ? parsed.valor_total : 0),
            )
            const tarVal = Number(parsed.tarifa || 0)

            // Se temos tarifa e valor alvo para conferência
            if (tarVal > 0 && targetVal > 0) {
              const diffCurrent = Math.abs(c * tarVal - targetVal)
              // Se já está coerente (diferença relativa < 10%), NÃO mexer!
              if (diffCurrent / targetVal < 0.1) {
                return c
              }
              // Só testar divisão por 1000 se o valor atual falhar e a divisão por 1000 fizer bater perfeitamente
              const diffDivided = Math.abs((c / 1000) * tarVal - targetVal)
              if (diffDivided < diffCurrent && diffDivided / targetVal < 0.05) {
                return Number((c / 1000).toFixed(3))
              }
            } else if (targetVal > 0) {
              // Se temos apenas o valor alvo e não temos tarifa:
              // Se o consumo atual é 1000x maior que targetVal (tarifa implícita < 0.05 R$/m³)
              const implicitTarifaCurrent = targetVal / c
              const implicitTarifaDivided = targetVal / (c / 1000)
              if (
                implicitTarifaCurrent < 0.05 &&
                implicitTarifaDivided >= 1.0 &&
                implicitTarifaDivided <= 20.0
              ) {
                return Number((c / 1000).toFixed(3))
              }
            }
            return c
          }

          if (parsed.consumo_corrigido) {
            parsed.consumo_corrigido = adjustGasConsumptionScale(Number(parsed.consumo_corrigido))
          }
          if (parsed.consumo) {
            parsed.consumo = adjustGasConsumptionScale(Number(parsed.consumo))
          }

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

          if (parsed.consumo !== undefined && parsed.consumo_corrigido === undefined) {
            parsed.consumo_corrigido = parsed.consumo
          }

          // Se tarifa não veio preenchida ou veio 0
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

          // Parser numérico robusto pt-BR/en-US — cobre strings e valores numéricos JSON:
          // "1.278"->1278, "120.086"->120086, 1.508->1508, 117.047->117047, 118.555->118555, "10.481,96"->10481.96
          function parseAguaNumero(val) {
            if (val === undefined || val === null || val === '') return null
            if (typeof val === 'number') {
              if (isNaN(val) || val <= 0) return null
              // Número chegando como JSON number com parte decimal (ex: 1.508, 117.047, 118.555):
              // Em hidrômetros e faturas de água Sabesp, leituras e consumos medidos são inteiros
              // ou foram gerados a partir de separador de milhar pt-BR convertido para float JSON.
              const sNum = String(val)
              const parts = sNum.split('.')
              if (parts.length === 2) {
                const frac = parts[1]
                // Se tem fração decimal com 1 a 3 casas e valor < 100000:
                // ex: 1.508 (frac 3, val 1.508) -> 1508
                // ex: 117.047 (frac 3, val 117.047) -> 117047
                // ex: 118.555 (frac 3, val 118.555) -> 118555
                // ex: 1.53 (frac 2, val 1.53) -> 1530
                if (frac.length === 3 || (frac.length < 3 && val < 10)) {
                  return Math.round(val * 1000)
                }
              }
              return val
            }
            let s = String(val)
              .trim()
              .replace(/^R\$\s*/i, '')
            if (s.includes('*')) s = s.replace(/\*+/g, '').trim()
            if (!s || s === 'null' || s === 'undefined') return null
            if (s.includes(',') && s.includes('.')) {
              // pt-BR completo: ponto = milhar, vírgula = decimal
              s = s.replace(/\./g, '').replace(',', '.')
            } else if (s.includes(',')) {
              // Se tiver formato "117,047" ou "1,508" (vírgula como decimal onde a fatura era milhar)
              const pVirg = s.split(',')
              if (pVirg.length === 2 && pVirg[1].length === 3 && Number(pVirg[0]) < 1000) {
                return Number(pVirg[0] + pVirg[1])
              }
              s = s.replace(',', '.')
            } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
              // Ponto de milhar pt-BR sem parte decimal (ex.: "1.278", "117.047", "118.555")
              s = s.replace(/\./g, '')
            } else if (/^\d{1,3}\.\d{1,3}$/.test(s)) {
              // String como "1.508" ou "117.047" com ponto
              const p = s.split('.')
              if (p[1].length === 3 && Number(p[0]) < 1000) {
                return Number(p[0] + p[1])
              }
            }
            const n = Number(s.replace(/[^0-9.]/g, ''))
            if (isNaN(n) || n <= 0) return null
            // Heurística secundária para número vindo de string parseada para float com 3 casas
            const pStr = String(n).split('.')
            if (
              pStr.length === 2 &&
              (pStr[1].length === 3 || (pStr[1].length < 3 && n < 10)) &&
              n < 1000
            ) {
              return Math.round(n * 1000)
            }
            return n
          }

          if (parsed.consumo_medido !== undefined && parsed.consumo_medido !== null) {
            parsed.consumo_medido = parseAguaNumero(parsed.consumo_medido)
          }
          if (parsed.consumo !== undefined && parsed.consumo !== null) {
            parsed.consumo = parseAguaNumero(parsed.consumo)
          }
          if (parsed.medicao_anterior !== undefined && parsed.medicao_anterior !== null) {
            parsed.medicao_anterior = parseAguaNumero(parsed.medicao_anterior)
          }
          if (parsed.medicao_atual !== undefined && parsed.medicao_atual !== null) {
            parsed.medicao_atual = parseAguaNumero(parsed.medicao_atual)
          }

          // Se medições foram extraídas, garantir que estão na mesma escala inteira
          if (
            parsed.medicao_atual !== undefined &&
            parsed.medicao_anterior !== undefined &&
            Number(parsed.medicao_atual) > 0 &&
            Number(parsed.medicao_anterior) > 0
          ) {
            let mAtu = Number(parsed.medicao_atual)
            let mAnt = Number(parsed.medicao_anterior)
            // Se medições vieram em escala decimal < 1000 (ex.: 117.047, 118.555 ou 117, 118)
            if (mAtu < 1000 && mAnt < 1000) {
              const fAtu = String(mAtu).split('.')[1]
              const fAnt = String(mAnt).split('.')[1]
              if ((fAtu && fAtu.length === 3) || (fAnt && fAnt.length === 3)) {
                parsed.medicao_atual = Math.round(mAtu * 1000)
                parsed.medicao_anterior = Math.round(mAnt * 1000)
              }
            }
          }

          // VALIDAÇÃO CRUZADA OBRIGATÓRIA DE ÁGUA:
          // Quando leitura anterior e leitura atual estiverem presentes, o consumo medido
          // DEVE ser a diferença leitura_atual − leitura_anterior.
          // Se o consumo extraído (mesmo após correção de escala) não bater com a diferença,
          // PREVALECE A DIFERENÇA DAS LEITURAS (corrige casos onde a IA lê média de consumo, ex: 1.206 vs 1.508).
          if (
            parsed.medicao_atual !== undefined &&
            parsed.medicao_anterior !== undefined &&
            Number(parsed.medicao_atual) > Number(parsed.medicao_anterior)
          ) {
            const diffLeituras = Math.round(
              Number(parsed.medicao_atual) - Number(parsed.medicao_anterior),
            )
            const consMedidoOriginal = Number(parsed.consumo_medido) || Number(parsed.consumo) || 0
            if (diffLeituras > 0 && Math.abs(consMedidoOriginal - diffLeituras) > 0) {
              console.log(
                `[fatura_extract] Validação cruzada Água: leituras ${parsed.medicao_atual} - ${parsed.medicao_anterior} = ${diffLeituras} m³. Substituindo consumo extraído (${consMedidoOriginal}) pela diferença exata das leituras.`,
              )
              parsed.consumo_medido = diffLeituras
              parsed.consumo = diffLeituras
            } else if (!parsed.consumo_medido || Number(parsed.consumo_medido) === 0) {
              parsed.consumo_medido = diffLeituras
              parsed.consumo = diffLeituras
            }
          }

          if (parsed.consumo_medido && !parsed.consumo) {
            parsed.consumo = parsed.consumo_medido
          }
          if (parsed.consumo && !parsed.consumo_medido) {
            parsed.consumo_medido = parsed.consumo
          }

          // TRAVA DE ESCALA PARA ÁGUA E ESGOTO:
          // Se o consumo veio minúsculo (< 100 m³) e o valor_total da fatura é alto (> R$ 1.000,00),
          // confere a ordem de grandeza da tarifa implícita (R$/m³).
          {
            const vRefAgua =
              sanitizeMonetary(parsed.valor_total) ||
              sanitizeMonetary(parsed.fatura_total) ||
              sanitizeMonetary(parsed.valor_a_pagar) ||
              0
            const consAguaAtual = Number(parsed.consumo) || Number(parsed.consumo_medido) || 0
            if (vRefAgua > 1000 && consAguaAtual > 0 && consAguaAtual < 100) {
              const tarifaImplicitaAtual = vRefAgua / consAguaAtual
              const consCorrigido = Number((consAguaAtual * 1000).toFixed(3))
              const tarifaImplicitaCorrigida = vRefAgua / consCorrigido
              // Se tarifa atual é > R$ 100/m³ e a tarifa corrigida fica entre R$ 2/m³ e R$ 100/m³
              if (
                tarifaImplicitaAtual > 100 &&
                tarifaImplicitaCorrigida >= 2 &&
                tarifaImplicitaCorrigida <= 100
              ) {
                console.log(
                  `[fatura_extract] Trava de escala Água: consumo ${consAguaAtual} m³ 1000x menor que o esperado (valor_total=${vRefAgua}, tarifa implícita=${tarifaImplicitaAtual.toFixed(2)}). Corrigindo para ${consCorrigido} m³.`,
                )
                parsed.consumo = consCorrigido
                parsed.consumo_medido = consCorrigido

                // Se as medições também vieram 1000x menores
                if (
                  parsed.medicao_atual !== undefined &&
                  Number(parsed.medicao_atual) > 0 &&
                  Number(parsed.medicao_atual) < 1000
                ) {
                  parsed.medicao_atual = Math.round(Number(parsed.medicao_atual) * 1000)
                }
                if (
                  parsed.medicao_anterior !== undefined &&
                  Number(parsed.medicao_anterior) > 0 &&
                  Number(parsed.medicao_anterior) < 1000
                ) {
                  parsed.medicao_anterior = Math.round(Number(parsed.medicao_anterior) * 1000)
                }
              }
            }
          }

          // Tarifa média de água: se vazia ou 0 (ou se veio calculada sobre a escala errada),
          // calcular valor total / consumo com até 6 casas decimais.
          // NUNCA sobrescrever tarifa digitada manualmente; mas na extração automática,
          // quando não há tarifa unitária impressa no documento Sabesp, calcula analiticamente.
          const valorAgua =
            sanitizeMonetary(parsed.valor_total) ||
            sanitizeMonetary(parsed.fatura_total) ||
            sanitizeMonetary(parsed.valor_a_pagar) ||
            0
          const consumoAgua =
            sanitizeNumeric(parsed.consumo) || sanitizeNumeric(parsed.consumo_medido) || 0
          const tarifaExistente = sanitizeNumeric(parsed.tarifa)
          if (valorAgua > 0 && consumoAgua > 0) {
            // Se tarifa não existe, é zero, ou se a tarifa existente for absurda (> R$ 100/m³ com fatura alta)
            if (
              tarifaExistente === null ||
              tarifaExistente === 0 ||
              (tarifaExistente > 100 && valorAgua / consumoAgua < 50)
            ) {
              parsed.tarifa = Number((valorAgua / consumoAgua).toFixed(6))
            } else if (tarifaExistente !== null && tarifaExistente > 0) {
              // Se já é plausível, mantém ou garante precisão de até 6 casas se for divisão exata
              parsed.tarifa = tarifaExistente
            }
          } else if (consumoAgua === 0) {
            // Regra: consumo zero -> tarifa vazia
            parsed.tarifa = null
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
          fileName.toLowerCase().includes('enel') ||
          isEnelDoc

        if (
          isEnergia &&
          parsed.tipo_utilidade !== 'Gás' &&
          parsed.tipo_utilidade !== 'Água e Esgoto'
        ) {
          parsed.tipo_utilidade = 'Energia Elétrica'
          parsed.unidade_consumo = 'kWh'

          if (
            (!parsed.cnpj_fornecedor || parsed.cnpj_fornecedor.length < 5) &&
            (isEnelDoc || fileName.toLowerCase().includes('enel') || rawTipo.includes('enel'))
          ) {
            parsed.cnpj_fornecedor = '61.695.227/0001-93'
          }

          // Regex direta no texto para capturar a bandeira tarifária real impressa na fatura
          if (textExtracted && textContent && typeof textContent === 'string') {
            const bandeiraMatch =
              textContent.match(
                /Bandeira(?:\(s\))?\s+tarif[aá]ria(?:\(s\))?\s+aplicada(?:\(s\))?\s+no\s+m[eê]s\s*[:.]?\s*([A-Z\u00C0-\u00FF0-9 ]+)/i,
              ) || textContent.match(/ADICIONAL\s+BANDEIRA\s+([A-Z\u00C0-\u00FF0-9 ]+)/i)
            if (bandeiraMatch) {
              const matchedColor = bandeiraMatch[1].trim().toUpperCase()
              if (matchedColor.includes('AMARELA')) {
                parsed.adicional_bandeira = 'Bandeira Amarela'
              } else if (matchedColor.includes('VERMELHA 2')) {
                parsed.adicional_bandeira = 'Bandeira Vermelha 2'
              } else if (matchedColor.includes('VERMELHA')) {
                parsed.adicional_bandeira = 'Bandeira Vermelha 1'
              } else if (matchedColor.includes('VERDE')) {
                parsed.adicional_bandeira = 'Bandeira Verde'
              } else if (matchedColor.includes('ESCASSEZ')) {
                parsed.adicional_bandeira = 'Escassez Hídrica'
              }
            }
          }

          // Normalização e correção da classificação de consumo (Grupo B vs Grupo A)
          // Na fatura Enel da imagem, o texto é "B - B3 - CONVENCIONAL - COMERCIAL - Outros serviços e outras atividades".
          // Se a IA interpretou erroneamente como "A4", corrigimos para B3 quando for Enel convencional/B3
          if (parsed.classificacao_consumo) {
            const rawClsUpper = String(parsed.classificacao_consumo).toUpperCase()
            if (
              rawClsUpper.includes('B3') ||
              rawClsUpper.includes('B-B3') ||
              rawClsUpper.includes('CONVENCIONAL') ||
              rawClsUpper.includes('COMERCIAL')
            ) {
              parsed.classificacao_consumo = 'B3'
            }
          } else if (isEnelDoc) {
            // Se for Enel e não informada, assumir B3 (comum para essas contas comerciais)
            parsed.classificacao_consumo = 'B3'
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

          // Fallback por regex no texto do PDF para faturas de Energia Elétrica (Enel e congêneres)
          let extractedMeterConst = null
          if (textExtracted && textContent && typeof textContent === 'string') {
            // 1. Quadro histórico: "MÊS/ANO CONSUMO FATURADO (kWh)"
            // Ex.: "JAN/26 24.098,400 31 LID" ou "JAN/2026 24.098,400"
            if (!parsed.consumo || Number(parsed.consumo) === 0) {
              const mesesMap = {
                '01': ['JAN', 'JANEIRO'],
                '02': ['FEV', 'FEVEREIRO'],
                '03': ['MAR', 'MARÇO', 'MARCO'],
                '04': ['ABR', 'ABRIL'],
                '05': ['MAI', 'MAIO'],
                '06': ['JUN', 'JUNHO'],
                '07': ['JUL', 'JULHO'],
                '08': ['AGO', 'AGOSTO'],
                '09': ['SET', 'SETEMBRO'],
                10: ['OUT', 'OUTUBRO'],
                11: ['NOV', 'NOVEMBRO'],
                12: ['DEZ', 'DEZEMBRO'],
              }

              let compMes = ''
              let compAnoCurto = ''
              let compAnoLongo = ''

              if (parsed.competencia_formatada) {
                const [mm, yyyy] = String(parsed.competencia_formatada).split('/')
                compMes = mm
                compAnoLongo = yyyy || ''
                compAnoCurto = yyyy ? yyyy.slice(-2) : ''
              } else if (parsed.competencia && String(parsed.competencia).includes('-')) {
                const [yyyy, mm] = String(parsed.competencia).split('-')
                compMes = mm
                compAnoLongo = yyyy || ''
                compAnoCurto = yyyy ? yyyy.slice(-2) : ''
              }

              if (compMes && mesesMap[compMes]) {
                const siglas = mesesMap[compMes]
                for (const sigla of siglas) {
                  // Tentar "JAN/26", "JAN/2026", "JAN 26"
                  const patts = [
                    new RegExp(
                      `${sigla}\\/(?:${compAnoCurto}|${compAnoLongo})\\s+(\\d{1,3}(?:\\.\\d{3})*,\\d{1,3})`,
                      'i',
                    ),
                    new RegExp(
                      `${sigla}\\s+(?:${compAnoCurto}|${compAnoLongo})\\s+(\\d{1,3}(?:\\.\\d{3})*,\\d{1,3})`,
                      'i',
                    ),
                  ]
                  for (const p of patts) {
                    const hMatch = textContent.match(p)
                    if (hMatch) {
                      const histCons = Number(hMatch[1].replace(/\./g, '').replace(',', '.'))
                      if (!isNaN(histCons) && histCons > 0) {
                        console.log(
                          '[fatura_extract] Consumo extraído por regex do histórico:',
                          histCons,
                        )
                        parsed.consumo = histCons
                        break
                      }
                    }
                  }
                  if (parsed.consumo && Number(parsed.consumo) > 0) break
                }
              }
            }

            // 2. Linha do medidor em DADOS DE MEDIÇÃO:
            // Ex.: "11134555 ENRG ATV ÚNICO 58753.000 59757.100 0,02400 24.098,400"
            // Suporta espaços múltiplos, quebras de linha ou colunas intercaladas
            const meterLineRegexes = [
              /(?:ENRG\s+ATV\s+(?:[A-Z\u00C0-\u00FF]+|\S+)\s+)?(\d{4,7}(?:\.\d{3})?)\s+(\d{4,7}(?:\.\d{3})?)\s+(\d+[,.]\d{2,6})\s+(\d{1,3}(?:\.\d{3})*,\d{1,3})/i,
              /(\d{5,7}(?:\.\d{3})?)\s+(\d{5,7}(?:\.\d{3})?)\s+(0[,.]\d{3,6})\s+(\d{1,3}(?:\.\d{3})*,\d{1,3})/i,
            ]
            for (const rx of meterLineRegexes) {
              const meterMatch = textContent.match(rx)
              if (meterMatch) {
                const rawAntStr = meterMatch[1]
                const rawAtuStr = meterMatch[2]
                const rawConstStr = meterMatch[3]
                const rawConsStr = meterMatch[4]

                const consClean = Number(rawConsStr.replace(/\./g, '').replace(',', '.'))
                if (!isNaN(consClean) && consClean > 0) {
                  if (!parsed.consumo || Number(parsed.consumo) === 0) {
                    console.log(
                      '[fatura_extract] Consumo extraído por regex da linha do medidor:',
                      consClean,
                    )
                    parsed.consumo = consClean
                  }
                }

                const constClean = Number(rawConstStr.replace(',', '.'))
                if (!isNaN(constClean) && constClean > 0) {
                  extractedMeterConst = constClean
                }

                const antClean = Math.round(
                  Number(rawAntStr.replace(/\./g, '')) / (rawAntStr.includes('.') ? 1000 : 1),
                )
                const atuClean = Math.round(
                  Number(rawAtuStr.replace(/\./g, '')) / (rawAtuStr.includes('.') ? 1000 : 1),
                )
                if (!parsed.medicao_anterior && antClean > 0) parsed.medicao_anterior = antClean
                if (!parsed.medicao_atual && atuClean > 0) parsed.medicao_atual = atuClean
                break
              }
            }

            // 3. Tabela de itens de faturamento (TUSD / TE): coluna Quant. (kWh)
            // Ex.: "USO SIST. DISTR. (TUSD) KWH 24.098,400 0,55454 13.363,46"
            // ou "ENERGIA (TE) KWH 24.098,400 0,37539 9.046,36"
            if (!parsed.consumo || Number(parsed.consumo) === 0) {
              const tusdTeItemMatch = textContent.match(
                /(?:USO\s+SIST\.?\s*DISTR\.?|ENERGIA\s*\(TE\)|TUSD|TE)\s+(?:KWH\s+)?(\d{1,3}(?:\.\d{3})*,\d{1,3})/i,
              )
              if (tusdTeItemMatch) {
                const itemCons = Number(tusdTeItemMatch[1].replace(/\./g, '').replace(',', '.'))
                if (!isNaN(itemCons) && itemCons > 0) {
                  console.log(
                    '[fatura_extract] Consumo extraído por regex dos itens TUSD/TE:',
                    itemCons,
                  )
                  parsed.consumo = itemCons
                }
              }
            }

            // Fallback para constante do medidor isolada se não encontrada na linha do medidor
            if (!extractedMeterConst) {
              const constMatch = textContent.match(
                /(?:Const\.?\s*Medidor|Constante)\s*[:.]?\s*(\d+[,.]\d{2,6})/i,
              )
              if (constMatch) {
                const parsedC = Number(constMatch[1].replace(',', '.'))
                if (!isNaN(parsedC) && parsedC > 0) {
                  extractedMeterConst = parsedC
                }
              }
            }
          }

          // Se constante foi detectada, persistir no objeto parsed
          if (extractedMeterConst && extractedMeterConst > 0 && !parsed.constante) {
            parsed.constante = extractedMeterConst
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

          // Validação de coerência e fallbacks para Grupo B e Grupo A quando consumo vier vazio:
          // Se consumo_total vier vazio mas medições e/ou tarifas existirem:
          if (!parsed.consumo || Number(parsed.consumo) === 0) {
            const vTotalVal = Number(parsed.valor_total || parsed.fatura_total || 0)
            const somaTarifas =
              (Number(parsed.tarifa_tusd_ponta) || 0) + (Number(parsed.tarifa_te_ponta) || 0)

            if (
              parsed.medicao_atual !== undefined &&
              parsed.medicao_anterior !== undefined &&
              Number(parsed.medicao_atual) > Number(parsed.medicao_anterior)
            ) {
              const diffLeituras = Number(parsed.medicao_atual) - Number(parsed.medicao_anterior)

              if (extractedMeterConst && extractedMeterConst > 0) {
                const calcConsumo = Number((diffLeituras * extractedMeterConst).toFixed(3))
                console.log(
                  `[fatura_extract] Consumo calculado por medições (${parsed.medicao_atual} - ${parsed.medicao_anterior}) * ${extractedMeterConst} = ${calcConsumo}`,
                )
                parsed.consumo = calcConsumo
              } else if (vTotalVal > 0 && somaTarifas > 0) {
                // Estimativa financeira por valor total / (TUSD + TE)
                const estimatedConsumo = vTotalVal / somaTarifas
                const ratio = estimatedConsumo / diffLeituras
                // Se a constante implícita (ex: ~16x ou 0.024) for condizente
                if (ratio > 0.001 && ratio < 1000) {
                  const roundedCons = Number(estimatedConsumo.toFixed(3))
                  console.log(
                    `[fatura_extract] Consumo estimado por valor_total / tarifas = ${roundedCons} (ratio: ${ratio})`,
                  )
                  parsed.consumo = roundedCons
                } else {
                  parsed.consumo = Number(diffLeituras.toFixed(3))
                }
              } else if (diffLeituras > 0) {
                parsed.consumo = Number(diffLeituras.toFixed(3))
              }
            } else if (vTotalVal > 0 && somaTarifas > 0) {
              // Se não há medições mas há valor total e tarifas
              const estimatedConsumo = Number((vTotalVal / somaTarifas).toFixed(3))
              console.log(
                `[fatura_extract] Consumo estimado diretamente por valor_total / somaTarifas = ${estimatedConsumo}`,
              )
              parsed.consumo = estimatedConsumo
            }
          }

          // Para Grupo A: se ponta e fora-ponta estiverem vazios mas temos consumo total,
          // ou se houver ponta/fora-ponta sem consumo total
          if (grupoConsumo === 'A') {
            if (
              (!parsed.consumo || Number(parsed.consumo) === 0) &&
              (parsed.consumo_ponta || parsed.consumo_fora_ponta)
            ) {
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

          // TRAVA DE ESCALA (defesa final): se o consumo veio 1000x menor do que o que a
          // própria fatura imprime, é o caso clássico de número pt-BR mal interpretado
          // ("20,160" ou "20,160.000" lidos como decimal). Contra-prova com o CONTRASTE
          // entre consumo e faturamento: consumo × (TUSD + TE) deve reproduzir o valor de
          // fornecimento/total na ordem de grandeza correta. Se o valor atual ficar
          // ~1000x abaixo do esperado, corrige multiplicando por 1000.
          {
            const consAtual = Number(parsed.consumo) || 0
            if (consAtual > 0 && consAtual < 1000) {
              const vRef = Number(parsed.valor_total) || Number(parsed.fatura_total) || 0
              const tTusd =
                Number(parsed.tarifa_tusd_ponta) || Number(parsed.tarifa_tusd_f_ponta) || 0
              const tTe = Number(parsed.tarifa_te_ponta) || Number(parsed.tarifa_te_f_ponta) || 0
              const somaT = tTusd + tTe
              // Consumo esperado pela linha do medidor (diferença de leituras), quando disponível
              let esperado = 0
              if (
                parsed.medicao_atual !== undefined &&
                parsed.medicao_anterior !== undefined &&
                Number(parsed.medicao_atual) > Number(parsed.medicao_anterior)
              ) {
                esperado = Number(parsed.medicao_atual) - Number(parsed.medicao_anterior)
              }
              const previstoAtual = consAtual * somaT
              const previstoCorrigido = consAtual * 1000 * somaT
              let corrigirPor1000 = false
              if (somaT > 0 && vRef > 0) {
                // Com tarifas: o consumo atual não pode faturar o valor_total; o corrigido sim
                if (previstoCorrigido > vRef * 0.6 && previstoAtual < vRef * 0.2) {
                  corrigirPor1000 = true
                }
              } else if (esperado > 0) {
                // Sem tarifas: compara com a diferença de leituras do medidor
                if (esperado > consAtual * 300) {
                  corrigirPor1000 = true
                }
              } else if (vRef > 0) {
                // Sem tarifas nem leituras: ordem de grandeza pelo valor (Enel B3: ~R$0,9–1,4/kWh)
                if (vRef > consAtual * 300) {
                  corrigirPor1000 = true
                }
              }
              if (corrigirPor1000) {
                console.log(
                  `[fatura_extract] Trava de escala: consumo ${consAtual} kWh 1000x menor que o esperado (valor_total=${vRef}, TUSD+TE=${somaT}). Corrigindo para ${Number(
                    (consAtual * 1000).toFixed(3),
                  )} kWh.`,
                )
                const fixado = Number((consAtual * 1000).toFixed(3))
                parsed.consumo = fixado
                if (parsed.consumo_medido !== undefined && Number(parsed.consumo_medido) > 0) {
                  parsed.consumo_medido = fixado
                }
                if (
                  parsed.consumo_corrigido !== undefined &&
                  Number(parsed.consumo_corrigido) > 0
                ) {
                  parsed.consumo_corrigido = fixado
                }
                // Leituras de medidor de energia também podem ter vindo divididas (ex: 84.938)
                if (
                  parsed.medicao_atual !== undefined &&
                  Number(parsed.medicao_atual) > 0 &&
                  Number(parsed.medicao_atual) < 10000
                ) {
                  parsed.medicao_atual = Number((Number(parsed.medicao_atual) * 1000).toFixed(0))
                }
                if (
                  parsed.medicao_anterior !== undefined &&
                  Number(parsed.medicao_anterior) > 0 &&
                  Number(parsed.medicao_anterior) < 10000
                ) {
                  parsed.medicao_anterior = Number(
                    (Number(parsed.medicao_anterior) * 1000).toFixed(0),
                  )
                }
              }
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

        if (
          parsed.valor_total !== null &&
          parsed.valor_total !== undefined &&
          !isNaN(Number(parsed.valor_total))
        ) {
          // Se o valor total é zero, é válido caso haja algum outro dado (consumo, medição, CNPJ ou fatura)
          if (Number(parsed.valor_total) > 0) {
            hasConsumptionOrValue = true
          } else if (Number(parsed.valor_total) === 0) {
            if (
              (parsed.consumo && Number(parsed.consumo) > 0) ||
              (parsed.consumo_corrigido && Number(parsed.consumo_corrigido) > 0) ||
              (parsed.consumo_medido && Number(parsed.consumo_medido) > 0) ||
              (parsed.medicao_anterior && Number(parsed.medicao_anterior) > 0) ||
              (parsed.medicao_atual && Number(parsed.medicao_atual) > 0) ||
              (parsed.tarifa && Number(parsed.tarifa) > 0) ||
              parsed.numero_fatura ||
              parsed.cnpj_cliente
            ) {
              hasConsumptionOrValue = true
            }
          }
        }
        if (
          parsed.fatura_total !== null &&
          parsed.fatura_total !== undefined &&
          Number(parsed.fatura_total) > 0
        ) {
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

      // Se for rate limit (429) do gateway ou muitas requisições
      if (
        msg.includes('429') ||
        msg.includes('Too Many Requests') ||
        msg.includes('rate limit') ||
        msg.includes('Rate limit')
      ) {
        throw new ApiError(
          429,
          'Muitas faturas foram processadas em sequência rápida. Aguarde alguns instantes e tente novamente.',
        )
      }

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
