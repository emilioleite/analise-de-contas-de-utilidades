export function cleanCNPJ(value: string): string {
  return value.replace(/\D/g, '')
}

export function formatCNPJ(value: string): string {
  const digits = cleanCNPJ(value).slice(0, 14)
  if (!digits) return ''
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

// Verifica se um CNPJ extraído (possivelmente mascarado com asteriscos)
// é compatível com um CNPJ completo cadastrado.
// Compara os dígitos visíveis nas posições da máscara ou por prefixo/sufixo.
export function matchMaskedCNPJ(maskedValue: string, fullCnpj: string): boolean {
  if (!maskedValue || !fullCnpj) return false
  const cleanFull = cleanCNPJ(fullCnpj)
  if (cleanFull.length !== 14) return false

  const trimMasked = maskedValue.trim()
  if (!trimMasked.includes('*')) {
    // Se não tiver asterisco, deve bater exatamente os dígitos limpos
    return cleanCNPJ(trimMasked) === cleanFull
  }

  // Se a máscara tiver formato com pontuação padrão (18 chars, ex: "04.***.***/****-63" ou "04.***.***/0001-63")
  const formattedFull = formatCNPJ(fullCnpj) // "04.151.776/0001-63" (18 chars)
  if (trimMasked.length === 18 && formattedFull.length === 18) {
    for (let i = 0; i < 18; i++) {
      const mc = trimMasked[i]
      const fc = formattedFull[i]
      if (mc === '*' || mc === 'X' || mc === 'x') {
        continue
      }
      if (mc !== fc) {
        return false
      }
    }
    return true
  }

  // Comparação por dígitos brutos onde asteriscos representam posições de dígitos (14 chars)
  const rawMaskedDigits = trimMasked.replace(/[^0-9*Xx]/g, '')
  if (rawMaskedDigits.length === 14) {
    for (let i = 0; i < 14; i++) {
      const mc = rawMaskedDigits[i]
      const fc = cleanFull[i]
      if (mc === '*' || mc === 'X' || mc === 'x') {
        continue
      }
      if (mc !== fc) {
        return false
      }
    }
    return true
  }

  // Comparação genérica por prefixo e sufixo de dígitos visíveis:
  // Ex: "04.***-63" ou "04***63" -> prefixo "04", sufixo "63"
  const startDigitsMatch = trimMasked.match(/^(\d+)/)
  const endDigitsMatch = trimMasked.match(/(\d+)$/)
  if (!startDigitsMatch && !endDigitsMatch) return false

  if (startDigitsMatch) {
    const prefix = startDigitsMatch[1]
    if (!cleanFull.startsWith(prefix)) return false
  }
  if (endDigitsMatch) {
    const suffix = endDigitsMatch[1]
    if (!cleanFull.endsWith(suffix)) return false
  }

  return true
}

export function isValidCNPJ(cnpj: string): boolean {
  const digits = cleanCNPJ(cnpj)
  if (digits.length !== 14) return false

  // Reject known invalid repeating sequences
  if (/^(\d)\1{13}$/.test(digits)) return false

  // Validate first digit
  let size = digits.length - 2
  let numbers = digits.substring(0, size)
  const digitsPart = digits.substring(size)
  let sum = 0
  let pos = size - 7

  for (let i = size; i >= 1; i--) {
    sum += Number(numbers.charAt(size - i)) * pos--
    if (pos < 2) pos = 9
  }

  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11)
  if (result !== Number(digitsPart.charAt(0))) return false

  // Validate second digit
  size = size + 1
  numbers = digits.substring(0, size)
  sum = 0
  pos = size - 7

  for (let i = size; i >= 1; i--) {
    sum += Number(numbers.charAt(size - i)) * pos--
    if (pos < 2) pos = 9
  }

  result = sum % 11 < 2 ? 0 : 11 - (sum % 11)
  if (result !== Number(digitsPart.charAt(1))) return false

  return true
}

export function toSafeNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function formatCurrencyBRL(value: number | undefined | null): string {
  const safe = toSafeNumber(value, 0)
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(safe)
  } catch {
    return 'R$ 0,00'
  }
}

export function formatNumberBR(value: number | undefined | null, decimals = 0): string {
  const safe = toSafeNumber(value, 0)
  const safeDecimals = Math.max(0, Math.min(20, Math.floor(toSafeNumber(decimals, 0))))
  try {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: safeDecimals,
      maximumFractionDigits: safeDecimals,
    }).format(safe)
  } catch {
    return safeDecimals > 0 ? `0,${'0'.repeat(safeDecimals)}` : '0'
  }
}

/**
 * Formata um valor numérico para input ou visualização com padrão brasileiro (ponto de milhar e vírgula decimal).
 * Preserva as casas decimais originais do número fornecido (até maxDecimals).
 */
