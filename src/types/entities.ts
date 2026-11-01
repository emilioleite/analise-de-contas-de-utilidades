export type TipoUtilidade = 'Energia Elétrica' | 'Água e Esgoto' | 'Gás'
export type TipoEmpreendimento = 'Comercial' | 'Industrial' | 'Residencial' | 'Misto'

export interface DadosEnergiaEletrica {
  medicao_anterior?: number
  medicao_atual?: number
  classificacao_consumo?: string // A1, A2, A3, A4, B1, B2, etc.
  consumo_ponta?: number
  tarifa_tusd_ponta?: number
  tarifa_te_ponta?: number
  consumo_fora_ponta?: number
  tarifa_tusd_f_ponta?: number
  tarifa_te_f_ponta?: number
  adicional_bandeira?: string // Verde, Amarela, Vermelha, etc.
  fatura_total?: number
}

export interface DadosGas {
  medicao_anterior?: number
  medicao_atual?: number
  consumo_medido?: number
  consumo_corrigido?: number
  tarifa?: number
  fatura_total?: number
}

export interface DadosAgua {
  medicao_anterior?: number
  medicao_atual?: number
  consumo_medido?: number
  tarifa?: number
  fatura_total?: number
}

export type DadosEspecificos = DadosEnergiaEletrica | DadosGas | DadosAgua

export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'inactive' | 'pending'

export interface UserRecord {
  id: string
  email: string
  name?: string
  avatar?: string
  role?: UserRole
  status?: UserStatus
  verified?: boolean
  created?: string
  updated?: string
}

export interface EmpreendimentoRecord {
  id: string
  nome: string
  cnpj: string
  endereco?: string
  tipo?: TipoEmpreendimento
  owner: string
  created: string
  updated: string
  faturas_count?: number
  utilidades?: TipoUtilidade[]
}

export interface FaturaRecord {
  id: string
  empreendimento: string
  tipo_utilidade: TipoUtilidade
  competencia: string // ISO date ex: 2024-03-01T00:00:00.000Z
  valor_total: number
  consumo?: number
  unidade_consumo?: string
  numero_fatura?: string
  cnpj_cliente?: string
  cnpj_fornecedor?: string
  cnpj_validado?: boolean
  arquivo_nome?: string | null
  vencimento?: string
  dados_especificos?: DadosEspecificos | string
  lancamento_manual?: boolean
  owner: string
  created: string
  updated: string
  expand?: {
    empreendimento?: EmpreendimentoRecord
  }
}

export type TipoFatorEmissao =
  | 'energia_mensal'
  | 'energia_fallback'
  | 'gas_natural'
  | 'agua_abastecimento'
  | 'agua_esgoto'

export interface FatorEmissaoRecord {
  id: string
  chave: string
  tipo: TipoFatorEmissao
  ano?: number
  mes?: number
  valor: number
  unidade: string
  is_oficial?: boolean
  fonte?: string
  descricao?: string
  created?: string
  updated?: string
}

export type EscopoGHG = 'Escopo 1' | 'Escopo 2' | 'Escopo 3'

export interface CalculoEmissaoFatura {
  faturaId: string
  tipoUtilidade: TipoUtilidade
  escopo: EscopoGHG
  consumoConsiderado: number // kWh para energia, m³ para água e gás
  unidadeConsumo: string
  fatorAplicado: number
  fatorUnidade: string
  isFatorOficial: boolean
  fatorDescricao: string
  emissoesTCO2e: number // toneladas de CO2 equivalente
  competencia: string
  ano: number
  mes: number
  empreendimentoId: string
}
