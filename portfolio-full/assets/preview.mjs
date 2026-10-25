let libraryPromise;

export function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

export function getPDFLibrary() {
  libraryPromise ||= withTimeout(import('./vendor/pdf.mjs'), 20000, '本地 PDF 组件加载超时').then((library) => {
    library.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
    return library;
  });
  return libraryPromise;
}

export function pdfOptions(file) {
  return {
    url: new URL(file, new URL('../', import.meta.url)).href,
    cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
    isEvalSupported: false,
    enableXfa: false
  };
}

// Original first-page previews only. No invented cover images, remote service, or retained PDF documents.
export function startPreviews(canvases) {
  if (!('IntersectionObserver' in window)) return () => {};
  const queue = [];
  let active = false;
  let stopped = false;
  let currentTask;
  let currentRender;
  const targets = new Map(Array.from(canvases, (canvas) => [canvas.parentElement, canvas]));
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const canvas = targets.get(entry.target);
      if (!entry.isIntersecting || !canvas || canvas.dataset.previewDone) continue;
      observer.unobserve(entry.target);
      canvas.dataset.previewDone = 'queued';
      queue.push(canvas);
    }
    drain();
  }, { rootMargin: '240px 0px' });

  async function drain() {
    if (active || stopped) return;
    active = true;
    while (queue.length && !stopped) {
      const canvas = queue.shift();
      if (!canvas.isConnected) continue;
      let document;
      try {
        const library = await getPDFLibrary();
        if (stopped || !canvas.isConnected) break;
        currentTask = library.getDocument(pdfOptions(canvas.dataset.pdfPreview));
        document = await withTimeout(currentTask.promise, 25000, '封面读取超时');
        const page = await document.getPage(1);
        if (stopped || !canvas.isConnected) break;
        const natural = page.getViewport({ scale: 1 });
        const cover = canvas.parentElement;
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        const scale = Math.min((cover.clientWidth - 24) / natural.width, (cover.clientHeight - 24) / natural.height) * ratio;
        const viewport = page.getViewport({ scale: Math.max(.1, scale) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas unavailable');
        currentRender = page.render({ canvasContext: context, viewport });
        await withTimeout(currentRender.promise, 20000, '封面绘制超时');
        if (!stopped && canvas.isConnected) {
          canvas.hidden = false;
          canvas.dataset.previewDone = 'ready';
        }
        page.cleanup();
      } catch (error) {
        currentRender?.cancel();
        canvas.width = 0;
        canvas.height = 0;
        canvas.hidden = true;
        canvas.dataset.previewDone = 'failed';
        if (!stopped) console.warn('Original PDF cover:', error.message);
      } finally {
        try { if (currentTask) await currentTask.destroy(); } catch { /* Already destroyed on cancellation. */ }
        currentTask = undefined;
        currentRender = undefined;
      }
    }
    active = false;
  }

  for (const canvas of canvases) {
    if (canvas.dataset.previewDone !== 'ready' && canvas.dataset.previewDone !== 'failed') {
      delete canvas.dataset.previewDone;
      observer.observe(canvas.parentElement);
    }
  }
  return () => {
    stopped = true;
    observer.disconnect();
    queue.length = 0;
    currentRender?.cancel();
    if (currentTask) currentTask.destroy().catch(() => {});
  };
}
