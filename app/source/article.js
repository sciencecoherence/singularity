'use strict';
/* ── The reader's fetch — desktop app only ─────────────────────────────────
   The reader shows an article as text inside the app, the way a browser's
   reader view does. The page is fetched here, in the main process, because the
   page itself may not reach other sites; the extraction happens in the page,
   on inert markup, and only the text is shown.

   This is not the feed allowlist. Articles come from hundreds of outlets, so
   any public web address is accepted — but nothing else: no local or private
   network addresses, no addresses carrying credentials, no cookies sent, no
   more than 5 MB read, and only pages that say they are HTML. The website has
   no equivalent: there the fetch would have to pass through the host, which
   would make the host an open relay and a republisher of other people's work. */

const { net } = require('electron');

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20000;
// Literal private, loopback and link-local hosts. A public name that resolves
// to a private address is not caught here; the renderer asking is already the
// app's own trusted page.
const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

/* Pages are not all UTF-8. The charset comes from the header, or failing that
   from the page's own meta tag, and is decoded with the platform's full ICU. */
function decode(bytes, type) {
  let charset = (/charset=["']?([\w-]+)/i.exec(type) || [])[1];
  if (!charset) {
    const head = bytes.subarray(0, 4096).toString('latin1');
    charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

function checkPublicUrl(raw, base) {
  let url;
  try { url = base ? new URL(String(raw), base) : new URL(String(raw)); } catch { return { error: 'not a web address' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'not a web page' };
  if (url.username || url.password) return { error: 'address carries credentials' };
  if (PRIVATE.test(url.hostname) || /\.(local|internal|lan)$/i.test(url.hostname)) return { error: 'not a public address' };
  return { url };
}

async function fetchArticle(raw) {
  const first = checkPublicUrl(raw);
  if (first.error) return first;
  let url = first.url;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    let res;
    for (let hops = 0; hops <= 5; hops++) {
      res = await net.fetch(url.href, {
        signal: abort.signal, redirect: 'manual', credentials: 'omit',
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return { error: 'redirect without a location' };
        if (hops === 5) return { error: 'too many redirects' };
        const next = checkPublicUrl(loc, url);
        if (next.error) return next;
        url = next.url;
        continue;
      }
      break;
    }
    if (!res.ok) return { error: `the site refused (HTTP ${res.status})`, status: res.status };
    const type = res.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) return { error: `not a web page (${type.split(';')[0]})` };

    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { abort.abort(); return { error: 'page too large' }; }
      chunks.push(Buffer.from(value));
    }
    return { html: decode(Buffer.concat(chunks), type), url: res.url || url.href };
  } catch (error) {
    return { error: error.name === 'AbortError' ? 'the site did not answer in time' : String(error.message || error).slice(0, 90) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchArticle };
