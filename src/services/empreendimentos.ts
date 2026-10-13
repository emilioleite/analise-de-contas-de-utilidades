import pb from '@/lib/pocketbase/client'
import { EmpreendimentoRecord } from '@/types/entities'

export const empreendimentosService = {
  async list(): Promise<EmpreendimentoRecord[]> {
    return pb.collection('empreendimentos').getFullList<EmpreendimentoRecord>({
      sort: 'nome',
    })
  },

  async getById(id: string): Promise<EmpreendimentoRecord> {
    return pb.collection('empreendimentos').getOne<EmpreendimentoRecord>(id)
  },

  async create(data: Partial<EmpreendimentoRecord>): Promise<EmpreendimentoRecord> {
    const userId = pb.authStore.record?.id
    return pb.collection('empreendimentos').create<EmpreendimentoRecord>({
      ...data,
      owner: userId,
    })
  },

  async update(id: string, data: Partial<EmpreendimentoRecord>): Promise<EmpreendimentoRecord> {
    return pb.collection('empreendimentos').update<EmpreendimentoRecord>(id, data)
  },

  async delete(id: string): Promise<boolean> {
    return pb.collection('empreendimentos').delete(id)
  },
}
