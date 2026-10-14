/**
 * Gerador de Relatório Executivo em PDF para Emissões de GEE (GHG Protocol).
 *
 * Utiliza carregamento dinâmico via CDN (jsPDF + jsPDF-AutoTable) no mesmo padrão
 * robusto adotado em src/lib/pdfToImages.ts, com renderização de gráficos nativos em Canvas
 * e tabelas/estilos alinhados à identidade visual do Gestor de Utilidades.
 */

import { formatNumberBR, formatTCO2e } from '@/lib/cnpj'

const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
const JSPDF_AUTOTABLE_CDN_URL =
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'

let jsPdfLoadingPromise: Promise<any> | null = null

export async function loadJsPdf(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('A geração de PDF só pode ser executada no navegador.')
  }

  const win = window as any
  if (win.jspdf && win.jspdf.jsPDF) {
    return win.jspdf.jsPDF
  }

  if (jsPdfLoadingPromise) {
    return jsPdfLoadingPromise
  }

  jsPdfLoadingPromise = new Promise((resolve, reject) => {
    // 1. Carregar jsPDF
    const scriptJsPdf = document.createElement('script')
    scriptJsPdf.src = JSPDF_CDN_URL
    scriptJsPdf.async = true
    scriptJsPdf.onload = () => {
      // 2. Carregar plugin autoTable em seguida
      const scriptAutoTable = document.createElement('script')
      scriptAutoTable.src = JSPDF_AUTOTABLE_CDN_URL
      scriptAutoTable.async = true
      scriptAutoTable.onload = () => {
        if (win.jspdf && win.jspdf.jsPDF) {
          resolve(win.jspdf.jsPDF)
        } else {
          reject(new Error('jsPDF carregado, mas objeto window.jspdf.jsPDF não disponível.'))
        }
      }
      scriptAutoTable.onerror = () => {
        // Fallback: mesmo sem autoTable, jsPDF funciona
        if (win.jspdf && win.jspdf.jsPDF) {
          resolve(win.jspdf.jsPDF)
        } else {
          reject(new Error('Falha ao carregar dependência jspdf-autotable.'))
        }
      }
      document.head.appendChild(scriptAutoTable)
    }
    scriptJsPdf.onerror = () => {
      jsPdfLoadingPromise = null
      reject(new Error('Falha ao carregar biblioteca jsPDF via CDN.'))
    }
    document.head.appendChild(scriptJsPdf)
  })

  return jsPdfLoadingPromise
}

export interface EmissoesPdfData {
  nomeEmpreendimento: string
  periodoCobertura: string
  total24Meses: number
  totalEscopo1: number
  totalEscopo2: number
  totalEscopo3: number
  mediaMensal: number
  maxPoint: { label: string; totalTCO2e: number } | null
  minPoint: { label: string; totalTCO2e: number } | null
  slots: Array<{
    key: string
    label: string
    shortMonth: string
    ano: number
    mes: number
    totalTCO2e: number
    escopo1: number
    escopo2: number
    escopo3: number
    consumoEnergiaKwh: number
    consumoGasM3: number
    consumoAguaM3: number
    fatorEnergiaAplicado: number
    isEnergiaOficial: boolean
  }>
  comparativoData: Array<{
    mes: string
    ano1Label: string
    ano1Valor: number
    ano2Label: string
    ano2Valor: number
  }>
  breakdownEmpreendimentos: Array<{
    nome: string
    totalTCO2e: number
    escopo1: number
    escopo2: number
    escopo3: number
  }>
}

/**
 * Renderiza gráfico de barras empilhadas de 24 meses em canvas e retorna DataURL PNG.
 */
