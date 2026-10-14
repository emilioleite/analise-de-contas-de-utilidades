/**
 * Gerador de Relatório Executivo em PDF para o Dashboard Geral.
 *
 * Padrão A4 institucional cliente-side (jsPDF + jsPDF-AutoTable carregados via CDN),
 * com gráficos em Canvas nativo (Donut de Utilidades, Linha de Evolução Mensal e
 * Barras das Maiores Faturas), KPIs consolidados e tabela das faturas de maior relevância.
 * Identidade visual corporativa Dekazen com monograma DKZ.
 */

import { formatCurrencyBRL, formatDateBR } from '@/lib/cnpj'
import { loadJsPdf } from '@/services/relatorioEmissoesPdf'
import {
  getDekazenLogoDataUrl,
  desenharCabecalhoPdfPadrao,
  desenharRodapePdfPadrao,
} from '@/services/pdfBranding'

export interface DashboardPdfData {
  nomeEmpreendimento: string
  periodoCobertura: string
  total12m: number
  energia12m: number
  agua12m: number
  gas12m: number
  donutData: Array<{ name: string; value: number; color: string }>
  lineData: Array<{
    label: string
    energia: number
    agua: number
    gas: number
    total: number
  }>
  topConsumos: Array<{
    id: string
    nome: string
    tipo: string
    competencia: string
    valor: number
  }>
}

/**
 * Renderiza gráfico de Donut em Canvas para o PDF
 */
function renderDonutChartCanvas(
  donutData: DashboardPdfData['donutData'],
  total: number,
  width = 600,
  height = 360,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const centerX = width * 0.35
  const centerY = height * 0.5
  const outerRadius = Math.min(centerX, centerY) - 20
  const innerRadius = outerRadius * 0.58

  if (total <= 0 || donutData.length === 0) {
    ctx.fillStyle = '#94A3B8'
    ctx.font = '14px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Sem gastos no período', centerX, centerY)
    return canvas.toDataURL('image/png')
  }

  let currentAngle = -Math.PI / 2

  donutData.forEach((slice) => {
    const sliceAngle = (slice.value / total) * (Math.PI * 2)
    ctx.beginPath()
    ctx.arc(centerX, centerY, outerRadius, currentAngle, currentAngle + sliceAngle, false)
    ctx.arc(centerX, centerY, innerRadius, currentAngle + sliceAngle, currentAngle, true)
    ctx.closePath()
    ctx.fillStyle = slice.color
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.stroke()
    currentAngle += sliceAngle
  })

  // Texto central
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('TOTAL 12M', centerX, centerY - 10)

  ctx.fillStyle = '#0F172A'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText(formatCurrencyBRL(total), centerX, centerY + 12)

  // Legenda lateral
  let legY = height * 0.28
  const legX = width * 0.65
  ctx.textAlign = 'left'

  donutData.forEach((slice) => {
    const pct = total > 0 ? ((slice.value / total) * 100).toFixed(1) : '0'
    // Ponto/quadrado de cor
    ctx.fillStyle = slice.color
    ctx.beginPath()
    if (typeof (ctx as any).roundRect === 'function') {
      ;(ctx as any).roundRect(legX, legY - 7, 12, 12, 3)
    } else {
      ctx.rect(legX, legY - 7, 12, 12)
    }
    ctx.fill()

    // Nome
    ctx.fillStyle = '#1E293B'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText(slice.name, legX + 18, legY)

    // Valor e %
    ctx.fillStyle = '#64748B'
    ctx.font = '12px sans-serif'
    ctx.fillText(`${formatCurrencyBRL(slice.value)} (${pct}%)`, legX + 18, legY + 16)

    legY += 46
  })

  return canvas.toDataURL('image/png')
}

/**
 * Renderiza gráfico de Linha (Evolução Mensal) em Canvas para o PDF
 */
