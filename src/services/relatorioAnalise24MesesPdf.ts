/**
 * Gerador de Relatório Executivo em PDF para a Análise de 24 Meses.
 *
 * Utiliza o padrão A4 institucional Dekazen (jsPDF + AutoTable por CDN),
 * com gráficos em Canvas de alta fidelidade:
 * 1. Análise de Consumo Físico: Série Contínua de 24 Meses (kWh ou m³) com Máxima (Vermelho) e Mínima (Verde)
 * 2. Comparativo Anual de Consumo Sazonal (Ano 1 vs. Ano 2)
 * 3. Evolução da Tarifa Aplicada (R$/kWh ou R$/m³) ao longo de 24 meses
 * 4. Análise Financeira: Série Histórica de Desembolso (R$) e Comparativo Financeiro Ano 1 vs Ano 2
 * 5. Cards KPI em todas as seções (Consumo, Tarifa e Financeiro)
 * 6. Tabela Mensal Completa dos 24 meses com colunas de Consumo (kWh/m³), Tarifa (R$/un), Valor Total (R$),
 *    Variações percentuais e Classificação clara (Pico, Mínima, Regular).
 *
 * Respeita tanto a utilidade selecionada (Total Geral, Energia Elétrica, Água e Esgoto, Gás)
 * quanto o(s) empreendimento(s) ativo(s) no filtro.
 */

import { formatCurrencyBRL, formatNumberBR } from '@/lib/cnpj'
import { loadJsPdf } from '@/services/relatorioEmissoesPdf'
import {
  getDekazenLogoDataUrl,
  desenharCabecalhoPdfPadrao,
  desenharRodapePdfPadrao,
} from '@/services/pdfBranding'

export interface Analise24MesesPdfData {
  nomeEmpreendimento: string
  periodoCobertura: string
  utilidadeSelecionada: string
  unidadeConsumo: string
  rotuloTarifa: string
  // Financeiro
  mediaMensal: number
  totalPeriodo: number
  maxPoint: { label: string; valor: number } | null
  minPoint: { label: string; valor: number } | null
  // Consumo
  mediaConsumoMensal: number
  totalConsumoPeriodo: number
  maxConsumoPoint: { label: string; consumo: number } | null
  minConsumoPoint: { label: string; consumo: number } | null
  // Tarifa
  mediaTarifaPeriodo: number
  maxTarifaPoint: { label: string; tarifa: number } | null
  minTarifaPoint: { label: string; tarifa: number } | null
  // Dados mensais
  monthPoints: Array<{
    key: string
    label: string
    shortMonth: string
    valor: number
    consumo: number
    tarifa: number
  }>
  comparativoData: Array<{
    mes: string
    ano1Label: string
    ano1Valor: number
    ano2Label: string
    ano2Valor: number
  }>
  comparativoConsumoData: Array<{
    mes: string
    ano1Label: string
    ano1Consumo: number
    ano2Label: string
    ano2Consumo: number
  }>
  tableRows: Array<{
    key: string
    label: string
    valor: number
    consumo: number
    tarifa: number
    variacaoPct: number
    variacaoConsumoPct: number
    isMax: boolean
    isMin: boolean
  }>
}

/**
 * Renderiza gráfico contínuo de 24 meses (área) para Valores em Reais (R$)
 */
