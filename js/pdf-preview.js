import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.js', import.meta.url).href;
let cachedSource;
let cachedPreview;

export function pdfPreview(source) {
  if (source !== cachedSource || !cachedPreview) {
    cachedSource = source;
    cachedPreview = renderFirstPage(source).catch(error => {
      if (cachedSource === source) cachedPreview = null;
      throw error;
    });
  }
  return cachedPreview;
}

async function renderFirstPage(source) {
  const data = Uint8Array.from(atob(source.split(',')[1] || source), character => character.charCodeAt(0));
  const loading = getDocument({
    data, isEvalSupported: false, enableXfa: false,
    standardFontDataUrl: new URL('../pdf-fonts/', import.meta.url).href,
    cMapUrl: new URL('../pdf-cmaps/', import.meta.url).href,
    cMapPacked: true,
    wasmUrl: new URL('../pdf-wasm/', import.meta.url).href
  });
  try {
    const document = await loading.promise;
    const page = await document.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1160 / original.width, 1600 / original.height) });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { image: canvas.toDataURL('image/png'), width: original.width, height: original.height };
  } finally {
    await loading.destroy();
  }
}
