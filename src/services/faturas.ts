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
  ): Promise<{ sucesso: boolean; arquivo_nome: string; dados: any }> {
    const formData = new FormData()
    formData.append('arquivo', file)
    if (tipoUtilidade) {
      formData.append('tipo_utilidade', tipoUtilidade)
    }

    // Call custom hook route /backend/v1/faturas/extract with auth token
    const token = pb.authStore.token
    const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
    const res = await fetch(`${baseUrl}/backend/v1/faturas/extract`, {
      method: 'POST',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: formData,
    })

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}))
      throw new Error(errJson.message || 'Falha ao extrair dados do documento.')
    }

    return res.json()
  },
}