function renderArea24MesesCanvas(
  slots: Analise24MesesPdfData['monthPoints'],
  maxKey?: string,
  minKey?: string,
  width = 1200,
  height = 360,
  accentColor = '#0F766E',
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const paddingLeft = 80
  const paddingRight = 40
  const paddingTop = 45
  const paddingBottom = 55

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const maxVal = Math.max(...slots.map((s) => s.valor), 100)
  const yMax = Math.ceil((maxVal * 1.2) / 1000) * 1000 || 1000

  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    ctx.fillText(`R$ ${(yVal / 1000).toFixed(0)}k`, paddingLeft - 10, yPos)
  }

  const count = slots.length || 1
  const stepX = chartWidth / Math.max(1, count - 1)

  if (slots.length > 1) {
    ctx.beginPath()
    ctx.moveTo(paddingLeft, paddingTop + chartHeight)

    slots.forEach((s, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (s.valor / yMax) * chartHeight
      ctx.lineTo(x, y)
    })

    ctx.lineTo(paddingLeft + (count - 1) * stepX, paddingTop + chartHeight)
    ctx.closePath()

    ctx.fillStyle = 'rgba(15, 118, 110, 0.12)'
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = accentColor
    ctx.lineWidth = 2.5

    slots.forEach((s, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (s.valor / yMax) * chartHeight
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    const y = paddingTop + chartHeight - (s.valor / yMax) * chartHeight

    const isMax = s.key === maxKey && s.valor > 0
    const isMin = s.key === minKey && s.valor > 0

    if (isMax) {
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#DC2626'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#DC2626'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('Máxima', x, y - 8)
    } else if (isMin) {
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#16A34A'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#16A34A'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('Mínima', x, y + 8)
    } else {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = accentColor
      ctx.fill()
    }
  })

  // Eixo X
  ctx.fillStyle = '#475569'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    ctx.save()
    ctx.translate(x, paddingTop + chartHeight + 8)
    ctx.rotate(-Math.PI / 4.5)
    ctx.fillText(s.label, 0, 0)
    ctx.restore()
  })

  // Legenda
  const legItems = [
    { label: 'Desembolso Mensal (R$)', color: accentColor },
    { label: 'Pico Máximo', color: '#DC2626' },
    { label: 'Menor Gasto', color: '#16A34A' },
  ]
  let lx = paddingLeft + 10
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  legItems.forEach((leg) => {
    ctx.fillStyle = leg.color
    ctx.beginPath()
    ctx.arc(lx + 6, 16, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1E293B'
    ctx.fillText(leg.label, lx + 18, 16)
    lx += ctx.measureText(leg.label).width + 36
  })

  return canvas.toDataURL('image/png')
}

/**
 * Renderiza gráfico contínuo de 24 meses (área) para Quantidade Consumida (kWh ou m³)
 */
function renderAreaConsumoCanvas(
  slots: Analise24MesesPdfData['monthPoints'],
  unidade: string,
  maxKey?: string,
  minKey?: string,
  width = 1200,
  height = 360,
  accentColor = '#0F766E',
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const paddingLeft = 80
  const paddingRight = 40
  const paddingTop = 45
  const paddingBottom = 55

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const maxVal = Math.max(...slots.map((s) => s.consumo), 10)
  // Arredondar para escala legível
  const factor = maxVal > 1000 ? 1000 : maxVal > 100 ? 50 : 10
  const yMax = Math.ceil((maxVal * 1.2) / factor) * factor || 100

  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    const labelVal = yVal >= 1000 ? `${(yVal / 1000).toFixed(1)}k` : `${Math.round(yVal)}`
    ctx.fillText(`${labelVal} ${unidade}`, paddingLeft - 10, yPos)
  }

  const count = slots.length || 1
  const stepX = chartWidth / Math.max(1, count - 1)

  if (slots.length > 1) {
    ctx.beginPath()
    ctx.moveTo(paddingLeft, paddingTop + chartHeight)

    slots.forEach((s, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (s.consumo / yMax) * chartHeight
      ctx.lineTo(x, y)
    })

    ctx.lineTo(paddingLeft + (count - 1) * stepX, paddingTop + chartHeight)
    ctx.closePath()

    ctx.fillStyle = 'rgba(15, 118, 110, 0.14)'
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = accentColor
    ctx.lineWidth = 2.5

    slots.forEach((s, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (s.consumo / yMax) * chartHeight
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    const y = paddingTop + chartHeight - (s.consumo / yMax) * chartHeight

    const isMax = s.key === maxKey && s.consumo > 0
    const isMin = s.key === minKey && s.consumo > 0

    if (isMax) {
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#DC2626'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#DC2626'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('Pico', x, y - 8)
    } else if (isMin) {
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#16A34A'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#16A34A'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('Mínimo', x, y + 8)
    } else {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = accentColor
      ctx.fill()
    }
  })

  // Eixo X
  ctx.fillStyle = '#475569'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    ctx.save()
    ctx.translate(x, paddingTop + chartHeight + 8)
    ctx.rotate(-Math.PI / 4.5)
    ctx.fillText(s.label, 0, 0)
    ctx.restore()
  })

  // Legenda
  const legItems = [
    { label: `Consumo (${unidade}/mês)`, color: accentColor },
    { label: 'Pico Histórico', color: '#DC2626' },
    { label: 'Mínimo Apurado', color: '#16A34A' },
  ]
  let lx = paddingLeft + 10
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  legItems.forEach((leg) => {
    ctx.fillStyle = leg.color
    ctx.beginPath()
    ctx.arc(lx + 6, 16, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1E293B'
    ctx.fillText(leg.label, lx + 18, 16)
    lx += ctx.measureText(leg.label).width + 36
  })

  return canvas.toDataURL('image/png')
}

