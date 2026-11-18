/**
 * Extração de faturas EM LOTE — lógica pura (sem React, sem rede).
 *
 * O motor de extração é o hook `POST /backend/v1/faturas/extract` (fatura_extract.js).
 * O contrato do endpoint NÃO muda: o lote é front-end, chamando o mesmo endpoint N
 * vezes em sequência. Este módulo cuida das decisões:
 *
 *  - leitura dos números na codificação em que a fatura os imprime (pt-BR × decimal
 *    com ponto, o caso "151.362" = 151,362 m³) e desempate por contexto;
 *  - triagem do PDF (com camada de texto × escaneado) ANTES de gastar extração;
 *  - conversão do payload da IA no rascunho revisável, com as mesmas regras que o
 *    formulário do passo 3 aplica;
 *  - alertas: estorno, conferência consumo × leituras (5%), duplicidade, lacuna de
 *    competência;
 *  - payload de gravação IDÊNTICO ao do lançamento unitário.
 *
 * Regra do negócio: mês sem fatura é LACUNA, nunca zero. Aqui isso significa que
 * nenhuma média ou consumo é inventado — ou existe fatura, ou o mês é declarado
 * ausente.
 */

import { EmpreendimentoRecord, FaturaRecord, TipoUtilidade } from '@/types/entities'
import { cleanCNPJ, formatCNPJ, isValidCNPJ, matchMaskedCNPJ, parseNumberValue } from '@/lib/cnpj'
import { calcularConsumoMedidoCoerenteAgua } from '@/lib/aguaCoerencia'

// ---------------------------------------------------------------------------
// Tipos do lote
// ---------------------------------------------------------------------------

export type LoteStatus =
  | 'aguardando'
  | 'triagem'
  | 'extraindo'
  | 'revisar'
  | 'pronta'
  | 'erro'
  | 'ignorado'
  | 'gravada'
  | 'pulada'

export type LoteAlertaNivel = 'erro' | 'atencao' | 'info'

export interface LoteAlerta {
  nivel: LoteAlertaNivel
  codigo: string
  mensagem: string
}

export interface LoteTriagem {
  paginas: number
  caracteresTexto: number
  temTexto: boolean
  escaneado: boolean
  motivo: string
}

/** Rascunho revisável de uma fatura do lote. Campos espelham o formulário do passo 3. */
export interface LoteDraft {
  empreendimentoId: string
  tipo: TipoUtilidade
  competencia: string // MM/AAAA
  valorTotal: string // texto pt-BR, como o formulário recebe
  consumo: string
  unidadeConsumo: string
  numeroFatura: string
  cnpjCliente: string
  cnpjFornecedor: string
  vencimento: string
  identificacao: string
  tipoFaturaEnergia: 'concessionaria' | 'mercado_livre'
  classificacaoConsumo: string
  medicaoAnterior: string
  medicaoAtual: string
  consumoMedido: string
  consumoCorrigido: string
  tarifa: string
  consumoPonta: string
  tarifaTusdPonta: string
  tarifaTePonta: string
  consumoForaPonta: string
  tarifaTusdFPonta: string
  tarifaTeFPonta: string
  adicionalBandeira: string
  /** Fatura de estorno/crédito: Total R$ 0,00 por devolução. Gravada, mas fora do custo/média. */
  estorno: boolean
  /** Valor de fornecimento impresso quando o total é 0,00 (contexto do estorno). */
  valorFornecimento?: number
  /** Observações da extração (ambiguidade de escala, coerência de leitura etc.). */
  avisosExtracao: string[]
  /** Payload bruto do endpoint, preservado para auditoria. */
  bruto?: any
}

export interface LoteArquivo {
  id: string
  file: File
  nome: string
  caminho: string
  tamanho: number
  status: LoteStatus
  triagem?: LoteTriagem
  erro?: string
  statusExtracao?: string
  draft?: LoteDraft
  alertas: LoteAlerta[]
  /** Já existe fatura igual no banco (empreendimento + utilidade + competência). */
  duplicadaExistente?: { id: string; competencia: string } | null
  /** Incluir na gravação em bloco. */
  incluir: boolean
}

// ---------------------------------------------------------------------------
// Números: a codificação em que a fatura imprime
// ---------------------------------------------------------------------------

export interface LeituraNumerica {
  valor: number | null
  /** Leitura alternativa quando o ponto é ambíguo (decimal × milhar). */
  alternativa: number | null
  /** O texto tinha forma ambígua (ex.: "151.362" pode ser 151.362 ou 151362). */
  ambiguo: boolean
  /** Como foi interpretado, para exibir ao usuário. */
  interpretacao: string
  /** De onde veio a decisão quando houve ambiguidade. */
  resolvidoPor?: 'leitura' | 'referencia' | 'padrao'
}

/**
 * Lê o CONSUMO de uma fatura.
 *
 * O ponto é o caso perigoso: em pt-BR ele é milhar ("1.280" = 1280, convenção que o
 * próprio formulário usa ao escrever o input), mas a fatura de gás imprime o consumo
 * corrigido como decimal com ponto ("151.362" = 151,362 m³). Estruturalmente os dois
 * textos são idênticos — só o contexto separa. Por isso esta função devolve também a
 * leitura alternativa, e `resolverConsumo` decide com as leituras do medidor e o
 * histórico do empreendimento.
 *
 * Regras de forma:
 *  - número JSON (151.362): é float → 151,362.
 *  - string com vírgula: padrão pt-BR completo.
 *  - string com PONTO e dois ou mais grupos de milhar ("1.234.567"): milhar.
 *  - string com PONTO e exatamente um grupo de 3 dígitos ("151.362", "1.280"): AMBÍGUO,
 *    com as duas leituras preenchidas para o contexto decidir.
 *  - string com ponto e 1–2 casas ("151.36"): decimal.
 */
