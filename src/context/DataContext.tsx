import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { EmpreendimentoRecord, FaturaRecord } from '@/types/entities'
import { empreendimentosService } from '@/services/empreendimentos'
import { faturasService } from '@/services/faturas'
import { useAuth } from './AuthContext'
import pb from '@/lib/pocketbase/client'

interface DataContextType {
  empreendimentos: EmpreendimentoRecord[]
  faturas: FaturaRecord[]
  loading: boolean
  syncing: boolean
  lastSync: Date | null
  refreshData: () => Promise<void>
  addEmpreendimento: (emp: Partial<EmpreendimentoRecord>) => Promise<EmpreendimentoRecord>
  updateEmpreendimento: (
    id: string,
    emp: Partial<EmpreendimentoRecord>,
  ) => Promise<EmpreendimentoRecord>
  deleteEmpreendimento: (id: string) => Promise<boolean>
  addFatura: (fat: Partial<FaturaRecord>) => Promise<FaturaRecord>
  updateFatura: (id: string, fat: Partial<FaturaRecord>) => Promise<FaturaRecord>
  deleteFatura: (id: string) => Promise<boolean>
}

const DataContext = createContext<DataContextType | undefined>(undefined)

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth()
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoRecord[]>([])
  const [faturas, setFaturas] = useState<FaturaRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const refreshData = useCallback(async () => {
    if (!isAuthenticated) {
      setEmpreendimentos([])
      setFaturas([])
      setLoading(false)
      return
    }

    try {
      setSyncing(true)
      const [empList, fatList] = await Promise.all([
        empreendimentosService.list(),
        faturasService.list({ sort: '-competencia' }),
      ])
      setEmpreendimentos(empList)
      setFaturas(fatList)
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

    return () => {
      isMounted = false
      unsubEmpPromise.then((unsub) => unsub())
      unsubFatPromise.then((unsub) => unsub())
    }
  }, [isAuthenticated, refreshData])

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

  return (
    <DataContext.Provider
      value={{
        empreendimentos,
        faturas,
        loading,
        syncing,
        lastSync,
        refreshData,
        addEmpreendimento,
        updateEmpreendimento,
        deleteEmpreendimento,
        addFatura,
        updateFatura,
        deleteFatura,
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