/**
 * Renderiza gráfico de linha de 24 meses para a Tarifa Aplicada (R$/unidade)
 */
function renderLinhaTarifaCanvas(
  slots: Analise24MesesPdfData['monthPoints'],
  rotuloTarifa: string,
  maxKey?: string,
  minKey?: string,
  width = 1200,
  height = 340,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const paddingLeft = 80
  const paddingRight = 40
  const paddingTop = 45
  const paddingBottom = 55

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const tarifasValidas = slots.filter((s) => s.tarifa > 0).map((s) => s.tarifa)
  const maxTarifa = Math.max(...tarifasValidas, 1)
  const minTarifa = Math.min(...tarifasValidas, 0)
  const yMax = maxTarifa * 1.15
  const yMin = Math.max(0, minTarifa * 0.85)
  const ySpan = yMax - yMin || 1

  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = yMin + (ySpan / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    ctx.fillText(`R$ ${yVal.toFixed(2)}`, paddingLeft - 10, yPos)
  }

  const count = slots.length || 1
  const stepX = chartWidth / Math.max(1, count - 1)

  // Linha da tarifa (#D97706)
  ctx.beginPath()
  ctx.strokeStyle = '#D97706'
  ctx.lineWidth = 2.5

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    const yClamped = Math.max(yMin, Math.min(yMax, s.tarifa))
    const y = paddingTop + chartHeight - ((yClamped - yMin) / ySpan) * chartHeight
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    const yClamped = Math.max(yMin, Math.min(yMax, s.tarifa))
    const y = paddingTop + chartHeight - ((yClamped - yMin) / ySpan) * chartHeight

    const isMax = s.key === maxKey && s.tarifa > 0
    const isMin = s.key === minKey && s.tarifa > 0

    if (isMax) {
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#DC2626'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#DC2626'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('Máx', x, y - 7)
    } else if (isMin) {
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#16A34A'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#16A34A'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('Mín', x, y + 7)
    } else {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#D97706'
      ctx.fill()
    }
  })

  // Eixo X
  ctx.fillStyle = '#475569'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    ctx.save()
    ctx.translate(x, paddingTop + chartHeight + 8)
    ctx.rotate(-Math.PI / 4.5)
    ctx.fillText(s.label, 0, 0)
    ctx.restore()
  })

  // Legenda
  const legItems = [
    { label: `Tarifa Média Aplicada (${rotuloTarifa})`, color: '#D97706' },
    { label: 'Tarifa Mais Alta', color: '#DC2626' },
    { label: 'Tarifa Mais Econômica', color: '#16A34A' },
  ]
  let lx = paddingLeft + 10
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  legItems.forEach((leg) => {
    ctx.fillStyle = leg.color
    ctx.beginPath()
    ctx.arc(lx + 6, 16, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1E293B'
    ctx.fillText(leg.label, lx + 18, 16)
    lx += ctx.measureText(leg.label).width + 36
  })

  return canvas.toDataURL('image/png')
}

/**
 * Renderiza gráfico de barras Ano 1 vs Ano 2 para Consumo
 */
