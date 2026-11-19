/**
 * Gerador de Relatório Executivo em PDF para o Dashboard Geral.
 *
 * Padrão A4 institucional cliente-side (jsPDF + jsPDF-AutoTable carregados via CDN),
 * com gráficos em Canvas nativo (Donut de Utilidades, Linha de Evolução Mensal e
 * Barras das Maiores Faturas), KPIs consolidados e tabela das faturas de maior relevância.
 * Identidade visual corporativa Dekazen com monograma DKZ.
 */

import { formatCurrencyBRL, formatNumberBR, formatDateBR, formatTCO2e } from '@/lib/cnpj'
import { loadJsPdf } from '@/services/relatorioEmissoesPdf'
import {
  getDekazenLogoDataUrl,
  desenharCabecalhoPdfPadrao,
  desenharRodapePdfPadrao,
} from '@/services/pdfBranding'
import { construirSerieEmissoes, type ResumoEmissoes } from '@/lib/emissoesPeriodo'
import type { CalculoEmissaoFatura } from '@/types/entities'

export interface DashboardPdfData {
  nomeEmpreendimento: string
  periodoCobertura: string
  total12m: number
  energia12m: number
  agua12m: number
  gas12m: number
  consumoEnergiaTotal?: number
  consumoAguaTotal?: number
  consumoGasTotal?: number
  donutData: Array<{ name: string; value: number; color: string }>
  lineData: Array<{
    label: string
    energia: number
    agua: number
    gas: number
    total: number
  }>
  topConsumos?: Array<{
    id: string
    nome: string
    tipo: string
    competencia: string
    valor: number
  }>
  /** Cálculos de emissão do MESMO recorte do dashboard (mesma janela/filtro). */
  calculosEmissoes?: CalculoEmissaoFatura[]
  /** Janela de competências do dashboard em 'YYYY-MM' (ordem cronológica). */
  mesesJanela?: string[]
  /** Empreendimentos para rotular o breakdown (quando o recorte é "todos"). */
  empreendimentos?: Array<{ id: string; nome?: string }>
  /** Indica se o recorte do dashboard é todos os empreendimentos. */
  mostrarPorEmpreendimento?: boolean
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
  const drawSeries = (key: 'energia' | 'agua' | 'gas' | 'total', color: string) => {
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

  // Traçar consolidado e utilidades
  drawSeries('total', '#0F766E')
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
    { label: 'Total Consolidado', color: '#0F766E' },
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
 * Arredonda para cima num "nice number" (1/2/2.5/5 × 10^n) para o eixo Y.
 */
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * pow
}

/**
 * Renderiza o gráfico de Emissões de GEE (barras empilhadas por escopo/utilidade)
 * em Canvas para o PDF. Mês sem fatura é lacuna (marcado, não zero).
 * Unidade: tCO₂e.
 */
function renderGeeEmissionsChartCanvas(resumo: ResumoEmissoes, width = 1240, height = 400): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const pontos = resumo.pontos
  const paddingLeft = 78
  const paddingRight = 30
  const paddingTop = 62
  const paddingBottom = 62

  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom

  const maxVal = Math.max(...pontos.map((p) => p.total || 0), 0.1)
  const yMax = niceCeil(maxVal * 1.15)

  // Linhas de grade + rótulos do eixo Y (tCO₂e)
  const gridSteps = 4
  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  const decimaisY = yMax >= 20 ? 0 : yMax >= 1 ? 1 : 2
  for (let i = 0; i <= gridSteps; i++) {
    const yVal = (yMax / gridSteps) * i
    const yPos = paddingTop + chartHeight - (chartHeight / gridSteps) * i

    ctx.beginPath()
    ctx.moveTo(paddingLeft, yPos)
    ctx.lineTo(paddingLeft + chartWidth, yPos)
    ctx.stroke()

    ctx.fillStyle = '#64748B'
    ctx.fillText(
      `${yVal.toLocaleString('pt-BR', { maximumFractionDigits: decimaisY })} t`,
      paddingLeft - 10,
      yPos,
    )
  }

