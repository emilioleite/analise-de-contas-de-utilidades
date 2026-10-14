/**
 * Gerador de Relatório Executivo em PDF para a Análise de 24 Meses.
 *
 * Utiliza o padrão A4 institucional Dekazen (jsPDF + AutoTable por CDN),
 * com gráficos em Canvas de alta fidelidade:
 * 1. Série Contínua de 24 Meses (Área) com destaques visuais para Máxima (Vermelho) e Mínima (Verde)
 * 2. Comparativo Anual Sazonal (Ano 1 vs. Ano 2) lado a lado
 * 3. Cards KPI: Maior Gasto com mês de referência, Menor Gasto com mês de referência, Média Mensal e Total
 * 4. Tabela Mensal Completa dos 24 meses com consumo apurado, valor em R$, variação vs mês anterior (%)
 *    e classificação clara (Pico/Máxima, Mínima, Regular)
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
  mediaMensal: number
  totalPeriodo: number
  maxPoint: { label: string; valor: number } | null
  minPoint: { label: string; valor: number } | null
  monthPoints: Array<{
    key: string
    label: string
    shortMonth: string
    valor: number
    consumo: number
  }>
  comparativoData: Array<{
    mes: string
    ano1Label: string
    ano1Valor: number
    ano2Label: string
    ano2Valor: number
  }>
  tableRows: Array<{
    key: string
    label: string
    valor: number
    consumo: number
    variacaoPct: number
    isMax: boolean
    isMin: boolean
  }>
}

/**
 * Renderiza gráfico contínuo de 24 meses (linha/área) em Canvas
 */
