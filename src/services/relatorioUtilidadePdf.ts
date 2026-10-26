/**
 * Gerador de Relatório Executivo em PDF por Utilidade para o Dashboard.
 *
 * Gera o relatório em formato A4 institucional Dekazen focado especificamente
 * em UMA utilidade (Água e Esgoto, Gás Natural ou Energia Elétrica):
 * - Cabeçalho institucional com monograma Dekazen e título da utilidade
 * - KPIs da utilidade: Gasto Total (R$), Consumo Total (m³ ou kWh), Tarifa Média (R$/unidade), etc.
 * - Gráfico de Evolução Mensal do CONSUMO na unidade física (m³ ou kWh)
 * - Gráfico de Evolução Mensal do GASTO em R$
 * - Tabela mensal resumida das competências (Competência, Consumo físico com unidade, Valor Total R$, Tarifa R$/unidade)
 * - Notas corporativas e premissas de apuração.
 */

import { formatCurrencyBRL, formatNumberBR } from '@/lib/cnpj'
import { TipoUtilidade } from '@/types/entities'
import { loadJsPdf } from '@/services/relatorioEmissoesPdf'
import {
  getDekazenLogoDataUrl,
  desenharCabecalhoPdfPadrao,
  desenharRodapePdfPadrao,
} from '@/services/pdfBranding'

export interface RelatorioUtilidadePdfData {
  nomeEmpreendimento: string
  periodoCobertura: string
  tipoUtilidade: TipoUtilidade
  unidadeConsumo: string
  rotuloTarifa: string
  corTema: string // hex color
  gastoTotal: number
  consumoTotal: number
  tarifaMedia: number
  mesesComDados: number
  meses: Array<{
    key: string
    label: string
    consumo: number
    valor: number
    tarifa: number
  }>
}

/**
 * Renderiza gráfico de área ou linha para série física ou financeira em canvas
 */