function renderComparativoConsumoCanvas(
  comparativo: Analise24MesesPdfData['comparativoConsumoData'],
  unidade: string,
  width = 1200,
  height = 340,
  accentColor = '#0F766E',
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const paddingLeft = 80
  const paddingRight = 40
  const paddingTop = 45
  const paddingBottom = 45

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const maxVal = Math.max(...comparativo.flatMap((c) => [c.ano1Consumo, c.ano2Consumo]), 10)
  const factor = maxVal > 1000 ? 1000 : maxVal > 100 ? 50 : 10
  const yMax = Math.ceil((maxVal * 1.15) / factor) * factor || 100

  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    const labelVal = yVal >= 1000 ? `${(yVal / 1000).toFixed(1)}k` : `${Math.round(yVal)}`
    ctx.fillText(`${labelVal} ${unidade}`, paddingLeft - 10, yPos)
  }

  const count = comparativo.length || 1
  const slotWidth = chartWidth / count
  const barWidth = Math.max(8, slotWidth * 0.36)
  const gap = 4

  comparativo.forEach((item, idx) => {
    const xCenter = paddingLeft + slotWidth * idx + slotWidth / 2

    const h1 = (item.ano1Consumo / yMax) * chartHeight
    const x1 = xCenter - barWidth - gap / 2
    const y1 = paddingTop + chartHeight - h1
    ctx.fillStyle = '#94A3B8'
    ctx.fillRect(x1, y1, barWidth, h1)

    const h2 = (item.ano2Consumo / yMax) * chartHeight
    const x2 = xCenter + gap / 2
    const y2 = paddingTop + chartHeight - h2
    ctx.fillStyle = accentColor
    ctx.fillRect(x2, y2, barWidth, h2)

    ctx.fillStyle = '#475569'
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(item.mes, xCenter, paddingTop + chartHeight + 10)
  })

  // Legenda
  const legItems = [
    { label: 'Ano 1 (12 meses anteriores)', color: '#94A3B8' },
    { label: 'Ano 2 (12 meses recentes)', color: accentColor },
  ]
  let lx = paddingLeft + 10
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  legItems.forEach((leg) => {
    ctx.fillStyle = leg.color
    ctx.fillRect(lx, 16 - 6, 14, 14)
    ctx.fillStyle = '#1E293B'
    ctx.fillText(leg.label, lx + 20, 16)
    lx += ctx.measureText(leg.label).width + 45
  })

  return canvas.toDataURL('image/png')
}

/**
 * Função principal que gera o PDF de 3 páginas da Análise de 24 Meses
 */
