(() => {
  'use strict';

  const categories = ['文案', '传播方案', '宣传册', '海报', '会议活动', '影视'];
  const page = document.body.dataset.page;
  const $ = (id) => document.getElementById(id);
  const text = (value) => Array.isArray(value) ? value.map(text).join('\n') : typeof value === 'string' ? value : '';
  const node = (tag, className, content) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  };
  const workURL = (id) => `work.html?id=${encodeURIComponent(id)}`;
  const assetURL = (file) => {
    if (typeof file !== 'string' || !/^assets\//.test(file) || file.split('/').includes('..') || /[\\?#]/.test(file)) {
      throw new Error('作品文件路径不可用');
    }
    return file;
  };
  const fileLabel = (work) => {
    if (work.kind === 'pdf') return `${Number(work.pages) || '—'} 页 · PDF`;
    if (work.kind === 'video') return work.id === 'hanyang-mv' ? '完整视频 · 03:27' : '完整视频';
    return '完整图片';
  };

  function reportError(message) {
    if (page === 'home') {
      const status = $('catalog-status');
      status.hidden = false;
      status.dataset.state = 'error';
      status.textContent = message;
      if (!$('work-grid').children.length) $('results-count').textContent = '作品目录暂不可用';
    } else {
      const state = $('work-state');
      state.hidden = false;
      state.replaceChildren(node('h2', '', '作品暂时无法打开'), node('p', '', message));
      const back = node('a', 'text-link', '返回完整作品库');
      back.href = 'index.html#portfolio';
      state.append(back);
    }
  }

  window.addEventListener('error', (event) => {
    if (event.error) reportError('页面遇到 JavaScript 错误。请刷新重试，或通过原文件入口继续阅读。');
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Portfolio:', event.reason);
    reportError('部分页面功能未能加载。请刷新重试；已显示的原文件链接仍可使用。');
  });

  function loadCatalog() {
    const works = window.PORTFOLIO_WORKS;
    if (!Array.isArray(works) || !works.length) throw new Error('作品目录未能加载。请确认 assets/catalog.js 已就绪，再刷新页面。');
    const ids = new Set();
    for (const work of works) {
      if (!work || typeof work.id !== 'string' || !work.title || ids.has(work.id) || !['pdf', 'image', 'video'].includes(work.kind)) {
        throw new Error('作品目录格式不完整，请检查数据后刷新页面。');
      }
      assetURL(work.file);
      ids.add(work.id);
    }
    return works;
  }

  function createCard(work, index) {
    const card = node('article', 'work-card');
    const link = node('a', 'card-link');
    link.href = workURL(work.id);
    const cover = node('div', 'card-cover');
    cover.dataset.kind = work.kind;
    if (work.photos?.length && work.thumb) cover.dataset.cover = 'event';
    cover.setAttribute('aria-hidden', 'true');
    const fallback = node('div', 'cover-fallback');
    fallback.append(node('span', 'cover-category', work.category));
    const bottom = node('div', 'cover-bottom');
    bottom.append(node('span', 'cover-id', work.kind === 'video' ? 'Film / 03:27' : work.kind === 'image' ? 'Original image' : 'Original document'), node('span', 'cover-index', String(index + 1).padStart(2, '0')));
    fallback.append(bottom);
    cover.append(fallback);
    if (work.kind === 'image' || work.thumb) {
      const image = node('img');
      image.src = assetURL(work.kind === 'image' ? work.file : work.thumb);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove(), { once: true });
      cover.replaceChildren(image);
      cover.prepend(fallback);
      fallback.hidden = true;
      image.addEventListener('error', () => { fallback.hidden = false; }, { once: true });
    } else if (work.kind === 'pdf') {
      const canvas = node('canvas', 'preview-canvas');
      canvas.dataset.pdfPreview = assetURL(work.file);
      canvas.hidden = true;
      cover.append(canvas);
    }
    const body = node('div', 'card-body');
    const meta = node('p', 'card-meta');
    meta.append(node('span', 'category', work.category), node('span', '', [work.year, fileLabel(work)].filter(Boolean).join(' · ')));
    body.append(meta, node('h3', '', work.title), node('p', 'card-summary', text(work.summary)));
    const cta = node('span', 'card-cta');
    cta.append(node('span', '', work.kind === 'video' ? '观看完整作品' : '阅读项目与原稿'), node('span', '', '↗'));
    body.append(cta);
    link.append(cover, body);
    card.append(link);
    return card;
  }

  let previewModule;
  let stopPreviews;
  let previewGeneration = 0;
  async function refreshPreviews() {
    const generation = ++previewGeneration;
    stopPreviews?.();
    if (!document.querySelector('[data-pdf-preview]') || !('IntersectionObserver' in window)) return;
    try {
      previewModule ||= import('./preview.mjs');
      const { startPreviews } = await previewModule;
      if (generation !== previewGeneration) return;
      stopPreviews = startPreviews(document.querySelectorAll('[data-pdf-preview]'));
    } catch (error) {
      // Text-based covers remain complete, clickable entries if PDF.js is unavailable.
      console.warn('PDF covers unavailable:', error.message);
    }
  }

  function initContact() {
    $('copy-wechat')?.addEventListener('click', async (event) => {
      const value = event.currentTarget.dataset.wechat;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        $('contact-status').textContent = '微信号已复制。';
      } catch {
        $('contact-status').textContent = `请手动复制微信号：${value}`;
      }
    });
  }

  function initHome(catalog) {
    const works = catalog.filter((work) => !work.parentId);
    const pdfs = works.filter((work) => work.kind === 'pdf');
    $('stat-works').textContent = works.length;
    $('stat-pdfs').textContent = pdfs.length;
    const pagesKnown = pdfs.every((work) => Number.isInteger(Number(work.pages)) && Number(work.pages) > 0);
    $('stat-pages').textContent = pagesKnown ? pdfs.reduce((sum, work) => sum + Number(work.pages), 0) : '—';
    $('catalog-status').hidden = true;
    const searchable = new Map(works.map((work) => [work.id, [work.title, work.category, work.sourceName, text(work.summary), text(work.role), text(work.value), work.year, ...Array.isArray(work.text) ? work.text : []].filter(Boolean).join('\n').toLocaleLowerCase('zh-CN')]));
    let selected = '全部';
    const search = $('work-search');
    const filterRow = $('category-filters');
    const params = new URLSearchParams(location.search);
    if (categories.includes(params.get('category'))) selected = params.get('category');
    search.value = params.get('q') || '';
    for (const category of ['全部', ...categories]) {
      const count = category === '全部' ? works.length : works.filter((work) => work.category === category).length;
      const button = node('button', 'filter-button', `${category} ${count}`);
      button.type = 'button';
      button.dataset.category = category;
      button.setAttribute('aria-pressed', String(category === selected));
      button.setAttribute('aria-controls', 'work-grid');
      button.addEventListener('click', () => { selected = category; render(); });
      filterRow.append(button);
    }
    function render() {
      const query = search.value.trim().toLocaleLowerCase('zh-CN');
      const terms = query.split(/\s+/).filter(Boolean);
      const filtered = works.filter((work) => (selected === '全部' || work.category === selected) && terms.every((term) => searchable.get(work.id).includes(term)));
      const fragment = document.createDocumentFragment();
      for (const work of filtered) fragment.append(createCard(work, works.indexOf(work)));
      $('work-grid').replaceChildren(fragment);
      $('results-count').textContent = `显示 ${filtered.length} / ${works.length} 个作品${selected !== '全部' ? ` · ${selected}` : ''}`;
      $('archive-empty').hidden = filtered.length > 0;
      $('reset-filters').hidden = !query && selected === '全部';
      for (const button of filterRow.children) button.setAttribute('aria-pressed', String(button.dataset.category === selected));
      refreshPreviews();
    }
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 150); });
    $('reset-filters').addEventListener('click', () => {
      clearTimeout(timer);
      search.value = '';
      selected = '全部';
      render();
      search.focus();
    });
    render();
  }

  function makeOriginalLink(file, label) {
    const link = node('a', 'text-link', label);
    link.href = assetURL(file);
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', `${label}（新标签页）`);
    return link;
  }

  function preparePages(count) {
    const fragment = document.createDocumentFragment();
    const options = document.createDocumentFragment();
    for (let number = 1; number <= count; number += 1) {
      const figure = node('figure', 'pdf-page');
      figure.id = `pdf-page-${number}`;
      figure.dataset.page = number;
      const sheet = node('div', 'pdf-sheet');
      sheet.dataset.state = 'idle';
      const placeholder = node('div', 'page-placeholder', `第 ${number} 页 · 滚动至此处显示完整原稿`);
      sheet.append(placeholder);
      figure.append(sheet, node('figcaption', 'pdf-page-label', `第 ${number} / ${count} 页`));
      fragment.append(figure);
      const option = node('option', '', `第 ${number} / ${count} 页`);
      option.value = number;
      options.append(option);
    }
    $('pdf-pages').replaceChildren(fragment);
    $('page-select').replaceChildren(options);
  }

  function initTextReader(work) {
    const source = Array.isArray(work.text) ? work.text.map(text) : [];
    const hasText = source.some((value) => value.trim());
    const search = $('text-search');
    const next = $('text-search-next');
    if (!hasText) {
      $('text-pages').append(node('p', 'empty-state', '这份材料没有可检索的抽取文字，可能是图片版原稿。请切换「原稿版式」阅读完整页面，或打开原文件。'));
      search.disabled = true;
      next.disabled = true;
      $('text-search-count').textContent = '无可检索文字';
      return;
    }
    const pageContents = source.map((content, index) => {
      const section = node('section', 'text-page');
      section.id = `text-page-${index + 1}`;
      section.append(node('h3', '', `第 ${index + 1} 页原文`));
      const body = node('div', 'text-page-content', content || '本页无抽取文字，请查看原稿。');
      section.append(body);
      $('text-pages').append(section);
      return body;
    });
    let marks = [];
    let current = -1;
    let lastQuery = '';
    let timer;
    function updateSearch() {
      const query = search.value.trim();
      lastQuery = query;
      current = -1;
      for (const [index, body] of pageContents.entries()) {
        const content = source[index] || '本页无抽取文字，请查看原稿。';
        if (!query || !source[index]) { body.textContent = content; continue; }
        const lower = content.toLocaleLowerCase('zh-CN');
        const needle = query.toLocaleLowerCase('zh-CN');
        const fragment = document.createDocumentFragment();
        let start = 0;
        let match = lower.indexOf(needle, start);
        while (match !== -1) {
          fragment.append(document.createTextNode(content.slice(start, match)), node('mark', '', content.slice(match, match + query.length)));
          start = match + query.length;
          match = lower.indexOf(needle, start);
        }
        fragment.append(document.createTextNode(content.slice(start)));
        body.replaceChildren(fragment);
      }
      marks = Array.from($('text-pages').querySelectorAll('mark'));
      next.disabled = marks.length === 0;
      $('text-search-count').textContent = query ? `找到 ${marks.length} 处匹配` : '';
    }
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(updateSearch, 150); });
    function findNext() {
      clearTimeout(timer);
      if (search.value.trim() !== lastQuery) updateSearch();
      if (!marks.length) return;
      if (current >= 0) delete marks[current].dataset.current;
      current = (current + 1) % marks.length;
      marks[current].dataset.current = 'true';
      marks[current].scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      $('text-search-count').textContent = `第 ${current + 1} / ${marks.length} 处匹配`;
    }
    next.addEventListener('click', findNext);
    search.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); findNext(); } });
  }

  function pdfFallback(error) {
    console.warn('PDF reader unavailable:', error);
    $('reader-status').textContent = '原稿预览不可用；可打开完整 PDF，或切换文字全文。';
    $('reader-status').dataset.state = 'error';
    $('reader-fallback').hidden = false;
    $('reader-error').textContent = location.protocol === 'file:' ? '请通过本地 HTTP 服务打开网站以使用 PDF 阅读器；也可直接打开原文件。' : '本地 PDF 组件或原文件未能加载。请打开完整原文件继续阅读。';
    for (const placeholder of $('pdf-pages').querySelectorAll('.page-placeholder')) placeholder.textContent = '预览不可用 · 请使用上方原文件链接';
  }

  async function initPDF(work) {
    $('pdf-reader').hidden = false;
    $('reader-fallback-link').href = assetURL(work.file);
    preparePages(Math.max(1, Number(work.pages) || 1));
    initTextReader(work);
    function setMode(mode) {
      const original = mode === 'original';
      $('pdf-pages').hidden = !original;
      $('text-reader').hidden = original;
      $('mode-original').setAttribute('aria-pressed', String(original));
      $('mode-text').setAttribute('aria-pressed', String(!original));
      $('page-select').setAttribute('aria-controls', original ? 'pdf-pages' : 'text-pages');
      $('page-nav').hidden = !original && !Array.isArray(work.text);
      window.dispatchEvent(new CustomEvent('portfolio:reader-mode', { detail: { original } }));
    }
    $('mode-original').addEventListener('click', () => setMode('original'));
    $('mode-text').addEventListener('click', () => setMode('text'));
    $('page-select').addEventListener('change', (event) => {
      const original = $('mode-original').getAttribute('aria-pressed') === 'true';
      const target = $(`${original ? 'pdf' : 'text'}-page-${event.target.value}`);
      if (target) target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    try {
      let timer;
      const module = await Promise.race([
        import('./reader.mjs'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('阅读组件加载超时')), 20000); })
      ]).finally(() => clearTimeout(timer));
      await module.mountPDFReader(work, { preparePages });
    } catch (error) { pdfFallback(error); }
  }

  function initImage(work) {
    const host = $('image-reader');
    host.hidden = false;
    const link = makeOriginalLink(work.file, '打开完整原图');
    link.className = 'original-image';
    const img = node('img');
    img.src = assetURL(work.file);
    img.alt = work.title;
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.hidden = true;
      link.append(node('p', 'empty-state', '图片未能加载，请点击打开原文件。'));
    }, { once: true });
    link.replaceChildren(img);
    host.append(link, node('p', 'media-caption', `${work.sourceName || work.title} · 完整图片，点击可在新标签页打开原图。`));
  }

  function initVideo(work) {
    const host = $('video-reader');
    host.hidden = false;
    const video = node('video', 'original-video');
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('aria-label', work.title);
    video.src = assetURL(work.file);
    video.append(document.createTextNode('当前浏览器不支持视频播放，请打开原文件。'));
    if (work.thumb) video.poster = assetURL(work.thumb);
    host.append(video, node('p', 'media-caption', `${work.sourceName || work.title} · 03:27 · 720p 完整网页播放版。`));
    video.addEventListener('error', () => {
      const message = node('div', 'empty-state');
      message.append(node('p', '', '视频未能播放，请使用原文件入口。'), makeOriginalLink(work.file, '打开完整视频'));
      host.append(message);
    }, { once: true });
  }

  function renderProjectPhotos(work, works) {
    // Fixed associations prevent 2024 business-environment imagery from being assigned to the 2023 expo.
    const association = { expo2023: 'expo-photo', anhui2024: 'anhui-photo' };
    let photos = Array.isArray(work.photos) ? work.photos : [];
    if (association[work.id]) {
      const correct = works.find((item) => item.id === association[work.id] && item.kind === 'image');
      photos = correct ? [{ file: correct.file, caption: photos.find((photo) => photo.file === correct.file)?.caption || correct.title }] : [];
    }
    if (!photos.length) return;
    for (const photo of photos) {
      const figure = node('figure');
      const link = makeOriginalLink(photo.file, '打开活动实拍原图');
      const img = node('img');
      img.src = assetURL(photo.file);
      img.alt = photo.caption || '对应活动实拍';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => { img.hidden = true; link.textContent = '照片未能加载，打开原图 ↗'; }, { once: true });
      link.replaceChildren(img);
      figure.append(link, node('figcaption', '', photo.caption || '对应活动实拍'));
      $('detail-photos').append(figure);
    }
    $('project-photos').hidden = false;
  }

  function initWork(catalog) {
    let id = new URLSearchParams(location.search).get('id');
    const requested = catalog.find((work) => work.id === id);
    if (requested?.parentId) {
      id = requested.parentId;
      const url = new URL(location.href);
      url.searchParams.set('id', id);
      history.replaceState(null, '', url);
    }
    const works = catalog.filter((work) => !work.parentId);
    const index = works.findIndex((work) => work.id === id);
    if (index === -1) {
      reportError(id ? '没有找到这个作品编号。请从作品库选择有效作品。' : '尚未选择作品。请从作品库打开一份材料。');
      return;
    }
    const work = works[index];
    document.title = `${work.title}｜罗睿娴`;
    $('breadcrumb-current').textContent = work.category;
    $('work-title').textContent = work.title;
    $('work-category').textContent = `${work.category} / ${work.kind === 'pdf' ? 'Original document' : work.kind === 'image' ? 'Original image' : 'Film'}`;
    $('work-meta').append(...[work.year, fileLabel(work)].filter(Boolean).map((value) => node('span', '', String(value))));
    $('work-summary').textContent = text(work.summary);
    $('work-role').textContent = text(work.role) || '以已确认的项目分工为准；作品样本不等同于个人独立完成全部工作。';
    $('work-value').textContent = text(work.value) || '通过具体交付物呈现项目内容，客户成果与个人贡献分别说明。';
    $('work-boundary').textContent = text(work.boundary) || '材料用于展示作品样本；不将项目整体成果、设计制作或主办职责自动归于个人。';
    $('original-open').href = assetURL(work.file);
    $('original-download').href = assetURL(work.file);
    $('original-download').download = work.file.split('/').pop();
    if (work.kind === 'video') {
      $('original-open').firstChild.textContent = '打开完整视频 ';
      $('original-download').firstChild.textContent = '下载网页播放版 ';
      if (work.sourceName) $('work-meta').append(node('span', '', `源文件：${work.sourceName}`));
    }
    renderProjectPhotos(work, catalog);
    const neighbors = [[(index - 1 + works.length) % works.length, '← 上一份作品'], [(index + 1) % works.length, '下一份作品 →']];
    for (const [position, label] of neighbors) {
      const neighbor = works[position];
      const link = node('a', 'pagination-link');
      link.href = workURL(neighbor.id);
      link.append(node('span', '', label), node('strong', '', neighbor.title));
      $('work-pagination').append(link);
    }
    $('work-state').hidden = true;
    $('work-detail').hidden = false;
    if (work.kind === 'pdf') initPDF(work);
    else if (work.kind === 'image') initImage(work);
    else initVideo(work);
  }

  try {
    initContact();
    const works = loadCatalog();
    if (page === 'home') initHome(works);
    else if (page === 'work') initWork(works);
  } catch (error) {
    console.error('Portfolio initialization:', error);
    reportError(error.message || '页面初始化失败，请刷新后重试。');
  }
})();