  // Barras empilhadas por escopo (E1 Gás / E2 Energia / E3 Água)
  const count = Math.max(1, pontos.length)
  const slot = chartWidth / count
  const barW = Math.min(46, slot * 0.55)

  pontos.forEach((p, idx) => {
    const centerX = paddingLeft + slot * idx + slot / 2

    if (!p.semFatura && (p.total || 0) > 0) {
      let acc = 0
      const segmentos = [
        { v: p.escopo1 || 0, cor: '#14B8A6' }, // Escopo 1 — Gás
        { v: p.escopo2 || 0, cor: '#F59E0B' }, // Escopo 2 — Energia
        { v: p.escopo3 || 0, cor: '#0EA5E9' }, // Escopo 3 — Água/Esgoto
      ]
      const x = paddingLeft + slot * idx + (slot - barW) / 2

      segmentos.forEach((seg) => {
        if (seg.v <= 0) return
        const h = Math.max(1, (seg.v / yMax) * chartHeight)
        ctx.fillStyle = seg.cor
        ctx.fillRect(x, paddingTop + chartHeight - acc - h, barW, h)
        acc += h
      })

      // Total do mês no topo da barra
      ctx.fillStyle = '#334155'
      ctx.font = 'bold 12.5px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(
        (p.total || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }),
        centerX,
        paddingTop + chartHeight - acc - 6,
      )
    }

    // Rótulo do eixo X
    ctx.fillStyle = p.semFatura ? '#CBD5E1' : '#475569'
    ctx.font = '12.5px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(p.label, centerX, paddingTop + chartHeight + 12)
    if (p.semFatura) {
      ctx.fillStyle = '#CBD5E1'
      ctx.font = '10.5px sans-serif'
      ctx.fillText('sem fatura', centerX, paddingTop + chartHeight + 30)
    }
  })

  // Legenda no topo
  const legenda = [
    { label: 'Escopo 1 — Gás (tCO₂e)', color: '#14B8A6' },
    { label: 'Escopo 2 — Energia Elétrica (tCO₂e)', color: '#F59E0B' },
    { label: 'Escopo 3 — Água e Esgoto (tCO₂e)', color: '#0EA5E9' },
  ]
  let lx = paddingLeft + 4
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  legenda.forEach((item) => {
    ctx.fillStyle = item.color
    ctx.fillRect(lx, 32 - 6, 12, 12)
    ctx.fillStyle = '#1E293B'
    ctx.font = 'bold 13px sans-serif'
    ctx.fillText(item.label, lx + 18, 32)
    lx += ctx.measureText(item.label).width + 48
  })

  return canvas.toDataURL('image/png')
}

/**
 * Monta a nota metodológica do bloco GEE com as premissas realmente aplicadas
 * (por escopo com emissão > 0), espelhando as fórmulas oficiais do relatório
 * de Emissões. Nenhum número é inventado: só entra premissa de escopo que
 * teve emissão no recorte. Retorna o texto já quebrado pelo splitTextToSize.
 */