export function lerConsumoFatura(raw: any): LeituraNumerica {
  if (raw === undefined || raw === null || raw === '') {
    return { valor: null, alternativa: null, ambiguo: false, interpretacao: 'vazio' }
  }
  if (typeof raw === 'number') {
    if (isNaN(raw) || raw < 0)
      return { valor: null, alternativa: null, ambiguo: false, interpretacao: 'inválido' }
    const casas = String(raw).split('.')[1]
    if (casas && casas.length === 3) {
      return {
        valor: raw,
        alternativa: Math.round(raw * 1000),
        ambiguo: true,
        interpretacao: `número ${raw} com 3 casas — decimal (alternativa: ${Math.round(
          raw * 1000,
        ).toLocaleString('pt-BR')})`,
      }
    }
    return { valor: raw, alternativa: null, ambiguo: false, interpretacao: String(raw) }
  }

  let s = String(raw)
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\*/g, '')
  if (!s) return { valor: null, alternativa: null, ambiguo: false, interpretacao: 'vazio' }
  if (/^-/.test(s))
    return { valor: null, alternativa: null, ambiguo: false, interpretacao: 'negativo' }

  if (s.includes(',') && s.includes('.')) {
    const valor = Number(s.replace(/\./g, '').replace(',', '.'))
    return {
      valor: isNaN(valor) ? null : valor,
      alternativa: null,
      ambiguo: false,
      interpretacao: 'pt-BR (milhar + vírgula decimal)',
    }
  }

  if (s.includes(',')) {
    const valor = parseNumberValue(s)
    return {
      valor: valor ?? null,
      alternativa: null,
      ambiguo: false,
      interpretacao: 'pt-BR (vírgula decimal)',
    }
  }

  if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    const valor = Number(s.replace(/\./g, ''))
    return {
      valor: Number.isNaN(valor) ? null : valor,
      alternativa: null,
      ambiguo: false,
      interpretacao: 'milhar pt-BR (dois ou mais grupos)',
    }
  }

  if (/^\d{1,3}\.\d{3}$/.test(s)) {
    const dec = Number(s)
    const mil = Number(s.replace(/\./g, ''))
    return {
      valor: Number.isNaN(dec) ? null : dec,
      alternativa: Number.isNaN(mil) ? null : mil,
      ambiguo: true,
      interpretacao: `ponto ambíguo — decimal ${dec.toLocaleString('pt-BR', {
        maximumFractionDigits: 3,
      })} ou milhar ${mil.toLocaleString('pt-BR')}`,
    }
  }

  if (/^\d+\.\d{1,6}$/.test(s)) {
    const valor = Number(s)
    return {
      valor: Number.isNaN(valor) ? null : valor,
      alternativa: null,
      ambiguo: false,
      interpretacao: 'decimal',
    }
  }

  if (/^\d+$/.test(s)) {
    return { valor: Number(s), alternativa: null, ambiguo: false, interpretacao: 'inteiro' }
  }

  const valor = parseNumberValue(s)
  return { valor: valor ?? null, alternativa: null, ambiguo: false, interpretacao: 'genérico' }
}

export interface ContextoConsumo {
  /** consumo implícito nas leituras (atual − anterior), quando disponíveis e coerentes. */
  diffLeituras?: number | null
  /** consumo típico do empreendimento para esta utilidade (mediana do histórico). */
  consumoReferencia?: number | null
}

const TOLERANCIA_AMBIGUIDADE = 0.05

/**
 * Desempata a leitura do consumo quando o ponto é ambíguo, nesta ordem:
 *  1. as leituras do medidor (atual − anterior), se baterem com um dos candidatos
 *     em até 5%;
 *  2. o consumo típico daquele empreendimento/utilidade;
 *  3. sem contexto, fica o DECIMAL e a linha vai para revisão com alerta — a decisão
 *     de 1000× nunca é tomada em silêncio.
 */
export function resolverConsumo(
  leitura: LeituraNumerica,
  ctx: ContextoConsumo = {},
): LeituraNumerica {
  if (!leitura.ambiguo || leitura.valor === null || leitura.alternativa === null) return leitura

  const candidatos: Array<{ v: number; nome: string }> = [
    { v: leitura.valor, nome: 'decimal' },
    { v: leitura.alternativa, nome: 'milhar' },
  ]

  const bate = (cand: number, ref: number) =>
    ref > 0 && Math.abs(cand - ref) / Math.max(ref, 1e-9) <= TOLERANCIA_AMBIGUIDADE

  if (ctx.diffLeituras !== undefined && ctx.diffLeituras !== null && ctx.diffLeituras > 0) {
    const escolhido = candidatos.find((c) => bate(c.v, ctx.diffLeituras!))
    if (escolhido) {
      return {
        ...leitura,
        valor: escolhido.v,
        resolvidoPor: 'leitura',
        interpretacao: `${escolhido.nome} confirmado pelas leituras (${ctx.diffLeituras.toLocaleString(
          'pt-BR',
        )} m³)`,
      }
    }
  }

  if (
    ctx.consumoReferencia !== undefined &&
    ctx.consumoReferencia !== null &&
    ctx.consumoReferencia > 0
  ) {
    const escolhido = candidatos.find((c) => bate(c.v, ctx.consumoReferencia!))
    if (escolhido) {
      return {
        ...leitura,
        valor: escolhido.v,
        resolvidoPor: 'referencia',
        interpretacao: `${escolhido.nome} coerente com o consumo típico (${ctx.consumoReferencia.toLocaleString(
          'pt-BR',
        )} m³)`,
      }
    }
  }

  return {
    ...leitura,
    valor: leitura.valor,
    resolvidoPor: 'padrao',
    interpretacao: `ponto ambíguo sem confirmação — lido como decimal ${leitura.valor.toLocaleString(
      'pt-BR',
      { maximumFractionDigits: 3 },
    )} (milhar seria ${leitura.alternativa.toLocaleString('pt-BR')}). Confira.`,
  }
}

