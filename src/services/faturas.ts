import pb from '@/lib/pocketbase/client'
import { parseNumberValue } from '@/lib/cnpj'
import { FaturaRecord, TipoUtilidade } from '@/types/entities'

/**
 * Normaliza datas para o formato ISO/YYYY-MM-DD aceito pelo PocketBase date field.
 * Suporta "DD/MM/AAAA", "DD/MM/AA", strings ISO com horário "YYYY-MM-DDTHH:mm:ss..." ou "YYYY-MM-DD".
 * Se isCompetencia for true e vier "MM/AAAA", converte para o 1º dia do mês "YYYY-MM-01".
 */
export function normalizeDateForPocketBase(
  rawVal: any,
  options?: { isCompetencia?: boolean },
): string | null {
  if (rawVal === undefined || rawVal === null) return null
  const str = String(rawVal).trim()
  if (!str || str === 'null' || str === 'undefined' || str === '-') return null

  // Se já contém 'T', ex: 2026-08-01T00:00:00.000Z
  if (str.includes('T')) {
    const datePart = str.split('T')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return `${datePart} 00:00:00.000Z`
    }
  }

  // Se formato já for YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return `${str} 00:00:00.000Z`
  }

  // Se formato com espaço YYYY-MM-DD HH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}\s/.test(str)) {
    return str
  }

  // Se formato brasileiro com barras DD/MM/AAAA ou DD/MM/AA
  if (str.includes('/')) {
    const parts = str.split('/').map((p) => p.trim())
    if (parts.length === 3) {
      const [dia, mes, anoRaw] = parts
      let ano = anoRaw
      if (ano.length === 2) {
        ano = Number(ano) < 70 ? `20${ano}` : `19${ano}`
      }
      if (ano && mes && dia && ano !== '1900') {
        const yyyy = ano.padStart(4, '0')
        const mm = mes.padStart(2, '0')
        const dd = dia.padStart(2, '0')
        return `${yyyy}-${mm}-${dd} 00:00:00.000Z`
      }
    } else if (parts.length === 2 && options?.isCompetencia) {
      // MM/AAAA
      const [mes, anoRaw] = parts
      let ano = anoRaw
      if (ano.length === 2) {
        ano = Number(ano) < 70 ? `20${ano}` : `19${ano}`
      }
      if (ano && mes && ano !== '1900') {
        const yyyy = ano.padStart(4, '0')
        const mm = mes.padStart(2, '0')
        return `${yyyy}-${mm}-01 00:00:00.000Z`
      }
    }
  }

  // Se formato brasileiro com traço DD-MM-AAAA
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    const [dia, mes, ano] = str.split('-')
    return `${ano}-${mes}-${dia} 00:00:00.000Z`
  }

  // Se competencia no formato YYYY-MM
  if (options?.isCompetencia && /^\d{4}-\d{2}$/.test(str)) {
    return `${str}-01 00:00:00.000Z`
  }

  // Tentativa final via Date parse
  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return null
}

/**
 * Normaliza um valor para número float aceito pelo PocketBase number field.
 * Trata formato pt-BR ("1.234,56", "852,643", "0,00"), números e strings.
 * Preserva 0 rigorosamente (nunca descarta por ser falsy).
 */
export function normalizeNumberForPocketBase(val: any): number | undefined {
  if (val === undefined || val === null || val === '') return undefined
  if (typeof val === 'number') {
    return isNaN(val) ? undefined : val
  }
  const parsed = parseNumberValue(val)
  return parsed !== undefined && !isNaN(parsed) ? parsed : undefined
}

/**
 * Sanitiza o payload da fatura antes de enviar para o PocketBase (create e update).
 * (a) Normaliza campos de data (competência, vencimento) de "DD/MM/AAAA" para formato aceito pelo PB.
 * (b) Converte números pt-BR ("1.234,56", "0,00") para number; nunca envia string com vírgula.
 * (c) Garante que valor 0 seja mantido (nunca descartado por ser falsy).
 * (d) Remove campos undefined/vazios que o schema do PocketBase rejeite.
 */
