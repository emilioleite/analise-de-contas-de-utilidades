import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import {
  EmpreendimentoRecord,
  FaturaRecord,
  FatorEmissaoRecord,
  CalculoEmissaoFatura,
} from '@/types/entities'
import { empreendimentosService } from '@/services/empreendimentos'
import { faturasService } from '@/services/faturas'
import { emissoesService } from '@/services/emissoes'
import { useAuth } from './AuthContext'
import pb from '@/lib/pocketbase/client'

interface DataContextType {
  empreendimentos: EmpreendimentoRecord[]
  faturas: FaturaRecord[]
  fatores: FatorEmissaoRecord[]
  calculosEmissoes: CalculoEmissaoFatura[]
  loading: boolean
  syncing: boolean
  lastSync: Date | null
  refreshData: () => Promise<void>
  refreshFatores: () => Promise<void>
  addEmpreendimento: (emp: Partial<EmpreendimentoRecord>) => Promise<EmpreendimentoRecord>
  updateEmpreendimento: (
    id: string,
    emp: Partial<EmpreendimentoRecord>,
  ) => Promise<EmpreendimentoRecord>
  deleteEmpreendimento: (id: string) => Promise<boolean>
  addFatura: (fat: Partial<FaturaRecord>) => Promise<FaturaRecord>
  updateFatura: (id: string, fat: Partial<FaturaRecord>) => Promise<FaturaRecord>
  deleteFatura: (id: string) => Promise<boolean>
  updateFator: (id: string, data: Partial<FatorEmissaoRecord>) => Promise<FatorEmissaoRecord>
  upsertFator: (
    data: Partial<FatorEmissaoRecord> & { chave: string },
  ) => Promise<FatorEmissaoRecord>
  restaurarPadraoFatores: () => Promise<void>
}

const DataContext = createContext<DataContextType | undefined>(undefined)

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth()
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoRecord[]>([])
  const [faturas, setFaturas] = useState<FaturaRecord[]>([])
  const [fatores, setFatores] = useState<FatorEmissaoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const refreshFatores = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      const lista = await emissoesService.listFatores()
      setFatores(lista)
    } catch (err) {
      console.error('Erro ao recarregar fatores:', err)
    }
  }, [isAuthenticated])

  const refreshData = useCallback(async () => {
    if (!isAuthenticated) {
      setEmpreendimentos([])
      setFaturas([])
      setFatores([])
      setLoading(false)
      return
    }

    try {
      setSyncing(true)
      const [empList, fatList, fatFatores] = await Promise.all([
        empreendimentosService.list(),
        faturasService.list({ sort: '-competencia' }),
        emissoesService.listFatores(),
      ])
      setEmpreendimentos(empList)
      setFaturas(fatList)
      setFatores(fatFatores)
      setLastSync(new Date())
    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Realtime subscription
  useEffect(() => {
    if (!isAuthenticated) return

    let isMounted = true

    const unsubEmpPromise = pb.collection('empreendimentos').subscribe('*', () => {
      if (isMounted) refreshData()
    })

    const unsubFatPromise = pb.collection('faturas').subscribe('*', () => {
      if (isMounted) refreshData()
    })

    const unsubFatoresPromise = pb.collection('fatores_emissao').subscribe('*', () => {
      if (isMounted) refreshFatores()
    })

    return () => {
      isMounted = false
      unsubEmpPromise.then((unsub) => unsub())
      unsubFatPromise.then((unsub) => unsub())
      unsubFatoresPromise.then((unsub) => unsub())
    }
  }, [isAuthenticated, refreshData, refreshFatores])

  const addEmpreendimento = async (data: Partial<EmpreendimentoRecord>) => {
    const created = await empreendimentosService.create(data)
    await refreshData()
    return created
  }

  const updateEmpreendimento = async (id: string, data: Partial<EmpreendimentoRecord>) => {
    const updated = await empreendimentosService.update(id, data)
    await refreshData()
    return updated
  }

  const deleteEmpreendimento = async (id: string) => {
    const res = await empreendimentosService.delete(id)
    await refreshData()
    return res
  }

  const addFatura = async (data: Partial<FaturaRecord>) => {
    const created = await faturasService.create(data)
    await refreshData()
    return created
  }

  const updateFatura = async (id: string, data: Partial<FaturaRecord>) => {
    const updated = await faturasService.update(id, data)
    await refreshData()
    return updated
  }

  const deleteFatura = async (id: string) => {
    const res = await faturasService.delete(id)
    await refreshData()
    return res
  }

  const updateFator = async (id: string, data: Partial<FatorEmissaoRecord>) => {
    const res = await emissoesService.updateFator(id, data)
    await refreshFatores()
    return res
  }

  const upsertFator = async (data: Partial<FatorEmissaoRecord> & { chave: string }) => {
    const res = await emissoesService.upsertFator(data)
    await refreshFatores()
    return res
  }

  const restaurarPadraoFatores = async () => {
    await emissoesService.restaurarPadrao()
    await refreshFatores()
  }

  // Cálculos reativos instantâneos de emissões baseados nas faturas e fatores atuais
  const calculosEmissoes = useMemo(() => {
    return faturas.map((f) => emissoesService.calcularEmissaoFatura(f, fatores))
  }, [faturas, fatores])

  return (
    <DataContext.Provider
      value={{
        empreendimentos,
        faturas,
        fatores,
        calculosEmissoes,
        loading,
        syncing,
        lastSync,
        refreshData,
        refreshFatores,
        addEmpreendimento,
        updateEmpreendimento,
        deleteEmpreendimento,
        addFatura,
        updateFatura,
        deleteFatura,
        updateFator,
        upsertFator,
        restaurarPadraoFatores,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export const useData = () => {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useData deve ser utilizado dentro de DataProvider')
  }
  return context
}
