/* ── /api/memory — the shared record of AI incidents ──────────────────────
   A feed holds only its newest items (Al Jazeera's last 25 stories cover about
   four hours), so a copy of the instrument that was not open while a story
   passed through never saw it. This keeps one record for every copy:

   GET   the record. If it has not been refreshed for a quarter hour, this
         function first reads the AI Incident Database and the three newsrooms
         itself, with the same rules as the page (lib/incidents.js), and adds
         what is new. So every visit keeps it current; no cron is needed.
   POST  with "Authorization: Bearer <MEMORY_KEY>": add incidents read
         elsewhere — the desktop app sends everything it has read. Without the
         key nothing can be written.

   Storage: Upstash Redis through its REST API (the Vercel Marketplace
   integration sets KV_REST_API_URL and KV_REST_API_TOKEN). Locally,
   scripts/dev.mjs points SM_MEMORY_FILE at a JSON file instead.            */

import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

const Incidents = createRequire(import.meta.url)('./_lib/incidents.cjs');

const RECORD = 'sm:incidents:v1', LOCK = 'sm:incidents:lock';
const REFRESH_MS = 15 * 60000;
const FEED_TIMEOUT_MS = 9000;
const MAX_BODY = 2_000_000;
const UA = 'SingularityMonitor/1.0 (web edition)';

/* ── Storage ── */
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const FILE = process.env.SM_MEMORY_FILE;
const configured = () => !!((REDIS_URL && REDIS_TOKEN) || FILE);

async function redis(...command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error('storage: ' + (body.error || 'HTTP ' + res.status));
  return body.result;
}
const empty = () => ({ incidents: [], at: 0 });
async function load() {
  let raw = null;
  if (REDIS_URL && REDIS_TOKEN) raw = await redis('GET', RECORD);
  else raw = await readFile(FILE, 'utf8').catch(() => null);
  try { const d = JSON.parse(raw); return d && Array.isArray(d.incidents) ? d : empty(); } catch { return empty(); }
}
async function store(d) {
  const text = JSON.stringify(d);
  if (REDIS_URL && REDIS_TOKEN) await redis('SET', RECORD, text);
  else await writeFile(FILE, text);
}
// One refresh at a time: the first visit after the quarter hour takes it.
async function takeLock() {
  if (!(REDIS_URL && REDIS_TOKEN)) return true;
  return (await redis('SET', LOCK, '1', 'NX', 'EX', '60')) === 'OK';
}

/* ── Reading the feeds on the server ──
   The page parses feeds with the browser's DOMParser; here the four fields it
   uses are taken out of the XML directly, entities decoded as textContent
   would. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m));
function textOf(node, tag) {
  const m = node.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map(part =>
    part.startsWith('<![CDATA[') ? part.slice(9, -3) : decode(part.replace(/<[^>]+>/g, ''))).join('').trim();
}
function parseFeed(xml) {
  const nodes = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return nodes.map(n => {
    const href = n.match(/<link[^>]*\shref="([^"]+)"/i);
    return {
      title: textOf(n, 'title'),
      summary: textOf(n, 'description') || textOf(n, 'summary'),
      link: (href ? decode(href[1]) : textOf(n, 'link')).trim(),
      time: Date.parse(textOf(n, 'pubDate') || textOf(n, 'published') || textOf(n, 'updated')) || null
    };
  }).filter(i => i.title);
}
async function readFeed(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseFeed(await res.text());
  } finally { clearTimeout(timer); }
}
async function readSources() {
  const reads = await Promise.allSettled([
    readFeed(Incidents.AIID_URL).then(Incidents.fromAiid),
    ...Incidents.NEWSROOMS.map(n => readFeed(n.url).then(items => Incidents.fromNewsroom(items, n.outlet)))
  ]);
  for (const r of reads) if (r.status === 'rejected') console.warn('[memory] read failed:', String(r.reason && r.reason.message || r.reason));
  return reads.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}

/* ── The handler ── */
function send(res, status, body, cache) {
  if (status >= 400) console.warn('[memory]', status, body.error);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}
function keyOk(header) {
  const want = process.env.MEMORY_KEY || '';
  const got = String(header || '').replace(/^Bearer\s+/i, '');
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
async function body(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export default async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: 'shared record not set up' }, 'public, max-age=0, s-maxage=60');
  try {
    if (req.method === 'POST') {
      if (!keyOk(req.headers.authorization)) return send(res, 401, { error: 'wrong or missing key' });
      let incoming;
      try { incoming = (await body(req)).incidents; } catch { return send(res, 400, { error: 'unreadable body' }); }
      if (!Array.isArray(incoming)) return send(res, 400, { error: 'no incidents' });
      const now = Date.now();
      const clean = incoming.slice(0, 600).map(e => Incidents.clean(e, now)).filter(Boolean);
      const d = await load();
      const merged = Incidents.merge(d.incidents, clean);
      await store({ incidents: merged, at: d.at });
      return send(res, 200, { incidents: merged, at: d.at, added: merged.length - d.incidents.length });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET or POST' });

    let d = await load();
    if (Date.now() - d.at > REFRESH_MS && await takeLock()) {
      const read = await readSources();
      d = await load();                       // a write may have landed while the feeds were read
      d = { incidents: Incidents.merge(d.incidents, read), at: Date.now() };
      await store(d);
    }
    return send(res, 200, { incidents: d.incidents, at: d.at },
      'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
  } catch (error) {
    return send(res, 502, { error: String(error.message || error).slice(0, 120) }, 'public, max-age=0, s-maxage=30');
  }
}
