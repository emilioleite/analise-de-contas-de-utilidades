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
    return '0'
  }
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