export function sanitizeFaturaPayload(
  data: Partial<FaturaRecord> & Record<string, any>,
  isCreate = false,
): Record<string, any> {
  const payload: Record<string, any> = {}

  // 1. Empreendimento (relation obrigatória no schema)
  if (data.empreendimento !== undefined) {
    if (data.empreendimento) {
      payload.empreendimento = String(data.empreendimento).trim()
    } else if (!isCreate) {
      // Não sobrescreve com vazio no update a menos que explícito
    }
  }

  // 2. Tipo Utilidade (select obrigatório: Energia Elétrica | Água e Esgoto | Gás)
  if (data.tipo_utilidade !== undefined) {
    if (data.tipo_utilidade) {
      payload.tipo_utilidade = String(data.tipo_utilidade).trim()
    }
  }

  // 3. Competência (date obrigatório)
  if (data.competencia !== undefined) {
    const compNorm = normalizeDateForPocketBase(data.competencia, { isCompetencia: true })
    if (compNorm) {
      payload.competencia = compNorm
    } else if (isCreate) {
      // Fallback de segurança para não quebrar create se não informado
      const now = new Date()
      const yyyy = now.getUTCFullYear()
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
      payload.competencia = `${yyyy}-${mm}-01 00:00:00.000Z`
    }
  }

  // 4. Valor Total (number obrigatório; 0 é VÁLIDO!)
  if (data.valor_total !== undefined) {
    const num = normalizeNumberForPocketBase(data.valor_total)
    if (num !== undefined) {
      payload.valor_total = num
    } else if (isCreate) {
      payload.valor_total = 0
    }
  } else if (isCreate) {
    payload.valor_total = 0
  }

  // 5. Consumo (number opcional)
  if (data.consumo !== undefined) {
    const numConsumo = normalizeNumberForPocketBase(data.consumo)
    if (numConsumo !== undefined) {
      payload.consumo = numConsumo
    } else {
      payload.consumo = null
    }
  }

  // 6. Unidade de Consumo (text opcional)
  if (data.unidade_consumo !== undefined) {
    const str = String(data.unidade_consumo || '').trim()
    payload.unidade_consumo = str || null
  }

  // 7. Número da Fatura (text opcional)
  if (data.numero_fatura !== undefined) {
    const str = String(data.numero_fatura || '').trim()
    payload.numero_fatura = str || null
  }

  // 8. CNPJ Fornecedor (text opcional)
  if (data.cnpj_fornecedor !== undefined) {
    const str = String(data.cnpj_fornecedor || '').trim()
    payload.cnpj_fornecedor = str || null
  }

  // 9. CNPJ Cliente (text opcional)
  if (data.cnpj_cliente !== undefined) {
    const str = String(data.cnpj_cliente || '').trim()
    payload.cnpj_cliente = str || null
  }

  // 10. CNPJ Validado (bool opcional)
  if (data.cnpj_validado !== undefined) {
    payload.cnpj_validado = Boolean(data.cnpj_validado)
  }

  // 10.1. Lançamento Manual (bool opcional)
  if (data.lancamento_manual !== undefined) {
    payload.lancamento_manual = Boolean(data.lancamento_manual)
  }

  // 11. Arquivo Nome (text opcional)
  if (data.arquivo_nome !== undefined) {
    const str = String(data.arquivo_nome || '').trim()
    payload.arquivo_nome = str || null
  }

  // 12. Vencimento (date opcional no schema)
  if (data.vencimento !== undefined) {
    const vencNorm = normalizeDateForPocketBase(data.vencimento)
    // Se vazio ou inválido, enviar null (limpa no PB sem erro de parsing de data)
    payload.vencimento = vencNorm || null
  }

  // 13. Dados Específicos (json opcional)
  if (data.dados_especificos !== undefined) {
    if (data.dados_especificos === null || data.dados_especificos === '') {
      payload.dados_especificos = null
    } else if (typeof data.dados_especificos === 'object') {
      // Objeto JS: PocketBase aceita objeto diretamente ou serializado em string
      payload.dados_especificos = data.dados_especificos
    } else if (typeof data.dados_especificos === 'string') {
      try {
        payload.dados_especificos = JSON.parse(data.dados_especificos)
      } catch {
        payload.dados_especificos = data.dados_especificos
      }
    }
  }

  // 14. Owner (relation obrigatória no create)
  if (data.owner !== undefined) {
    if (data.owner) {
      payload.owner = String(data.owner).trim()
    }
  }

  return payload
}

