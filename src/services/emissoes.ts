import pb from '@/lib/pocketbase/client'
import { FatorEmissaoRecord, FaturaRecord, CalculoEmissaoFatura, EscopoGHG } from '@/types/entities'

// Valores default de fallback definidos na metodologia
export const DEFAULT_FATORES: Record<
  string,
  { valor: number; unidade: string; is_oficial: boolean; fonte: string; descricao: string }
> = {
  energia_fallback: {
    valor: 0.05,
    unidade: 'tCO₂/MWh',
    is_oficial: false,
    fonte: 'Estimativa provisória configurável (fallback)',
    descricao: 'Fator médio provisório aplicado para meses sem publicação oficial do MCTI/SIRENE',
  },
  gas_natural: {
    valor: 2.15,
    unidade: 'kgCO₂e/m³',
    is_oficial: true,
    fonte: 'IPCC 2006 / Programa Brasileiro GHG Protocol',
    descricao: 'Combustão estacionária (Escopo 1) — PCI 38,3 MJ/m³ × FEOC 15,3 tC/TJ',
  },
  agua_abastecimento: {
    valor: 0.208,
    unidade: 'kgCO₂e/m³',
    is_oficial: false,
    fonte: 'Prática do Programa Brasileiro GHG Protocol (estimativa setorial)',
    descricao: 'Captação e distribuição de água tratada (Escopo 3)',
  },
  agua_esgoto: {
    valor: 0.7,
    unidade: 'kgCO₂e/m³',
    is_oficial: false,
    fonte: 'Prática do Programa Brasileiro GHG Protocol (estimativa setorial)',
    descricao: 'Tratamento e destinação de efluentes sanitários (Escopo 3)',
  },
}

