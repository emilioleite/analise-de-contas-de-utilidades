/**
 * Relatório PDF — Análise por Período (Dekazen).
 *
 * Regras seguidas à risca:
 *  1. Consumo lido na unidade nativa da fatura (kWh/m³) antes de qualquer conversão para R$.
 *  2. Mês sem fatura é LACUNA: linha do gráfico quebra, tabela escreve "sem fatura". Nunca zero.
 *  3. Média divide pelo número de meses COM dado no período — nunca por constante.
 *  4. Custo unitário efetivo = valor ÷ consumo, rotulado com o que está embutido.
 */

import { formatCurrencyBRL, formatNumberBR } from '@/lib/cnpj'
import { loadJsPdf } from '@/services/relatorioEmissoesPdf'
import {
  getDekazenLogoDataUrl,
  desenharCabecalhoPdfPadrao,
  desenharRodapePdfPadrao,
} from '@/services/pdfBranding'

export interface PontoSerie {
  key: string
  label: string
  shortMonth: string
  valor: number | null
  consumo: number | null
  tarifa: number | null
  semFatura?: boolean
}

export interface LinhaTabela {
  key: string
  label: string
  valor: number | null
  consumo: number | null
  tarifa: number | null
  variacaoPct: number | null
  variacaoConsumoPct: number | null
  isMax: boolean
  isMin: boolean
  semFatura?: boolean
}

export interface ResumoUtilidade {
  utilidade: string
  unidade: string
  consumoTotal: number
  mesesComConsumo: number
  mediaConsumo: number | null
  valorTotal: number
  mesesComValor: number
  tarifaMedia: number | null
  rotuloTarifa: string
}

export interface RelatorioPeriodoData {
  nomeEmpreendimento: string
  periodoCobertura: string
  utilidadeSelecionada: string
  unidadeConsumo: string
  rotuloTarifa: string
  qtdMeses: number
  mesesComValor: number
  mesesComConsumo: number
  mediaMensal: number | null
  totalPeriodo: number
  maxPoint: PontoSerie | null
  minPoint: PontoSerie | null
  mediaConsumoMensal: number | null
  totalConsumoPeriodo: number
  maxConsumoPoint: PontoSerie | null
  minConsumoPoint: PontoSerie | null
  mediaTarifaPeriodo: number | null
  maxTarifaPoint: PontoSerie | null
  minTarifaPoint: PontoSerie | null
  monthPoints: PontoSerie[]
  comparativoAnual: Array<{
    mes: string
    atualLabel: string
    atualValor: number | null
    anteriorLabel: string
    anteriorValor: number | null
  }>
  comparativoConsumoAnual: Array<{
    mes: string
    atualLabel: string
    atualConsumo: number | null
    anteriorLabel: string
    anteriorConsumo: number | null
  }>
  tableRows: LinhaTabela[]
  porUtilidade: ResumoUtilidade[]
  avisoCobertura: string | null
}

const num = (v: number | null | undefined, dec = 0) =>
  v === null || v === undefined ? 'ND' : formatNumberBR(v, dec)
const moeda = (v: number | null | undefined) =>
  v === null || v === undefined ? 'ND' : formatCurrencyBRL(v)
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

