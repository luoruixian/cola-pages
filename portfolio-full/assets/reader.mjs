import { getPDFLibrary, pdfOptions, withTimeout } from './preview.mjs';

const MAX_PIXEL_RATIO = 2;
const MAX_CANVAS_PIXELS = 8000000;
const MAX_CANVAS_DIMENSION = 4096;

export async function mountPDFReader(work, { preparePages }) {
  const host = document.getElementById('pdf-pages');
  const status = document.getElementById('reader-status');
  let loadingTask;
  let pdf;
  try {
    const library = await getPDFLibrary();
    loadingTask = library.getDocument(pdfOptions(work.file));
    pdf = await withTimeout(loadingTask.promise, 35000, '完整 PDF 读取超时');
    if (host.children.length !== pdf.numPages) preparePages(pdf.numPages);
  } catch (error) {
    if (loadingTask) loadingTask.destroy().catch(() => {});
    throw error;
  }

  const records = Array.from(host.querySelectorAll('.pdf-page'), (element) => ({
    element,
    sheet: element.querySelector('.pdf-sheet'),
    number: Number(element.dataset.page),
    state: 'idle',
    visible: false,
    queued: false,
    token: 0,
    renderTask: null,
    canvas: null
  }));
  const byElement = new Map(records.map((record) => [record.element, record]));
  const queue = [];
  let draining = false;
  let destroyed = false;
  let resizeTimer;
  let modeOriginal = !host.hidden;
  const originalURL = new URL(work.file, new URL('../', import.meta.url)).href;

  function setPlaceholder(record, message) {
    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    placeholder.textContent = message || `第 ${record.number} 页 · 滚动至此处显示完整原稿`;
    record.sheet.replaceChildren(placeholder);
  }

  function clearCanvas(record) {
    if (record.canvas) {
      record.canvas.width = 0;
      record.canvas.height = 0;
      record.canvas.remove();
      record.canvas = null;
    }
  }

  function release(record) {
    record.token += 1;
    record.renderTask?.cancel();
    clearCanvas(record);
    if (record.state !== 'error') {
      record.state = 'idle';
      record.sheet.dataset.state = 'idle';
      setPlaceholder(record);
    }
  }

  function showPageError(record, error) {
    record.state = 'error';
    record.sheet.dataset.state = 'error';
    clearCanvas(record);
    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    const message = document.createElement('p');
    message.textContent = `第 ${record.number} 页未能显示。可重试或打开完整原文件。`;
    const original = document.createElement('a');
    original.href = originalURL;
    original.target = '_blank';
    original.rel = 'noopener';
    original.textContent = '打开完整 PDF 原稿 ↗';
    original.setAttribute('aria-label', '打开完整 PDF 原稿（新标签页）');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button-secondary';
    retry.textContent = '重试本页';
    retry.addEventListener('click', () => {
      record.state = 'idle';
      record.sheet.dataset.state = 'idle';
      setPlaceholder(record);
      enqueue(record);
    });
    placeholder.append(message, original, retry);
    record.sheet.replaceChildren(placeholder);
    status.textContent = `已读取全部 ${pdf.numPages} 页；个别页面预览失败，可在该页重试或打开原文件。`;
    console.warn(`PDF page ${record.number}:`, error.message);
  }

  function enqueue(record) {
    if (destroyed || !modeOriginal || !record.visible || record.queued || record.state !== 'idle') return;
    record.queued = true;
    queue.push(record);
    drain();
  }

  async function drain() {
    if (draining || destroyed) return;
    draining = true;
    while (queue.length && !destroyed) {
      const record = queue.shift();
      record.queued = false;
      if (!record.visible || !modeOriginal || record.state !== 'idle') continue;
      record.state = 'rendering';
      record.sheet.dataset.state = 'rendering';
      const token = ++record.token;
      setPlaceholder(record, `正在显示第 ${record.number} 页…`);
      let page;
      let canvas;
      let task;
      try {
        page = await withTimeout(pdf.getPage(record.number), 25000, '页面读取超时');
        if (token !== record.token || destroyed || !record.visible || !modeOriginal) continue;
        const natural = page.getViewport({ scale: 1 });
        record.sheet.style.setProperty('--page-ratio', String(natural.width / natural.height));
        const width = record.sheet.clientWidth;
        if (width < 1) { record.state = 'idle'; continue; }
        const cssScale = width / natural.width;
        const cssHeight = natural.height * cssScale;
        // Cap both device pixel ratio and canvas allocation for long or unusually shaped pages.
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          MAX_PIXEL_RATIO,
          Math.sqrt(MAX_CANVAS_PIXELS / (width * cssHeight)),
          MAX_CANVAS_DIMENSION / width,
          MAX_CANVAS_DIMENSION / cssHeight
        );
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${work.title}，原稿第 ${record.number} / ${pdf.numPages} 页；可切换文字全文阅读可检索原文。`);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('浏览器不支持 Canvas');
        task = page.render({ canvasContext: context, viewport });
        record.renderTask = task;
        await withTimeout(task.promise, 30000, '页面绘制超时');
        if (token !== record.token || destroyed || !record.visible || !modeOriginal) continue;
        record.canvas = canvas;
        record.sheet.replaceChildren(canvas);
        record.state = 'ready';
        record.sheet.dataset.state = 'ready';
      } catch (error) {
        task?.cancel();
        if (token === record.token && !destroyed && error.name !== 'RenderingCancelledException') showPageError(record, error);
      } finally {
        if (canvas && record.canvas !== canvas) { canvas.width = 0; canvas.height = 0; }
        record.renderTask = null;
        page?.cleanup();
        if (token === record.token && record.state === 'rendering') {
          record.state = 'idle';
          record.sheet.dataset.state = 'idle';
          setPlaceholder(record);
        }
        // A resize or rapid return to the page may have invalidated an in-flight render.
        if (record.state === 'idle' && record.visible && modeOriginal && !destroyed) enqueue(record);
      }
    }
    draining = false;
  }

  // Read page dimensions before observation so landscape pages do not move the scroll target when rendered.
  status.textContent = `已建立全部 ${pdf.numPages} 页占位，正在确认原稿页面比例…`;
  await Promise.all(records.map(async (record) => {
    try {
      const page = await withTimeout(pdf.getPage(record.number), 25000, '页面尺寸读取超时');
      const viewport = page.getViewport({ scale: 1 });
      record.sheet.style.setProperty('--page-ratio', String(viewport.width / viewport.height));
      page.cleanup();
    } catch (error) { showPageError(record, error); }
  }));

  let observer;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const record = byElement.get(entry.target);
        record.visible = entry.isIntersecting;
        if (record.visible) enqueue(record);
        else release(record);
      }
    }, { rootMargin: '900px 0px', threshold: 0 });
    records.forEach((record) => observer.observe(record.element));
  } else {
    // Still show every page in older browsers; never replace the document with an iframe.
    records.forEach((record) => { record.visible = true; enqueue(record); });
  }

  function refreshVisible() {
    if (destroyed) return;
    records.forEach((record) => {
      if (record.state === 'ready' || record.state === 'rendering') release(record);
      if (record.visible) enqueue(record);
    });
  }
  let measuredWidth = host.clientWidth;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const width = host.clientWidth;
      if (Math.abs(width - measuredWidth) < 2 || width < 1) return;
      measuredWidth = width;
      refreshVisible();
    }, 180);
  }
  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;
  resizeObserver?.observe(host);
  window.addEventListener('resize', onResize);

  function onMode(event) {
    modeOriginal = event.detail.original;
    if (!modeOriginal) records.forEach(release);
    else refreshVisible();
  }
  window.addEventListener('portfolio:reader-mode', onMode);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(resizeTimer);
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('portfolio:reader-mode', onMode);
    queue.length = 0;
    records.forEach(release);
    loadingTask.destroy().catch(() => {});
  }
  window.addEventListener('pagehide', (event) => { if (!event.persisted) destroy(); });
  status.textContent = records.some((record) => record.state === 'error')
    ? `已建立全部 ${pdf.numPages} 页；个别页面读取失败，可在该页重试或打开完整原文件。`
    : `已读取全部 ${pdf.numPages} 页。连续向下滚动即可阅读完整原稿；临近页面按需显示。`;
  status.removeAttribute('data-state');
  return { destroy, numPages: pdf.numPages };
}