/** Mediana de uma lista de números (ignora vazios). null se não houver dado. */
export function mediana(valores: number[]): number | null {
  const validos = valores.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (validos.length === 0) return null
  const meio = Math.floor(validos.length / 2)
  return validos.length % 2 === 0 ? (validos[meio - 1] + validos[meio]) / 2 : validos[meio]
}

/**
 * Leitura de medidor cumulativo (gás e água): o ponto é SEMPRE milhar.
 * "117.047" → 117047. Um float JSON 117.047 vindo do modelo é o mesmo inteiro.
 */
export function lerMedicaoCumulativa(raw: any): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'number') {
    if (isNaN(raw) || raw <= 0) return null
    const s = String(raw)
    const partes = s.split('.')
    if (partes.length === 2 && partes[1].length === 3) return Math.round(raw * 1000)
    return Math.round(raw)
  }
  const s = String(raw).trim()
  if (!s) return null
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    const n = Number(s.replace(/\./g, ''))
    return Number.isNaN(n) || n <= 0 ? null : n
  }
  if (s.includes(',') && !s.includes('.')) {
    const p = s.split(',')
    if (p.length === 2 && p[1].length === 3) {
      const n = Number(p[0] + p[1])
      if (!Number.isNaN(n) && n > 0) return n
    }
  }
  const n = Number(s.replace(/[^0-9]/g, ''))
  return Number.isNaN(n) || n <= 0 ? null : n
}

/** Número monetário / tarifa em pt-BR, preservando zero. */
export function lerNumeroFatura(raw: any): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  const v = parseNumberValue(String(raw))
  return v === undefined ? null : v
}

/** Formata em pt-BR para o input do formulário (o formulário lê esse padrão de volta). */
export function paraInputPtBr(valor: number | null | undefined, casas = 3): string {
  if (valor === undefined || valor === null || Number.isNaN(valor)) return ''
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })
}

// ---------------------------------------------------------------------------
// Competência
// ---------------------------------------------------------------------------

/** 'MM/AAAA' → 'AAAA-MM'. null se inválida. */
export function competenciaParaChave(comp: string | undefined | null): string | null {
  if (!comp) return null
  const s = String(comp).trim()
  const mMm = /^(\d{1,2})\/(\d{4})$/.exec(s)
  if (mMm) {
    const mes = Number(mMm[1])
    if (mes < 1 || mes > 12) return null
    return `${mMm[2]}-${String(mes).padStart(2, '0')}`
  }
  const mYmd = /^(\d{4})-(\d{2})/.exec(s)
  if (mYmd) {
    const mes = Number(mYmd[2])
    if (mes < 1 || mes > 12) return null
    return `${mYmd[1]}-${mYmd[2]}`
  }
  return null
}

/** 'AAAA-MM' → 'MM/AAAA'. */
export function chaveParaCompetencia(chave: string): string {
  const [ano, mes] = chave.split('-')
  return `${mes}/${ano}`
}