export interface FaturasFilter {
  search?: string
  tipoUtilidade?: string
  empreendimentoId?: string
  sort?: string
}

export const faturasService = {
  async list(filters?: FaturasFilter): Promise<FaturaRecord[]> {
    const filterParts: string[] = []

    if (filters?.tipoUtilidade && filters.tipoUtilidade !== 'Todas') {
      filterParts.push(`tipo_utilidade = "${filters.tipoUtilidade}"`)
    }

    if (filters?.empreendimentoId && filters.empreendimentoId !== 'Todos') {
      filterParts.push(`empreendimento = "${filters.empreendimentoId}"`)
    }

    const sortOption = filters?.sort || '-competencia'

    return pb.collection('faturas').getFullList<FaturaRecord>({
      filter: filterParts.length > 0 ? filterParts.join(' && ') : undefined,
      sort: sortOption,
      expand: 'empreendimento',
    })
  },

  async getById(id: string): Promise<FaturaRecord> {
    return pb.collection('faturas').getOne<FaturaRecord>(id, {
      expand: 'empreendimento',
    })
  },

  async create(data: Partial<FaturaRecord>): Promise<FaturaRecord> {
    const userId = pb.authStore.record?.id
    const payload = sanitizeFaturaPayload(
      {
        ...data,
        owner: data.owner || userId,
      },
      true,
    )

    try {
      return await pb.collection('faturas').create<FaturaRecord>(payload)
    } catch (err: any) {
      console.warn('[faturasService.create] Erro ao cadastrar fatura no PocketBase:', {
        status: err?.status || err?.response?.status || err?.data?.code,
        message: err?.message,
        serverData: err?.data,
        payloadFinal: payload,
      })
      throw err
    }
  },

  async update(id: string, data: Partial<FaturaRecord>): Promise<FaturaRecord> {
    const payload = sanitizeFaturaPayload(data, false)

    try {
      return await pb.collection('faturas').update<FaturaRecord>(id, payload)
    } catch (err: any) {
      console.warn('[faturasService.update] Erro ao atualizar fatura no PocketBase:', {
        id,
        status: err?.status || err?.response?.status || err?.data?.code,
        message: err?.message,
        serverData: err?.data,
        payloadFinal: payload,
      })
      throw err
    }
  },

  async delete(id: string): Promise<boolean> {
    return pb.collection('faturas').delete(id)
  },

  async deleteAll(onProgress?: (progress: { current: number; total: number }) => void): Promise<{
    deletedCount: number
    errors: { id: string; error: string }[]
  }> {
    // Obter contagem inicial para estimativa de progresso
    let initialTotal = 0
    try {
      const initialPage = await pb.collection('faturas').getList<{ id: string }>(1, 1, {
        fields: 'id',
      })
      initialTotal = initialPage.totalItems || 0
    } catch (err) {
      console.warn('Não foi possível obter contagem total inicial:', err)
    }

    let deletedCount = 0
    const errors: { id: string; error: string }[] = []
    const failedIds = new Set<string>()

    // Reportar estado inicial
    if (onProgress) {
      onProgress({ current: 0, total: initialTotal })
    }

    const BATCH_SIZE = 50
    let safetyLoopCount = 0
    const MAX_LOOPS = 500 // Proteção contra loops infinitos em caso de faturas que falharem persistentemente

    // Iterar até a coleção ficar completamente vazia ou restarem apenas faturas com falha persistente
    while (safetyLoopCount < MAX_LOOPS) {
      safetyLoopCount++

      // Construir filtro para excluir faturas que já falharam, evitando retentativas infinitas
      let filter: string | undefined = undefined
      if (failedIds.size > 0) {
        const idConditions = Array.from(failedIds).map((id) => `id != "${id}"`)
        // Limita o tamanho do filtro para não exceder limites de URL
        if (idConditions.length <= 100) {
          filter = idConditions.join(' && ')
        }
      }

      let batchItems: { id: string }[] = []
      let totalRemaining = 0

      try {
        const pageResult = await pb.collection('faturas').getList<{ id: string }>(1, BATCH_SIZE, {
          fields: 'id',
          filter,
        })
        batchItems = pageResult.items || []
        totalRemaining = pageResult.totalItems || 0
      } catch (fetchErr: any) {
        // Se a busca falhar, tenta uma última vez sem filtro ou encerra
        console.error('Erro ao buscar lote de faturas para exclusão:', fetchErr)
        errors.push({
          id: 'list_batch_error',
          error: fetchErr?.message || String(fetchErr),
        })
        break
      }

      // Se nenhum registro foi encontrado, a coleção está limpa
      if (batchItems.length === 0) {
        break
      }

      // Atualiza o total estimado para a barra de progresso caso a base tenha mudado
      const dynamicTotal = Math.max(initialTotal, deletedCount + totalRemaining)

      // Excluir cada item do lote sequencialmente
      for (const item of batchItems) {
        try {
          await pb.collection('faturas').delete(item.id)
          deletedCount++
        } catch (delErr: any) {
          failedIds.add(item.id)
          errors.push({
            id: item.id,
            error: delErr?.message || String(delErr),
          })
        }

        if (onProgress) {
          onProgress({ current: deletedCount, total: dynamicTotal })
        }
      }

      // Se todos os itens deste lote falharam e foram marcados, encerramos para não travar
      const unhandledBatchItems = batchItems.filter((i) => !failedIds.has(i.id))
      if (unhandledBatchItems.length === 0 && failedIds.size >= batchItems.length) {
        break
      }
    }

    if (onProgress) {
      onProgress({ current: deletedCount, total: Math.max(deletedCount, initialTotal) })
    }

    return { deletedCount, errors }
  },

  async checkDuplicate(params: {
    empreendimentoId: string
    tipoUtilidade: string
    competenciaYearMonth: string
    excludeId?: string
  }): Promise<FaturaRecord | null> {
    try {
      // Normalizar competenciaYearMonth: se vier no formato MM/AAAA ou AAAA-MM, garantir formato AAAA-MM
      let ym = (params.competenciaYearMonth || '').trim()
      if (ym.includes('/')) {
        const [mm, yyyy] = ym.split('/')
        if (mm && yyyy) {
          ym = `${yyyy}-${mm.padStart(2, '0')}`
        }
      } else if (ym.includes('T')) {
        ym = ym.substring(0, 7)
      } else if (ym.length >= 7) {
        ym = ym.substring(0, 7)
      }

      const filterParts = [
        `empreendimento = "${params.empreendimentoId}"`,
        `tipo_utilidade = "${params.tipoUtilidade}"`,
        `competencia ~ "${ym}"`,
      ]
      if (params.excludeId) {
        filterParts.push(`id != "${params.excludeId}"`)
      }

      const list = await pb.collection('faturas').getList<FaturaRecord>(1, 1, {
        filter: filterParts.join(' && '),
        expand: 'empreendimento',
      })
      return list.items.length > 0 ? list.items[0] : null
    } catch (err) {
      console.warn('Erro ao verificar duplicidade de fatura no backend:', err)
      return null
    }
  },

  async extractFromDocument(
    file: File,
    tipoUtilidade?: TipoUtilidade,
    onProgress?: (status: string) => void,
    forceModel?: 'fast' | 'reasoning',
    disableImages?: boolean,
  ): Promise<{ sucesso: boolean; arquivo_nome: string; dados: any }> {
    const fileName = file.name || ''
    const ext = fileName.toLowerCase().split('.').pop()

    let renderedImages: string[] = []
    let clientExtractedText = ''

    // If PDF, extract client-side text if selectable and render high-clarity images of main pages for vision fallback
    if (ext === 'pdf') {
      try {
        if (onProgress) onProgress('Otimizando documento para extração...')
        const { loadPdfJs, convertPdfToImages } = await import('@/lib/pdfToImages')

        // Tentativa de ler texto pelo PDF.js (caso disponível e não corrompido)
        try {
          const pdfjs = await loadPdfJs()
          const arrayBuffer = await file.arrayBuffer()
          const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise
          let fullPdfText = ''
          const maxP = Math.min(pdfDoc.numPages, 3)
          for (let p = 1; p <= maxP; p++) {
            const page = await pdfDoc.getPage(p)
            const textContent = await page.getTextContent()
            const pageStrings = textContent.items.map((item: any) => item.str || '').join(' ')
            fullPdfText += `\n--- PÁGINA ${p} ---\n` + pageStrings
          }
          const trimmedText = fullPdfText.trim()
          // Validar texto mínimo útil (> 200 caracteres e com palavras-chave) para não enviar ruído/texto corrompido de 36 caracteres
          if (trimmedText && trimmedText.length >= 200) {
            clientExtractedText = trimmedText
          }
        } catch (textReadErr) {
          console.warn('Não foi possível extrair texto do PDF via pdf.js:', textReadErr)
        }

        // Renderizar imagens de páginas com limites adequados de dimensão e tamanho para LLMs multimodais
        // Se disableImages for false (ou se o PDF não tiver texto selecionável, onde imagens são vitais), renderizar imagens
        const hasNoText = !clientExtractedText
        if (!disableImages || hasNoText) {
          renderedImages = await convertPdfToImages(file, {
            maxPages: 2,
            scale: 1.6,
            quality: 0.8,
            maxWidth: 1400,
            maxHeight: 1900,
          })
        }
      } catch (pdfErr) {
        console.warn('Conversão PDF para imagem não pôde ser concluída no cliente:', pdfErr)
      }
    }

    if (disableImages) {
      renderedImages = []
    }

    if (onProgress) onProgress('Extraindo dados com IA...')

    const formData = new FormData()
    formData.append('arquivo', file)
    if (tipoUtilidade) {
      formData.append('tipo_utilidade', tipoUtilidade)
    }
    if (clientExtractedText) {
      formData.append('client_text', clientExtractedText)
    }
    if (renderedImages.length > 0) {
      formData.append('images', JSON.stringify(renderedImages))
    }
    if (forceModel) {
      formData.append('force_model', forceModel)
    }

    // Call custom hook route /backend/v1/faturas/extract with auth token, timeout controller and automatic backoff on 429
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''

    const executeExtractRequest = async (attemptCount = 1): Promise<Response> => {
      const token = pb.authStore.token
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
      }, 75000) // 75 segundos de timeout para modelos de visão

      try {
        const response = await fetch(`${baseUrl}/backend/v1/faturas/extract`, {
          method: 'POST',
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: formData,
          signal: controller.signal,
        })

        // Se receber 429 (Too Many Requests), aplicar espera e retentativa automática (até 2 retentativas)
        if (response.status === 429 && attemptCount <= 2) {
          const waitSec = attemptCount * 4
          if (onProgress) {
            onProgress(
              `Limite temporário de requisições. Aguardando ${waitSec}s para tentar novamente...`,
            )
          }
          await new Promise((r) => setTimeout(r, waitSec * 1000))
          return executeExtractRequest(attemptCount + 1)
        }

        return response
      } catch (networkErr: any) {
        if (networkErr.name === 'AbortError') {
          throw new Error(
            'O processamento da fatura excedeu o tempo limite. Tente novamente ou preencha os campos manualmente.',
          )
        }
        const rawMsg = networkErr?.message || String(networkErr)
        if (
          rawMsg.includes('Failed to fetch') ||
          rawMsg.includes('NetworkError') ||
          rawMsg.includes('Load failed')
        ) {
          throw new Error(
            'Não foi possível conectar ao serviço de extração. Verifique sua conexão e tente novamente.',
          )
        }
        throw new Error(`Falha na comunicação: ${rawMsg}`)
      } finally {
        clearTimeout(timeoutId)
      }
    }

    const res = await executeExtractRequest(1)

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error(
          'Muitas solicitações seguidas de extração. Por favor, aguarde alguns instantes e tente novamente.',
        )
      }

      const errJson = await res.json().catch(() => ({}))
      let errMsg = errJson.message || 'Falha ao extrair dados do documento.'
      // Clean up raw gateway error bodies or developer diagnostics if any leaked through
      if (
        errMsg.includes('skip-ai-gateway') ||
        errMsg.includes('{"error":{}}') ||
        errMsg.includes('gateway') ||
        errMsg.includes('400')
      ) {
        errMsg =
          'Não foi possível processar visualmente os dados desta fatura no momento. Preencha os campos diretamente no formulário abaixo.'
      }
      throw new Error(errMsg)
    }

    return res.json()
  },
}