function renderStackedBarChartCanvas(
  slots: EmissoesPdfData['slots'],
  width = 1200,
  height = 420,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // Fundo branco limpo
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const paddingLeft = 70
  const paddingRight = 40
  const paddingTop = 45
  const paddingBottom = 65

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  // Encontrar valor máximo
  const maxVal = Math.max(...slots.map((s) => s.totalTCO2e), 1)
  // Arredondar para teto estético
  const yMax = Math.ceil(maxVal * 1.15 * 10) / 10

  // Linhas de grade e eixos Y
  const gridSteps = 5
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 16px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    ctx.fillText(`${yVal.toFixed(1)} t`, paddingLeft - 12, yPos)
  }

  // Desenhar barras empilhadas
  const count = slots.length || 1
  const slotWidth = chartWidth / count
  const barWidth = Math.max(12, slotWidth * 0.68)

  slots.forEach((slot, idx) => {
    const xCenter = paddingLeft + slotWidth * idx + slotWidth / 2
    const xLeft = xCenter - barWidth / 2

    const hTotal = (slot.totalTCO2e / yMax) * chartHeight
    const hE1 = (slot.escopo1 / yMax) * chartHeight
    const hE2 = (slot.escopo2 / yMax) * chartHeight
    const hE3 = (slot.escopo3 / yMax) * chartHeight

    let currentY = paddingTop + chartHeight

    // Escopo 1 (Gás) - Verde petróleo / Teal escuro
    if (hE1 > 0) {
      currentY -= hE1
      ctx.fillStyle = '#0F766E'
      ctx.fillRect(xLeft, currentY, barWidth, hE1)
    }

    // Escopo 2 (Energia) - Âmbar
    if (hE2 > 0) {
      currentY -= hE2
      ctx.fillStyle = '#F59E0B'
      ctx.fillRect(xLeft, currentY, barWidth, hE2)
    }

    // Escopo 3 (Água) - Azul celeste
    if (hE3 > 0) {
      currentY -= hE3
      ctx.fillStyle = '#0EA5E9'
      ctx.fillRect(xLeft, currentY, barWidth, hE3)
    }

    // Rótulo X (mes/ano)
    ctx.fillStyle = '#475569'
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    // Alternar ou inclinar levemente se muitos slots
    ctx.save()
    ctx.translate(xCenter, paddingTop + chartHeight + 10)
    ctx.rotate(-Math.PI / 4.5)
    ctx.fillText(slot.label, 0, 0)
    ctx.restore()
  })

  // Legenda no topo
  const legendItems = [
    { label: 'Escopo 1 — Gás Natural', color: '#0F766E' },
    { label: 'Escopo 2 — Energia Elétrica (SIN)', color: '#F59E0B' },
    { label: 'Escopo 3 — Água e Esgoto', color: '#0EA5E9' },
  ]

  let legendX = paddingLeft + 10
  const legendY = 16
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 15px sans-serif'

  legendItems.forEach((item) => {
    ctx.fillStyle = item.color
    ctx.fillRect(legendX, legendY - 6, 14, 14)
    ctx.fillStyle = '#1E293B'
    ctx.fillText(item.label, legendX + 22, legendY)
    legendX += ctx.measureText(item.label).width + 50
  })

  return canvas.toDataURL('image/png')
}

/**
 * Renderiza gráfico comparativo Ano 1 vs Ano 2 em canvas e retorna DataURL PNG.
 */
function renderComparativoCanvas(
  comparativo: EmissoesPdfData['comparativoData'],
  width = 1200,
  height = 360,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const paddingLeft = 70
  const paddingRight = 40
  const paddingTop = 45
  const paddingBottom = 45

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const maxVal = Math.max(...comparativo.flatMap((c) => [c.ano1Valor, c.ano2Valor]), 1)
  const yMax = Math.ceil(maxVal * 1.15 * 10) / 10

  // Linhas de grade
  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    ctx.fillText(`${yVal.toFixed(1)} t`, paddingLeft - 10, yPos)
  }

  const count = comparativo.length || 1
  const slotWidth = chartWidth / count
  const barWidth = Math.max(8, slotWidth * 0.36)
  const gap = 4

  comparativo.forEach((item, idx) => {
    const xCenter = paddingLeft + slotWidth * idx + slotWidth / 2

    // Barra Ano 1 (cinza ardósia)
    const h1 = (item.ano1Valor / yMax) * chartHeight
    const x1 = xCenter - barWidth - gap / 2
    const y1 = paddingTop + chartHeight - h1
    ctx.fillStyle = '#94A3B8'
    ctx.fillRect(x1, y1, barWidth, h1)

    // Barra Ano 2 (verde escuro institucional)
    const h2 = (item.ano2Valor / yMax) * chartHeight
    const x2 = xCenter + gap / 2
    const y2 = paddingTop + chartHeight - h2
    ctx.fillStyle = '#0F766E'
    ctx.fillRect(x2, y2, barWidth, h2)

    // Rótulo mês
    ctx.fillStyle = '#475569'
    ctx.font = 'bold 15px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(item.mes, xCenter, paddingTop + chartHeight + 10)
  })

  // Legenda
  const legItems = [
    { label: 'Ano 1 (12 meses anteriores)', color: '#94A3B8' },
    { label: 'Ano 2 (12 meses recentes)', color: '#0F766E' },
  ]
  let lx = paddingLeft + 10
  ctx.font = 'bold 15px sans-serif'
  legItems.forEach((leg) => {
    ctx.fillStyle = leg.color
    ctx.fillRect(lx, 16 - 6, 14, 14)
    ctx.fillStyle = '#1E293B'
    ctx.fillText(leg.label, lx + 22, 16)
    lx += ctx.measureText(leg.label).width + 50
  })

  return canvas.toDataURL('image/png')
}