function renderArea24MesesCanvas(
  slots: Analise24MesesPdfData['monthPoints'],
  maxKey?: string,
  minKey?: string,
  width = 1200,
  height = 380,
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

  // Linhas de grade
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
    // Área preenchida com transparência
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

    // Linha principal
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

  // Pontos regulares e pontos destacados (Máxima e Mínima)
  slots.forEach((s, idx) => {
    const x = paddingLeft + idx * stepX
    const y = paddingTop + chartHeight - (s.valor / yMax) * chartHeight

    const isMax = s.key === maxKey && s.valor > 0
    const isMin = s.key === minKey && s.valor > 0

    if (isMax) {
      // Destaque Máxima (Vermelho)
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
      // Destaque Mínima (Verde)
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
    { label: 'Série Mensal Contínua', color: accentColor },
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
 * Renderiza gráfico de barras Ano 1 vs Ano 2 em Canvas
 */
function renderComparativo24MesesCanvas(
  comparativo: Analise24MesesPdfData['comparativoData'],
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
  const paddingBottom = 45

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const maxVal = Math.max(...comparativo.flatMap((c) => [c.ano1Valor, c.ano2Valor]), 100)
  const yMax = Math.ceil((maxVal * 1.15) / 1000) * 1000 || 1000

  // Linhas de grade
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

  const count = comparativo.length || 1
  const slotWidth = chartWidth / count
  const barWidth = Math.max(8, slotWidth * 0.36)
  const gap = 4

  comparativo.forEach((item, idx) => {
    const xCenter = paddingLeft + slotWidth * idx + slotWidth / 2

    // Barra Ano 1 (cinza)
    const h1 = (item.ano1Valor / yMax) * chartHeight
    const x1 = xCenter - barWidth - gap / 2
    const y1 = paddingTop + chartHeight - h1
    ctx.fillStyle = '#94A3B8'
    ctx.fillRect(x1, y1, barWidth, h1)

    // Barra Ano 2 (accent / institucional)
    const h2 = (item.ano2Valor / yMax) * chartHeight
    const x2 = xCenter + gap / 2
    const y2 = paddingTop + chartHeight - h2
    ctx.fillStyle = accentColor
    ctx.fillRect(x2, y2, barWidth, h2)

    // Rótulo mês
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
 * Função principal que gera o PDF do relatório de Análise de 24 Meses
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

  // Cor de destaque conforme utilidade
  let accentColor = '#0F766E'
  if (data.utilidadeSelecionada === 'Energia Elétrica') accentColor = '#F59E0B'
  else if (data.utilidadeSelecionada === 'Água e Esgoto') accentColor = '#0EA5E9'
  else if (data.utilidadeSelecionada === 'Gás') accentColor = '#14B8A6'

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
      subtitulo: `Histórico Operacional, Sazonalidade e Variações • Utilidade: ${data.utilidadeSelecionada}`,
      nomeEmpreendimento: data.nomeEmpreendimento,
      periodoCobertura: data.periodoCobertura,
      dataGeracaoStr,
      logoDataUrl,
    })
  }

  // =========================================================================
  // PÁGINA 1: RESUMO + CARDS KPI + GRÁFICO 24 MESES + COMPARATIVO ANO 1 VS ANO 2
  // =========================================================================
  desenharCabecalho(1)

  // 1. Banner Resumo
  doc.setFillColor(240, 253, 250) // teal-50
  doc.setDrawColor(204, 251, 241)
  doc.roundedRect(margin, currentY, contentWidth, 12, 1.5, 1.5, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 118, 110)
  doc.text(
    `DIAGNÓSTICO HISTÓRICO DE CONSUMO E DESEMBOLSO (${data.utilidadeSelecionada.toUpperCase()})`,
    margin + 4,
    currentY + 4.8,
  )
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(19, 78, 74)
  doc.text(
    `Apuração contínua de 24 meses identificando sazonalidade, picos de consumo e oportunidade de otimização tarifária.`,
    margin + 4,
    currentY + 9,
  )

  currentY += 16

  // 2. Grid de 3 Cards KPI Principais
  const cardWidth = (contentWidth - 6) / 3
  const cardHeight = 22

  const kpis = [
    {
      titulo: 'MAIOR GASTO (PICO)',
      valor: formatCurrencyBRL(data.maxPoint?.valor || 0),
      sub: `Mês de referência: ${data.maxPoint?.label || '-'}`,
      corBarra: [220, 38, 38], // Vermelho
    },
    {
      titulo: 'MENOR GASTO (MÍNIMA)',
      valor: formatCurrencyBRL(data.minPoint?.valor || 0),
      sub: `Mês de referência: ${data.minPoint?.label || '-'}`,
      corBarra: [22, 163, 74], // Verde
    },
    {
      titulo: 'MÉDIA MENSAL (24M)',
      valor: formatCurrencyBRL(data.mediaMensal),
      sub: `Total: ${formatCurrencyBRL(data.totalPeriodo)}`,
      corBarra: [15, 118, 110], // Teal
    },
  ]

  kpis.forEach((kpi, idx) => {
    const cardX = margin + idx * (cardWidth + 3)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD')

    // Barra lateral de cor
    doc.setFillColor(kpi.corBarra[0], kpi.corBarra[1], kpi.corBarra[2])
    doc.rect(cardX, currentY, 2.5, cardHeight, 'F')

    // Textos do card
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.titulo, cardX + 5, currentY + 5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(15, 23, 42)
    doc.text(kpi.valor, cardX + 5, currentY + 12.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.sub, cardX + 5, currentY + 18)
  })

  currentY += cardHeight + 6

  // 3. Gráfico de Série Temporal Contínua (24 Meses) com Destaques
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text(
    `Série Histórica Contínua de 24 Meses com Destaques de Máxima e Mínima (${data.utilidadeSelecionada})`,
    margin,
    currentY,
  )
  currentY += 3.5

  const areaImg = renderArea24MesesCanvas(
    data.monthPoints,
    data.maxPoint?.label
      ? data.monthPoints.find((m) => m.label === data.maxPoint?.label)?.key
      : undefined,
    data.minPoint?.label
      ? data.monthPoints.find((m) => m.label === data.minPoint?.label)?.key
      : undefined,
    1200,
    380,
    accentColor,
  )

  if (areaImg) {
    const areaH = 64
    doc.addImage(areaImg, 'PNG', margin, currentY, contentWidth, areaH)
    currentY += areaH + 6
  }

  // 4. Comparativo Anual (Ano 1 vs Ano 2)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Comparativo Sazonal Lado a Lado: Ano 1 vs. Ano 2', margin, currentY)
  currentY += 3.5

  const compImg = renderComparativo24MesesCanvas(data.comparativoData, 1200, 360, accentColor)

  if (compImg) {
    const compH = 54
    doc.addImage(compImg, 'PNG', margin, currentY, contentWidth, compH)
    currentY += compH + 6
  }

  desenharRodapePdfPadrao(doc, 1, 2, margin, pageWidth, pageHeight)

  // =========================================================================
  // PÁGINA 2: TABELA MENSAL COMPLETA COM VARIAÇÃO % E CLASSIFICAÇÃO
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(2)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Detalhamento Mensal Completo — 24 Competências', margin, currentY)
  currentY += 3.5

  const tableHeaders = [
    [
      'Mês / Ano',
      'Consumo Apurado',
      'Valor Total (R$)',
      'Variação vs Mês Anterior (%)',
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

    let classifStr = 'Regular'
    if (r.isMax) classifStr = 'Pico (Máxima)'
    else if (r.isMin) classifStr = 'Menor Gasto (Mínima)'

    return [
      r.label,
      r.consumo > 0 ? formatNumberBR(r.consumo) : '-',
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
        fontSize: 7,
        cellPadding: 1.8,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: (hookData: any) => {
        // Destaques de linha na tabela
        if (hookData.section === 'body') {
          const rowData = data.tableRows[hookData.row.index]
          if (rowData?.isMax) {
            hookData.cell.styles.fillColor = [254, 242, 242] // vermelho claro
            if (hookData.column.index === 4) {
              hookData.cell.styles.textColor = [185, 28, 28]
              hookData.cell.styles.fontStyle = 'bold'
            }
          } else if (rowData?.isMin) {
            hookData.cell.styles.fillColor = [240, 253, 244] // verde claro
            if (hookData.column.index === 4) {
              hookData.cell.styles.textColor = [21, 128, 61]
              hookData.cell.styles.fontStyle = 'bold'
            }
          }
        }
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 28 },
        1: { halign: 'right', cellWidth: 35 },
        2: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
        3: { halign: 'right', cellWidth: 45 },
        4: { halign: 'center', cellWidth: 'auto' },
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 8
  }

  // Nota Institucional
  doc.setFillColor(241, 245, 249)
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(margin, currentY, contentWidth, 20, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(15, 23, 42)
  doc.text('CONSIDERAÇÕES DE ANÁLISE COMPARATIVA:', margin + 4, currentY + 4.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(71, 85, 105)
  doc.text(
    `• Variações sazonais superiores a 15% entre ciclos anuais indicam possíveis alterações operacionais ou recomposição tarifária da distribuidora.`,
    margin + 4,
    currentY + 8.5,
  )
  doc.text(
    `• Documento corporativo emitido em ${dataGeracaoStr} via Gestor de Utilidades Dekazen.`,
    margin + 4,
    currentY + 12.5,
  )
  doc.text(
    '• Faturas sob contestação ou com estimativa de leitura podem sofrer ajuste retroativo na série histórica.',
    margin + 4,
    currentY + 16.5,
  )

  desenharRodapePdfPadrao(doc, 2, 2, margin, pageWidth, pageHeight)

  // Nome do arquivo
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