// Fatores SIN conhecidos para restauração rápida
export const DEFAULT_SIN_MENSAIS: Array<{
  chave: string
  ano: number
  mes: number
  valor: number
  is_oficial: boolean
  fonte: string
  descricao: string
}> = [
  {
    chave: 'sin_2024_01',
    ano: 2024,
    mes: 1,
    valor: 0.0416,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Janeiro/2024 (41,6 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2024_02',
    ano: 2024,
    mes: 2,
    valor: 0.0375,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Fevereiro/2024 (37,5 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2024_03',
    ano: 2024,
    mes: 3,
    valor: 0.0278,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Março/2024 (27,8 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2024_04',
    ano: 2024,
    mes: 4,
    valor: 0.0194,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Abril/2024 (19,4 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2025_01',
    ano: 2025,
    mes: 1,
    valor: 0.0237,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Janeiro/2025 (23,7 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2025_02',
    ano: 2025,
    mes: 2,
    valor: 0.0248,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Fevereiro/2025 (24,8 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2025_03',
    ano: 2025,
    mes: 3,
    valor: 0.0215,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Março/2025 (21,5 kgCO₂/MWh)',
  },
  {
    chave: 'sin_2025_04',
    ano: 2025,
    mes: 4,
    valor: 0.0289,
    is_oficial: true,
    fonte: 'Fator médio do SIN — MCTI/SIRENE',
    descricao: 'Abril/2025 (28,9 kgCO₂/MWh)',
  },
]

export const emissoesService = {
  /**
   * Lista todos os fatores cadastrados
   */
  async listFatores(): Promise<FatorEmissaoRecord[]> {
    try {
      const records = await pb.collection('fatores_emissao').getFullList<FatorEmissaoRecord>({
        sort: 'tipo,ano,mes',
      })
      return records
    } catch (err) {
      console.error('Erro ao listar fatores de emissão:', err)
      return []
    }
  },

  /**
   * Atualiza ou insere um fator pelo `chave`
   */
  async upsertFator(
    fator: Partial<FatorEmissaoRecord> & { chave: string },
  ): Promise<FatorEmissaoRecord> {
    try {
      // Tentar encontrar pelo chave
      const existing = await pb
        .collection('fatores_emissao')
        .getFirstListItem<FatorEmissaoRecord>(`chave="${fator.chave}"`)
        .catch(() => null)
      if (existing) {
        return await pb.collection('fatores_emissao').update<FatorEmissaoRecord>(existing.id, fator)
      } else {
        return await pb.collection('fatores_emissao').create<FatorEmissaoRecord>(fator)
      }
    } catch (err) {
      console.error('Erro ao salvar fator de emissão:', err)
      throw err
    }
  },

  /**
   * Atualiza um fator por id
   */
  async updateFator(id: string, data: Partial<FatorEmissaoRecord>): Promise<FatorEmissaoRecord> {
    return await pb.collection('fatores_emissao').update<FatorEmissaoRecord>(id, data)
  },

  /**
   * Dispara verificação e atualização manual dos fatores oficiais do SIN via backend
   */
  async sincronizarFatoresSin(): Promise<{
    sucesso: boolean
    paginaAcessada?: boolean
    urlConsultada?: string
    fatoresIdentificados?: number
    registrosInseridos?: number
    registrosAtualizados?: number
    registrosIgnorados?: number
    aviso?: string
  }> {
    try {
      const res = await pb.send<{
        sucesso: boolean
        paginaAcessada?: boolean
        urlConsultada?: string
        fatoresIdentificados?: number
        registrosInseridos?: number
        registrosAtualizados?: number
        registrosIgnorados?: number
        aviso?: string
      }>('/backend/v1/emissoes/atualizar-fatores-sin', {
        method: 'POST',
      })
      return res
    } catch (err: any) {
      console.error('Erro ao sincronizar fatores SIN:', err)
      throw err
    }
  },

  /**
   * Restaura todos os fatores padrão (SIN conhecidos + fallbacks + gás + água)
   */
  async restaurarPadrao(): Promise<void> {
    // 1. Atualizar ou criar globais
    for (const [chave, dados] of Object.entries(DEFAULT_FATORES)) {
      await this.upsertFator({
        chave,
        tipo: chave as any,
        valor: dados.valor,
        unidade: dados.unidade,
        is_oficial: dados.is_oficial,
        fonte: dados.fonte,
        descricao: dados.descricao,
      })
    }

    // 2. Atualizar ou criar SIN mensais padrão
    for (const sin of DEFAULT_SIN_MENSAIS) {
      await this.upsertFator({
        chave: sin.chave,
        tipo: 'energia_mensal',
        ano: sin.ano,
        mes: sin.mes,
        valor: sin.valor,
        unidade: 'tCO₂/MWh',
        is_oficial: sin.is_oficial,
        fonte: sin.fonte,
        descricao: sin.descricao,
      })
    }
  },

  /**
   * Calcula as emissões para uma fatura com base no mapa de fatores em memória.
   * Regras estritas do GHG Protocol:
   * - Energia Elétrica -> Escopo 2, fator do mês MCTI ou fallback (tCO2/MWh).
   *   Fórmula: consumo (kWh) / 1000 * fator (tCO2/MWh).
   *   Consumo: consumo único ou (ponta + fora-ponta se grupo A).
   * - Gás Natural -> Escopo 1, fator kgCO2e/m3 (default 2,15).
   *   Fórmula: consumo_corrigido (se vazio, medido) * fator / 1000 = tCO2e.
   * - Água e Esgoto -> Escopo 3, fator composto (abastecimento + esgoto, kgCO2e/m3, default 0,908).
   *   Fórmula: consumo_medido * fator / 1000 = tCO2e.
   */
  calcularEmissaoFatura(fatura: FaturaRecord, fatores: FatorEmissaoRecord[]): CalculoEmissaoFatura {
    const dataFat = new Date(fatura.competencia)
    const ano = dataFat.getFullYear()
    const mes = dataFat.getMonth() + 1 // 1 a 12

    // Helper para extrair dados_especificos
    let de: any = fatura.dados_especificos
    if (typeof de === 'string') {
      try {
        de = JSON.parse(de)
      } catch {
        de = {}
      }
    }
    de = de || {}

    // 1. ENERGIA ELÉTRICA
    if (fatura.tipo_utilidade === 'Energia Elétrica') {
      // Consumo a usar: soma ponta+fora-ponta se existir, senão consumo da fatura
      let consumoKwh = Number(fatura.consumo) || 0
      const cPonta = Number(de.consumo_ponta) || 0
      const cForaPonta = Number(de.consumo_fora_ponta) || 0
      if (cPonta > 0 || cForaPonta > 0) {
        consumoKwh = cPonta + cForaPonta
      }

      // Procurar fator mensal específico
      const chaveMensal = `sin_${ano}_${String(mes).padStart(2, '0')}`
      const fatorMensal = fatores.find(
        (f) =>
          f.chave === chaveMensal ||
          (f.tipo === 'energia_mensal' && Number(f.ano) === ano && Number(f.mes) === mes),
      )

      // Fallback
      const fatorFallback = fatores.find(
        (f) => f.tipo === 'energia_fallback' || f.chave === 'energia_fallback',
      )
      const fallbackVal = fatorFallback
        ? Number(fatorFallback.valor)
        : DEFAULT_FATORES.energia_fallback.valor

      let fatorAplicado = fallbackVal
      let isOficial = false
      let descricao = 'Estimativa provisória (fallback anual)'

      if (fatorMensal && Number(fatorMensal.valor) > 0) {
        fatorAplicado = Number(fatorMensal.valor)
        isOficial = !!fatorMensal.is_oficial
        descricao =
          fatorMensal.fonte || (isOficial ? 'Oficial MCTI/SIRENE' : 'Fator mensal editado')
      }

      // Fórmula: kWh / 1000 * fator(tCO2/MWh) = tCO2e
      const emissoesTCO2e = (consumoKwh / 1000) * fatorAplicado

      return {
        faturaId: fatura.id,
        tipoUtilidade: 'Energia Elétrica',
        escopo: 'Escopo 2',
        consumoConsiderado: consumoKwh,
        unidadeConsumo: 'kWh',
        fatorAplicado,
        fatorUnidade: 'tCO₂/MWh',
        isFatorOficial: isOficial,
        fatorDescricao: descricao,
        emissoesTCO2e: Math.max(0, emissoesTCO2e),
        competencia: fatura.competencia,
        ano,
        mes,
        empreendimentoId: fatura.empreendimento,
      }
    }

    // 2. GÁS NATURAL
    if (fatura.tipo_utilidade === 'Gás') {
      // Consumo corrigido (m³); fallback medido
      const cCorrigido =
        de.consumo_corrigido !== undefined && de.consumo_corrigido !== null
          ? Number(de.consumo_corrigido)
          : null
      const cMedido =
        de.consumo_medido !== undefined && de.consumo_medido !== null
          ? Number(de.consumo_medido)
          : null
      let consumoM3 = Number(fatura.consumo) || 0

      if (cCorrigido !== null && !isNaN(cCorrigido) && cCorrigido > 0) {
        consumoM3 = cCorrigido
      } else if (cMedido !== null && !isNaN(cMedido) && cMedido > 0) {
        consumoM3 = cMedido
      }

      const fatorGas = fatores.find((f) => f.tipo === 'gas_natural' || f.chave === 'gas_natural')
      const fatorVal = fatorGas ? Number(fatorGas.valor) : DEFAULT_FATORES.gas_natural.valor
      const isOficial = fatorGas?.is_oficial ?? true

      // kgCO2e/m³ -> converter para tCO2e (dividir por 1000)
      const emissoesTCO2e = (consumoM3 * fatorVal) / 1000

      return {
        faturaId: fatura.id,
        tipoUtilidade: 'Gás',
        escopo: 'Escopo 1',
        consumoConsiderado: consumoM3,
        unidadeConsumo: 'm³',
        fatorAplicado: fatorVal,
        fatorUnidade: 'kgCO₂e/m³',
        isFatorOficial: isOficial,
        fatorDescricao: fatorGas?.fonte || 'IPCC 2006 / PB GHG Protocol',
        emissoesTCO2e: Math.max(0, emissoesTCO2e),
        competencia: fatura.competencia,
        ano,
        mes,
        empreendimentoId: fatura.empreendimento,
      }
    }

    // 3. ÁGUA E ESGOTO
    // Consumo medido (m³)
    const cMedido =
      de.consumo_medido !== undefined && de.consumo_medido !== null
        ? Number(de.consumo_medido)
        : null
    let consumoM3 = Number(fatura.consumo) || 0
    if (cMedido !== null && !isNaN(cMedido) && cMedido > 0) {
      consumoM3 = cMedido
    }

    const fAbast = fatores.find(
      (f) => f.tipo === 'agua_abastecimento' || f.chave === 'agua_abastecimento',
    )
    const fEsg = fatores.find((f) => f.tipo === 'agua_esgoto' || f.chave === 'agua_esgoto')

    const valAbast = fAbast ? Number(fAbast.valor) : DEFAULT_FATORES.agua_abastecimento.valor
    const valEsg = fEsg ? Number(fEsg.valor) : DEFAULT_FATORES.agua_esgoto.valor
    const fatorComposto = valAbast + valEsg

    // kgCO2e/m³ -> dividir por 1000 = tCO2e
    const emissoesTCO2e = (consumoM3 * fatorComposto) / 1000

    return {
      faturaId: fatura.id,
      tipoUtilidade: 'Água e Esgoto',
      escopo: 'Escopo 3',
      consumoConsiderado: consumoM3,
      unidadeConsumo: 'm³',
      fatorAplicado: fatorComposto,
      fatorUnidade: 'kgCO₂e/m³',
      isFatorOficial: false,
      fatorDescricao: `Composto: Abast. (${valAbast.toFixed(3)}) + Esgoto (${valEsg.toFixed(3)})`,
      emissoesTCO2e: Math.max(0, emissoesTCO2e),
      competencia: fatura.competencia,
      ano,
      mes,
      empreendimentoId: fatura.empreendimento,
    }
  },
}