/**
 * Função principal que orquestra a geração e download do PDF com formatação institucional.
 */
export async function gerarRelatorioEmissoesPDF(data: EmissoesPdfData): Promise<void> {
  const jsPDF = await loadJsPdf()

  // Criar documento formato A4 vertical
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

  // Função auxiliar para desenhar cabeçalho corporativo padronizado
  const desenharCabecalho = (numeroPagina: number) => {
    // Top bar institucional teal escuro
    doc.setFillColor(15, 118, 110) // #0F766E
    doc.rect(margin, currentY, contentWidth, 24, 'F')

    // Título principal
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('GESTOR DE UTILIDADES — RELATÓRIO DE EMISSÕES DE GEE', margin + 6, currentY + 9)

    // Subtítulo técnico
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(
      'Inventário Corporativo segundo Diretrizes do Programa Brasileiro GHG Protocol (Escopos 1, 2 e 3)',
      margin + 6,
      currentY + 16,
    )

    // Metadata bar logo abaixo
    currentY += 28
    doc.setFillColor(248, 250, 252) // #F8FAFC
    doc.setDrawColor(226, 232, 240) // #E2E8F0
    doc.roundedRect(margin, currentY, contentWidth, 14, 1.5, 1.5, 'FD')

    doc.setFontSize(8)
    doc.setTextColor(71, 85, 105)

    doc.setFont('helvetica', 'bold')
    doc.text('Empreendimento:', margin + 4, currentY + 5.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    const empTruncado =
      data.nomeEmpreendimento.length > 40
        ? data.nomeEmpreendimento.slice(0, 38) + '...'
        : data.nomeEmpreendimento
    doc.text(empTruncado, margin + 30, currentY + 5.5)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text('Período:', margin + 4, currentY + 10.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.text(data.periodoCobertura, margin + 30, currentY + 10.5)

    const rightColX = margin + contentWidth - 48
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text('Emissão:', rightColX, currentY + 5.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.text(dataGeracaoStr, rightColX + 16, currentY + 5.5)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text('Página:', rightColX, currentY + 10.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.text(`${numeroPagina}`, rightColX + 16, currentY + 10.5)

    currentY += 18
  }

  // Função auxiliar para desenhar rodapé institucional
  const desenharRodape = (numeroPagina: number, totalPaginas?: number) => {
    const rodapeY = pageHeight - 12
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, rodapeY - 2, pageWidth - margin, rodapeY - 2)

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(148, 163, 184)
    doc.text(
      'Metodologia: GHG Protocol / MCTI-SIRENE (Energia Elétrica) / IPCC 2006 (Gás Natural) / PB GHG Protocol (Água e Esgoto)',
      margin,
      rodapeY + 2,
    )
    doc.text(
      `Página ${numeroPagina}${totalPaginas ? ` de ${totalPaginas}` : ''}`,
      pageWidth - margin,
      rodapeY + 2,
      { align: 'right' },
    )
  }

  // =========================================================================
  // PÁGINA 1: RESUMO EXECUTIVO + CARDS KPI + GRÁFICO 24 MESES + COMPARATIVO
  // =========================================================================
  desenharCabecalho(1)

  // 1. Banner Resumo Executivo
  doc.setFillColor(240, 253, 250) // teal-50
  doc.setDrawColor(204, 251, 241)
  doc.roundedRect(margin, currentY, contentWidth, 14, 1.5, 1.5, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 118, 110)
  doc.text('RESUMO EXECUTIVO DO INVENTÁRIO DE CARBONO', margin + 4, currentY + 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(19, 78, 74)
  doc.text(
    'Apuração consolidada da pegada de emissões de gases de efeito estufa para o período analisado.',
    margin + 4,
    currentY + 10,
  )

  currentY += 18

  // 2. Grid de 4 Cards KPI
  const cardWidth = (contentWidth - 9) / 4
  const cardHeight = 22

  const kpis = [
    {
      titulo: 'TOTAL DO PERÍODO',
      valor: formatTCO2e(data.total24Meses, 2),
      sub: `Média: ${formatTCO2e(data.mediaMensal, 2)}/mês`,
      corBarra: [15, 118, 110], // Teal
    },
    {
      titulo: 'ESCOPO 1 (GÁS)',
      valor: formatTCO2e(data.totalEscopo1, 2),
      sub:
        data.total24Meses > 0
          ? `${((data.totalEscopo1 / data.total24Meses) * 100).toFixed(1)}% do total`
          : '0% do total',
      corBarra: [20, 184, 166], // Teal claro
    },
    {
      titulo: 'ESCOPO 2 (ENERGIA)',
      valor: formatTCO2e(data.totalEscopo2, 2),
      sub:
        data.total24Meses > 0
          ? `${((data.totalEscopo2 / data.total24Meses) * 100).toFixed(1)}% do total`
          : '0% do total',
      corBarra: [245, 158, 11], // Âmbar
    },
    {
      titulo: 'ESCOPO 3 (ÁGUA/ESG)',
      valor: formatTCO2e(data.totalEscopo3, 2),
      sub:
        data.total24Meses > 0
          ? `${((data.totalEscopo3 / data.total24Meses) * 100).toFixed(1)}% do total`
          : '0% do total',
      corBarra: [14, 165, 233], // Azul
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
    doc.setFontSize(10.5)
    doc.setTextColor(15, 23, 42)
    doc.text(kpi.valor, cardX + 5, currentY + 12.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(100, 116, 139)
    doc.text(kpi.sub, cardX + 5, currentY + 18)
  })

  currentY += cardHeight + 6

  // 3. Gráfico de Barras Empilhadas de 24 Meses
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Evolução Mensal de Emissões — Série de 24 Meses (tCO₂e)', margin, currentY)
  currentY += 3.5

  const chartImgStacked = renderStackedBarChartCanvas(data.slots)
  if (chartImgStacked) {
    const imgHeight = 65
    doc.addImage(chartImgStacked, 'PNG', margin, currentY, contentWidth, imgHeight)
    currentY += imgHeight + 6
  }

  // 4. Comparativo Ano 1 vs Ano 2 ou Ranking (conforme espaço na página 1)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Comparativo Sazonal: Ano 1 vs. Ano 2 (tCO₂e)', margin, currentY)
  currentY += 3.5

  const chartImgComparativo = renderComparativoCanvas(data.comparativoData)
  if (chartImgComparativo) {
    const compHeight = 52
    doc.addImage(chartImgComparativo, 'PNG', margin, currentY, contentWidth, compHeight)
    currentY += compHeight + 4
  }

  // Destaques de Máxima e Mínima
  if (data.maxPoint && data.minPoint) {
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(margin, currentY, contentWidth, 10, 1, 1, 'FD')

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(220, 38, 38)
    doc.text(
      `Pico Histórico: ${data.maxPoint.label} (${formatTCO2e(data.maxPoint.totalTCO2e, 3)})`,
      margin + 4,
      currentY + 6,
    )

    doc.setTextColor(22, 163, 74)
    doc.text(
      `Menor Emissão: ${data.minPoint.label} (${formatTCO2e(data.minPoint.totalTCO2e, 3)})`,
      margin + contentWidth / 2 + 4,
      currentY + 6,
    )
  }

  desenharRodape(1)

  // =========================================================================
  // PÁGINA 2: TABELA DETALHADA + RANKING + NOTA METODOLÓGICA COMPLETA
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(2)

  // Se houver mais de um empreendimento, desenhar Ranking
  if (data.breakdownEmpreendimentos && data.breakdownEmpreendimentos.length > 1) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text('Ranking de Emissões por Empreendimento (Top Unidades)', margin, currentY)
    currentY += 3

    const rankingHeaders = [
      [
        '#',
        'Empreendimento',
        'Escopo 1 (Gás)',
        'Escopo 2 (Energia)',
        'Escopo 3 (Água)',
        'Total tCO₂e',
        'Part. %',
      ],
    ]
    const rankingBody = data.breakdownEmpreendimentos.map((emp, idx) => {
      const part = data.total24Meses > 0 ? (emp.totalTCO2e / data.total24Meses) * 100 : 0
      return [
        String(idx + 1),
        emp.nome,
        formatTCO2e(emp.escopo1, 2),
        formatTCO2e(emp.escopo2, 2),
        formatTCO2e(emp.escopo3, 2),
        formatTCO2e(emp.totalTCO2e, 2),
        `${part.toFixed(1)}%`,
      ]
    })

    if (typeof (doc as any).autoTable === 'function') {
      ;(doc as any).autoTable({
        startY: currentY,
        head: rankingHeaders,
        body: rankingBody,
        theme: 'striped',
        margin: { left: margin, right: margin },
        styles: {
          fontSize: 7,
          cellPadding: 1.8,
          textColor: [30, 41, 59],
        },
        headStyles: {
          fillColor: [15, 118, 110],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 'auto', fontStyle: 'bold' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' },
          6: { halign: 'right' },
        },
      })
      currentY = (doc as any).lastAutoTable.finalY + 6
    }
  }

  // Tabela Detalhada Mensal
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text('Detalhamento Mensal de Consumos e Fatores de Emissão Aplicados', margin, currentY)
  currentY += 3

  const reversedSlots = [...data.slots].reverse()
  const tableHeaders = [
    [
      'Mês/Ano',
      'Consumo Gás',
      'Escopo 1',
      'Consumo Elétrico',
      'Fator SIN (kg/MWh)',
      'Escopo 2',
      'Consumo Água',
      'Escopo 3',
      'Total (tCO₂e)',
    ],
  ]

  const tableBody = reversedSlots.map((s) => {
    const fatorSinStr =
      s.fatorEnergiaAplicado > 0
        ? `${(s.fatorEnergiaAplicado * 1000).toFixed(1)} (${s.isEnergiaOficial ? 'Oficial' : 'Fallback'})`
        : '-'

    return [
      s.label,
      `${formatNumberBR(s.consumoGasM3, 0)} m³`,
      formatTCO2e(s.escopo1, 3),
      `${formatNumberBR(s.consumoEnergiaKwh, 0)} kWh`,
      fatorSinStr,
      formatTCO2e(s.escopo2, 3),
      `${formatNumberBR(s.consumoAguaM3, 0)} m³`,
      formatTCO2e(s.escopo3, 3),
      formatTCO2e(s.totalTCO2e, 3),
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
        fontSize: 6.5,
        cellPadding: 1.5,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 6.5,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 18 },
        1: { halign: 'right', cellWidth: 20 },
        2: { halign: 'right', cellWidth: 18 },
        3: { halign: 'right', cellWidth: 22 },
        4: { halign: 'center', cellWidth: 24 },
        5: { halign: 'right', cellWidth: 18 },
        6: { halign: 'right', cellWidth: 20 },
        7: { halign: 'right', cellWidth: 18 },
        8: { halign: 'right', fontStyle: 'bold', cellWidth: 24 },
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 6
  }

  // Nota Metodológica e Enquadramento Técnico
  // Garantir que cabe na página ou adiciona página 3
  if (currentY > pageHeight - 45) {
    desenharRodape(2)
    doc.addPage()
    currentY = margin
    desenharCabecalho(3)
  }

  doc.setFillColor(241, 245, 249) // #F1F5F9
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(margin, currentY, contentWidth, 26, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(15, 23, 42)
  doc.text('NOTA METODOLÓGICA E PREMISSAS TÉCNICAS (GHG PROTOCOL):', margin + 4, currentY + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(71, 85, 105)

  const notas = [
    '• Escopo 1 (Gás Natural Canalizado): Combustão estacionária calculada com 2,15 kgCO₂e/m³ baseado nas Diretrizes IPCC 2006 e Programa Brasileiro GHG Protocol (Poder Calorífico Inferior 38,3 MJ/m³ e Fator Específico 15,3 tC/TJ).',
    '• Escopo 2 (Energia Elétrica): Abordagem baseada na localização (location-based). Fator médio mensal de emissão do Sistema Interligado Nacional (SIN) publicado oficialmente pelo MCTI/SIRENE em tCO₂/MWh. Nos meses sem publicação oficial, adota-se fallback provisório de 0,050 tCO₂/MWh.',
    '• Escopo 3 (Água e Esgoto): Fator composto setorial de 0,908 kgCO₂e/m³ (sendo 0,208 kgCO₂e/m³ para captação/abastecimento e 0,700 kgCO₂e/m³ para tratamento de efluentes sanitários).',
    `• Documento gerado eletronicamente pela plataforma Gestor de Utilidades em ${dataGeracaoStr}. Todos os valores apurados com base nas faturas homologadas no sistema.`,
  ]

  let notaY = currentY + 9.5
  notas.forEach((nota) => {
    doc.text(nota, margin + 4, notaY)
    notaY += 4
  })

  // Rodapé da última página
  const totalPaginas = doc.getNumberOfPages ? doc.getNumberOfPages() : 2
  desenharRodape(doc.internal.getCurrentPageInfo().pageNumber, totalPaginas)

  // Gerar nome de arquivo amigável: emissoes-{empreendimento|todos}-{periodo}.pdf
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

  const filename = `emissoes-${safeEmp}-${safePeriodo}.pdf`

  // Salvar / iniciar download
  doc.save(filename)
}