function renderChartCanvas({
  data,
  dataKey,
  unidade,
  prefixo = '',
  cor,
  largura = 1200,
  altura = 340,
}: {
  data: RelatorioUtilidadePdfData['meses']
  dataKey: 'consumo' | 'valor'
  unidade: string
  prefixo?: string
  cor: string
  largura?: number
  altura?: number
}): string {
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, largura, altura)

  const paddingLeft = 85
  const paddingRight = 35
  const paddingTop = 40
  const paddingBottom = 50

  const chartWidth = largura - paddingLeft - paddingRight
  const chartHeight = altura - paddingTop - paddingBottom

  const maxVal = Math.max(...data.map((d) => d[dataKey]), 10)
  // Cálculo de yMax com margem
  const factor = maxVal > 1000 ? 1000 : maxVal > 100 ? 50 : 10
  const yMax = Math.ceil((maxVal * 1.18) / factor) * factor || 100

  // Linhas de grade horizontais
  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    let labelStr = ''
    if (prefixo) {
      labelStr =
        yVal >= 1000 ? `${prefixo} ${(yVal / 1000).toFixed(0)}k` : `${prefixo} ${Math.round(yVal)}`
    } else {
      labelStr =
        yVal >= 1000 ? `${(yVal / 1000).toFixed(1)}k ${unidade}` : `${Math.round(yVal)} ${unidade}`
    }
    ctx.fillText(labelStr, paddingLeft - 10, yPos)
  }

  const count = data.length || 1
  const stepX = chartWidth / Math.max(1, count - 1)

  // Encontrar pico e mínimo (dentre os valores > 0)
  let maxIdx = -1
  let minIdx = -1
  let maxP = -Infinity
  let minP = Infinity

  data.forEach((d, idx) => {
    const v = d[dataKey]
    if (v > maxP) {
      maxP = v
      maxIdx = idx
    }
    if (v > 0 && v < minP) {
      minP = v
      minIdx = idx
    }
  })

  // Área preenchida
  if (data.length > 1) {
    ctx.beginPath()
    ctx.moveTo(paddingLeft, paddingTop + chartHeight)
    data.forEach((d, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (d[dataKey] / yMax) * chartHeight
      ctx.lineTo(x, y)
    })
    ctx.lineTo(paddingLeft + (count - 1) * stepX, paddingTop + chartHeight)
    ctx.closePath()

    // Gradiente suave para a área
    const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight)
    gradient.addColorStop(0, hexToRgba(cor, 0.22))
    gradient.addColorStop(1, hexToRgba(cor, 0.02))
    ctx.fillStyle = gradient
    ctx.fill()

    // Linha principal
    ctx.beginPath()
    ctx.strokeStyle = cor
    ctx.lineWidth = 2.8
    data.forEach((d, idx) => {
      const x = paddingLeft + idx * stepX
      const y = paddingTop + chartHeight - (d[dataKey] / yMax) * chartHeight
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  // Pontos e destaques
  data.forEach((d, idx) => {
    const x = paddingLeft + idx * stepX
    const y = paddingTop + chartHeight - (d[dataKey] / yMax) * chartHeight
    const val = d[dataKey]

    if (idx === maxIdx && val > 0) {
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
      ctx.fillText('Pico', x, y - 7)
    } else if (idx === minIdx && val > 0 && maxIdx !== minIdx) {
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
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = cor
      ctx.fill()
    }
  })

  // Eixo X (rótulos de competência)
  ctx.fillStyle = '#475569'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  data.forEach((d, idx) => {
    const x = paddingLeft + idx * stepX
    ctx.fillText(d.label, x, paddingTop + chartHeight + 10)
  })

  return canvas.toDataURL('image/png')
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  if (c.length === 6) {
    const r = parseInt(c.slice(0, 2), 16)
    const g = parseInt(c.slice(2, 4), 16)
    const b = parseInt(c.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return `rgba(15, 118, 110, ${alpha})`
}

/**
 * Função principal que gera o relatório PDF específico de UMA utilidade
 */
export async function gerarRelatorioUtilidadePDF(data: RelatorioUtilidadePdfData): Promise<void> {
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

  const nomeExibicaoUtilidade =
    data.tipoUtilidade === 'Gás'
      ? 'GÁS NATURAL / GLP'
      : data.tipoUtilidade === 'Água e Esgoto'
        ? 'ÁGUA E ESGOTO'
        : 'ENERGIA ELÉTRICA'

  const desenharCabecalho = (numeroPagina: number) => {
    currentY = desenharCabecalhoPdfPadrao({
      doc,
      currentY: margin,
      margin,
      contentWidth,
      pageWidth,
      pageHeight,
      numeroPagina,
      tituloPrincipal: `RELATÓRIO DE ${nomeExibicaoUtilidade}`,
      subtitulo: `Apuração Detalhada de Consumo Físico (${data.unidadeConsumo}) e Desembolso Financeiro (R$)`,
      nomeEmpreendimento: data.nomeEmpreendimento,
      periodoCobertura: data.periodoCobertura,
      dataGeracaoStr,
      logoDataUrl,
    })
  }

  // =========================================================================
  // PÁGINA 1: RESUMO + CARDS KPI + GRÁFICO CONSUMO FÍSICO + GRÁFICO GASTO R$
  // =========================================================================
  desenharCabecalho(1)

  // 1. Banner Resumo Executivo
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(margin, currentY, contentWidth, 13, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text(`ANÁLISE EXCLUSIVA DE ${nomeExibicaoUtilidade}`, margin + 4, currentY + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(71, 85, 105)
  doc.text(
    `Período de apuração com ${data.mesesComDados} faturas registradas, totalizando ${formatCurrencyBRL(
      data.gastoTotal,
    )} e ${formatNumberBR(data.consumoTotal, 2)} ${data.unidadeConsumo}.`,
    margin + 4,
    currentY + 9.5,
  )

  currentY += 17

  // 2. Grid de Cards KPI da Utilidade
  const cardWidth = (contentWidth - 6) / 3
  const cardHeight = 22

  const rgbBarra =
    data.tipoUtilidade === 'Energia Elétrica'
      ? [245, 158, 11]
      : data.tipoUtilidade === 'Água e Esgoto'
        ? [14, 165, 233]
        : [20, 184, 166]

  const kpis = [
    {
      titulo: 'GASTO TOTAL DO PERÍODO',
      valor: formatCurrencyBRL(data.gastoTotal),
      sub: 'Desembolso em contas da utilidade',
    },
    {
      titulo: `CONSUMO TOTAL (${data.unidadeConsumo})`,
      valor: `${formatNumberBR(data.consumoTotal, 2)} ${data.unidadeConsumo}`,
      sub: 'Volume total apurado no período',
    },
    {
      titulo: `TARIFA MÉDIA APLICADA`,
      valor:
        data.tarifaMedia > 0
          ? `${formatCurrencyBRL(data.tarifaMedia)} / ${data.unidadeConsumo}`
          : '—',
      sub: `Média ponderada do custo por ${data.unidadeConsumo}`,
    },
  ]

  kpis.forEach((kpi, idx) => {
    const cardX = margin + idx * (cardWidth + 3)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 1.5, 1.5, 'FD')

    // Barra lateral de cor da utilidade
    doc.setFillColor(rgbBarra[0], rgbBarra[1], rgbBarra[2])
    doc.rect(cardX, currentY, 2.5, cardHeight, 'F')

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

  // 3. Gráfico 1: Evolução Mensal do CONSUMO na unidade física
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text(`1. Evolução Mensal do Consumo Físico (${data.unidadeConsumo}/mês)`, margin, currentY)
  currentY += 3.5

  const chartConsumoImg = renderChartCanvas({
    data: data.meses,
    dataKey: 'consumo',
    unidade: data.unidadeConsumo,
    cor: data.corTema,
  })
  if (chartConsumoImg) {
    const chartH = 50
    doc.addImage(chartConsumoImg, 'PNG', margin, currentY, contentWidth, chartH)
    currentY += chartH + 6
  }

  // 4. Gráfico 2: Evolução Mensal do GASTO em R$
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text(`2. Evolução Mensal do Gasto Financeiro (R$/mês)`, margin, currentY)
  currentY += 3.5

  const chartGastoImg = renderChartCanvas({
    data: data.meses,
    dataKey: 'valor',
    unidade: 'R$',
    prefixo: 'R$',
    cor: data.corTema,
  })
  if (chartGastoImg) {
    const chartH = 50
    doc.addImage(chartGastoImg, 'PNG', margin, currentY, contentWidth, chartH)
    currentY += chartH + 6
  }

  // Rodapé página 1
  desenharRodapePdfPadrao(doc, 1, 2, margin, pageWidth, pageHeight)

  // =========================================================================
  // PÁGINA 2: TABELA MENSAL RESUMIDA + NOTAS E PREMISSAS
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(2)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  doc.text(`Tabela Resumida Mensal — ${nomeExibicaoUtilidade}`, margin, currentY)
  currentY += 3.5

  const reversedMeses = [...data.meses].reverse()
  const tableHeaders = [
    [
      'Competência',
      `Consumo Físico (${data.unidadeConsumo})`,
      'Gasto Total (R$)',
      `Tarifa Média (${data.rotuloTarifa})`,
      'Part. %',
    ],
  ]

  const tableBody = reversedMeses.map((m) => {
    const part = data.gastoTotal > 0 ? (m.valor / data.gastoTotal) * 100 : 0
    const tarifaFormatada =
      m.consumo > 0 && m.valor > 0
        ? `${formatCurrencyBRL(m.valor / m.consumo)}/${data.unidadeConsumo}`
        : '—'

    return [
      m.label,
      `${formatNumberBR(m.consumo, 2)} ${data.unidadeConsumo}`,
      formatCurrencyBRL(m.valor),
      tarifaFormatada,
      `${part.toFixed(1)}%`,
    ]
  })

  // Linha totalizadora
  const tarifaGeral =
    data.consumoTotal > 0 && data.gastoTotal > 0
      ? `${formatCurrencyBRL(data.gastoTotal / data.consumoTotal)}/${data.unidadeConsumo}`
      : '—'
  tableBody.push([
    'TOTAL DO PERÍODO',
    `${formatNumberBR(data.consumoTotal, 2)} ${data.unidadeConsumo}`,
    formatCurrencyBRL(data.gastoTotal),
    tarifaGeral,
    '100,0%',
  ])

  if (typeof (doc as any).autoTable === 'function') {
    ;(doc as any).autoTable({
      startY: currentY,
      head: tableHeaders,
      body: tableBody,
      theme: 'grid',
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 7.5,
        cellPadding: 2.2,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: rgbBarra,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 32 },
        1: { halign: 'right', cellWidth: 42 },
        2: { halign: 'right', fontStyle: 'bold', cellWidth: 40 },
        3: { halign: 'right', cellWidth: 42 },
        4: { halign: 'right', cellWidth: 26 },
      },
      didParseCell: (hookData: any) => {
        // Estilizar linha de Total
        if (hookData.section === 'body' && hookData.row.index === tableBody.length - 1) {
          hookData.cell.styles.fontStyle = 'bold'
          hookData.cell.styles.fillColor = [241, 245, 249]
        }
      },
    })
    currentY = (doc as any).lastAutoTable.finalY + 8
  }

  // Notas corporativas específicas da utilidade
  doc.setFillColor(241, 245, 249)
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(margin, currentY, contentWidth, 24, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(15, 23, 42)
  doc.text('NOTAS CORPORATIVAS E PREMISSAS TÉCNICAS:', margin + 4, currentY + 4.5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(71, 85, 105)

  let notaEspecifica = ''
  if (data.tipoUtilidade === 'Energia Elétrica') {
    notaEspecifica =
      '• Grupo B (B1 a B4): consumo único sem segregação ponta/fora-ponta. Grupo A (A1 a A4): soma de consumo ponta + fora-ponta.'
  } else if (data.tipoUtilidade === 'Gás') {
    notaEspecifica =
      '• Apuração de consumo: prioriza o volume corrigido por fator de temperatura/pressão (m³) com fallback para medição bruta.'
  } else {
    notaEspecifica =
      '• Consumo de Água e Esgoto: volume faturado em m³ medido pela concessionária de abastecimento e saneamento.'
  }

  doc.text(
    `• Relatório específico de ${nomeExibicaoUtilidade} gerado pelo Gestor de Utilidades Dekazen.`,
    margin + 4,
    currentY + 8.5,
  )
  doc.text(notaEspecifica, margin + 4, currentY + 12.5)
  doc.text(
    `• Os dados refletem faturas homologadas no sistema até ${dataGeracaoStr}.`,
    margin + 4,
    currentY + 16.5,
  )
  doc.text(
    '• Para detalhamento completo de 24 meses, sazonalidade e tarifas horo-sazonais, consulte o módulo Análise 24 Meses.',
    margin + 4,
    currentY + 20.5,
  )

  desenharRodapePdfPadrao(doc, 2, 2, margin, pageWidth, pageHeight)

  // Nome do arquivo para download
  const safeUtil =
    data.tipoUtilidade
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'utilidade'

  const safeEmp =
    data.nomeEmpreendimento
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'todos'

  const filename = `relatorio-dekazen-${safeUtil}-${safeEmp}.pdf`
  doc.save(filename)
}
