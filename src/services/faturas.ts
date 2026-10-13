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

  async extractFromDocument(
    file: File,
    tipoUtilidade?: TipoUtilidade,
    onProgress?: (status: string) => void,
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
        renderedImages = await convertPdfToImages(file, {
          maxPages: 2,
          scale: 1.8,
          quality: 0.85,
          maxWidth: 1600,
          maxHeight: 2200,
        })
      } catch (pdfErr) {
        console.warn('Conversão PDF para imagem não pôde ser concluída no cliente:', pdfErr)
      }
    }

    if (onProgress) onProgress('Extraindo dados com IA e Visão Computacional...')

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

    // Call custom hook route /backend/v1/faturas/extract with auth token and timeout controller
    const token = pb.authStore.token
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, 60000) // 60 segundos de timeout para modelos de visão

    let res: Response
    try {
      res = await fetch(`${baseUrl}/backend/v1/faturas/extract`, {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: formData,
        signal: controller.signal,
      })
    } catch (networkErr: any) {
      clearTimeout(timeoutId)
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

    if (!res.ok) {
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
