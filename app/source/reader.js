'use strict';
/* ── The reader — desktop app only ─────────────────────────────────────────
   An article from World, Discovery or the AI incident feed, read inside the
   app as text: the title, where it came from, when it happened in Matrix
   time, and the body — no navigation, no advertising, no scripts, no images,
   no trackers.

   The main process fetches the page (article.js). Here the page is parsed as
   inert markup — a parsed document runs no script and loads nothing — and
   Mozilla's Readability, the engine of Firefox's reader view, finds the body.
   Its result is not inserted as markup: the paragraphs, headings, quotes and
   list items are rebuilt one by one as plain text, so nothing from the page
   can execute or reach out.

   A body under 120 words is shown for what it is — usually a paywall or a
   page that builds its text with scripts — with the way out to the browser.
   On the website there is no reader and links open as before.            */

const Reader = (() => {
  const $ = id => document.getElementById(id);
  const available = () => !!(window.desktop && window.desktop.article);
  const cache = new Map();                  // url → extracted article, for this session
  const SHORT = 120;
  let current = null;                      // the article last opened, for the browser button
  let seq = 0;                              // each opening's ticket; a stale fetch finds it changed

  let engine = null;
  function loadEngine() {
    if (typeof Readability === 'function') return Promise.resolve();
    if (!engine) engine = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'readability.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('the reader engine is missing from this build'));
      document.head.appendChild(s);
    });
    return engine;
  }

  /* When it happened, in Matrix time. Items filed by day carry the date only. */
  function matrixWhen(item) {
    if (!item.time) return '';
    const t = Matrix.cal360(new Date(item.time));
    const pad = n => String(n).padStart(2, '0');
    const date = `${Matrix.CAL360.days[t.weekday].name} ${t.day} ${Matrix.CAL360.months[t.month]}`;
    return item.dayOnly ? date : `${date} · ${pad(t.h)}:${pad(t.m)}`;
  }

  /* Readability's result, reduced to text blocks in reading order. A block is
     the innermost paragraph-like element; a quote keeps the fact that it was
     one, a list item that it was one, and nothing else survives. */
  const BLOCK = 'p,h1,h2,h3,h4,h5,h6,blockquote,li,pre,figcaption';
  function blocksOf(html) {
    const root = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const out = [];
    for (const el of root.querySelectorAll(BLOCK)) {
      if (el.querySelector(BLOCK)) continue;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const tag = el.tagName;
      out.push({
        kind: /^H[1-6]$/.test(tag) ? 'h' : tag === 'LI' ? 'li' : tag === 'FIGCAPTION' ? 'cap' : 'p',
        quote: !!el.closest('blockquote'), text
      });
    }
    // Site furniture that survives Readability: a short "Recommended",
    // "Related", "Read more" or "Most read" heading and the list of links
    // under it. The heading and its list go; nothing else is judged.
    const FURNITURE = /^(recommended|related|read more|read also|also read|more from|more on this|you may also like|most (read|popular|viewed)|trending)\b/i;
    for (let i = 0; i < out.length; i++) {
      if (out[i].text.length < 45 && out[i].kind !== 'li' && FURNITURE.test(out[i].text)) {
        let j = i + 1;
        while (j < out.length && out[j].kind === 'li') j++;
        if (j > i + 1 || out[i].kind === 'h') { out.splice(i, j - i); i--; }
      }
    }
    // Some pages keep their text in bare divs with line breaks; fall back to
    // the running text split at blank lines.
    if (!out.length) {
      for (const para of root.textContent.split(/\n\s*\n/)) {
        const text = para.replace(/\s+/g, ' ').trim();
        if (text) out.push({ kind: 'p', quote: false, text });
      }
    }
    return out;
  }

  function extract(html, url) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Relative references resolve against the article, not against the app.
    const base = doc.createElement('base'); base.href = url; doc.head.prepend(base);
    const art = new Readability(doc, { charThreshold: 300 }).parse();
    if (!art) return null;
    const blocks = blocksOf(art.content || '');
    const words = blocks.reduce((n, b) => n + b.text.split(' ').length, 0);
    return { title: (art.title || '').trim(), byline: (art.byline || '').trim(),
             site: (art.siteName || '').trim(), blocks, words };
  }

  function render(article) {
    const body = $('reader-body');
    body.textContent = '';
    let list = null;
    for (const b of article.blocks) {
      if (b.kind !== 'li') list = null;
      let el;
      if (b.kind === 'h') el = document.createElement('h3');
      else if (b.kind === 'li') {
        if (!list) { list = document.createElement('ul'); body.appendChild(list); }
        el = document.createElement('li'); el.textContent = b.text; list.appendChild(el); continue;
      } else el = document.createElement('p');
      if (b.quote) el.className = 'quote';
      if (b.kind === 'cap') el.className = 'caption';
      el.textContent = b.text;
      body.appendChild(el);
    }
  }

  function note(text, tone) {
    const p = document.createElement('p');
    p.className = 'reader-note' + (tone ? ' ' + tone : '');
    p.textContent = text;
    return p;
  }

  async function open(item) {
    if (!item || !item.link) return;
    if (!available()) { window.open(item.link, '_blank', 'noopener'); return; }
    current = item;
    const ticket = ++seq;
    const dlg = $('reader');
    $('reader-meta').textContent = [item.place || item.source, matrixWhen(item)].filter(Boolean).join(' · ').toUpperCase();
    $('reader-title').textContent = item.headline || item.title || '';
    $('reader-byline').textContent = '';
    $('reader-count').textContent = '';
    const body = $('reader-body');
    body.textContent = '';
    body.appendChild(note('Reading the article…'));
    if (!dlg.open) dlg.showModal();
    body.scrollTop = 0;

    let article = cache.get(item.link);
    if (!article) {
      try {
        await loadEngine();
        const page = await window.desktop.article(item.link);
        if (ticket !== seq) return;                         // closed, or another article opened meanwhile
        if (!page || page.error) throw new Error(page ? page.error : 'no answer');
        article = extract(page.html, page.url || item.link);
        if (!article || !article.blocks.length) throw new Error('no article text could be found on the page');
        cache.set(item.link, article);
      } catch (error) {
        if (ticket !== seq) return;
        body.textContent = '';
        body.appendChild(note(`This article could not be read here: ${error.message}.`, 'warn'));
        body.appendChild(note('Some sites refuse to be read outside a browser, and some keep their text behind a paywall. The original opens in your browser below.'));
        return;
      }
    }
    if (ticket !== seq) return;
    if (article.title && article.title !== $('reader-title').textContent) $('reader-title').textContent = article.title;
    $('reader-byline').textContent = [article.byline, article.site].filter(Boolean).join(' · ');
    render(article);
    if (article.words < SHORT)
      body.prepend(note(`Only ${article.words} words could be read — most likely a paywall, or a page that builds its text with scripts. The full piece opens in your browser below.`, 'warn'));
    $('reader-count').textContent = `${article.words.toLocaleString('en-US')} words`;
    body.scrollTop = 0;
  }

  function init() {
    const dlg = $('reader');
    if (!dlg) return;
    $('reader-close').addEventListener('click', () => dlg.close());
    $('reader-open').addEventListener('click', () => { if (current && current.link) window.open(current.link, '_blank', 'noopener'); });
    // A click on the dimmed backdrop closes it, as the settings dialog does.
    dlg.addEventListener('click', e => {
      if (e.target !== dlg) return;
      const b = dlg.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dlg.close();
    });
    /* Closing abandons a fetch still in flight. The close event arrives a task
       late, so a close followed at once by another opening must not cancel
       the new one: by then the dialog is open again, and that is the test. */
    dlg.addEventListener('close', () => { if (!dlg.open) seq++; });
  }

  return { open, init, available, isOpen: () => !!($('reader') && $('reader').open) };
})();