/** Área com quebra nas lacunas: null não liga um ponto ao seguinte. */
function area(
  pontos: PontoSerie[],
  campo: 'valor' | 'consumo' | 'tarifa',
  opts: {
    rotuloY: (v: number) => string
    legenda: string
    cor: string
    maxKey?: string
    minKey?: string
    altura?: number
  },
): string {
  const width = 1200
  const height = opts.altura || 330
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const pl = 92
  const pr = 40
  const pt = 45
  const pb = 52
  const cw = width - pl - pr
  const ch = height - pt - pb

  const vals = pontos.map((p) => p[campo]).filter((v): v is number => v !== null && v !== undefined)
  const maxVal = vals.length ? Math.max(...vals) : 0
  const minVal = vals.length ? Math.min(...vals) : 0
  // Escala "bonita": arredonda o topo para um múltiplo que dê 4-5 linhas de grade
  // legíveis em qualquer ordem de grandeza (kWh de milhares ou tarifa < R$ 1).
  const cru = maxVal > 0 ? maxVal * 1.15 : 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(cru)))
  const esc = magnitude * (cru / magnitude <= 1.5 ? 0.5 : cru / magnitude <= 3.5 ? 1 : 2.5)
  const yMax = Math.ceil(cru / esc) * esc || 100
  const yMin = minVal < 0 ? Math.floor((minVal * 1.15) / esc) * esc : 0
  const span = yMax - yMin || 1
  const yPos = (v: number) => pt + ch - ((v - yMin) / span) * ch
  const stepX = cw / Math.max(1, pontos.length - 1)
  const xPos = (i: number) => pl + i * stepX

  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (span / 4) * i
    const y = yPos(v)
    ctx.beginPath()
    ctx.moveTo(pl, y)
    ctx.lineTo(pl + cw, y)
    ctx.stroke()
    ctx.fillText(opts.rotuloY(v), pl - 10, y)
  }

  let seg: Array<{ x: number; y: number }> = []
  const fechar = () => {
    if (seg.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(seg[0].x, seg[0].y)
      seg.forEach((p) => ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = opts.cor
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
    seg = []
  }
  pontos.forEach((p, i) => {
    const v = p[campo]
    if (v === null || v === undefined) {
      fechar()
      return
    }
    seg.push({ x: xPos(i), y: yPos(v) })
  })
  fechar()

  pontos.forEach((p, i) => {
    const v = p[campo]
    if (v === null || v === undefined) {
      ctx.beginPath()
      ctx.arc(xPos(i), pt + ch, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = '#E2E8F0'
      ctx.fill()
      return
    }
    const isMax = p.key === opts.maxKey
    const isMin = p.key === opts.minKey
    ctx.beginPath()
    ctx.arc(xPos(i), yPos(v), isMax || isMin ? 6 : 3, 0, Math.PI * 2)
    ctx.fillStyle = isMax ? '#DC2626' : isMin ? '#16A34A' : opts.cor
    ctx.fill()
    if (isMax || isMin) {
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = isMax ? '#DC2626' : '#16A34A'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = isMax ? 'bottom' : 'top'
      ctx.fillText(isMax ? 'Máx' : 'Mín', xPos(i), yPos(v) + (isMax ? -8 : 8))
    }
  })

  ctx.fillStyle = '#475569'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const pular = Math.ceil(pontos.length / 26)
  pontos.forEach((p, i) => {
    if (i % pular !== 0 && i !== pontos.length - 1) return
    ctx.save()
    ctx.translate(xPos(i), pt + ch + 10)
    ctx.rotate(-Math.PI / 4.5)
    ctx.fillText(p.label, 0, 0)
    ctx.restore()
  })

  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = opts.cor
  ctx.beginPath()
  ctx.arc(pl + 6, 20, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1E293B'
  ctx.fillText(opts.legenda, pl + 18, 20)
  ctx.fillStyle = '#94A3B8'
  ctx.font = 'italic 11px sans-serif'
  ctx.fillText('Lacuna = mês sem fatura lançada (não é zero)', pl + 250, 20)

  return canvas.toDataURL('image/png')
}

/** Barras: ano anterior × período. Par sem dado não desenha barra. */
function barras(
  dados: Array<{ mes: string; anterior: number | null; atual: number | null }>,
  opts: { fmt: (v: number) => string; legenda: string; cor: string; altura?: number },
): string {
  const width = 1200
  const height = opts.altura || 310
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)

  const pl = 92
  const pr = 40
  const pt = 50
  const pb = 45
  const cw = width - pl - pr
  const ch = height - pt - pb

  const todos = dados.flatMap((d) => [d.anterior, d.atual]).filter((v): v is number => v !== null)
  const maxVal = todos.length ? Math.max(...todos) : 0
  // Mesma escala "bonita" da área: legível de m³ dezenas a kWh milhares.
  const cru = maxVal > 0 ? maxVal * 1.15 : 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(cru)))
  const esc = magnitude * (cru / magnitude <= 1.5 ? 0.5 : cru / magnitude <= 3.5 ? 1 : 2.5)
  const yMax = Math.ceil(cru / esc) * esc || 100

  ctx.strokeStyle = '#F1F5F9'
  ctx.lineWidth = 1
  ctx.fillStyle = '#64748B'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i
    const y = pt + ch - (ch / 4) * i
    ctx.beginPath()
    ctx.moveTo(pl, y)
    ctx.lineTo(pl + cw, y)
    ctx.stroke()
    ctx.fillText(opts.fmt(v), pl - 10, y)
  }

  const slot = cw / Math.max(1, dados.length)
  const bw = Math.max(5, slot * 0.32)
  const gap = 3
  dados.forEach((d, i) => {
    const c = pl + slot * i + slot / 2
    if (d.anterior !== null) {
      const h = (d.anterior / yMax) * ch
      ctx.fillStyle = '#94A3B8'
      ctx.fillRect(c - bw - gap / 2, pt + ch - h, bw, h)
    }
    if (d.atual !== null) {
      const h = (d.atual / yMax) * ch
      ctx.fillStyle = opts.cor
      ctx.fillRect(c + gap / 2, pt + ch - h, bw, h)
    }
    if (dados.length <= 26 || i % Math.ceil(dados.length / 26) === 0) {
      ctx.fillStyle = '#475569'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(d.mes, c, pt + ch + 8)
    }
  })

  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#94A3B8'
  ctx.fillRect(pl + 10, 14, 14, 14)
  ctx.fillStyle = '#1E293B'
  ctx.fillText('Ano anterior', pl + 30, 21)
  ctx.fillStyle = opts.cor
  ctx.fillRect(pl + 150, 14, 14, 14)
  ctx.fillStyle = '#1E293B'
  ctx.fillText(opts.legenda, pl + 170, 21)

  return canvas.toDataURL('image/png')
}

