/* ========================================================
 * 爱阅读 — 主应用脚本
 * 支持 EPUB / PDF / TXT / HTML 四种格式
 * ======================================================== */

// ============ 全局状态 ============
const App = {
  state: {
    books: [],
    currentBook: null,
    currentChapter: 0,
    readerFormat: null, // 'epub' | 'pdf' | 'txt' | 'html'
    pdfPage: 1,
    pdfTotalPages: 0,
    searchResults: [],
    searchQuery: '',
  },
  settings: {
    theme: 'light',
    fontSize: 18,
    lineHeight: 1.8,
    textIndent: 2,
    pageMargins: 24,
  },
  db: null,
};

// ============ IndexedDB 存储 ============
const Storage = {
  DB_NAME: 'AiReadDB',
  DB_VERSION: 1,
  STORE_BOOKS: 'books',
  STORE_SETTINGS: 'settings',
  STORE_PROGRESS: 'progress',
  STORE_BOOKMARKS: 'bookmarks',
  STORE_NOTES: 'notes',

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_BOOKS)) {
          db.createObjectStore(this.STORE_BOOKS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.STORE_SETTINGS)) {
          db.createObjectStore(this.STORE_SETTINGS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(this.STORE_PROGRESS)) {
          db.createObjectStore(this.STORE_PROGRESS, { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains(this.STORE_BOOKMARKS)) {
          const store = db.createObjectStore(this.STORE_BOOKMARKS, { keyPath: 'id' });
          store.createIndex('bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains(this.STORE_NOTES)) {
          const store = db.createObjectStore(this.STORE_NOTES, { keyPath: 'id' });
          store.createIndex('bookId', 'bookId', { unique: false });
        }
      };
      req.onsuccess = (e) => { App.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  tx(storeName, mode = 'readonly') {
    return App.db.transaction(storeName, mode).objectStore(storeName);
  },

  async put(storeName, value) {
    return new Promise((resolve, reject) => {
      const req = this.tx(storeName, 'readwrite').put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.target.error);
    });
  },

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this.tx(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.target.error);
    });
  },

  async getAll(storeName, indexName = null, key = null) {
    return new Promise((resolve, reject) => {
      const store = this.tx(storeName);
      const req = indexName ? store.index(indexName).getAll(key) : store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.target.error);
    });
  },

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this.tx(storeName, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.target.error);
    });
  },

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const req = this.tx(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.target.error);
    });
  },
};

// ============ 工具函数 ============
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function showToast(msg, duration = 2000) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div'); t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), duration);
}
function detectFormat(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (['epub'].includes(ext)) return 'epub';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['txt'].includes(ext)) return 'txt';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['mobi', 'azw3'].includes(ext)) return 'mobi';
  return 'unknown';
}
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function getFirstChars(str, n = 2) {
  return (str || '').trim().slice(0, n) || '📖';
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ============ 设置（主题/字体/行距）============
const Settings = {
  async load() {
    const keys = ['theme', 'fontSize', 'lineHeight', 'textIndent', 'pageMargins'];
    const saved = await Promise.all(
      keys.map(k => Storage.get(Storage.STORE_SETTINGS, k))
    );
    saved.forEach((v, i) => {
      if (v !== undefined) App.settings[keys[i]] = v.value;
    });
    this.apply();
  },

  apply() {
    document.documentElement.setAttribute('data-theme', App.settings.theme);
    if ($('#book-content')) {
      const bc = $('#book-content');
      bc.style.setProperty('--font-size', App.settings.fontSize + 'px');
      bc.style.lineHeight = App.settings.lineHeight;
      bc.style.setProperty('--text-indent', App.settings.textIndent + 'em');
      bc.style.padding = `${App.settings.pageMargins}px`;
    }
    // 同步到 input 控件
    const fontSizeInput = $('#font-size');
    if (fontSizeInput) fontSizeInput.value = App.settings.fontSize;
    const lineHeightInput = $('#line-height');
    if (lineHeightInput) lineHeightInput.value = App.settings.lineHeight;
    const themeBtns = $$('.theme-btn');
    themeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.theme === App.settings.theme));
  },

  async set(key, value) {
    App.settings[key] = value;
    await Storage.put(Storage.STORE_SETTINGS, { key, value });
    this.apply();
  },
};

