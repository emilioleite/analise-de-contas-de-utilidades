/**
 * Utilitário compartilhado para carregar o monograma Dekazen em Data URL PNG
 * e desenhar o cabeçalho e rodapé corporativos padronizados nos PDFs
 * (Dashboard, Análise 24 Meses e Emissões).
 *
 * Utiliza o logo real em src/assets/monograma-dkz-2e2a6.png. No navegador, desenha
 * a imagem em um canvas para obter uma DataURL limpa com fundo transparente ou branco
 * evitando qualquer artefato escuro de compressão.
 */

import dekazenLogoUrl from '@/assets/monograma-dkz-2e2a6.png'

let cachedLogoDataUrl: string | null = null
let logoLoadingPromise: Promise<string> | null = null

export async function getDekazenLogoDataUrl(): Promise<string> {
  if (cachedLogoDataUrl) {
    return cachedLogoDataUrl
  }

  if (logoLoadingPromise) {
    return logoLoadingPromise
  }

  logoLoadingPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve('')
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        // Manter resolução nítida
        const width = img.naturalWidth || 400
        const height = img.naturalHeight || 400
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          // Garante fundo branco limpo para o PDF caso haja transparência parcial
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/png')
          cachedLogoDataUrl = dataUrl
          resolve(dataUrl)
          return
        }
      } catch (e) {
        console.warn('Falha ao converter logo em canvas:', e)
      }
      cachedLogoDataUrl = dekazenLogoUrl
      resolve(dekazenLogoUrl)
    }

    img.onerror = () => {
      console.warn('Falha ao carregar imagem do monograma Dekazen.')
      resolve('')
    }

    img.src = dekazenLogoUrl
  })

  return logoLoadingPromise
}

export interface HeaderPdfOptions {
  doc: any
  currentY: number
  margin: number
  contentWidth: number
  pageWidth: number
  pageHeight: number
  numeroPagina: number
  tituloPrincipal: string
  subtitulo: string
  nomeEmpreendimento: string
  periodoCobertura: string
  dataGeracaoStr: string
  logoDataUrl?: string
}

/**
 * Desenha o cabeçalho corporativo Dekazen padronizado nos relatórios em PDF.
 * Contém o monograma Dekazen em destaque com fundo branco elegante,
 * títulos institucionais e metadados de filtros e período.
 * Retorna o novo currentY para o corpo da página.
 */
export function desenharCabecalhoPdfPadrao(options: HeaderPdfOptions): number {
  const {
    doc,
    margin,
    contentWidth,
    numeroPagina,
    tituloPrincipal,
    subtitulo,
    nomeEmpreendimento,
    periodoCobertura,
    dataGeracaoStr,
    logoDataUrl,
  } = options

  let y = options.currentY

  // 1. Top bar institucional em teal corporativo (#0F766E)
  const barHeight = 26
  doc.setFillColor(15, 118, 110) // #0F766E
  doc.rect(margin, y, contentWidth, barHeight, 'F')

  // Área da logo Dekazen à esquerda
  const logoBoxSize = 20
  const logoBoxX = margin + 3
  const logoBoxY = y + (barHeight - logoBoxSize) / 2

  // Fundo branco arredondado para destacar o monograma sem corte escuro
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(logoBoxX, logoBoxY, logoBoxSize, logoBoxSize, 2, 2, 'F')

  if (logoDataUrl) {
    try {
      doc.addImage(
        logoDataUrl,
        'PNG',
        logoBoxX + 1.5,
        logoBoxY + 1.5,
        logoBoxSize - 3,
        logoBoxSize - 3,
        undefined,
        'FAST',
      )
    } catch {
      // Fallback texto se imagem falhar
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(15, 118, 110)
      doc.text('DKZ', logoBoxX + 5, logoBoxY + 12)
    }
  }

  // Título e Subtítulo ao lado do logotipo
  const textLeft = logoBoxX + logoBoxSize + 4.5
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(tituloPrincipal, textLeft, y + 10)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(204, 251, 241) // teal-100
  doc.text(subtitulo, textLeft, y + 17)

  // Badge Dekazen no canto direito do banner
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text('DEKAZEN', margin + contentWidth - 4, y + 10, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(204, 251, 241)
  doc.text('Gestor de Utilidades', margin + contentWidth - 4, y + 16, { align: 'right' })

  // 2. Metadata bar abaixo do banner
  y += barHeight + 3
  const metaHeight = 14
  doc.setFillColor(248, 250, 252) // #F8FAFC
  doc.setDrawColor(226, 232, 240) // #E2E8F0
  doc.roundedRect(margin, y, contentWidth, metaHeight, 1.5, 1.5, 'FD')

  doc.setFontSize(7.5)

  // Linha 1 de metadados: Empreendimento
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text('Empreendimento:', margin + 4, y + 5.5)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)
  const empTruncado =
    nomeEmpreendimento.length > 55 ? nomeEmpreendimento.slice(0, 52) + '...' : nomeEmpreendimento
  doc.text(empTruncado, margin + 31, y + 5.5)

  // Linha 2 de metadados: Período
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text('Período:', margin + 4, y + 10.5)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)
  doc.text(periodoCobertura, margin + 31, y + 10.5)

  // Coluna direita de metadados: Data de Emissão e Página
  const rightColX = margin + contentWidth - 46
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text('Emissão:', rightColX, y + 5.5)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)
  doc.text(dataGeracaoStr, rightColX + 15, y + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.text('Página:', rightColX, y + 10.5)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)
  doc.text(`${numeroPagina}`, rightColX + 15, y + 10.5)

  y += metaHeight + 4
  return y
}

/**
 * Desenha o rodapé corporativo Dekazen.
 */
export function desenharRodapePdfPadrao(
  doc: any,
  numeroPagina: number,
  totalPaginas: number | undefined,
  margin: number,
  pageWidth: number,
  pageHeight: number,
  notaMetodologica?: string,
): void {
  const rodapeY = pageHeight - 10
  doc.setDrawColor(226, 232, 240)
  doc.line(margin, rodapeY - 2, pageWidth - margin, rodapeY - 2)

  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(148, 163, 184)

  const defaultNota =
    'Dekazen • Gestor de Utilidades — Relatório Executivo emitido a partir das faturas homologadas no sistema.'
  const textoNota = notaMetodologica || defaultNota

  doc.text(textoNota, margin, rodapeY + 2)
  doc.text(
    `Página ${numeroPagina}${totalPaginas ? ` de ${totalPaginas}` : ''}`,
    pageWidth - margin,
    rodapeY + 2,
    { align: 'right' },
  )
}
