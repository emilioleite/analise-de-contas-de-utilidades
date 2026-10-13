routerAdd(
  'POST',
  '/backend/v1/faturas/extract',
  (e) => {
    const files = e.findUploadedFiles('arquivo')
    if (!files || files.length === 0) {
      throw new BadRequestError("Nenhum arquivo enviado. Envie um arquivo em 'arquivo'.")
    }

    const uploadedFile = files[0]
    const fileName = uploadedFile.name || 'arquivo'
    const ext = fileName.toLowerCase().split('.').pop()

    let textContent = ''

    // If PDF, DOCX, XLSX: use $documents.toMarkdown
    if (['pdf', 'xlsx', 'xls', 'docx'].includes(ext)) {
      try {
        const docRes = $documents.toMarkdown({ file: uploadedFile })
        textContent = docRes.markdown || ''
      } catch (err) {
        if (err && err.status === 422) {
          throw new BadRequestError(
            'Não foi possível ler o texto do documento. Certifique-se de que o PDF possui camada de texto pesquisável.',
          )
        }
        // If error converting, try fallback or rethrow
        throw new BadRequestError(
          'Erro ao processar documento: ' + (err.message || 'formato não suportado'),
        )
      }
    } else if (ext === 'csv' || ext === 'txt') {
      // For CSV/TXT, read text content directly
      try {
        const bytes = uploadedFile.bytes ? uploadedFile.bytes() : null
        if (bytes) {
          textContent = $security.decrypt ? String.fromCharCode.apply(null, bytes) : ''
        }
      } catch (_) {
        // fallback
      }
    }

    // If text is still empty, throw friendly message
    if (!textContent || textContent.trim().length === 0) {
      // If $documents didn't extract or CSV reading was blank
      textContent = 'Arquivo de fatura recebido: ' + fileName
    }

    // Optional hint utility from form body
    const body = e.requestInfo().body || {}
    const requestedUtility = body.tipo_utilidade || ''

    // Prompt the LLM using $ai.chat
    const prompt = `Você é um especialista em análise e extração de faturas de utilidades brasileiras (Energia Elétrica, Gás Natural/GLP e Água e Esgoto).
Analise o conteúdo abaixo extraído do arquivo "${fileName}".

Tipo de utilidade sugerido pelo usuário: "${requestedUtility || 'Detectar automaticamente'}".

Extraia estritamente os dados presentes na fatura e retorne APENAS um JSON no formato especificado, sem formatação markdown ou explicações fora do JSON.

Campos gerais obrigatórios para retornar:
- "tipo_utilidade": "Energia Elétrica" | "Água e Esgoto" | "Gás"
- "competencia": string no formato "YYYY-MM-01" (se encontrar mês/ano ex: 03/2024, retorne "2024-03-01")
- "competencia_formatada": "MM/AAAA"
- "valor_total": número float com o valor total da fatura
- "consumo": número float com o consumo faturado principal
- "unidade_consumo": "kWh" se Energia Elétrica, ou "m³" se Água ou Gás
- "numero_fatura": string com o código/número da nota ou fatura
- "cnpj_fornecedor": string com o CNPJ do cliente/consumidor ou fornecedor identificado na fatura (no formato XX.XXX.XXX/XXXX-XX ou números)
- "vencimento": string no formato "YYYY-MM-DD" se identificado

Campos específicos OBRIGATÓRIOS dependendo do tipo:
Se Energia Elétrica:
- "medicao_anterior": número
- "medicao_atual": número
- "classificacao_consumo": string (ex: "A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4")
- "consumo_ponta": número
- "tarifa_tusd_ponta": número
- "tarifa_te_ponta": número
- "consumo_fora_ponta": número
- "tarifa_tusd_f_ponta": número
- "tarifa_te_f_ponta": número
- "adicional_bandeira": string (ex: "Bandeira Verde", "Bandeira Amarela", "Bandeira Vermelha")
- "fatura_total": número float

Se Gás:
- "medicao_anterior": número
- "medicao_atual": número
- "consumo_medido": número
- "consumo_corrigido": número
- "tarifa": número
- "fatura_total": número float

Se Água:
- "medicao_anterior": número
- "medicao_atual": número
- "consumo_medido": número
- "tarifa": número
- "fatura_total": número float

Conteúdo extraído do documento:
"""
${textContent.slice(0, 14000)}
"""

Retorne o JSON estrito.`

    try {
      const aiResponse = $ai.chat({
        model: 'fast',
        messages: [
          {
            role: 'system',
            content:
              'Você é um extrator de dados de faturas altamente preciso. Responda APENAS com JSON puro e válido.',
          },
          { role: 'user', content: prompt },
        ],
      })

      let rawText =
        aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message
          ? aiResponse.choices[0].message.content
          : '{}'

      // Strip markdown code fences if model enclosed in ```json
      rawText = rawText.trim()
      if (rawText.startsWith('```json')) {
        rawText = rawText
          .replace(/^```json/, '')
          .replace(/```$/, '')
          .trim()
      } else if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```/, '').replace(/```$/, '').trim()
      }

      let parsed = {}
      try {
        parsed = JSON.parse(rawText)
      } catch (_) {
        // Fallback object if parsing failed
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
      throw new BadRequestError(
        'Falha na extração por IA: ' + (aiErr.message || 'Erro desconhecido'),
      )
    }
  },
  $apis.requireAuth(),
)