// ============ 书架 ============
const Bookshelf = {
  async load() {
    App.state.books = await Storage.getAll(Storage.STORE_BOOKS);
    this.render();
  },

  async importFiles(fileList) {
    for (const file of fileList) {
      const format = detectFormat(file.name);
      if (format === 'unknown') {
        showToast(`不支持的格式: ${file.name}`);
        continue;
      }
      const buffer = await file.arrayBuffer();
      const book = {
        id: uid(),
        name: file.name.replace(/\.[^.]+$/, ''),
        fullName: file.name,
        format,
        size: file.size,
        data: buffer,
        importedAt: Date.now(),
        lastRead: null,
        progress: 0,
      };
      await Storage.put(Storage.STORE_BOOKS, book);
      App.state.books.push(book);
    }
    this.render();
    showToast(`导入成功 (${fileList.length} 本)`);
  },

  render() {
    const grid = $('.books-grid');
    if (!grid) return;
    const query = ($('#search-input')?.value || '').toLowerCase();
    const sortBy = $('#sort-select')?.value || 'recent';

    let books = App.state.books.filter(b =>
      b.name.toLowerCase().includes(query) || b.fullName.toLowerCase().includes(query)
    );

    books.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'size') return b.size - a.size;
      return (b.lastRead || b.importedAt) - (a.lastRead || a.importedAt);
    });

    if (books.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <div class="emoji">📚</div>
          <h3>${App.state.books.length === 0 ? '书架空空如也' : '没有找到匹配的书籍'}</h3>
          <p>${App.state.books.length === 0 ? '点击右上角 "+" 导入你的第一本书吧' : ''}</p>
        </div>`;
      return;
    }

    grid.innerHTML = books.map(b => this.bookCard(b)).join('');
  },

  bookCard(b) {
    const formatLabel = { epub: 'EPUB', pdf: 'PDF', txt: 'TXT', html: 'HTML', mobi: 'MOBI' }[b.format] || b.format.toUpperCase();
    const progress = Math.round((b.progress || 0) * 100);
    return `
      <div class="book-card" data-id="${b.id}">
        <div class="book-cover ${b.format}">${escapeHtml(getFirstChars(b.name, 2))}</div>
        <span class="book-format-tag">${formatLabel}</span>
        <button class="book-delete" data-delete="${b.id}" title="删除">✕</button>
        <div class="book-meta">
          <div class="book-title">${escapeHtml(b.name)}</div>
          <div class="book-author">${formatFileSize(b.size)}</div>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${progress}%"></div></div>
        </div>
      </div>`;
  },

  async delete(id) {
    if (!confirm('确定要删除这本书吗？相关书签和笔记也会删除。')) return;
    await Storage.delete(Storage.STORE_BOOKS, id);
    await Storage.delete(Storage.STORE_PROGRESS, id);
    const bookmarks = await Storage.getAll(Storage.STORE_BOOKMARKS, 'bookId', id);
    for (const bm of bookmarks) await Storage.delete(Storage.STORE_BOOKMARKS, bm.id);
    const notes = await Storage.getAll(Storage.STORE_NOTES, 'bookId', id);
    for (const n of notes) await Storage.delete(Storage.STORE_NOTES, n.id);
    App.state.books = App.state.books.filter(b => b.id !== id);
    this.render();
    showToast('已删除');
  },

  async open(id) {
    const book = App.state.books.find(b => b.id === id);
    if (!book) return;
    book.lastRead = Date.now();
    await Storage.put(Storage.STORE_BOOKS, book);
    App.state.currentBook = book;
    App.state.readerFormat = book.format;
    location.href = `reader.html?id=${id}`;
  },
};

// ============ 阅读器 ============
const Reader = {
  async init() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) { location.href = 'index.html'; return; }

    await Bookshelf.load();
    const book = App.state.books.find(b => b.id === id);
    if (!book) { location.href = 'index.html'; return; }
    App.state.currentBook = book;
    App.state.readerFormat = book.format;

    $('#reader-title').textContent = book.name;
    document.title = `${book.name} - 爱阅读`;

    await this.loadProgress();
    this.bindEvents();
    Settings.apply();

    switch (book.format) {
      case 'epub': await this.openEpub(book); break;
      case 'pdf': await this.openPdf(book); break;
      case 'txt':
      case 'html': await this.openText(book); break;
      default:
        $('#book-content').innerHTML = `<p>不支持的格式: ${book.format}</p>`;
    }

    await this.loadTOC();
  },

  async loadProgress() {
    const prog = await Storage.get(Storage.STORE_PROGRESS, App.state.currentBook.id);
    if (prog) {
      App.state.currentChapter = prog.chapter || 0;
      App.state.pdfPage = prog.pdfPage || 1;
    }
  },

  async saveProgress() {
    const book = App.state.currentBook;
    const scrollTop = $('.reader-container')?.scrollTop || 0;
    const scrollHeight = $('.reader-container')?.scrollHeight || 1;
    const progress = scrollTop / (scrollHeight - window.innerHeight);
    const finalProgress = Math.max(0, Math.min(1, progress));
    book.progress = finalProgress;
    await Storage.put(Storage.STORE_BOOKS, book);
    await Storage.put(Storage.STORE_PROGRESS, {
      bookId: book.id,
      chapter: App.state.currentChapter,
      pdfPage: App.state.pdfPage,
      scrollTop,
    });
  },

  bindEvents() {
    $('.reader-container')?.addEventListener('scroll', () => {
      const sc = $('.reader-container');
      if (!sc) return;
      const total = sc.scrollHeight - sc.clientHeight;
      const pct = total > 0 ? (sc.scrollTop / total * 100) : 0;
      $('#reader-progress-fill').style.width = pct + '%';
    });

    setInterval(() => this.saveProgress(), 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.saveProgress();
    });
    window.addEventListener('beforeunload', () => this.saveProgress());

    // 返回书架
    $('#back-btn').onclick = () => {
      this.saveProgress().then(() => location.href = 'index.html');
    };

    // 打开目录
    $('#toc-btn').onclick = () => Panel.open('toc');
    $('#bookmarks-btn').onclick = () => Panel.open('bookmarks');
    $('#notes-btn').onclick = () => Panel.open('notes');
    $('#search-btn').onclick = () => Panel.open('search');
    $('#settings-btn').onclick = () => Panel.open('settings');
    $('#add-bookmark-btn').onclick = () => Bookmarks.addHere();
  },

  /* ---------- TXT / HTML ---------- */
  async openText(book) {
    const content = new TextDecoder('utf-8').decode(book.data);
    let html;
    if (book.format === 'html') {
      html = content.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<body[^>]*>/i, '<div>').replace(/<\/body>/i, '</div>');
    } else {
      const escaped = escapeHtml(content);
      html = escaped.split(/\n+/).map(line => {
        if (!line.trim()) return '<p><br></p>';
        if (/^#{1,6}\s+/.test(line)) {
          const level = (line.match(/^#+/) || [''])[0].length;
          return `<h${Math.min(level, 3)}>${escapeHtml(line.replace(/^#+\s+/, ''))}</h${Math.min(level, 3)}>`;
        }
        return `<p>${line.replace(/ {2,}/g, '&nbsp;&nbsp;')}</p>`;
      }).join('');
    }
    $('#book-content').innerHTML = html;

    // 恢复阅读位置
    const prog = await Storage.get(Storage.STORE_PROGRESS, book.id);
    if (prog && prog.scrollTop) {
      setTimeout(() => {
        $('.reader-container').scrollTop = prog.scrollTop;
      }, 100);
    }
  },

  /* ---------- EPUB ---------- */
  async openEpub(book) {
    const container = $('.reader-container');
    container.innerHTML = `<iframe id="epub-frame"></iframe>`;
    this._renderEpub(book);
  },

  _renderEpub(book) {
    const dataUrl = 'application/epub+zip';
    const blob = new Blob([book.data], { type: dataUrl });
    const url = URL.createObjectURL(blob);

    // epub.js 在 iframe 里运行
    const frame = $('#epub-frame');
    const epubHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.97/epub.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.97/epub.min.js"><\/script>
      <style>
        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: var(--reader-bg, #fff); }
        #viewer { height: 100vh; }
        iframe { border: none; width: 100%; height: 100%; }
      </style></head><body>
      <div id="viewer"></div>
      <script>
        const book = ePub("${url}");
        const rendition = book.renderTo("viewer", {
          width: "100%", height: "100%", spread: "auto", flow: "auto"
        });
        rendition.display();
        // 通信：把目录传出去
        book.loaded.navigation.then(nav => {
          window.parent.postMessage({ type: "epub-toc", toc: nav.toc }, "*");
        });
        window.addEventListener("message", (e) => {
          if (e.data.type === "epub-jump") rendition.display(e.data.href);
          if (e.data.type === "epub-theme") {
            const themes = rendition.themes || rendition.book?.themes;
          }
        });
        window._epubBook = book;
        window._epubRendition = rendition;
      <\/script></body></html>`;
    frame.srcdoc = epubHtml;

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'epub-toc') {
        App.state._epubToc = e.data.toc;
        renderTOCEpub(e.data.toc);
      }
    });
  },

  /* ---------- PDF ---------- */
  async openPdf(book) {
    const container = $('.reader-container');
    container.innerHTML = `
      <div id="pdf-container"></div>
      <div class="pdf-nav">
        <button id="pdf-prev">‹</button>
        <span class="page-info"><span id="pdf-cur">1</span> / <span id="pdf-total">1</span></span>
        <button id="pdf-next">›</button>
      </div>`;

    // 注入 PDF.js CDN
    await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const typedArray = new Uint8Array(book.data);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;
    App.state.pdfTotalPages = pdf.numPages;
    $('#pdf-total').textContent = pdf.numPages;

    const container2 = $('#pdf-container');
    const canvases = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.dataset.pageNum = i;
      container2.appendChild(canvas);
      canvases.push(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }

    // 页码导航
    const updateCurPage = () => {
      const sc = $('.reader-container');
      const rect = canvases[0].getBoundingClientRect();
      const scrollTop = sc.scrollTop + 100;
      let cur = 1;
      for (const c of canvases) {
        if (c.offsetTop <= scrollTop) cur = parseInt(c.dataset.pageNum);
        else break;
      }
      App.state.pdfPage = cur;
      $('#pdf-cur').textContent = cur;
      this.saveProgress();
    };

    $('.reader-container').addEventListener('scroll', updateCurPage);

    $('#pdf-prev').onclick = () => this._gotoPdfPage(Math.max(1, App.state.pdfPage - 1));
    $('#pdf-next').onclick = () => this._gotoPdfPage(Math.min(App.state.pdfTotalPages, App.state.pdfPage + 1));

    // 恢复位置
    const prog = await Storage.get(Storage.STORE_PROGRESS, book.id);
    const targetPage = prog?.pdfPage || 1;
    this._gotoPdfPage(targetPage);
  },

  async _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  _gotoPdfPage(n) {
    if (!App.state.readerFormat === 'pdf') return;
    const sc = $('.reader-container');
    const canvas = $(`canvas[data-page-num="${n}"]`, sc);
    if (canvas) sc.scrollTo({ top: canvas.offsetTop - 20, behavior: 'smooth' });
  },

  /* ---------- 目录 ---------- */
  async loadTOC() {
    const book = App.state.currentBook;
    App.state.toc = [];

    if (book.format === 'epub' && App.state._epubToc) {
      // EPUB 目录由 iframe postMessage 传入
      return;
    }
    if (book.format === 'pdf') {
      for (let i = 1; i <= App.state.pdfTotalPages; i++) {
        App.state.toc.push({ id: `page-${i}`, title: `第 ${i} 页`, level: 1 });
      }
      return;
    }
    if (book.format === 'txt' || book.format === 'html') {
      // 从标题标签提取
      const content = $('#book-content');
      if (!content) return;
      const headings = $$('h1, h2, h3', content);
      if (headings.length === 0) {
        // 没有标题，尝试按段落生成简易目录
        const paragraphs = $$('p', content).filter(p => p.textContent.trim().length > 0);
        App.state.toc = paragraphs.slice(0, Math.min(20, paragraphs.length)).map((p, i) => ({
          id: `para-${i}`, title: (p.textContent.slice(0, 30) || '段落 ' + (i + 1)), level: 1,
        }));
      } else {
        App.state.toc = headings.map((h, i) => ({
          id: `heading-${i}`, title: h.textContent.trim(), level: parseInt(h.tagName[1]), el: h,
        }));
      }
    }
  },

  gotoTOC(id) {
    const book = App.state.currentBook;
    if (book.format === 'epub') {
      const toc = App.state._epubToc || [];
      const item = this._findTocItem(toc, id);
      if (item) {
        const frame = $('#epub-frame');
        frame.contentWindow.postMessage({ type: 'epub-jump', href: item.href }, '*');
      }
    } else if (book.format === 'pdf') {
      const page = parseInt(id.replace('page-', ''));
      this._gotoPdfPage(page);
    } else {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    Panel.close();
  },

  _findTocItem(toc, id) {
    for (const item of toc) {
      if (item.id === id || item.href === id) return item;
      if (item.subitems?.length) {
        const found = this._findTocItem(item.subitems, id);
        if (found) return found;
      }
    }
    return null;
  },

  /* ---------- 全文搜索 ---------- */
  async search(query) {
    App.state.searchQuery = query;
    App.state.searchResults = [];
    if (!query || query.length < 1) return [];

    const content = $('#book-content');
    if (content) {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.parentNode?.nodeName === 'MARK') return NodeFilter.FILTER_REJECT;
          return node.textContent.includes(query) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      let node; let count = 0;
      while ((node = walker.nextNode()) && count < 50) {
        count++;
        const text = node.textContent;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        const snippet = text.slice(Math.max(0, idx - 30), idx + query.length + 30);
        App.state.searchResults.push({
          id: 'search-' + count,
          snippet,
          match: query,
          node,
          parent: node.parentElement,
        });
      }
    }
    return App.state.searchResults;
  },
};

// ============ 目录渲染（EPUB）============
function renderTOCEpub(toc) {
  App.state._epubToc = toc;
  function flatten(items, depth = 1) {
    let result = [];
    for (const it of items) {
      result.push({ id: it.id || it.href, href: it.href, title: it.label || '未命名', level: depth });
      if (it.subitems?.length) result = result.concat(flatten(it.subitems, depth + 1));
    }
    return result;
  }
  App.state.toc = flatten(toc);
  const list = $('.toc-list');
  if (!list) return;
  list.innerHTML = App.state.toc.map(t =>
    `<li data-id="${t.id}" style="padding-left:${12 + (t.level - 1) * 12}px">
       <span class="toc-title">${escapeHtml(t.title)}</span>
       <span class="toc-level">${'　'.repeat(t.level - 1)}</span>
     </li>`
  ).join('');
  list.querySelectorAll('li').forEach(li => {
    li.onclick = () => Reader.gotoTOC(li.dataset.id);
  });
}

// ============ 书签 ============
const Bookmarks = {
  async list() {
    return Storage.getAll(Storage.STORE_BOOKMARKS, 'bookId', App.state.currentBook.id);
  },

  async addHere() {
    const book = App.state.currentBook;
    const sc = $('.reader-container');
    const bm = {
      id: uid(),
      bookId: book.id,
      position: App.state.readerFormat === 'pdf'
        ? `第 ${App.state.pdfPage} 页`
        : `位置 ${Math.round((sc.scrollTop / (sc.scrollHeight - sc.clientHeight)) * 100)}%`,
      scrollTop: sc.scrollTop,
      pdfPage: App.state.pdfPage,
      createdAt: Date.now(),
    };
    await Storage.put(Storage.STORE_BOOKMARKS, bm);
    showToast('已添加书签');
    if (Panel.current === 'bookmarks') this.render();
  },

  async render() {
    const list = $('.bookmark-list');
    if (!list) return;
    const bookmarks = await this.list();
    if (bookmarks.length === 0) {
      list.innerHTML = `<li style="text-align:center;color:var(--text-secondary);cursor:default">还没有书签</li>`;
      return;
    }
    list.innerHTML = bookmarks.map(b =>
      `<li data-id="${b.id}">
         <span>🔖 ${b.position}</span>
         <button class="delete-btn" data-del="${b.id}" title="删除">✕</button>
       </li>`
    ).join('');
    list.querySelectorAll('li[data-id]').forEach(li => {
      li.onclick = (e) => {
        if (e.target.dataset.del) return;
        this.goto(li.dataset.id);
      };
    });
    list.querySelectorAll('button[data-del]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        await this.remove(btn.dataset.del);
        this.render();
      };
    });
  },

  async goto(id) {
    const bm = (await this.list()).find(b => b.id === id);
    if (!bm) return;
    const sc = $('.reader-container');
    if (App.state.readerFormat === 'pdf') {
      Reader._gotoPdfPage(bm.pdfPage);
    } else if (sc && bm.scrollTop) {
      sc.scrollTo({ top: bm.scrollTop, behavior: 'smooth' });
    }
    Panel.close();
  },

  async remove(id) {
    await Storage.delete(Storage.STORE_BOOKMARKS, id);
    showToast('已删除书签');
  },
};

// ============ 笔记 ============
const Notes = {
  async list() {
    return Storage.getAll(Storage.STORE_NOTES, 'bookId', App.state.currentBook.id);
  },

  async add(quote, content) {
    const note = {
      id: uid(),
      bookId: App.state.currentBook.id,
      quote, content,
      createdAt: Date.now(),
    };
    await Storage.put(Storage.STORE_NOTES, note);
    showToast('笔记已保存');
    if (Panel.current === 'notes') this.render();
  },

  async render() {
    const container = $('.note-list');
    if (!container) return;
    const notes = await this.list();
    if (notes.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:30px">
        <p style="font-size:32px;margin-bottom:8px">📝</p>
        <p>选中文字后可以添加笔记</p>
      </div>`;
      return;
    }
    container.innerHTML = notes.map(n => {
      const d = new Date(n.createdAt);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return `<div class="note-item" data-id="${n.id}">
        <div class="note-quote">${escapeHtml(n.quote || '')}</div>
        ${n.content ? `<div class="note-content">${escapeHtml(n.content)}</div>` : ''}
        <div class="note-meta">${dateStr}</div>
        <div class="note-actions">
          <button data-export="${n.id}">导出</button>
          <button data-del="${n.id}">删除</button>
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('[data-export]').forEach(btn => {
      btn.onclick = () => this.exportSingle(btn.dataset.export);
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        if (confirm('确定删除这条笔记？')) {
          await Storage.delete(Storage.STORE_NOTES, btn.dataset.del);
          this.render();
        }
      };
    });
  },

  async exportSingle(id) {
    const n = (await this.list()).find(x => x.id === id);
    if (!n) return;
    const text = `《${App.state.currentBook.name}》读书笔记\n\n> ${n.quote || ''}\n\n${n.content || ''}\n\n${new Date(n.createdAt).toLocaleString()}`;
    downloadBlob(new Blob([text], { type: 'text/plain' }), `笔记-${Date.now()}.txt`);
  },

  async exportAll() {
    const notes = await this.list();
    if (notes.length === 0) { showToast('没有笔记可导出'); return; }
    const md = [`# 《${App.state.currentBook.name}》读书笔记`, ''];
    notes.sort((a, b) => b.createdAt - a.createdAt).forEach(n => {
      md.push(`## ${new Date(n.createdAt).toLocaleString()}`);
      if (n.quote) md.push(`> ${n.quote}`);
      if (n.content) md.push(n.content);
      md.push('');
    });
    downloadBlob(new Blob([md.join('\n')], { type: 'text/markdown' }), `${App.state.currentBook.name}-笔记.md`);
  },

  async exportAllAsImage() {
    const notes = await this.list();
    if (notes.length === 0) { showToast('没有笔记可导出'); return; }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const lineHeight = 22;
    const padding = 40;
    const content = [`《${App.state.currentBook.name}》读书笔记`, '', ...notes.map(n => `【${new Date(n.createdAt).toLocaleString()}】\n原文: ${n.quote || ''}\n笔记: ${n.content || ''}`).join('\n\n').split('\n')];
    canvas.width = 800;
    canvas.height = Math.max(600, content.length * lineHeight + padding * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '16px -apple-system, PingFang SC, sans-serif';
    ctx.textBaseline = 'top';
    content.forEach((line, i) => {
      ctx.fillText(line, padding, padding + i * lineHeight);
    });
    canvas.toBlob(blob => downloadBlob(blob, `${App.state.currentBook.name}-笔记.png`));
  },
};

// ============ 侧边面板 ============
const Panel = {
  current: null,

  open(name) {
    this.current = name;
    const panel = $('.side-panel');
    $('.panel-overlay').classList.add('open');
    panel.classList.add('open');

    const contents = {
      toc: () => {
        $('.panel-title').textContent = '目录';
        return `<ul class="toc-list" id="toc-list"></ul>`;
      },
      bookmarks: () => {
        $('.panel-title').textContent = '书签';
        Bookmarks.render();
        return `<div style="padding:12px"><button class="btn" id="bm-add-here" style="width:100%">📌 在当前位置添加书签</button></div>
                <ul class="bookmark-list"></ul>`;
      },
      notes: () => {
        $('.panel-title').textContent = '笔记';
        Notes.render();
        return `<div style="padding:12px;display:flex;gap:8px">
                  <button class="btn" id="export-md" style="flex:1">导出Markdown</button>
                  <button class="btn" id="export-img" style="flex:1">导出图片</button>
                </div>
                <div class="note-list"></div>`;
      },
      search: () => {
        $('.panel-title').textContent = '全文搜索';
        return `<div style="padding:12px">
                  <input type="text" id="search-input-panel" placeholder="输入关键词..." style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
                  <button class="btn primary" id="search-btn-panel" style="margin-top:10px;width:100%">搜索</button>
                </div>
                <div class="search-results" id="search-results"></div>`;
      },
      settings: () => {
        $('.panel-title').textContent = '阅读设置';
        return `
          <div class="panel-section">
            <h4>主题</h4>
            <div class="theme-options">
              <button class="theme-btn" data-theme="light" title="亮色"></button>
              <button class="theme-btn" data-theme="dark" title="深色"></button>
              <button class="theme-btn" data-theme="eye-care" title="护眼绿"></button>
              <button class="theme-btn" data-theme="night" title="夜间"></button>
            </div>
          </div>
          <div class="panel-section">
            <h4>字体大小</h4>
            <div class="slider-row">
              <input type="range" id="font-size" min="14" max="32" value="${App.settings.fontSize}">
              <span class="value" id="font-size-val">${App.settings.fontSize}px</span>
            </div>
          </div>
          <div class="panel-section">
            <h4>行间距</h4>
            <div class="slider-row">
              <input type="range" id="line-height" min="12" max="28" value="${Math.round(App.settings.lineHeight * 10)}">
              <span class="value" id="line-height-val">${(App.settings.lineHeight).toFixed(1)}</span>
            </div>
          </div>
          <div class="panel-section">
            <h4>页边距</h4>
            <div class="slider-row">
              <input type="range" id="page-margins" min="8" max="60" value="${App.settings.pageMargins}">
              <span class="value" id="page-margins-val">${App.settings.pageMargins}px</span>
            </div>
          </div>
          <div class="panel-section">
            <h4>首行缩进</h4>
            <div class="btn-group">
              <button class="btn" data-indent="0">无</button>
              <button class="btn" data-indent="2" style="background:var(--primary);color:#fff">两字符</button>
              <button class="btn" data-indent="4">四字符</button>
            </div>
          </div>`;
      },
    };

    panel.innerHTML = contents[name]();
    this._bindPanelEvents(name);
  },

  close() {
    $('.side-panel').classList.remove('open');
    $('.panel-overlay').classList.remove('open');
    this.current = null;
  },

  _bindPanelEvents(name) {
    if (name === 'toc') {
      // 用 Reader.loadTOC 填充
      App.state.toc = [];
      Reader.loadTOC().then(() => {
        const list = $('#toc-list');
        if (!list) return;
        if (App.state.toc.length === 0) {
          list.innerHTML = `<li style="text-align:center;color:var(--text-secondary);padding:30px">没有目录信息</li>`;
          return;
        }
        list.innerHTML = App.state.toc.map(t =>
          `<li data-id="${t.id}" style="padding-left:${8 + (t.level || 1) * 12}px">
             <span class="toc-title">${escapeHtml(t.title)}</span>
           </li>`
        ).join('');
        list.querySelectorAll('li').forEach(li => {
          li.onclick = () => Reader.gotoTOC(li.dataset.id);
        });
      });
    } else if (name === 'bookmarks') {
      $('#bm-add-here')?.addEventListener('click', () => Bookmarks.addHere());
    } else if (name === 'notes') {
      $('#export-md')?.addEventListener('click', () => Notes.exportAll());
      $('#export-img')?.addEventListener('click', () => Notes.exportAllAsImage());
    } else if (name === 'search') {
      const input = $('#search-input-panel');
      const doSearch = () => {
        const q = input.value.trim();
        Reader.search(q).then(results => {
          const el = $('#search-results');
          if (!el) return;
          if (!results.length) {
            el.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:20px">没有找到 "${q}"</p>`;
            return;
          }
          el.innerHTML = results.map(r =>
            `<div class="search-result-item" data-idx="${results.indexOf(r)}">
               ${escapeHtml(r.snippet.replace(new RegExp(q, 'gi'), m => `<mark>${m}</mark>`))}
             </div>`
          ).join('');
          el.querySelectorAll('.search-result-item').forEach(item => {
            item.onclick = () => {
              const idx = parseInt(item.dataset.idx);
              const r = results[idx];
              r.parent?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              Panel.close();
            };
          });
        });
      };
      $('#search-btn-panel')?.addEventListener('click', doSearch);
      input?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    } else if (name === 'settings') {
      $('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('theme', btn.dataset.theme));
      });
      const fs = $('#font-size');
      fs.addEventListener('input', () => {
        $('#font-size-val').textContent = fs.value + 'px';
        Settings.set('fontSize', parseInt(fs.value));
      });
      const lh = $('#line-height');
      lh.addEventListener('input', () => {
        $('#line-height-val').textContent = (parseInt(lh.value) / 10).toFixed(1);
        Settings.set('lineHeight', parseInt(lh.value) / 10);
      });
      const pm = $('#page-margins');
      pm.addEventListener('input', () => {
        $('#page-margins-val').textContent = pm.value + 'px';
        Settings.set('pageMargins', parseInt(pm.value));
      });
      $('.btn[data-indent]').forEach(btn => {
        btn.addEventListener('click', () => {
          $('.btn[data-indent]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          Settings.set('textIndent', parseInt(btn.dataset.indent));
        });
      });
    }

    $('.panel-overlay').addEventListener('click', () => Panel.close(), { once: true });
  },
};

// ============ 笔记模态框（选中文本后）============
function showNoteModal(quote) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <h3>添加笔记</h3>
      <p style="margin-bottom:12px;color:var(--text-secondary);font-size:13px;border-left:3px solid var(--primary);padding-left:10px">${escapeHtml(quote)}</p>
      <textarea id="note-content" rows="4" placeholder="写下你的想法..."></textarea>
      <div class="modal-actions">
        <button class="btn" id="note-cancel">取消</button>
        <button class="btn primary" id="note-save">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  $('#note-cancel').onclick = () => overlay.remove();
  $('#note-save').onclick = () => {
    const content = $('#note-content').value.trim();
    Notes.add(quote, content);
    overlay.remove();
  };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// ============ 书架页初始化 ============
async function initBookshelf() {
  await Storage.init();
  await Settings.load();
  await Bookshelf.load();

  const fileInput = $('#file-input');
  $('#import-btn').onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    Bookshelf.importFiles(e.target.files);
    e.target.value = '';
  };

  $('#search-input').addEventListener('input', () => Bookshelf.render());
  $('#sort-select').addEventListener('change', () => Bookshelf.render());

  $('.books-grid').addEventListener('click', (e) => {
    const delId = e.target.dataset.delete;
    if (delId) { e.stopPropagation(); Bookshelf.delete(delId); return; }
    const card = e.target.closest('.book-card');
    if (card) Bookshelf.open(card.dataset.id);
  });

  // 拖拽导入
  ['dragenter', 'dragover'].forEach(ev => {
    document.addEventListener(ev, (e) => { e.preventDefault(); document.body.style.opacity = '0.7'; });
  });
  ['dragleave', 'drop'].forEach(ev => {
    document.addEventListener(ev, (e) => { e.preventDefault(); document.body.style.opacity = '1'; });
  });
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) Bookshelf.importFiles(e.dataTransfer.files);
  });
}

