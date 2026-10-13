/**
 * Utility to convert PDF files to image data URLs (JPEG/PNG) in the browser
 * using PDF.js via dynamic script loading.
 * This enables Vision-capable LLM analysis for scanned PDFs or PDFs with custom encodings.
 */

// Use official cdnjs/unpkg release of pdfjs-dist that works with standard HTML5 canvas
const PDFJS_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

let pdfjsLoadingPromise: Promise<any> | null = null

export async function loadPdfJs(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('PDF.js can only be loaded in a browser environment')
  }

  const win = window as any
  if (win.pdfjsLib) {
    return win.pdfjsLib
  }

  if (pdfjsLoadingPromise) {
    return pdfjsLoadingPromise
  }

  pdfjsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PDFJS_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (win.pdfjsLib) {
        win.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
        resolve(win.pdfjsLib)
      } else {
        reject(new Error('PDF.js failed to initialize'))
      }
    }
    script.onerror = () => {
      pdfjsLoadingPromise = null
      reject(new Error('Failed to load PDF.js script'))
    }
    document.head.appendChild(script)
  })

  return pdfjsLoadingPromise
}

export interface ConvertPdfToImagesOptions {
  maxPages?: number
  scale?: number
  quality?: number
}

/**
 * Converts up to `maxPages` pages of a PDF File/Blob to base64 JPEG data URLs.
 * High quality rendering (scale 1.5 - 2.0) ensures clean OCR by vision models.
 */
export async function convertPdfToImages(
  file: File | Blob,
  options: ConvertPdfToImagesOptions = {},
): Promise<string[]> {
  const { maxPages = 3, scale = 1.75, quality = 0.85 } = options

  const pdfjs = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise

  const numPages = Math.min(pdf.numPages, maxPages)
  const images: string[] = []

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) continue

    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise

    // Convert to JPEG data URL with good compression/quality ratio
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    images.push(dataUrl)

    // Free canvas memory
    canvas.width = 0
    canvas.height = 0
  }

  return images
}