function montarNotaMetodologicaGee(
  doc: any,
  resumo: ResumoEmissoes,
  contentWidth: number,
): string[] {
  const premissas: string[] = []
  if ((resumo.porEscopo['Escopo 1'].total || 0) > 0) {
    premissas.push(
      'Escopo 1 (Gás Natural Canalizado): combustão estacionária com 2,15 kgCO₂e/m³ (IPCC 2006 / PB GHG Protocol, PCI 38,3 MJ/m³)',
    )
  }
  if ((resumo.porEscopo['Escopo 2'].total || 0) > 0) {
    premissas.push(
      'Escopo 2 (Energia Elétrica): fator médio mensal do SIN (MCTI/SIRENE, location-based); fallback provisório de 0,050 tCO₂/MWh quando o mês não tem publicação oficial',
    )
  }
  if ((resumo.porEscopo['Escopo 3'].total || 0) > 0) {
    premissas.push(
      'Escopo 3 (Água e Esgoto): fator composto setorial de 0,908 kgCO₂e/m³ (0,208 captação + 0,700 efluentes)',
    )
  }

  const corpo = [
    `Nota metodológica: emissões estimadas a partir do consumo físico das faturas do período e dos fatores de emissão cadastrados no sistema. Unidade: tCO₂e (toneladas de CO₂ equivalente). Mês marcado como "sem fatura" indica competência sem lançamento, não emissão zero.`,
    ...premissas.map((p) => `• ${p}`),
  ]
  return doc.splitTextToSize(corpo, contentWidth - 8)
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
  doc.roundedRect(margin, currentY, contentWidth, 13, 1.5, 1.5, 'FD')
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

  currentY += 17

  // 2. Grid de 4 Cards KPI (compactos) — cada card leva também a linha de
  //    consumo físico / média mensal daquele recorte (quando houver dado).
  const cardWidth = (contentWidth - 9) / 4
  const cardHeight = 26

  const qtdMesesJanela = data.lineData.length || 12
  const consumoEnergiaN = data.consumoEnergiaTotal ?? 0
  const consumoAguaN = data.consumoAguaTotal ?? 0
  const consumoGasN = data.consumoGasTotal ?? 0
  // Aviso honesto de cobertura: meses da janela sem nenhuma fatura lançada
  const mesesSemFatura = data.lineData.filter((m) => (m.total || 0) === 0).length
  const avisoCobertura =
    mesesSemFatura > 0
      ? `${mesesSemFatura} de ${data.lineData.length} meses da janela sem faturas lançadas`
      : null

  const consumoPorKpi = [
    data.total12m > 0
      ? `Média ${formatCurrencyBRL(data.total12m / qtdMesesJanela)}/mês`
      : 'Sem gastos no período',
    consumoEnergiaN > 0 ? `Consumo: ${formatNumberBR(consumoEnergiaN)} kWh` : '',
    consumoAguaN > 0 ? `Consumo: ${formatNumberBR(consumoAguaN)} m³` : '',
    consumoGasN > 0 ? `Consumo: ${formatNumberBR(consumoGasN)} m³` : '',
  ]

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

    const linhaConsumo = consumoPorKpi[idx]
    if (linhaConsumo) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(100, 116, 139)
      doc.text(linhaConsumo, cardX + 5, currentY + 21.5)
    }
  })

  currentY += cardHeight + 6

  // ---------------------------------------------------------------------
  // 3. Gráfico principal (evolução mensal) em largura total + linha
  //    inferior com donut de distribuição e painel de consumo físico.
  //    A página inteira é aproveitada: as alturas são calculadas até o
  //    limite inferior útil — sem vazios e sem cortes (a página 2 só
  //    começa depois, via addPage).
  // ---------------------------------------------------------------------
  const limiteInferior = pageHeight - margin - 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Evolução Mensal de Gastos por Utilidade (12 Meses)', margin, currentY + 3)
  currentY += 5

  const lineCanvasH = 640
  const lineH = 95
  const lineImg = renderLineChartCanvas(data.lineData, 1150, lineCanvasH)
  if (lineImg) {
    doc.addImage(lineImg, 'PNG', margin, currentY, contentWidth, lineH)
  }
  currentY += lineH + 5

  // Linha inferior: donut (esquerda) + painel de consumo físico (direita),
  // ambos preenchendo exatamente o espaço restante da página.
  const bottomH = Math.max(40, limiteInferior - currentY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(15, 23, 42)
  doc.text('Distribuição por Utilidade', margin, currentY + 3)

  const donutY = currentY + 5
  const donutH = Math.max(30, bottomH - 5)
  const donutW = 64
  const donutImg = renderDonutChartCanvas(
    data.donutData,
    data.total12m,
    640,
    Math.max(300, Math.round((640 * donutH) / donutW)),
  )
  if (donutImg) {
    doc.addImage(donutImg, 'PNG', margin, donutY, donutW, donutH)
  }

  const painelX = margin + donutW + 4
  const painelW = contentWidth - donutW - 4
  doc.setFillColor(248, 250, 252) // slate-50
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(painelX, donutY, painelW, donutH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text('Consumo Físico do Período', painelX + 4, donutY + 6.5)

  const miniCards = [
    {
      rotulo: 'Energia Elétrica',
      valor: consumoEnergiaN > 0 ? `${formatNumberBR(consumoEnergiaN)} kWh` : '—',
      cor: [245, 158, 11] as [number, number, number],
    },
    {
      rotulo: 'Água e Esgoto',
      valor: consumoAguaN > 0 ? `${formatNumberBR(consumoAguaN)} m³` : '—',
      cor: [14, 165, 233] as [number, number, number],
    },
    {
      rotulo: 'Gás (GN/GLP)',
      valor: consumoGasN > 0 ? `${formatNumberBR(consumoGasN)} m³` : '—',
      cor: [20, 184, 166] as [number, number, number],
    },
  ]
  const miniW = (painelW - 14) / 3
  miniCards.forEach((mini, idx) => {
    const mx = painelX + 4 + idx * (miniW + 3)
    const my = donutY + 10
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(mx, my, miniW, 17, 1.2, 1.2, 'FD')
    doc.setFillColor(mini.cor[0], mini.cor[1], mini.cor[2])
    doc.rect(mx, my, 2, 17, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(100, 116, 139)
    doc.text(mini.rotulo, mx + 4, my + 5.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(15, 23, 42)
    doc.text(mini.valor, mx + 4, my + 13)
  })

  // Aviso de cobertura: meses da janela sem faturas lançadas (lacuna
  // honesta, nunca zerada) — ocupa o rodapé do painel de consumo.
  if (avisoCobertura) {
    const avY = donutY + donutH - 16
    doc.setFillColor(255, 251, 235) // amber-50
    doc.setDrawColor(253, 230, 138)
    doc.roundedRect(painelX + 4, avY, painelW - 8, 12, 1.2, 1.2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.3)
    doc.setTextColor(146, 64, 14)
    doc.text(`Atenção: ${avisoCobertura}`, painelX + 7, avY + 4.6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.6)
    doc.text(
      'Valores destes meses não entram nos totalizadores do período.',
      painelX + 7,
      avY + 9.3,
    )
  }

  // Rodapé da página 1 é desenhado ao final do documento, com o total
  // real de páginas.

  // =========================================================================
  // PÁGINA 2: MAIORES FATURAS (TOP 5 / 10) + TABELA RESUMO MENSAL + NOTAS
  // =========================================================================
  doc.addPage()
  currentY = margin
  desenharCabecalho(2)

  // Tabela: Maiores Contas Registradas (Top Contas)
  const topConsumosList = data.topConsumos || []
  if (topConsumosList.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text('Maiores Contas Registradas — Faturas de Maior Impacto Financeiro', margin, currentY)
    currentY += 3.5

    const topHeaders = [['#', 'Empreendimento', 'Utilidade', 'Competência', 'Valor Fatura (R$)']]
    const topBody = topConsumosList.map((c, idx) => [
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

  // =========================================================================
  // BLOCO GEE: Emissões de Gases de Efeito Estufa do período (se houver dado)
  // =========================================================================
  const calculos = data.calculosEmissoes ?? []
  const temDadoGee = calculos.some((c) => (c.emissoesTCO2e || 0) > 0)

  if (temDadoGee) {
    const resumo = construirSerieEmissoes({
      calculos,
      meses: data.mesesJanela ?? [],
      empreendimentos: data.empreendimentos ?? [],
    })

    if (resumo.temDados && resumo.pontos.length > 0) {
      const totalGee = resumo.totalPeriodo

      // Nota metodológica: calculada ANTES da decisão de quebra, porque a
      // altura real do bloco depende do número de linhas quebradas da nota.
      const notaGee = montarNotaMetodologicaGee(doc, resumo, contentWidth)

      // Altura real do bloco GEE: título + KPIs + gráfico + nota (o bloco
      // nunca sai cortado no meio — ou cabe inteiro, ou vai para a página
      // seguinte inteiro).
      const alturaBlocoGee = 3.5 + 19 + 58 + 3 + notaGee.length * 3 + 8
      if (currentY + alturaBlocoGee > pageHeight - margin - 14) {
        doc.addPage()
        currentY = margin
        desenharCabecalho(doc.getNumberOfPages())
      }

      // Título + KPIs consolidados (acima do gráfico, na mesma página)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(15, 23, 42)
      doc.text('Emissões de Gases de Efeito Estufa (GEE) do Período', margin, currentY)
      currentY += 3.5

      const totaisGee = [
        {
          titulo: 'TOTAL DE EMISSÕES (GEE)',
          valor: formatTCO2e(totalGee, 2),
          cor: [15, 118, 110] as [number, number, number],
        },
        {
          titulo: 'ESCOPO 1 — GÁS',
          valor: formatTCO2e(resumo.porEscopo['Escopo 1'].total, 2),
          cor: [20, 184, 166] as [number, number, number],
        },
        {
          titulo: 'ESCOPO 2 — ENERGIA ELÉTRICA',
          valor: formatTCO2e(resumo.porEscopo['Escopo 2'].total, 2),
          cor: [245, 158, 11] as [number, number, number],
        },
        {
          titulo: 'ESCOPO 3 — ÁGUA E ESGOTO',
          valor: formatTCO2e(resumo.porEscopo['Escopo 3'].total, 2),
          cor: [14, 165, 233] as [number, number, number],
        },
      ]
      const geeCardW = (contentWidth - 9) / 4
      totaisGee.forEach((card, idx) => {
        const cardX = margin + idx * (geeCardW + 3)
        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(226, 232, 240)
        doc.roundedRect(cardX, currentY, geeCardW, 16, 1.5, 1.5, 'FD')
        doc.setFillColor(card.cor[0], card.cor[1], card.cor[2])
        doc.rect(cardX, currentY, 2.5, 16, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6)
        doc.setTextColor(100, 116, 139)
        doc.text(card.titulo, cardX + 5, currentY + 5)
        doc.setFontSize(8.5)
        doc.setTextColor(15, 23, 42)
        doc.text(card.valor, cardX + 5, currentY + 12)
      })
      currentY += 19

      // Gráfico de barras mensais empilhadas por escopo
      const geeImg = renderGeeEmissionsChartCanvas(resumo)
      if (geeImg) {
        const geeH = 58
        doc.addImage(geeImg, 'PNG', margin, currentY, contentWidth, geeH)
        currentY += geeH + 3
      }

      // Nota metodológica já calculada antes da decisão de quebra (notaGee),
      // com as fontes realmente aplicadas — sem inventar número.
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(100, 116, 139)
      doc.text(notaGee, margin + 4, currentY + 1)
      currentY += notaGee.length * 3 + 4
    }
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
    '• Para detalhamento de bandeiras tarifárias, tarifas ponta/fora-ponta ou histórico do período, abra o módulo Análise por Período.',
    margin + 4,
    currentY + 16.5,
  )

  // Rodapés com o total real de páginas (o bloco GEE pode abrir a página 3)
  const totalPaginas = doc.getNumberOfPages()
  desenharRodapePdfPadrao(doc, 1, totalPaginas, margin, pageWidth, pageHeight)
  desenharRodapePdfPadrao(doc, 2, totalPaginas, margin, pageWidth, pageHeight)
  for (let p = 3; p <= totalPaginas; p++) {
    desenharRodapePdfPadrao(doc, p, totalPaginas, margin, pageWidth, pageHeight)
  }

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