// ============ 阅读器页初始化 ============
async function initReader() {
  await Storage.init();
  await Settings.load();
  await Reader.init();

  // 选中文字添加笔记
  document.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (text.length >= 5 && text.length <= 500 && $('#book-content')?.contains(sel.anchorNode)) {
      showNoteModal(text.slice(0, 200));
      sel.removeAllRanges();
    }
  });

  // EPUB iframe 内监听笔记（简化）
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      Reader.saveProgress();
      showToast('进度已保存');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      Bookmarks.addHere();
    }
  });
}

// ============ 入口 ============
document.addEventListener('DOMContentLoaded', () => {
  const path = location.pathname.split('/').pop() || 'index.html';
  if (path === 'reader.html') initReader();
  else initBookshelf();
});

// ============ PWA Service Worker ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ============ 开发/测试用 Bootstrap ============
// 在浏览器 Console 执行: window.bootstrapTestBooks()
// 会自动从服务器 fetch /books/ 下的测试书籍并注入书架
window.bootstrapTestBooks = async function() {
  const testFiles = [
    '/books/平凡的世界.txt',
    '/books/活着.html',
    '/books/论语.txt',
  ];
  if (!App.db) await Storage.init();
  let count = 0;
  for (const path of testFiles) {
    try {
      const resp = await fetch(path);
      if (!resp.ok) { console.warn('跳过:', path); continue; }
      const blob = await resp.blob();
      const buf = await blob.arrayBuffer();
      const fileName = path.split('/').pop();
      const format = detectFormat(fileName);
      const book = {
        id: uid(),
        name: fileName.replace(/\.[^.]+$/, ''),
        fullName: fileName,
        format,
        size: buf.byteLength,
        data: buf,
        importedAt: Date.now(),
        lastRead: null,
        progress: 0,
      };
      await Storage.put(Storage.STORE_BOOKS, book);
      App.state.books.push(book);
      count++;
      console.log('✅ 已加载:', fileName, `(${format}, ${book.size} bytes)`);
    } catch (e) {
      console.error('加载失败:', path, e);
    }
  }
  Bookshelf.render();
  showToast(`已注入 ${count} 本测试书籍`);
  return count;
};

window.clearAllBooks = async function() {
  if (!App.db) await Storage.init();
  for (const b of App.state.books) {
    await Storage.delete(Storage.STORE_BOOKS, b.id);
  }
  await Storage.clear(Storage.STORE_PROGRESS);
  App.state.books = [];
  Bookshelf.render();
  showToast('已清空书架');
};