export function formatNumberValue(
  val: number | string | undefined | null,
  maxDecimals = 6,
  minDecimals = 0,
): string {
  if (val === undefined || val === null || val === '') return ''
  const s = String(val)
    .trim()
    .replace(/^R\$\s*/i, '')
  if (s === '' || s === 'null' || s === 'undefined') return ''

  // 1. Se já tem ponto de milhar E vírgula decimal no padrão brasileiro (ex: "23.862,35" ou "3.230,016")
  // A vírgula é OBRIGATÓRIA (,\d+). Sem vírgula, "852.643" é decimal com ponto, NÃO milhar!
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    if (minDecimals > 0) {
      const [inteiro, decimal = ''] = s.split(',')
      const paddedDec = decimal.padEnd(minDecimals, '0').slice(0, maxDecimals)
      return `${inteiro},${paddedDec}`
    }
    return s
  }

  // 2. Se tem apenas vírgula decimal (ex: "852,643" ou "33,037" ou "211,2"), já está no padrão pt-BR
  if (/^\d+,\d+$/.test(s)) {
    const [inteiro, decimal = ''] = s.split(',')
    const intNum = Number(inteiro)
    const intFmt = isNaN(intNum) ? inteiro : intNum.toLocaleString('pt-BR')
    let decFmt = decimal.slice(0, maxDecimals)
    if (minDecimals > 0 && decFmt.length < minDecimals) {
      decFmt = decFmt.padEnd(minDecimals, '0')
    }
    return decFmt ? `${intFmt},${decFmt}` : intFmt
  }

  // 3. Se for string com 2 ou mais blocos de milhar com ponto e sem vírgula (ex: "148.479.173" ou "1.146.303")
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    return s
  }

  // 4. Se for apenas dígitos inteiros (ex: "35", "889", "75830", "430415")
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    if (isNaN(n)) return s
    const intFmt = n.toLocaleString('pt-BR')
    if (minDecimals > 0) {
      return `${intFmt},${'0'.repeat(minDecimals)}`
    }
    return intFmt
  }

  // 5. Se for formato decimal com ponto (ex: "852.643", "33.037", "5453.4", "6.395877")
  if (/^\d+\.\d+$/.test(s)) {
    const [inteiro, decimal = ''] = s.split('.')
    const intNum = Number(inteiro)
    const intFmt = isNaN(intNum) ? inteiro : intNum.toLocaleString('pt-BR')
    let decFmt = decimal.slice(0, maxDecimals)
    if (minDecimals > 0 && decFmt.length < minDecimals) {
      decFmt = decFmt.padEnd(minDecimals, '0')
    }
    return decFmt ? `${intFmt},${decFmt}` : intFmt
  }

  const n = typeof val === 'number' ? val : Number(s)
  if (isNaN(n)) return s
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  })
}

/**
 * Converte um valor digitado pelo usuário (com ponto de milhar e vírgula decimal, ou notação comum)
 * para número float/inteiro padrão JavaScript.
 */
export function parseNumberValue(val: number | string | undefined | null): number | undefined {
  if (val === undefined || val === null || val === '') return undefined
  if (typeof val === 'number') {
    return isNaN(val) ? undefined : val
  }
  let s = String(val)
    .trim()
    .replace(/^R\$\s*/i, '')
  if (s.includes('*')) s = s.replace(/[*]+/g, '').trim()
  if (!s || s === 'null' || s === 'undefined') return undefined

  // Se tem ponto e vírgula (ex: 23.862,35 ou 3.230,016)
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    // Apenas vírgula (ex: 7,387689 ou 33,037 ou 211,2) -> decimal
    s = s.replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    // Apenas ponto com 2 ou mais blocos de milhar (ex: 1.146.303) -> ponto de milhar
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return isNaN(n) ? undefined : n
}

export function formatTCO2e(value: number | undefined | null, decimals = 3): string {
  const safe = toSafeNumber(value, 0)
  const safeDecimals = Math.max(0, Math.min(20, Math.floor(toSafeNumber(decimals, 3))))
  try {
    const formatted = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: safeDecimals,
      maximumFractionDigits: safeDecimals,
    }).format(safe)
    return `${formatted} tCO₂e`
  } catch {
    return '0,000 tCO₂e'
  }
}

export function formatCompetencia(dateStr: string | undefined): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    const month = String(d.getUTCMonth() + 1).padStart(2, '0')
    const year = d.getUTCFullYear()
    return `${month}/${year}`
  } catch {
    return dateStr
  }
}

export function formatDateBR(dateStr: string | undefined): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
  } catch {
    return dateStr
  }
}
