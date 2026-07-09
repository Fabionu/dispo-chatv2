import type * as PdfjsModule from 'pdfjs-dist'

// pdf.js is heavy (~300KB + a web worker), so it must never sit in the initial
// bundle. We lazy-import it (and its worker as a Vite `?url` asset) the first
// time a PDF surface actually needs it, then cache the module promise so every
// consumer (preview modals, document viewer, chat-card thumbnails) shares one
// load. The worker keeps rasterisation off the main thread.
let pdfjsPromise: Promise<typeof PdfjsModule> | null = null

export async function loadPdfjs(): Promise<typeof PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}