function renderLineChartCanvas(
  lineData: DashboardPdfData['lineData'],
  width = 1200,
  height = 380,
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

  // Encontrar valor máximo
  const maxVal = Math.max(...lineData.flatMap((d) => [d.total, d.energia, d.agua, d.gas]), 100)
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

  const count = lineData.length || 1
  const stepX = chartWidth / Math.max(1, count - 1)

  // Função auxiliar para traçar série
  const drawSeries = (key: 'energia' | 'agua' | 'gas', color: string) => {
    if (lineData.length === 0) return
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.fillStyle = color

    lineData.forEach((d, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (d[key] / yMax) * chartHeight
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Pontos
    lineData.forEach((d, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (d[key] / yMax) * chartHeight
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // Traçar utilidades
  drawSeries('energia', '#F59E0B')
  drawSeries('agua', '#0EA5E9')
  drawSeries('gas', '#14B8A6')

  // Rótulos do eixo X
  ctx.fillStyle = '#475569'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  lineData.forEach((d, idx) => {
    const x = paddingLeft + idx * stepX
    ctx.fillText(d.label, x, paddingTop + chartHeight + 10)
  })

  // Legenda no topo
  const legend = [
    { label: 'Energia Elétrica', color: '#F59E0B' },
    { label: 'Água e Esgoto', color: '#0EA5E9' },
    { label: 'Gás Canalizado/GLP', color: '#14B8A6' },
  ]
  let lx = paddingLeft + 10
  ctx.textAlign = 'left'
  ctx.font = 'bold 13px sans-serif'
  legend.forEach((item) => {
    ctx.fillStyle = item.color
    ctx.fillRect(lx, 16 - 5, 12, 12)
    ctx.fillStyle = '#1E293B'
    ctx.fillText(item.label, lx + 18, 16)
    lx += ctx.measureText(item.label).width + 45
  })

  return canvas.toDataURL('image/png')
}

/**
 * Função principal que gera o PDF do Dashboard Geral
 */
export async function gerarRelatorioDashboardPDF(data: DashboardPdfData): Promise<void> {
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

  const desenharCabecalho = (numeroPagina: number) => {
    currentY = desenharCabecalhoPdfPadrao({
      doc,
      currentY: margin,
      margin,
      contentWidth,
      pageWidth,
      pageHeight,
      numeroPagina,
      tituloPrincipal: 'GESTOR DE UTILIDADES — DASHBOARD EXECUTIVO',
      subtitulo: 'Visão Consolidada de Gastos Operacionais com Energia, Água e Gás',
      nomeEmpreendimento: data.nomeEmpreendimento,
      periodoCobertura: data.periodoCobertura,
      dataGeracaoStr,
      logoDataUrl,
    })
  }

  // =========================================================================
  // PÁGINA 1: RESUMO + 4 CARDS KPI + GRÁFICO DONUT + EVOLUÇÃO MENSAL
  // =========================================================================
  desenharCabecalho(1)

  // 1. Banner Resumo Executivo
  doc.setFillColor(240, 253, 250) // teal-50
  doc.setDrawColor(204, 251, 241)
  doc.roundedRect(margin, currentY, contentWidth, 12, 1.5, 1.5, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 118, 110)
  doc.text('RESUMO EXECUTIVO DE CUSTOS DE UTILIDADES (12 MESES)', margin + 4, currentY + 4.8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(19, 78, 74)
  doc.text(
    `Total acumulado no período de ${formatCurrencyBRL(data.total12m)} distribuído entre energia elétrica, abastecimento/saneamento e gás.`,
    margin + 4,
    currentY + 9,
  )

  currentY += 16

  // 2. Grid de 4 Cards KPI
  const cardWidth = (contentWidth - 9) / 4
  const cardHeight = 22

  const kpis = [
    {
      titulo: 'TOTAL GASTO (12M)',
      valor: formatCurrencyBRL(data.total12m),
      sub: 'Todas as utilidades',
      corBarra: [15, 118, 110], // Teal
    },
    {
      titulo: 'ENERGIA ELÉTRICA',
      valor: formatCurrencyBRL(data.energia12m),
      sub:
        data.total12m > 0
          ? `${((data.energia12m / data.total12m) * 100).toFixed(1)}% do total`
          : '0% do total',
      corBarra: [245, 158, 11], // Âmbar
    },
    {
      titulo: 'ÁGUA E ESGOTO',
      valor: formatCurrencyBRL(data.agua12m),
      sub:
        data.total12m > 0
          ? `${((data.agua12m / data.total12m) * 100).toFixed(1)}% do total`
          : '0% do total',
      corBarra: [14, 165, 233], // Azul
    },
    {
      titulo: 'GÁS NATURAL / GLP',
      valor: formatCurrencyBRL(data.gas12m),
      sub:
        data.total12m > 0
          ? `${((data.gas12m / data.total12m) * 100).toFixed(1)}% do total`
          : '0% do total',
      corBarra: [20, 184, 166], // Teal claro
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

  // 3. Gráfico Donut: Distribuição dos Gastos por Utilidade
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Distribuição dos Custos por Utilidade (12 Meses)', margin, currentY)
  currentY += 3.5

  const donutImg = renderDonutChartCanvas(data.donutData, data.total12m)
  if (donutImg) {
    const donutH = 48
    doc.addImage(donutImg, 'PNG', margin, currentY, contentWidth, donutH)
    currentY += donutH + 6
  }

  // 4. Gráfico de Linha: Evolução Mensal dos Gastos (12 meses)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Evolução Mensal de Gastos por Utilidade (Série de 12 Meses)', margin, currentY)
  currentY += 3.5

  const lineImg = renderLineChartCanvas(data.lineData)
  if (lineImg) {
    const lineH = 58
    doc.addImage(lineImg, 'PNG', margin, currentY, contentWidth, lineH)
    currentY += lineH + 6
  }

  // Rodapé página 1
  desenharRodapePdfPadrao(doc, 1, 2, margin, pageWidth, pageHeight)

  // =========================================================================
  // PÁGINA 2: MAIORES FATURAS (TOP 5 / 10) + TABELA RESUMO MENSAL + NOTAS
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(2)

  // Tabela: Maiores Contas Registradas (Top Contas)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Maiores Contas Registradas — Faturas de Maior Impacto Financeiro', margin, currentY)
  currentY += 3.5

  const topHeaders = [['#', 'Empreendimento', 'Utilidade', 'Competência', 'Valor Fatura (R$)']]
  const topBody = data.topConsumos.map((c, idx) => [
    String(idx + 1),
    c.nome,
    c.tipo,
    formatDateBR(c.competencia).slice(3), // mm/aaaa
    formatCurrencyBRL(c.valor),
  ])

  if (typeof (doc as any).autoTable === 'function') {
    ;(doc as any).autoTable({
      startY: currentY,
      head: topHeaders,
      body: topBody,
      theme: 'striped',
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [15, 118, 110],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 'auto', fontStyle: 'bold' },
        2: { cellWidth: 40 },
        3: { cellWidth: 30, halign: 'center' },
        4: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 7
  }

  // Tabela: Detalhamento Mensal das 12 competências
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Detalhamento Mensal de Gastos — Últimos 12 Meses', margin, currentY)
  currentY += 3.5

  const reversedLine = [...data.lineData].reverse()
  const monthlyHeaders = [
    [
      'Mês/Ano',
      'Energia Elétrica (R$)',
      'Água e Esgoto (R$)',
      'Gás (R$)',
      'Total Mensal (R$)',
      'Part. %',
    ],
  ]

  const monthlyBody = reversedLine.map((m) => {
    const part = data.total12m > 0 ? (m.total / data.total12m) * 100 : 0
    return [
      m.label,
      formatCurrencyBRL(m.energia),
      formatCurrencyBRL(m.agua),
      formatCurrencyBRL(m.gas),
      formatCurrencyBRL(m.total),
      `${part.toFixed(1)}%`,
    ]
  })

  if (typeof (doc as any).autoTable === 'function') {
    ;(doc as any).autoTable({
      startY: currentY,
      head: monthlyHeaders,
      body: monthlyBody,
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
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 24 },
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'right', cellWidth: 20 },
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 7
  }

  // Nota Institucional Dekazen
  doc.setFillColor(241, 245, 249) // #F1F5F9
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(margin, currentY, contentWidth, 20, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(15, 23, 42)
  doc.text('NOTAS CORPORATIVAS E PREMISSAS:', margin + 4, currentY + 4.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(71, 85, 105)
  doc.text(
    '• Relatório gerado a partir do processamento e homologação das faturas das concessionárias atendidas pela Dekazen.',
    margin + 4,
    currentY + 8.5,
  )
  doc.text(
    `• Os valores apresentados refletem os lançamentos vigentes no Gestor de Utilidades em ${dataGeracaoStr}.`,
    margin + 4,
    currentY + 12.5,
  )
  doc.text(
    '• Para detalhamento de bandeiras tarifárias, tarifas ponta/fora-ponta ou histórico de 24 meses, acerte a aba Análise 24 Meses.',
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

  const safePeriodo =
    data.periodoCobertura
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'periodo'

  const filename = `dashboard-dekazen-${safeEmp}-${safePeriodo}.pdf`
  doc.save(filename)
}
