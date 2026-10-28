import pb from '@/lib/pocketbase/client'
import { FaturaRecord, TipoUtilidade } from '@/types/entities'

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
    return pb.collection('faturas').create<FaturaRecord>({
      ...data,
      owner: userId,
    })
  },

  async update(id: string, data: Partial<FaturaRecord>): Promise<FaturaRecord> {
    return pb.collection('faturas').update<FaturaRecord>(id, data)
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