export async function gerarRelatorioAnalise24MesesPDF(data: Analise24MesesPdfData): Promise<void> {
  const jsPDF = await loadJsPdf()
  const logoDataUrl = await getDekazenLogoDataUrl()

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2

  const agora = new Date()
  const dataGeracaoStr = agora.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  let currentY = margin

  let accentColor = '#0F766E'
  if (data.utilidadeSelecionada === 'Energia Elétrica') accentColor = '#F59E0B'
  else if (data.utilidadeSelecionada === 'Água e Esgoto') accentColor = '#0EA5E9'
  else if (data.utilidadeSelecionada === 'Gás') accentColor = '#14B8A6'

  const totalPaginas = 3

  const desenharCabecalho = (numeroPagina: number) => {
    currentY = desenharCabecalhoPdfPadrao({
      doc,
      currentY: margin,
      margin,
      contentWidth,
      pageWidth,
      pageHeight,
      numeroPagina,
      tituloPrincipal: 'GESTOR DE UTILIDADES — ANÁLISE DE 24 MESES',
      subtitulo: `Consumo Físico (${data.unidadeConsumo}), Tarifas (${data.rotuloTarifa}) e Desembolso • ${data.utilidadeSelecionada}`,
      nomeEmpreendimento: data.nomeEmpreendimento,
      periodoCobertura: data.periodoCobertura,
      dataGeracaoStr,
      logoDataUrl,
    })
  }

  // =========================================================================
  // PÁGINA 1: ANÁLISE DE CONSUMO FÍSICO + EVOLUÇÃO DA TARIFA APLICADA
  // =========================================================================
  desenharCabecalho(1)

  // 1. Banner
  doc.setFillColor(240, 253, 250) // teal-50
  doc.setDrawColor(204, 251, 241)
  doc.roundedRect(margin, currentY, contentWidth, 11, 1.5, 1.5, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 118, 110)
  doc.text(
    `DIAGNÓSTICO HISTÓRICO: QUANTIDADE CONSUMIDA (${data.unidadeConsumo.toUpperCase()}) E TARIFA (${data.rotuloTarifa})`,
    margin + 4,
    currentY + 4.5,
  )
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(19, 78, 74)
  doc.text(
    `Evolução dos volumes físicos consumidos e custos unitários médios praticados nas faturas dos últimos 24 meses.`,
    margin + 4,
    currentY + 8.5,
  )
  currentY += 14.5

  // 2. Cards KPI de Consumo (3 cards)
  const cardWidth = (contentWidth - 6) / 3
  const cardHeight = 19

  const kpisConsumo = [
    {
      titulo: 'MAIOR CONSUMO (PICO)',
      valor: `${formatNumberBR(data.maxConsumoPoint?.consumo || 0)} ${data.unidadeConsumo}`,
      sub: `Mês de referência: ${data.maxConsumoPoint?.label || '-'}`,
      corBarra: [220, 38, 38], // Vermelho
    },
    {
      titulo: 'MENOR CONSUMO (MÍNIMA)',
      valor: `${formatNumberBR(data.minConsumoPoint?.consumo || 0)} ${data.unidadeConsumo}`,
      sub: `Mês de referência: ${data.minConsumoPoint?.label || '-'}`,
      corBarra: [22, 163, 74], // Verde
    },
    {
      titulo: `MÉDIA MENSAL (${data.unidadeConsumo})`,
      valor: `${formatNumberBR(data.mediaConsumoMensal, 1)} ${data.unidadeConsumo}/mês`,
      sub: `Total: ${formatNumberBR(data.totalConsumoPeriodo)} ${data.unidadeConsumo}`,
      corBarra: [15, 118, 110], // Teal
    },
  ]

  kpisConsumo.forEach((kpi, idx) => {
    const cardX = margin + idx * (cardWidth + 3)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD')

    doc.setFillColor(kpi.corBarra[0], kpi.corBarra[1], kpi.corBarra[2])
    doc.rect(cardX, currentY, 2.5, cardHeight, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.titulo, cardX + 5, currentY + 4.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text(kpi.valor, cardX + 5, currentY + 11)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.sub, cardX + 5, currentY + 15.5)
  })

  currentY += cardHeight + 5

  // 3. Gráfico de Consumo Físico (24 Meses)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text(
    `Série Histórica de Consumo Físico — 24 Meses (${data.unidadeConsumo}/mês)`,
    margin,
    currentY,
  )
  currentY += 3

  const consumoImg = renderAreaConsumoCanvas(
    data.monthPoints,
    data.unidadeConsumo,
    data.maxConsumoPoint?.label
      ? data.monthPoints.find((m) => m.label === data.maxConsumoPoint?.label)?.key
      : undefined,
    data.minConsumoPoint?.label
      ? data.monthPoints.find((m) => m.label === data.minConsumoPoint?.label)?.key
      : undefined,
    1200,
    340,
    accentColor,
  )

  if (consumoImg) {
    const h = 50
    doc.addImage(consumoImg, 'PNG', margin, currentY, contentWidth, h)
    currentY += h + 5
  }

  // 4. Cards KPI de Tarifa Aplicada (3 cards)
  const kpisTarifa = [
    {
      titulo: 'TARIFA MAIS ALTA',
      valor: `${formatCurrencyBRL(data.maxTarifaPoint?.tarifa || 0)}/${data.unidadeConsumo}`,
      sub: `Mês de referência: ${data.maxTarifaPoint?.label || '-'}`,
      corBarra: [220, 38, 38],
    },
    {
      titulo: 'TARIFA MAIS ECONÔMICA',
      valor: `${formatCurrencyBRL(data.minTarifaPoint?.tarifa || 0)}/${data.unidadeConsumo}`,
      sub: `Mês de referência: ${data.minTarifaPoint?.label || '-'}`,
      corBarra: [22, 163, 74],
    },
    {
      titulo: 'TARIFA MÉDIA DO PERÍODO',
      valor: `${formatCurrencyBRL(data.mediaTarifaPeriodo)}/${data.unidadeConsumo}`,
      sub: `Ponderada pelo consumo de 24 meses`,
      corBarra: [217, 119, 6], // Amber
    },
  ]

  kpisTarifa.forEach((kpi, idx) => {
    const cardX = margin + idx * (cardWidth + 3)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD')

    doc.setFillColor(kpi.corBarra[0], kpi.corBarra[1], kpi.corBarra[2])
    doc.rect(cardX, currentY, 2.5, cardHeight, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.titulo, cardX + 5, currentY + 4.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text(kpi.valor, cardX + 5, currentY + 11)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.sub, cardX + 5, currentY + 15.5)
  })

  currentY += cardHeight + 5

  // 5. Gráfico de Evolução da Tarifa Aplicada (Linha)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text(`Evolução da Tarifa Média Aplicada (${data.rotuloTarifa})`, margin, currentY)
  currentY += 3

  const tarifaImg = renderLinhaTarifaCanvas(
    data.monthPoints,
    data.rotuloTarifa,
    data.maxTarifaPoint?.label
      ? data.monthPoints.find((m) => m.label === data.maxTarifaPoint?.label)?.key
      : undefined,
    data.minTarifaPoint?.label
      ? data.monthPoints.find((m) => m.label === data.minTarifaPoint?.label)?.key
      : undefined,
    1200,
    330,
  )

  if (tarifaImg) {
    const h = 48
    doc.addImage(tarifaImg, 'PNG', margin, currentY, contentWidth, h)
    currentY += h + 4
  }

  desenharRodapePdfPadrao(doc, 1, totalPaginas, margin, pageWidth, pageHeight)

  // =========================================================================
  // PÁGINA 2: ANÁLISE FINANCEIRA (R$) + COMPARATIVOS ANUAIS (ANO 1 VS ANO 2)
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(2)

  // 1. Cards Financeiros
  const kpisFin = [
    {
      titulo: 'MAIOR GASTO (PICO FINANCEIRO)',
      valor: formatCurrencyBRL(data.maxPoint?.valor || 0),
      sub: `Mês de referência: ${data.maxPoint?.label || '-'}`,
      corBarra: [220, 38, 38],
    },
    {
      titulo: 'MENOR GASTO (MÍNIMA FINANCEIRA)',
      valor: formatCurrencyBRL(data.minPoint?.valor || 0),
      sub: `Mês de referência: ${data.minPoint?.label || '-'}`,
      corBarra: [22, 163, 74],
    },
    {
      titulo: 'MÉDIA MENSAL EM REAIS',
      valor: formatCurrencyBRL(data.mediaMensal),
      sub: `Total: ${formatCurrencyBRL(data.totalPeriodo)}`,
      corBarra: [15, 118, 110],
    },
  ]

  kpisFin.forEach((kpi, idx) => {
    const cardX = margin + idx * (cardWidth + 3)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD')

    doc.setFillColor(kpi.corBarra[0], kpi.corBarra[1], kpi.corBarra[2])
    doc.rect(cardX, currentY, 2.5, cardHeight, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.titulo, cardX + 5, currentY + 4.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text(kpi.valor, cardX + 5, currentY + 11)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.sub, cardX + 5, currentY + 15.5)
  })

  currentY += cardHeight + 5

  // 2. Gráfico de Série Financeira Contínua
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text('Série Histórica de Desembolso Financeiro — 24 Meses (R$)', margin, currentY)
  currentY += 3

  const areaImg = renderArea24MesesCanvas(
    data.monthPoints,
    data.maxPoint?.label
      ? data.monthPoints.find((m) => m.label === data.maxPoint?.label)?.key
      : undefined,
    data.minPoint?.label
      ? data.monthPoints.find((m) => m.label === data.minPoint?.label)?.key
      : undefined,
    1200,
    340,
    accentColor,
  )

  if (areaImg) {
    const h = 50
    doc.addImage(areaImg, 'PNG', margin, currentY, contentWidth, h)
    currentY += h + 5
  }

  // 3. Comparativo de Consumo Ano 1 vs Ano 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text(
    `Comparativo Sazonal de Consumo: Ano 1 vs. Ano 2 (${data.unidadeConsumo})`,
    margin,
    currentY,
  )
  currentY += 3

  const compConsumoImg = renderComparativoConsumoCanvas(
    data.comparativoConsumoData,
    data.unidadeConsumo,
    1200,
    330,
    accentColor,
  )

  if (compConsumoImg) {
    const h = 48
    doc.addImage(compConsumoImg, 'PNG', margin, currentY, contentWidth, h)
    currentY += h + 4
  }

  desenharRodapePdfPadrao(doc, 2, totalPaginas, margin, pageWidth, pageHeight)

  // =========================================================================
  // PÁGINA 3: TABELA MENSAL COMPLETA (CONSUMO + TARIFA + VALOR + VARIAÇÃO)
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(3)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Detalhamento Mensal Completo — 24 Competências', margin, currentY)
  currentY += 3.5

  const tableHeaders = [
    [
      'Mês / Ano',
      `Consumo (${data.unidadeConsumo})`,
      'Var. Consumo',
      `Tarifa (${data.rotuloTarifa})`,
      'Valor Total (R$)',
      'Var. Valor (%)',
      'Classificação',
    ],
  ]

  const tableBody = data.tableRows.map((r) => {
    let variacaoStr = '-'
    if (r.variacaoPct > 0) {
      variacaoStr = `+${r.variacaoPct.toFixed(1)}%`
    } else if (r.variacaoPct < 0) {
      variacaoStr = `${r.variacaoPct.toFixed(1)}%`
    }

    let variacaoConsumoStr = '-'
    if (r.variacaoConsumoPct > 0) {
      variacaoConsumoStr = `+${r.variacaoConsumoPct.toFixed(1)}%`
    } else if (r.variacaoConsumoPct < 0) {
      variacaoConsumoStr = `${r.variacaoConsumoPct.toFixed(1)}%`
    }

    let classifStr = 'Regular'
    if (r.isMax) classifStr = 'Pico Valor'
    else if (r.isMin) classifStr = 'Menor Valor'

    return [
      r.label,
      r.consumo > 0 ? formatNumberBR(r.consumo) : '-',
      variacaoConsumoStr,
      r.tarifa > 0 ? formatCurrencyBRL(r.tarifa) : '-',
      formatCurrencyBRL(r.valor),
      variacaoStr,
      classifStr,
    ]
  })

  if (typeof (doc as any).autoTable === 'function') {
    ;(doc as any).autoTable({
      startY: currentY,
      head: tableHeaders,
      body: tableBody,
      theme: 'grid',
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 6.8,
        cellPadding: 1.5,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 6.8,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: (hookData: any) => {
        if (hookData.section === 'body') {
          const rowData = data.tableRows[hookData.row.index]
          if (rowData?.isMax) {
            hookData.cell.styles.fillColor = [254, 242, 242]
            if (hookData.column.index === 6) {
              hookData.cell.styles.textColor = [185, 28, 28]
              hookData.cell.styles.fontStyle = 'bold'
            }
          } else if (rowData?.isMin) {
            hookData.cell.styles.fillColor = [240, 253, 244]
            if (hookData.column.index === 6) {
              hookData.cell.styles.textColor = [21, 128, 61]
              hookData.cell.styles.fontStyle = 'bold'
            }
          }
        }
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 24 },
        1: { halign: 'right', cellWidth: 28 },
        2: { halign: 'right', cellWidth: 25 },
        3: { halign: 'right', cellWidth: 28 },
        4: { halign: 'right', fontStyle: 'bold', cellWidth: 30 },
        5: { halign: 'right', cellWidth: 24 },
        6: { halign: 'center', cellWidth: 'auto' },
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 6
  }

  // Nota Institucional Dekazen
  doc.setFillColor(241, 245, 249)
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(margin, currentY, contentWidth, 18, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(15, 23, 42)
  doc.text('METODOLOGIA E CONSIDERAÇÕES DE ANÁLISE:', margin + 4, currentY + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.2)
  doc.setTextColor(71, 85, 105)
  doc.text(
    `• Energia Elétrica: medição em kWh/mês com soma de ponta e fora-ponta para Grupo A (A1–A4) e consumo único para Grupo B (B1–B4).`,
    margin + 4,
    currentY + 7.5,
  )
  doc.text(
    `• Água e Gás: medição em m³/mês considerando volume faturado e consumo corrigido quando informado pela concessionária.`,
    margin + 4,
    currentY + 11,
  )
  doc.text(
    `• Tarifa unitária média calculada como Valor Total (R$) ÷ Consumo do Mês, refletindo bandeiras, encargos e impostos aplicados.`,
    margin + 4,
    currentY + 14.5,
  )

  desenharRodapePdfPadrao(doc, 3, totalPaginas, margin, pageWidth, pageHeight)

  // Salvar PDF com nome padronizado
  const safeEmp =
    data.nomeEmpreendimento
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'todos'

  const safeUtil =
    data.utilidadeSelecionada
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'todas'

  const filename = `analise-24m-dekazen-${safeEmp}-${safeUtil}.pdf`
  doc.save(filename)
}