/** Numera o mês para ordenar/comparar (ano*12+mês). */
export function indiceCompetencia(comp: string | undefined | null): number | null {
  const k = competenciaParaChave(comp)
  if (!k) return null
  const [ano, mes] = k.split('-').map(Number)
  return ano * 12 + (mes - 1)
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function rotuloCompetencia(comp: string | undefined | null): string {
  const k = competenciaParaChave(comp)
  if (!k) return comp ? String(comp) : '—'
  const [ano, mes] = k.split('-').map(Number)
  return `${MESES[mes - 1]}/${ano}`
}

/** Competências entre duas (inclusive), em ordem. Vazio se invertido. */
export function mesesEntre(inicio: string, fim: string): string[] {
  const i = indiceCompetencia(inicio)
  const f = indiceCompetencia(fim)
  if (i === null || f === null || i > f || f - i > 240) return []
  const out: string[] = []
  for (let k = i; k <= f; k++) {
    const ano = Math.floor(k / 12)
    const mes = (k % 12) + 1
    out.push(`${ano}-${String(mes).padStart(2, '0')}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Chave de identidade da fatura (para duplicidade e lacuna)
// ---------------------------------------------------------------------------

/**
 * Identidade lógica de uma fatura: empreendimento + utilidade + competência (+
 * identificação, que separa duas faturas de gás do mesmo mês — ex.: caldeira e cozinha).
 */
export function chaveIdentidade(params: {
  empreendimentoId: string
  tipo: TipoUtilidade
  competencia: string
  identificacao?: string
}): string | null {
  const k = competenciaParaChave(params.competencia)
  if (!k || !params.empreendimentoId) return null
  const ident = (params.identificacao || '').trim().toLowerCase()
  return `${params.empreendimentoId}||${params.tipo}||${k}||${ident}`
}

// ---------------------------------------------------------------------------
// Triagem do PDF (antes de gastar extração)
// ---------------------------------------------------------------------------

/** Uma camada de texto serve para a extração? (espelha o isQualityText do hook) */
export function textoPdfAproveitavel(texto: string): boolean {
  if (!texto) return false
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (limpo.length < 200) return false
  const letras = (limpo.match(/[A-Za-zÀ-ÿ]/g) || []).length
  if (letras < 80) return false
  const uteis = (limpo.match(/[\wÀ-ÿ.,:/\-R$%()]/g) || []).length
  return uteis / limpo.length > 0.6
}

/** Triagem já pronta a partir do texto extraído no navegador. */
export function montarTriagem(params: { paginas: number; texto: string }): LoteTriagem {
  const temTexto = textoPdfAproveitavel(params.texto)
  return {
    paginas: params.paginas,
    caracteresTexto: params.texto ? params.texto.length : 0,
    temTexto,
    escaneado: !temTexto,
    motivo: temTexto
      ? 'PDF com camada de texto — leitura por texto + imagens'
      : 'PDF sem camada de texto útil (escaneado) — leitura por imagens (visão)',
  }
}

// ---------------------------------------------------------------------------
// Payload da IA → rascunho revisável
// ---------------------------------------------------------------------------

function primeiroDefinido(d: any, chaves: string[]): any {
  for (const k of chaves) {
    if (d && d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k]
  }
  const subs = [
    d?.dados_especificos,
    d?.dadosEspecificos,
    d?.dados,
    d?.especificos,
    d?.gas,
    d?.agua,
    d?.energia,
  ]
  for (const sub of subs) {
    if (sub && typeof sub === 'object') {
      for (const k of chaves) {
        if (sub[k] !== undefined && sub[k] !== null && sub[k] !== '') return sub[k]
      }
    }
  }
  return undefined
}

function textoLimpo(v: any): string {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  if (!s || s === 'null' || s === 'undefined' || s === '0') return ''
  return s
}

export function detectarTipoUtilidade(payload: any, tipoSolicitado?: TipoUtilidade): TipoUtilidade {
  const bruto = primeiroDefinido(payload, ['tipo_utilidade', 'tipoUtilidade', 'tipo', 'utilidade'])
  const s = String(bruto || '').toLowerCase()
  if (/g[áa]s|comg[áa]s|naturgy|glp/.test(s)) return 'Gás'
  if (/[áa]gua|esgoto|sabesp/.test(s)) return 'Água e Esgoto'
  if (/energia|enel|el[ée]tric|kwh|cemig|light|cpfl/.test(s)) return 'Energia Elétrica'
  return tipoSolicitado || 'Energia Elétrica'
}

export interface ContextoDraft {
  empreendimentos: EmpreendimentoRecord[]
  tipoSolicitado?: TipoUtilidade
  /** Consumo típico do empreendimento/utilidade, para desempatar ponto ambíguo. */
  consumoReferencia?: number | null
}

/**
 * Converte o payload do endpoint no rascunho revisável.
 * Mesmas decisões do formulário do passo 3, com três diferenças deliberadas:
 *  1. nada é escrito em estado de React — devolve um objeto;
 *  2. o consumo passa por `lerConsumoFatura` + `resolverConsumo`, que resolvem o ponto
 *     decimal do consumo corrigido (151.362 = 151,362 m³) com as leituras do medidor
 *     e o histórico, e marcam quando houve ambiguidade;
 *  3. o estorno (Total R$ 0,00 com devolução) é identificado e marcado, para sair do
 *     custo e da média sem sair do histórico.
 */
export function montarDraft(payload: any, ctx: ContextoDraft): LoteDraft {
  let d: any = payload?.dados && typeof payload.dados === 'object' ? payload.dados : payload || {}
  if (d.dados && typeof d.dados === 'object') d = { ...d.dados, ...d }
  if (d.data && typeof d.data === 'object') d = { ...d.data, ...d }

  const tipo = detectarTipoUtilidade(d, ctx.tipoSolicitado)
  const avisos: string[] = []

  // Competência — aceita MM/AAAA, AAAA-MM, AAAA-MM-DD e data ISO
  let competencia = ''
  const compFmt = primeiroDefinido(d, [
    'competencia_formatada',
    'competenciaFormatada',
    'mes_ano',
    'referencia',
  ])
  const compRaw = primeiroDefinido(d, ['competencia', 'periodo', 'mes_referencia'])
  const candidatos = [compFmt, compRaw].filter(Boolean).map((v) => String(v).trim())
  for (const c of candidatos) {
    if (/^\d{1,2}\/\d{4}$/.test(c)) {
      competencia = c
      break
    }
    const mMesAno = /^(\d{1,2})[-/](\d{4})$/.exec(c)
    if (mMesAno) {
      competencia = `${mMesAno[1].padStart(2, '0')}/${mMesAno[2]}`
      break
    }
    const mBr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c)
    if (mBr) {
      competencia = `${mBr[2]}/${mBr[3]}`
      break
    }
    const mIso = /^(\d{4})-(\d{2})(-\d{2})?/.exec(c)
    if (mIso && !c.includes('1900')) {
      competencia = `${mIso[2]}/${mIso[1]}`
      break
    }
  }

  // Valor total — 0,00 é legítimo (estorno)
  const valorBruto = primeiroDefinido(d, [
    'valor_total',
    'valorTotal',
    'fatura_total',
    'faturaTotal',
    'total',
    'valor_a_pagar',
    'valorAPagar',
    'total_a_pagar',
  ])
  const valorFornecimentoBruto = primeiroDefinido(d, [
    'valor_fornecimento',
    'valorFornecimento',
    'fornecimento_gas',
    'fornecimentoGas',
    'subtotal',
  ])
  const valorTotalNum = lerNumeroFatura(valorBruto)
  const valorFornecimentoNum = lerNumeroFatura(valorFornecimentoBruto)

  // Medições ANTES do consumo: a diferença entre elas desempata o ponto ambíguo
  const medAnteriorRaw = primeiroDefinido(d, [
    'medicao_anterior',
    'medicaoAnterior',
    'leitura_anterior',
  ])
  const medAtualRaw = primeiroDefinido(d, ['medicao_atual', 'medicaoAtual', 'leitura_atual'])
  const cumulativo = tipo === 'Gás' || tipo === 'Água e Esgoto'
  const medAnterior = cumulativo
    ? lerMedicaoCumulativa(medAnteriorRaw)
    : lerNumeroFatura(medAnteriorRaw)
  const medAtual = cumulativo ? lerMedicaoCumulativa(medAtualRaw) : lerNumeroFatura(medAtualRaw)
  const diffLeituras =
    medAnterior !== null && medAtual !== null && medAtual > medAnterior
      ? medAtual - medAnterior
      : null

  const contexto: ContextoConsumo = {
    diffLeituras,
    consumoReferencia: ctx.consumoReferencia ?? null,
  }

  const corrigidoRaw = primeiroDefinido(d, [
    'consumo_corrigido',
    'consumoCorrigido',
    'consumo_faturado',
    'consumoFaturado',
  ])
  const leituraCorrigido = resolverConsumo(lerConsumoFatura(corrigidoRaw), contexto)

  const consumoBruto =
    corrigidoRaw !== undefined && corrigidoRaw !== null && corrigidoRaw !== ''
      ? corrigidoRaw
      : primeiroDefinido(d, [
          'consumo',
          'consumo_total',
          'consumoTotal',
          'consumo_medido',
          'consumoMedido',
          'consumo_apurado',
          'kwh',
          'volume',
        ])
  const leituraConsumo = resolverConsumo(lerConsumoFatura(consumoBruto), contexto)

  if (leituraConsumo.ambiguo) {
    avisos.push(`Consumo veio como "${String(consumoBruto)}": ${leituraConsumo.interpretacao}.`)
  }
  if (leituraCorrigido.ambiguo && corrigidoRaw !== undefined && corrigidoRaw !== consumoBruto) {
    avisos.push(
      `Consumo Corrigido veio como "${String(corrigidoRaw)}": ${leituraCorrigido.interpretacao}.`,
    )
  }

  const medidoRaw = primeiroDefinido(d, ['consumo_medido', 'consumoMedido', 'consumo_apurado'])
  const leituraMedido = resolverConsumo(lerConsumoFatura(medidoRaw), contexto)

  // CNPJs
  const cnpjClienteRaw = textoLimpo(
    primeiroDefinido(d, ['cnpj_cliente', 'cnpjCliente', 'cnpj_titular', 'cnpj']),
  )
  const cnpjFornecedorRaw = textoLimpo(
    primeiroDefinido(d, [
      'cnpj_fornecedor',
      'cnpjFornecedor',
      'cnpj_concessionaria',
      'cnpj_emitente',
    ]),
  )

  // Vencimento
  let vencimento = ''
  const vencRaw = textoLimpo(
    primeiroDefinido(d, ['vencimento', 'data_vencimento', 'dataVencimento']),
  )
  const mVenc = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(vencRaw)
  if (mVenc) vencimento = `${mVenc[3]}-${mVenc[2]}-${mVenc[1]}`
  else if (/^\d{4}-\d{2}-\d{2}/.test(vencRaw)) vencimento = vencRaw.substring(0, 10)

  // Energia
  const classificacao = textoLimpo(
    primeiroDefinido(d, ['classificacao_consumo', 'classificacaoConsumo', 'classe', 'subgrupo']),
  )
  const consumoPonta = lerNumeroFatura(primeiroDefinido(d, ['consumo_ponta', 'consumoPonta']))
  const consumoForaPonta = lerNumeroFatura(
    primeiroDefinido(d, ['consumo_fora_ponta', 'consumoForaPonta', 'consumo_f_ponta']),
  )
  const tarifaTusdPonta = lerNumeroFatura(
    primeiroDefinido(d, ['tarifa_tusd_ponta', 'tarifaTusdPonta', 'tusd']),
  )
  const tarifaTePonta = lerNumeroFatura(
    primeiroDefinido(d, ['tarifa_te_ponta', 'tarifaTePonta', 'te']),
  )
  const tarifaTusdFPonta = lerNumeroFatura(
    primeiroDefinido(d, ['tarifa_tusd_f_ponta', 'tarifaTusdFPonta']),
  )
  const tarifaTeFPonta = lerNumeroFatura(
    primeiroDefinido(d, ['tarifa_te_f_ponta', 'tarifaTeFPonta']),
  )
  const bandeira = textoLimpo(
    primeiroDefinido(d, ['adicional_bandeira', 'adicionalBandeira', 'bandeira']),
  )
  const tipoEnergiaBruto = String(
    primeiroDefinido(d, ['tipo_fatura_energia', 'tipoFaturaEnergia']) || '',
  ).toLowerCase()
  const tipoFaturaEnergia: 'concessionaria' | 'mercado_livre' =
    tipoEnergiaBruto.includes('mercado') || tipoEnergiaBruto.includes('livre')
      ? 'mercado_livre'
      : 'concessionaria'

  // Tarifa
  let tarifa = lerNumeroFatura(
    primeiroDefinido(d, ['tarifa', 'tarifa_aplicada', 'tarifaAplicada', 'tarifa_com_icms']),
  )
  if (
    tarifa === null &&
    valorTotalNum !== null &&
    valorTotalNum > 0 &&
    leituraConsumo.valor &&
    leituraConsumo.valor > 0
  ) {
    tarifa = Number((valorTotalNum / leituraConsumo.valor).toFixed(6))
  }

  // Identificação (gás: destino/medidor)
  const identificacao = textoLimpo(
    primeiroDefinido(d, ['identificacao', 'destino', 'medidor', 'ponto_consumo']),
  )

  // Estorno: total 0,00 com devolução/crédito expresso, ou fornecimento > 0 compensado
  const textoCompleto = JSON.stringify(d).toLowerCase()
  const temDevolucao = /devolu|estorno|cr[eé]dito|compensa|saldo\s+credor/.test(textoCompleto)
  const estorno =
    valorTotalNum !== null &&
    valorTotalNum === 0 &&
    (temDevolucao || (valorFornecimentoNum !== null && valorFornecimentoNum > 0))
  if (estorno) {
    avisos.push(
      `Fatura de ESTORNO: Total R$ 0,00${
        valorFornecimentoNum && valorFornecimentoNum > 0
          ? ` com fornecimento de R$ ${valorFornecimentoNum.toLocaleString('pt-BR', {
              minimumFractionDigits: 2,
            })} devolvido`
          : ' por devolução/crédito'
      }. Gravada no histórico e fora do custo e da média.`,
    )
  }

  // Empreendimento: CNPJ completo exato > CNPJ mascarado (única correspondência)
  let empreendimentoId = ''
  const cnpjClienteDigitos = cleanCNPJ(cnpjClienteRaw || '')
  if (cnpjClienteDigitos.length === 14 && isValidCNPJ(cnpjClienteDigitos)) {
    const exato = ctx.empreendimentos.filter((e) => cleanCNPJ(e.cnpj || '') === cnpjClienteDigitos)
    if (exato.length === 1) empreendimentoId = exato[0].id
  } else if (cnpjClienteRaw.includes('*')) {
    const porMascara = ctx.empreendimentos.filter((e) =>
      matchMaskedCNPJ(cnpjClienteRaw, e.cnpj || ''),
    )
    if (porMascara.length === 1) empreendimentoId = porMascara[0].id
  }

  const unidade = tipo === 'Energia Elétrica' ? 'kWh' : 'm³'

  return {
    empreendimentoId,
    tipo,
    competencia,
    valorTotal: valorTotalNum === null ? '' : paraInputPtBr(valorTotalNum, 2),
    consumo: leituraConsumo.valor === null ? '' : paraInputPtBr(leituraConsumo.valor, 3),
    unidadeConsumo: unidade,
    numeroFatura: textoLimpo(
      primeiroDefinido(d, ['numero_fatura', 'numeroFatura', 'numero_nota', 'nota_fiscal', 'nf']),
    ),
    cnpjCliente: cnpjClienteRaw,
    cnpjFornecedor: cnpjFornecedorRaw,
    vencimento,
    identificacao,
    tipoFaturaEnergia,
    classificacaoConsumo: classificacao || (tipo === 'Energia Elétrica' ? 'A4' : ''),
    medicaoAnterior: medAnterior === null ? '' : String(medAnterior),
    medicaoAtual: medAtual === null ? '' : String(medAtual),
    consumoMedido: leituraMedido.valor === null ? '' : paraInputPtBr(leituraMedido.valor, 3),
    consumoCorrigido:
      leituraCorrigido.valor === null ? '' : paraInputPtBr(leituraCorrigido.valor, 3),
    tarifa: tarifa === null ? '' : paraInputPtBr(tarifa, 6),
    consumoPonta: consumoPonta === null ? '' : paraInputPtBr(consumoPonta, 3),
    tarifaTusdPonta: tarifaTusdPonta === null ? '' : paraInputPtBr(tarifaTusdPonta, 6),
    tarifaTePonta: tarifaTePonta === null ? '' : paraInputPtBr(tarifaTePonta, 6),
    consumoForaPonta: consumoForaPonta === null ? '' : paraInputPtBr(consumoForaPonta, 3),
    tarifaTusdFPonta: tarifaTusdFPonta === null ? '' : paraInputPtBr(tarifaTusdFPonta, 6),
    tarifaTeFPonta: tarifaTeFPonta === null ? '' : paraInputPtBr(tarifaTeFPonta, 6),
    adicionalBandeira: bandeira || 'Bandeira Verde',
    estorno,
    valorFornecimento: valorFornecimentoNum === null ? undefined : valorFornecimentoNum,
    avisosExtracao: avisos,
    bruto: d,
  }
}

// ---------------------------------------------------------------------------
// Alertas de revisão
// ---------------------------------------------------------------------------

export const LIMIAR_CONFERENCIA_LEITURA_PCT = 5

/**
 * Alertas de uma linha do lote.
 *  - consumo × (leitura atual − anterior): alerta acima de 5%;
 *  - dados que impedem gravar (sem empreendimento, sem competência, sem valor);
 *  - estorno (informativo);
 *  - lacuna de competência (nível do lote, ver `calcularLacunas`).
 */
export function avaliarAlertasDraft(draft: LoteDraft): LoteAlerta[] {
  const alertas: LoteAlerta[] = []
  const consumo = parseNumberValue(draft.consumo)
  const valor = parseNumberValue(draft.valorTotal)

  if (!draft.competencia || !competenciaParaChave(draft.competencia)) {
    alertas.push({
      nivel: 'erro',
      codigo: 'sem_competencia',
      mensagem: 'Competência não identificada — preencha MM/AAAA.',
    })
  }
  if (!draft.empreendimentoId) {
    alertas.push({
      nivel: 'erro',
      codigo: 'sem_empreendimento',
      mensagem: 'Empreendimento não vinculado — escolha o empreendimento para gravar.',
    })
  }
  if ((draft.valorTotal || '').trim() === '' || valor === undefined || Number.isNaN(valor)) {
    alertas.push({
      nivel: 'erro',
      codigo: 'sem_valor',
      mensagem: 'Valor total não identificado — informe (0,00 é válido para estorno).',
    })
  }
  if (consumo === undefined || consumo === null) {
    alertas.push({
      nivel: 'atencao',
      codigo: 'sem_consumo',
      mensagem:
        'Consumo não identificado — a fatura entra sem consumo (fica em branco; não é zero).',
    })
  }

  // Conferência das leituras: consumo deve fechar com (atual − anterior)
  const ant = lerMedicaoCumulativa(draft.medicaoAnterior)
  const atu = lerMedicaoCumulativa(draft.medicaoAtual)
  if (ant !== null && atu !== null) {
    const diff = atu - ant
    if (diff <= 0) {
      alertas.push({
        nivel: 'atencao',
        codigo: 'leitura_invertida',
        mensagem: `Leitura atual (${atu.toLocaleString(
          'pt-BR',
        )}) não é maior que a anterior (${ant.toLocaleString('pt-BR')}). Confira as medições na fatura.`,
      })
    } else if (consumo !== undefined && consumo !== null && consumo > 0) {
      const desvio = (Math.abs(diff - consumo) / consumo) * 100
      if (desvio > LIMIAR_CONFERENCIA_LEITURA_PCT) {
        alertas.push({
          nivel: 'atencao',
          codigo: 'leitura_divergente',
          mensagem: `Consumo (${consumo.toLocaleString(
            'pt-BR',
          )}) difere ${desvio.toFixed(1)}% da diferença das leituras (${diff.toLocaleString(
            'pt-BR',
          )} = ${atu.toLocaleString('pt-BR')} − ${ant.toLocaleString(
            'pt-BR',
          )}). Acima de ${LIMIAR_CONFERENCIA_LEITURA_PCT}% exige conferência.`,
        })
      }
    }
  }

  if (draft.estorno) {
    alertas.push({
      nivel: 'info',
      codigo: 'estorno',
      mensagem:
        'Estorno: Total R$ 0,00 por devolução — entra no histórico, fora do custo e da média.',
    })
  }

  draft.avisosExtracao.forEach((a) => {
    alertas.push({ nivel: 'atencao', codigo: 'extracao', mensagem: a })
  })

  return alertas
}

// ---------------------------------------------------------------------------
// Duplicidade e lacunas
// ---------------------------------------------------------------------------

export interface ResultadoDuplicidade {
  dentroDoLote: LoteArquivo[]
  noBanco: FaturaRecord[]
}

/** Duplicidade do lote contra o próprio lote e contra as faturas já carregadas. */
export function detectarDuplicidades(
  arquivo: LoteArquivo,
  todos: LoteArquivo[],
  faturas: FaturaRecord[],
): ResultadoDuplicidade {
  const draft = arquivo.draft
  if (!draft || !draft.empreendimentoId) return { dentroDoLote: [], noBanco: [] }
  const chave = chaveIdentidade({
    empreendimentoId: draft.empreendimentoId,
    tipo: draft.tipo,
    competencia: draft.competencia,
    identificacao: draft.tipo === 'Gás' ? draft.identificacao : '',
  })

  const dentroDoLote = chave
    ? todos.filter((a) => {
        if (a.id === arquivo.id || !a.draft) return false
        return (
          chaveIdentidade({
            empreendimentoId: a.draft.empreendimentoId,
            tipo: a.draft.tipo,
            competencia: a.draft.competencia,
            identificacao: a.draft.tipo === 'Gás' ? a.draft.identificacao : '',
          }) === chave
        )
      })
    : []

  const compChave = competenciaParaChave(draft.competencia)
  const noBanco = compChave
    ? faturas.filter((f) => {
        if (f.empreendimento !== draft.empreendimentoId) return false
        if (f.tipo_utilidade !== draft.tipo) return false
        const k = (f.competencia || '').substring(0, 7)
        if (k !== compChave) return false
        if (draft.tipo === 'Gás') {
          const ident = (f.identificacao || '').trim().toLowerCase()
          if (ident !== (draft.identificacao || '').trim().toLowerCase()) return false
        }
        return true
      })
    : []

  return { dentroDoLote, noBanco }
}

export interface Lacuna {
  empreendimentoId: string
  tipo: TipoUtilidade
  competencia: string
  chave: string
}

/**
 * Lacunas de competência: meses SEM fatura entre a primeira e a última competência
 * do lote, por empreendimento + utilidade. Mês sem fatura é lacuna — nunca zero.
 */
export function calcularLacunas(arquivos: LoteArquivo[], faturas: FaturaRecord[]): Lacuna[] {
  const grupos = new Map<string, { emp: string; tipo: TipoUtilidade; chaves: Set<string> }>()

  const registrar = (emp: string, tipo: TipoUtilidade, competencia: string) => {
    const chave = competenciaParaChave(competencia)
    if (!chave || !emp) return
    const g = grupos.get(`${emp}||${tipo}`) || { emp, tipo, chaves: new Set<string>() }
    g.chaves.add(chave)
    grupos.set(`${emp}||${tipo}`, g)
  }

  arquivos.forEach((a) => {
    if (!a.draft || a.status === 'erro' || a.status === 'ignorado') return
    registrar(a.draft.empreendimentoId, a.draft.tipo, a.draft.competencia)
  })
  faturas.forEach((f) => {
    registrar(f.empreendimento, f.tipo_utilidade, (f.competencia || '').substring(0, 7))
  })

  const lacunas: Lacuna[] = []
  grupos.forEach((g) => {
    if (!g.emp || g.chaves.size < 2) return
    const ordenadas = Array.from(g.chaves).sort()
    const intervalo = mesesEntre(ordenadas[0], ordenadas[ordenadas.length - 1])
    intervalo.forEach((k) => {
      if (!g.chaves.has(k)) {
        lacunas.push({
          empreendimentoId: g.emp,
          tipo: g.tipo,
          competencia: chaveParaCompetencia(k),
          chave: k,
        })
      }
    })
  })
  return lacunas.sort((a, b) => a.chave.localeCompare(b.chave))
}

// ---------------------------------------------------------------------------
// Gravação: payload idêntico ao do lançamento unitário
// ---------------------------------------------------------------------------

/** Mesma estrutura de `dados_especificos` que `executeSaveNewInvoice` grava. */
export function montarDadosEspecificos(draft: LoteDraft): Record<string, any> {
  const num = (v: string) => parseNumberValue(v)
  const medAnterior = lerMedicaoCumulativa(draft.medicaoAnterior)
  const medAtual = lerMedicaoCumulativa(draft.medicaoAtual)
  const valorTotal = num(draft.valorTotal) || 0

  let dadosEsp: Record<string, any>
  if (draft.tipo === 'Energia Elétrica') {
    const isB = /^B/i.test((draft.classificacaoConsumo || '').replace(/^B-/, ''))
    dadosEsp = {
      medicao_anterior: num(draft.medicaoAnterior),
      medicao_atual: num(draft.medicaoAtual),
      classificacao_consumo: draft.classificacaoConsumo || undefined,
      consumo_medido: num(draft.consumo),
      consumo_ponta: isB ? undefined : num(draft.consumoPonta),
      tarifa_tusd_ponta: num(draft.tarifaTusdPonta),
      tarifa_te_ponta: num(draft.tarifaTePonta),
      consumo_fora_ponta: isB ? undefined : num(draft.consumoForaPonta),
      tarifa_tusd_f_ponta: num(draft.tarifaTusdFPonta || draft.tarifaTusdPonta),
      tarifa_te_f_ponta: num(draft.tarifaTeFPonta || draft.tarifaTePonta),
      adicional_bandeira: draft.adicionalBandeira || undefined,
      fatura_total: valorTotal,
    }
  } else if (draft.tipo === 'Gás') {
    dadosEsp = {
      medicao_anterior: medAnterior === null ? undefined : medAnterior,
      medicao_atual: medAtual === null ? undefined : medAtual,
      consumo_medido: num(draft.consumoMedido || draft.consumo) || undefined,
      consumo_corrigido: num(draft.consumoCorrigido) || undefined,
      tarifa: num(draft.tarifa) || undefined,
      fatura_total: valorTotal,
    }
  } else {
    let tarifaSalvar = num(draft.tarifa)
    const vTot = num(draft.valorTotal)
    const cons = num(draft.consumoMedido || draft.consumo)
    if (
      (tarifaSalvar === undefined || tarifaSalvar === 0) &&
      vTot &&
      vTot > 0 &&
      cons &&
      cons > 0
    ) {
      tarifaSalvar = Number((vTot / cons).toFixed(6))
    }
    dadosEsp = {
      medicao_anterior: medAnterior === null ? undefined : medAnterior,
      medicao_atual: medAtual === null ? undefined : medAtual,
      consumo_medido: calcularConsumoMedidoCoerenteAgua(
        draft.consumo,
        draft.consumoMedido || draft.consumo,
      ),
      tarifa: tarifaSalvar || undefined,
      fatura_total: valorTotal,
    }
  }

  // Marcas do lote (acrescentam, não substituem o que o formulário grava)
  if (draft.estorno) {
    dadosEsp.estorno = true
    if (draft.valorFornecimento !== undefined) dadosEsp.valor_fornecimento = draft.valorFornecimento
  }
  dadosEsp.origem_extracao = 'lote'

  return dadosEsp
}

export function montarPayloadFatura(draft: LoteDraft, arquivoNome: string): Partial<FaturaRecord> {
  const compChave = competenciaParaChave(draft.competencia)
  const compISO = compChave ? `${compChave}-01T00:00:00.000Z` : new Date().toISOString()
  const valor = parseNumberValue(draft.valorTotal)
  const consumo = parseNumberValue(draft.consumo)

  return {
    empreendimento: draft.empreendimentoId,
    tipo_utilidade: draft.tipo,
    competencia: compISO,
    valor_total: valor === undefined ? 0 : valor,
    consumo: consumo === undefined ? undefined : consumo,
    unidade_consumo: draft.tipo === 'Energia Elétrica' ? 'kWh' : 'm³',
    numero_fatura: draft.numeroFatura || undefined,
    cnpj_cliente: isValidCNPJ(draft.cnpjCliente) ? formatCNPJ(draft.cnpjCliente) : undefined,
    cnpj_fornecedor: isValidCNPJ(draft.cnpjFornecedor)
      ? formatCNPJ(draft.cnpjFornecedor)
      : undefined,
    cnpj_validado: isValidCNPJ(draft.cnpjCliente),
    arquivo_nome: arquivoNome,
    lancamento_manual: false,
    vencimento: draft.vencimento || undefined,
    identificacao: draft.tipo === 'Gás' ? draft.identificacao.trim() || undefined : undefined,
    tipo_fatura_energia:
      draft.tipo === 'Energia Elétrica'
        ? (draft.tipoFaturaEnergia as 'concessionaria' | 'mercado_livre')
        : undefined,
    dados_especificos: JSON.stringify(montarDadosEspecificos(draft)),
  }
}

// ---------------------------------------------------------------------------
// Resumo do lote (gravação em bloco)
// ---------------------------------------------------------------------------

export interface ResumoLote {
  total: number
  prontas: number
  comAlerta: number
  comErro: number
  ignoradas: number
  estornos: number
  gravadas: number
  falhas: number
  valorTotalPeriodo: number
  /** Custo médio só sobre faturas com consumo. Estorno nunca entra aqui. */
  custoMedio: Array<{ tipo: TipoUtilidade; valor: number; consumo: number; media: number | null }>
  lacunas: Lacuna[]
}

export function resumoDoLote(
  arquivos: LoteArquivo[],
  faturas: FaturaRecord[],
  gravadas = 0,
  falhas = 0,
): ResumoLote {
  const consideradas = arquivos.filter((a) => a.draft && a.incluir)
  const acumuladoPorUtilidade = new Map<TipoUtilidade, { valor: number; consumo: number }>()

  let valorTotalPeriodo = 0
  consideradas.forEach((a) => {
    const d = a.draft!
    const valor = parseNumberValue(d.valorTotal) ?? 0
    const consumo = parseNumberValue(d.consumo) ?? 0
    valorTotalPeriodo += valor
    if (d.estorno) return // fora do custo e da média
    const acc = acumuladoPorUtilidade.get(d.tipo) || { valor: 0, consumo: 0 }
    acc.valor += valor
    acc.consumo += consumo
    acumuladoPorUtilidade.set(d.tipo, acc)
  })

  const custoMedio = Array.from(acumuladoPorUtilidade.entries()).map(([tipo, v]) => ({
    tipo,
    valor: v.valor,
    consumo: v.consumo,
    media: v.consumo > 0 ? v.valor / v.consumo : null, // sem consumo = sem média (ND), não zero
  }))

  return {
    total: arquivos.length,
    prontas: arquivos.filter((a) => a.status === 'pronta' || a.status === 'revisar').length,
    comAlerta: arquivos.filter((a) => a.alertas.some((x) => x.nivel === 'atencao')).length,
    comErro: arquivos.filter((a) => a.alertas.some((x) => x.nivel === 'erro')).length,
    ignoradas: arquivos.filter((a) => a.status === 'ignorado' || a.status === 'pulada').length,
    estornos: arquivos.filter((a) => a.draft?.estorno).length,
    gravadas,
    falhas,
    valorTotalPeriodo,
    custoMedio,
    lacunas: calcularLacunas(arquivos, faturas),
  }
}
