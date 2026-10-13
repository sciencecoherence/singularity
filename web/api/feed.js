/* ── /api/feed — the one server-side function ─────────────────────────────
   An allowlisted pass-through, deliberately not a parser: it exists for the
   sources that publish no Access-Control-Allow-Origin header, so a browser
   cannot read them directly. All parsing stays in the page's JavaScript, so
   the website and the desktop app share one implementation.

   Every answer is cached by Vercel's CDN for a time set per source (below),
   and served stale while it refreshes. So however many people have the page
   open, each source is asked at most once per window: one Google News search
   serves every visitor for a quarter hour.

   ?url=   the https address to read (its host must be in ALLOWED)
   ?head=  only the first N bytes (a range request; the conjunction list is
           22 MB sorted by risk, and only its top is read)
   ?tail=  only the last N bytes, cut at a line (the sea-ice record is 1.9 MB
           and only its last rows are read)                                  */

const ALLOWED = new Set([
  'data.giss.nasa.gov', 'noaadata.apps.nsidc.org', 'www.cpc.ncep.noaa.gov', 'www.star.nesdis.noaa.gov',
  'epoch.ai', 'export.arxiv.org', 'www.esa.int', 'www.sidc.be', 'api.gdeltproject.org', 'metr.org',
  'incidentdatabase.ai', 'reliefweb.int', 'www.aljazeera.com', 'feeds.bbci.co.uk', 'news.un.org',
  'celestrak.org', 'lifespan.io', 'ir.eia.gov', 'www.eia.gov', 'query1.finance.yahoo.com',
  'nominatim.openstreetmap.org', 'news.google.com', 'www.nhc.noaa.gov', 'www.metoc.navy.mil',
  'unstats.un.org', 'stats.bis.org', 'api.imf.org', 'cdn.jsdelivr.net', 'api.nasa.gov',
  // Launch Library: read directly by browsers, and through here only when it
  // refuses one (fifteen requests an hour per address; see net.js).
  'll.thespacedevs.com'
]);

// Seconds the CDN keeps an answer, and how long after that it may still serve
// it while fetching a fresh one. Daily data is kept for hours; news for a
// quarter hour; market quotes for two minutes.
const CACHE = {
  'news.google.com': [900, 3600],
  'query1.finance.yahoo.com': [120, 600],
  'celestrak.org': [21600, 43200],       // it recomputes twice a day and asks not to be re-read
  'api.imf.org': [21600, 86400], 'stats.bis.org': [21600, 86400], 'unstats.un.org': [21600, 86400],
  'cdn.jsdelivr.net': [3600, 21600], 'www.eia.gov': [3600, 21600], 'ir.eia.gov': [3600, 21600],
  'www.nhc.noaa.gov': [600, 1800], 'www.metoc.navy.mil': [600, 1800],
  'api.gdeltproject.org': [900, 3600], 'll.thespacedevs.com': [1200, 3600], 'api.nasa.gov': [10800, 21600], 'nominatim.openstreetmap.org': [86400, 604800]
};
const DEFAULT_CACHE = [900, 3600];

// Vercel refuses responses over 4.5 MB; nothing the page reads needs more.
const MAX_BYTES = 4_200_000;
const TIMEOUT_MS = 25_000;
const UA = 'SingularityMonitor/1.0 (web edition)';

function send(res, status, body, cache) {
  if (status !== 200) console.warn('[feed]', status, body, res.req && res.req.url ? decodeURIComponent(res.req.url).slice(0, 160) : '');
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', status === 200 ? 'text/plain; charset=utf-8' : 'application/json');
  // Failures are kept a minute too, so a source that refuses is not hammered.
  res.setHeader('Cache-Control', status === 200
    ? `public, max-age=60, s-maxage=${cache[0]}, stale-while-revalidate=${cache[1]}`
    : 'public, max-age=0, s-maxage=60');
  res.end(status === 200 ? body : JSON.stringify({ error: body }));
}

// Read at most `limit` bytes, stopping the download there.
async function readCapped(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0, cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    if (size >= limit) { cut = true; try { await reader.cancel(); } catch { /* gone */ } break; }
  }
  return { buf: Buffer.concat(chunks).subarray(0, limit), cut };
}

async function upstream(url, head) {
  const headers = { 'User-Agent': UA, Accept: '*/*' };
  if (head) headers.Range = `bytes=0-${head - 1}`;
  let r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Yahoo rate-limits by host; its second host answers the same questions.
  if (r.status === 429 && url.hostname === 'query1.finance.yahoo.com') {
    const alt = new URL(url); alt.hostname = 'query2.finance.yahoo.com';
    r = await fetch(alt, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
  return r;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return send(res, 405, 'GET only');
  const q = new URL(req.url, 'http://local').searchParams;
  let url;
  try { url = new URL(q.get('url') || ''); } catch { return send(res, 400, 'no url'); }
  if (url.protocol !== 'https:') return send(res, 400, 'url must be https');
  if (!ALLOWED.has(url.hostname)) return send(res, 403, 'host not allowed');
  const cache = CACHE[url.hostname] || DEFAULT_CACHE;
  const head = Math.max(0, Math.min(parseInt(q.get('head') || '0', 10) || 0, MAX_BYTES));
  const tail = Math.max(0, Math.min(parseInt(q.get('tail') || '0', 10) || 0, MAX_BYTES));

  let r;
  try { r = await upstream(url, head); }
  catch (e) { return send(res, 502, 'upstream unreachable: ' + String(e && (e.cause && e.cause.code || e.message) || e).slice(0, 80)); }
  if (r.status < 200 || r.status >= 300) return send(res, 502, 'upstream HTTP ' + r.status);

  // A tail needs the whole file; otherwise read only what can be sent.
  const limit = head || (tail ? 40_000_000 : MAX_BYTES + 1);
  let { buf, cut } = await readCapped(r, limit);
  if (!head && !tail && cut) return send(res, 502, 'response too large');
  let text = buf.toString('utf8');
  if (head && (cut || buf.length >= head)) { const nl = text.lastIndexOf('\n'); if (nl > 0) text = text.slice(0, nl + 1); }
  if (tail && text.length > tail) {
    // Cut at a line boundary so the page never parses half a row.
    text = text.slice(-tail);
    const nl = text.indexOf('\n');
    if (nl >= 0 && nl < 4096) text = text.slice(nl + 1);
  }
  if (Buffer.byteLength(text) > MAX_BYTES) return send(res, 502, 'response too large');
  return send(res, 200, text, cache);
}