function cards(
  doc: any,
  y: number,
  margin: number,
  contentWidth: number,
  lista: Array<{ titulo: string; valor: string; sub: string; cor: [number, number, number] }>,
): number {
  const w = (contentWidth - 6) / 3
  const h = 20
  lista.forEach((c, i) => {
    const x = margin + i * (w + 3)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')
    doc.setFillColor(c.cor[0], c.cor[1], c.cor[2])
    doc.rect(x, y, 2.5, h, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    doc.setTextColor(100, 116, 139)
    doc.text(c.titulo, x + 5, y + 4.5)
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text(c.valor, x + 5, y + 11)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(100, 116, 139)
    doc.text(doc.splitTextToSize(c.sub, w - 8).slice(0, 2), x + 5, y + 15.5)
  })
  return h
}

export async function gerarRelatorioAnalisePeriodoPDF(data: RelatorioPeriodoData): Promise<void> {
  const jsPDF = await loadJsPdf()
  const logoDataUrl = await getDekazenLogoDataUrl()

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2

  const geradoEm = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  let cor = '#0F766E'
  if (data.utilidadeSelecionada === 'Energia Elétrica') cor = '#F59E0B'
  else if (data.utilidadeSelecionada === 'Água e Esgoto') cor = '#0EA5E9'
  else if (data.utilidadeSelecionada === 'Gás') cor = '#14B8A6'

  const totalGeral = data.utilidadeSelecionada === 'Total Geral'
  let y = margin
  let paginaAtual = 1

  const cabecalho = (pagina: number) => {
    y = desenharCabecalhoPdfPadrao({
      doc,
      currentY: margin,
      margin,
      contentWidth,
      pageWidth,
      pageHeight,
      numeroPagina: pagina,
      tituloPrincipal: 'GESTOR DE UTILIDADES — ANÁLISE POR PERÍODO',
      subtitulo: totalGeral
        ? 'Desembolso consolidado por competência • Total Geral (R$)'
        : `Consumo (${data.unidadeConsumo}), Custo Unitário (${data.rotuloTarifa}) e Desembolso • ${data.utilidadeSelecionada}`,
      nomeEmpreendimento: data.nomeEmpreendimento,
      periodoCobertura: `${data.periodoCobertura} • ${data.qtdMeses} competências`,
      dataGeracaoStr: geradoEm,
      logoDataUrl,
    })
    return y
  }

  /**
   * Quebra de página segura: se o próximo bloco (de altura `necessario` mm)
   * não couber inteiro acima do rodapé, começa uma página nova com cabeçalho.
   * Garante que nenhum gráfico seja cortado na quebra de página.
   */
  const garantirEspaco = (necessario: number) => {
    if (y + necessario <= pageHeight - 16) return
    doc.addPage()
    paginaAtual += 1
    cabecalho(paginaAtual)
  }

  // ------------------------------------------------------------------ PÁGINA 1
  cabecalho(1)

  doc.setFillColor(240, 253, 250)
  doc.setDrawColor(204, 251, 241)
  doc.roundedRect(margin, y, contentWidth, 12, 1.5, 1.5, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 118, 110)
  doc.text(
    totalGeral
      ? 'DIAGNÓSTICO DO PERÍODO — DESEMBOLSO POR UTILIDADE (R$)'
      : `DIAGNÓSTICO DO PERÍODO — CONSUMO (${data.unidadeConsumo.toUpperCase()}) E CUSTO UNITÁRIO (${data.rotuloTarifa})`,
    margin + 4,
    y + 4.5,
  )
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.6)
  doc.setTextColor(19, 78, 74)
  doc.text(
    `Janela: ${data.periodoCobertura}. Só meses com fatura entram nas médias; mês sem fatura é lacuna.`,
    margin + 4,
    y + 9,
  )
  y += 15

  if (data.avisoCobertura) {
    doc.setFillColor(255, 251, 235)
    doc.setDrawColor(253, 230, 138)
    doc.roundedRect(margin, y, contentWidth, 8, 1.2, 1.2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    doc.setTextColor(146, 64, 14)
    doc.text(doc.splitTextToSize(data.avisoCobertura, contentWidth - 8), margin + 4, y + 5)
    y += 10
  }

  if (!totalGeral) {
    garantirEspaco(24)
    y += cards(doc, y, margin, contentWidth, [
      {
        titulo: 'MAIOR CONSUMO',
        valor: `${num(data.maxConsumoPoint?.consumo ?? null)} ${data.unidadeConsumo}`,
        sub: `Mês de pico: ${data.maxConsumoPoint?.label || 'ND'}`,
        cor: [220, 38, 38],
      },
      {
        titulo: 'MENOR CONSUMO',
        valor: `${num(data.minConsumoPoint?.consumo ?? null)} ${data.unidadeConsumo}`,
        sub: `Mínimo apurado: ${data.minConsumoPoint?.label || 'ND'}`,
        cor: [22, 163, 74],
      },
      {
        titulo: `MÉDIA MENSAL (${data.unidadeConsumo})`,
        valor: `${num(data.mediaConsumoMensal, 1)} ${data.unidadeConsumo}/mês`,
        sub: `Soma ${num(data.totalConsumoPeriodo)} ÷ ${data.mesesComConsumo} meses com dado`,
        cor: [15, 118, 110],
      },
    ])
    y += 4

    // Título + gráfico inteiros: quebra antes se não couber (título 5 + gráfico 45 + gap)
    garantirEspaco(53)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(15, 23, 42)
    doc.text(`Consumo Físico Mensal — ${data.unidadeConsumo}/mês`, margin, y + 3)
    y += 5

    const imgConsumo = area(data.monthPoints, 'consumo', {
      rotuloY: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
      legenda: `Consumo (${data.unidadeConsumo}/mês)`,
      cor,
      maxKey: data.maxConsumoPoint?.key,
      minKey: data.minConsumoPoint?.key,
      altura: 310,
    })
    if (imgConsumo) {
      doc.addImage(imgConsumo, 'PNG', margin, y, contentWidth, 45)
      y += 48
    }

    garantirEspaco(24)
    y += cards(doc, y, margin, contentWidth, [
      {
        titulo: 'CUSTO UNITÁRIO MAIS ALTO',
        valor: `${moeda(data.maxTarifaPoint?.tarifa ?? null)}/${data.unidadeConsumo}`,
        sub: data.maxTarifaPoint?.label || 'ND',
        cor: [220, 38, 38],
      },
      {
        titulo: 'CUSTO UNITÁRIO MAIS BAIXO',
        valor: `${moeda(data.minTarifaPoint?.tarifa ?? null)}/${data.unidadeConsumo}`,
        sub: data.minTarifaPoint?.label || 'ND',
        cor: [22, 163, 74],
      },
      {
        titulo: 'MÉDIA PONDERADA',
        valor: `${moeda(data.mediaTarifaPeriodo)}/${data.unidadeConsumo}`,
        sub: 'Soma dos valores ÷ soma dos consumos nos meses com dado',
        cor: [217, 119, 6],
      },
    ])
    y += 4

    // Título + gráfico inteiros (título 5 + gráfico 42 + gap)
    garantirEspaco(50)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(15, 23, 42)
    doc.text(`Custo Unitário Efetivo Mensal (${data.rotuloTarifa})`, margin, y + 3)
    y += 5

    const imgTarifa = area(data.monthPoints, 'tarifa', {
      rotuloY: (v) => `R$ ${v.toFixed(2)}`,
      legenda: `Custo efetivo (${data.rotuloTarifa})`,
      cor: '#D97706',
      maxKey: data.maxTarifaPoint?.key,
      minKey: data.minTarifaPoint?.key,
      altura: 290,
    })
    if (imgTarifa) {
      doc.addImage(imgTarifa, 'PNG', margin, y, contentWidth, 42)
      y += 45
    }

    const embutido =
      data.utilidadeSelecionada === 'Água e Esgoto'
        ? 'Tarifa de água + tarifa de esgoto + tributos e encargos da conta. Em tarifa escalonada, consumo menor pode cair em faixa mais cara e elevar o R$/m³.'
        : data.utilidadeSelecionada === 'Energia Elétrica'
          ? 'TUSD + TE, bandeiras tarifárias, encargos setoriais e tributos. Bandeira vermelha eleva o R$/kWh sem relação com desperdício.'
          : 'Tarifa de gás, encargos, tributos e, quando houver, parcela de transporte/GLP.'

    garantirEspaco(16)
    doc.setFillColor(255, 251, 235)
    doc.setDrawColor(253, 230, 138)
    doc.roundedRect(margin, y, contentWidth, 13, 1.2, 1.2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    doc.setTextColor(146, 64, 14)
    doc.text('O QUE ESTÁ EMBUTIDO NO CUSTO UNITÁRIO:', margin + 4, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(doc.splitTextToSize(embutido, contentWidth - 8), margin + 4, y + 8)
    y += 16
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(15, 23, 42)
    doc.text('Resumo por Utilidade — cada grandeza na sua unidade', margin, y + 3)
    y += 6

    if (typeof (doc as any).autoTable === 'function') {
      ;(doc as any).autoTable({
        startY: y,
        head: [
          [
            'Utilidade',
            'Consumo total',
            'Média/mês',
            'Valor faturado',
            'Custo unit. efetivo',
            'Meses c/ dado',
          ],
        ],
        body: data.porUtilidade.map((u) => [
          u.utilidade,
          u.mesesComConsumo > 0 ? `${num(u.consumoTotal)} ${u.unidade}` : 'ND',
          u.mediaConsumo !== null ? `${num(u.mediaConsumo, 1)} ${u.unidade}/mês` : 'ND',
          u.mesesComValor > 0 ? formatCurrencyBRL(u.valorTotal) : 'ND',
          u.tarifaMedia !== null ? formatCurrencyBRL(u.tarifaMedia) : 'ND',
          `${u.mesesComConsumo}/${data.qtdMeses}`,
        ]),
        theme: 'grid',
        margin: { left: margin, right: margin },
        styles: {
          fontSize: 7,
          cellPadding: 2,
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
        columnStyles: {
          0: { fontStyle: 'bold' },
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'center' },
        },
      })
      y = (doc as any).lastAutoTable.finalY + 6
    }

    doc.setFillColor(240, 249, 255)
    doc.setDrawColor(186, 230, 253)
    doc.roundedRect(margin, y, contentWidth, 13, 1.2, 1.2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    doc.setTextColor(12, 74, 110)
    doc.text('POR QUE NÃO EXISTE “TOTAL GERAL DE CONSUMO”:', margin + 4, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(
      doc.splitTextToSize(
        'kWh e m³ são grandezas diferentes e não se somam sem conversão. No Total Geral só os valores em R$ são consolidados.',
        contentWidth - 8,
      ),
      margin + 4,
      y + 8,
    )
    y += 16
  }

  // Bloco Desembolso (cards + título + gráfico) sempre inteiro numa página
  garantirEspaco(80)
  y += cards(doc, y, margin, contentWidth, [
    {
      titulo: 'MAIOR DESEMBOLSO',
      valor: moeda(data.maxPoint?.valor ?? null),
      sub: data.maxPoint?.label || 'ND',
      cor: [220, 38, 38],
    },
    {
      titulo: 'MENOR DESEMBOLSO',
      valor: moeda(data.minPoint?.valor ?? null),
      sub: data.minPoint?.label || 'ND',
      cor: [22, 163, 74],
    },
    {
      titulo: 'MÉDIA MENSAL',
      valor: moeda(data.mediaMensal),
      sub: `Total ${formatCurrencyBRL(data.totalPeriodo)} ÷ ${data.mesesComValor} meses com fatura`,
      cor: [15, 118, 110],
    },
  ])
  y += 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text('Desembolso Mensal (R$)', margin, y + 3)
  y += 5

  const imgValor = area(data.monthPoints, 'valor', {
    rotuloY: (v) => `R$ ${(v / 1000).toFixed(1)}k`,
    legenda: 'Desembolso (R$)',
    cor,
    maxKey: data.maxPoint?.key,
    minKey: data.minPoint?.key,
    altura: 310,
  })
  if (imgValor) {
    doc.addImage(imgValor, 'PNG', margin, y, contentWidth, 45)
    y += 49
  }

  // ---------------------------------------------------- COMPARATIVO ANUAL (segue o desembolso; quebra de página se não couber)
  if (data.comparativoAnual.length > 0) {
    const temCompConsumo = !totalGeral && data.comparativoConsumoAnual.length > 0
    // Título + gráfico de valor (+ título + gráfico de consumo) inteiros na página
    garantirEspaco(temCompConsumo ? 108 : 56)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(15, 23, 42)
    doc.text('Comparativo Valor: mesmo mês do ano anterior (R$)', margin, y + 3)
    y += 6

    const imgCV = barras(
      data.comparativoAnual.map((c) => ({
        mes: c.mes,
        anterior: c.anteriorValor,
        atual: c.atualValor,
      })),
      {
        fmt: (v) => `R$ ${(v / 1000).toFixed(0)}k`,
        legenda: 'Período analisado',
        cor,
        altura: 300,
      },
    )
    if (imgCV) {
      doc.addImage(imgCV, 'PNG', margin, y, contentWidth, 46)
      y += 50
    }

    if (temCompConsumo) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(15, 23, 42)
      doc.text(
        `Comparativo Consumo: mesmo mês do ano anterior (${data.unidadeConsumo})`,
        margin,
        y + 3,
      )
      y += 6

      const imgCC = barras(
        data.comparativoConsumoAnual.map((c) => ({
          mes: c.mes,
          anterior: c.anteriorConsumo,
          atual: c.atualConsumo,
        })),
        {
          fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
          legenda: `Período (${data.unidadeConsumo})`,
          cor,
          altura: 290,
        },
      )
      if (imgCC) {
        doc.addImage(imgCC, 'PNG', margin, y, contentWidth, 43)
        y += 46
      }
    }
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('Sem mês comparável ao ano anterior neste período.', margin, y + 5)
  }

  // ------------------------------------------------------------------ DETALHAMENTO MENSAL
  if (!totalGeral) {
    doc.addPage()
    paginaAtual += 1
    cabecalho(paginaAtual)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(15, 23, 42)
    doc.text(`Detalhamento Mensal — ${data.tableRows.length} linhas`, margin, y)
    y += 4

    if (typeof (doc as any).autoTable === 'function') {
      ;(doc as any).autoTable({
        startY: y,
        head: [
          [
            'Mês / Ano',
            `Consumo (${data.unidadeConsumo})`,
            'Var. Consumo',
            `Custo unit. (${data.rotuloTarifa})`,
            'Valor (R$)',
            'Var. Valor',
            'Classificação',
          ],
        ],
        body: data.tableRows.map((r) =>
          r.semFatura
            ? [r.label, 'sem fatura', '—', '—', '—', '—', 'sem dado']
            : [
                r.label,
                r.consumo !== null ? formatNumberBR(r.consumo) : '—',
                pct(r.variacaoConsumoPct),
                r.tarifa !== null ? formatCurrencyBRL(r.tarifa) : '—',
                r.valor !== null ? formatCurrencyBRL(r.valor) : '—',
                pct(r.variacaoPct),
                r.isMax ? 'Maior valor' : r.isMin ? 'Menor valor' : 'Regular',
              ],
        ),
        theme: 'grid',
        margin: { left: margin, right: margin },
        styles: {
          fontSize: 6.5,
          cellPadding: 1.4,
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
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell: (hook: any) => {
          if (hook.section !== 'body') return
          const row = data.tableRows[hook.row.index]
          if (row?.semFatura) {
            hook.cell.styles.textColor = [148, 163, 184]
            hook.cell.styles.fontStyle = 'italic'
          } else if (row?.isMax) {
            hook.cell.styles.fillColor = [254, 242, 242]
          } else if (row?.isMin) {
            hook.cell.styles.fillColor = [240, 253, 244]
          }
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 30 },
          1: { halign: 'right', cellWidth: 26 },
          2: { halign: 'right', cellWidth: 22 },
          3: { halign: 'right', cellWidth: 26 },
          4: { halign: 'right', fontStyle: 'bold', cellWidth: 28 },
          5: { halign: 'right', cellWidth: 20 },
          6: { halign: 'center', cellWidth: 'auto' },
        },
      })
      y = (doc as any).lastAutoTable.finalY + 6
    }

    garantirEspaco(28)

    doc.setFillColor(241, 245, 249)
    doc.setDrawColor(203, 213, 225)
    doc.roundedRect(margin, y, contentWidth, 22, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(15, 23, 42)
    doc.text('METODOLOGIA E CONSIDERAÇÕES:', margin + 4, y + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(71, 85, 105)
    const notas = [
      '• Consumo lido na unidade nativa da fatura; convertido para R$ apenas no indicador de custo unitário.',
      '• Média mensal = soma ÷ número de meses COM fatura no período (nunca por constante fixa).',
      '• Mês sem fatura é lacuna: não entra em média, não vira zero e quebra a linha do gráfico.',
      '• Custo unitário efetivo = valor total ÷ consumo; inclui tributos e encargos — não é a tarifa homologada.',
      '• “—” na variação significa ausência de base de comparação (mês anterior sem dado).',
    ]
    notas.forEach((n, i) => {
      doc.text(doc.splitTextToSize(n, contentWidth - 8), margin + 4, y + 7.5 + i * 3.1)
    })
  }

  // Rodapés desenhados no fim, com a contagem real de páginas do documento.
  const totalPaginasFinal = doc.getNumberOfPages()
  for (let i = 1; i <= totalPaginasFinal; i++) {
    doc.setPage(i)
    desenharRodapePdfPadrao(doc, i, totalPaginasFinal, margin, pageWidth, pageHeight)
  }

  const slug = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'geral'

  doc.save(
    `analise-periodo-dekazen-${slug(data.nomeEmpreendimento)}-${slug(data.utilidadeSelecionada)}.pdf`,
  )
}
