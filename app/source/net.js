'use strict';
/* ── The transport ─────────────────────────────────────────────────────────
   Three ways to reach a source, chosen in this order:

   1. Inside the desktop app, the page never touches the network. It asks the
      Electron main process, which holds the allowlist. No origin rules apply
      and nothing is refused for being cross-origin.
   2. On the web, a source that publishes Access-Control-Allow-Origin is
      fetched directly by the visitor's browser.
   3. On the web, a source that does not — NASA GISTEMP, NSIDC, NOAA CPC,
      arXiv, ESA — goes through proxy.php on the host, which holds the same
      allowlist and can return only the tail of a large file.

   Which sources fall in group 2 and which in group 3 was measured, not
   assumed: every host below was checked with a browser Origin header, and
   against hosts that genuinely lack CORS, to be sure a proxy was not quietly
   adding the header for us.                                                 */

const Net = (() => {

  // Hosts that answer a cross-origin browser fetch on their own.
  const DIRECT = new Set([
    'earthquake.usgs.gov', 'www.gdacs.org', 'eonet.gsfc.nasa.gov',
    'services.swpc.noaa.gov',
    'gml.noaa.gov', 'll.thespacedevs.com', 'en.wikipedia.org', 'www.nasa.gov',
    // Re-checked with a browser Origin: NOAA STAR does answer cross-origin,
    // so sea level never needed the proxy and works in a plain browser.
    'www.star.nesdis.noaa.gov',
    // Peer-reviewed papers (Crossref) and longevity research (Europe PMC):
    // both publish Access-Control-Allow-Origin: *.
    'api.crossref.org', 'www.ebi.ac.uk',
    // Society: the World Bank's indicators API sends Access-Control-Allow-Origin: *.
    'api.worldbank.org'
  ]);

  // Hosts that do not, and must go through the host's proxy on the web.
  const VIA_PROXY = new Set([
    'data.giss.nasa.gov', 'noaadata.apps.nsidc.org', 'www.cpc.ncep.noaa.gov',
    'epoch.ai', 'metr.org', 'export.arxiv.org', 'www.esa.int',
    'incidentdatabase.ai',
    'www.sidc.be',
    // GDELT does publish a cross-origin header on a good response, but not on
    // its rate-limit refusals — and it refuses anything faster than one request
    // every five seconds. Behind the proxy, the cache makes all visitors share
    // one request a quarter hour, which is both politer and more reliable.
    'api.gdeltproject.org',
    // Floods with people affected (ReliefWeb) and the war desks (World).
    'reliefweb.int', 'www.aljazeera.com', 'feeds.bbci.co.uk', 'news.un.org',
    // The orbital catalogue and conjunction screening (Kessler watch).
    'celestrak.org',
    // The longevity newsroom (Lifespan.io) for the LEV stream.
    'lifespan.io',
    // Energy: EIA stocks and SPR history, oil futures, data-centre positions.
    'ir.eia.gov', 'www.eia.gov', 'query1.finance.yahoo.com', 'nominatim.openstreetmap.org',
    // The country energy watch (watch.js).
    'news.google.com',
    // Cyclones now (storms.js): NOAA NHC advisories and JTWC warnings.
    'www.nhc.noaa.gov', 'www.metoc.navy.mil',
    // Society (society.js): UN Statistics Division's SDG database.
    'unstats.un.org',
    // NASA's near-Earth objects: through the proxy, so one DEMO_KEY reading
    // (cached three hours) serves every visitor rather than each spending
    // the key's thirty requests an hour.
    'api.nasa.gov',
    // Economy (economy.js): BIS policy rates, the IMF outlook, daily currency rates.
    'stats.bis.org', 'api.imf.org', 'cdn.jsdelivr.net'
  ]);

  // The proxy: proxy.php on a PHP host, or what the page names in
  // <meta name="sm-proxy"> (the Vercel edition: /api/feed).
  const proxyMeta = typeof document !== 'undefined' && document.querySelector('meta[name="sm-proxy"]');
  const PROXY = (proxyMeta && proxyMeta.content) || 'proxy.php';

  /* Whether proxy.php is actually there. Opened from a file:// path it cannot
     be, and a host serving the folder without PHP hands back the source text
     instead of running it — both look like a dead source otherwise, so they
     are detected and reported as what they are. */
  let proxyState = (location.protocol === 'file:') ? 'absent' : 'unknown';
  const NEEDS_PROXY = 'needs proxy.php — open the app, or serve the folder over http';

  function route(url, tail, head) {
    const host = new URL(url).hostname;
    if (DIRECT.has(host)) return { url, direct: true };
    if (!VIA_PROXY.has(host)) throw new Error('host not allowed: ' + host);
    if (proxyState === 'absent') throw new Error(NEEDS_PROXY);
    return { url: `${PROXY}?url=${encodeURIComponent(url)}${tail ? '&tail=' + tail : ''}${head ? '&head=' + head : ''}`, direct: false };
  }

  /* Hosts read directly that ration requests per address. Launch Library
     allows fifteen an hour; a visitor whose desktop app is running on the
     same connection shares that allowance, and the website then got 429 and
     showed no launches. When such a host refuses a direct read, the proxy
     reads it instead — one cached request serving every visitor. */
  const PROXY_ON_REFUSAL = new Set(['ll.thespacedevs.com']);

  /* One fetch, with the two ways a missing proxy shows itself folded in. */
  async function grab(url, tail, head) {
    const r = route(url, tail, head);
    const fallback = r.direct && proxyState !== 'absent' && PROXY_ON_REFUSAL.has(new URL(url).hostname);
    // A refusal may come without the cross-origin header, which the browser
    // reports as a network error rather than a 429.
    let response = await fetch(r.url, { cache: 'no-store' }).catch(e => { if (fallback) return null; throw e; });
    if (fallback && (!response || response.status === 429)) {
      const via = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`, { cache: 'no-store' }).catch(() => null);
      if (via && via.ok) response = via;
      else if (!response) throw new Error(via ? 'HTTP ' + via.status : 'refused');
    }
    if (!r.direct && response.status === 404) { proxyState = 'absent'; throw new Error(NEEDS_PROXY); }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const body = await response.text();
    if (!r.direct && body.slice(0, 5) === '<?php') { proxyState = 'absent'; throw new Error(NEEDS_PROXY); }
    if (!r.direct) proxyState = 'present';
    return body;
  }

  /* text() returns the body as a string; json() parses it. `tail` asks for
     only the last N bytes of a large file, which matters: the sea-ice record
     is 1.9 MB and the Epoch model list 1.1 MB, and no visitor should pull
     those whole to read the last few rows. The desktop app fetches the file
     and trims client-side, since it has no PHP. */
  const STALE_RUNTIME = 'app runtime is older than this source — run Build Runtime.cmd';
  const PAUSED_ERR = 'streams paused';
  let paused = false;
  function setPaused(v) { paused = !!v; }

  // Google News serves Watch, Society, War and Economy. Spacing requests
  // across all four modules avoids simultaneous bursts that draw HTTP 429.
  const NEWS_GAP_MS = 1200;
  let newsChain = Promise.resolve(), newsLastAt = 0;
  function paceNews(url, fn) {
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (host !== 'news.google.com') return fn();
    const run = async () => {
      const wait = Math.max(0, NEWS_GAP_MS - (Date.now() - newsLastAt));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (paused) throw new Error(PAUSED_ERR);
      newsLastAt = Date.now();
      return fn();
    };
    const next = newsChain.then(run, run);
    newsChain = next.catch(() => {});
    return next;
  }

  function trimTail(raw, tail) {
    const s = String(raw);
    if (!tail || s.length <= tail) return s;
    const cut = s.slice(-tail);
    const nl = cut.indexOf('\n');
    return nl >= 0 && nl < 4096 ? cut.slice(nl + 1) : cut;
  }

  async function text(url, opts = {}) {
    if (paused) throw new Error(PAUSED_ERR);
    // Inside the app but without the text channel means the packaged runtime
    // predates this source. Say that, rather than failing as if the source
    // were down.
    if (window.desktop && !window.desktop.feedText) throw new Error(STALE_RUNTIME);
    return paceNews(url, async () => {
      if (paused) throw new Error(PAUSED_ERR);
      if (window.desktop && window.desktop.feedText) {
        // `head` asks for only the first N bytes (a range request) — the
        // conjunction list is 22 MB sorted by risk, and only its top is read.
        const r = await window.desktop.feedText(url, opts.head || 0);
        if (r && r.error) throw new Error(r.error);
        return trimTail(r, opts.tail);
      }
      return grab(url, opts.tail, opts.head);
    });
  }

  async function json(url, opts = {}) {
    if (paused) throw new Error(PAUSED_ERR);
    if (window.desktop && window.desktop.feed) {
      const r = await window.desktop.feed(url);
      if (r && r.error) throw new Error(r.error);
      return r;
    }
    const body = await grab(url);
    try { return JSON.parse(body); } catch { throw new Error('unreadable response'); }
  }

  /* A feed reader for the three RSS/Atom sources. Parsing XML in the browser
     is free; doing it ourselves avoids shipping a library for four fields. */
  async function feed(url, opts = {}) {
    const body = await text(url, opts);
    const doc = new DOMParser().parseFromString(body, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('unreadable feed');
    const items = [...doc.querySelectorAll('item, entry')];
    return items.map(n => {
      const get = sel => { const e = n.querySelector(sel); return e ? e.textContent.trim() : ''; };
      const link = n.querySelector('link');
      return {
        title: get('title'),
        summary: get('description') || get('summary'),
        link: ((link && (link.getAttribute('href') || link.textContent)) || '').trim(),
        categories: [...n.querySelectorAll('category')].map(c => c.textContent.trim()),
        // Google News names the publisher's site; the energy watch uses it to tell local press.
        source: ((n.querySelector('source') && n.querySelector('source').getAttribute('url')) || '').trim(),
        time: Date.parse(get('pubDate') || get('published') || get('updated')) || null
      };
    }).filter(i => i.title);
  }

  return { text, json, feed, DIRECT, VIA_PROXY, setPaused, get paused() { return paused; }, get proxyState() { return proxyState; }, NEEDS_PROXY, STALE_RUNTIME, PAUSED_ERR };
})();
