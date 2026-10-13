'use strict';
/* ── Energy ────────────────────────────────────────────────────────────────
   Three things the globe and the Energy page show:

   Refineries. The world's crude refineries come from Wikipedia's List of oil
   refineries, placed with OpenStreetMap (lib/energy-data.js). Over that sits
   a hand-kept register of what has happened to them: struck, burning,
   offline, restored, closed. Each entry names its date and links its source;
   an entry is only as current as its last report, and says so. A live scan
   of the news (GDELT, and the World page's own feeds) attaches fresh reports
   to the refinery they name, so a strike shows before the register catches up.

   The oil reserves. The United States' Strategic Petroleum Reserve and its
   commercial stocks are read every week from the EIA's Weekly Petroleum
   Status Report, the SPR's whole weekly history from the EIA's series page;
   Brent and WTI from the futures markets (Yahoo Finance's chart service).
   Nobody publishes the world's stocks weekly: the global picture is the
   IEA's monthly Oil Market Report, written in below with its date.

   AI data centres (shown on the AI page). Epoch AI's Frontier Data Centers hub, read live: power,
   H100-equivalents, owner and users. Epoch gives addresses, not positions;
   the positions of the sites it listed on 11 October 2026 are bundled, and a
   site added later is looked up once on OpenStreetMap's Nominatim.        */
const Energy = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const listeners = new Set();
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };

  const EPOCH_CSV = 'https://epoch.ai/data/data_centers/data_centers.csv';
  const EPOCH_HUB = 'https://epoch.ai/data/data-centers';
  const EIA_T1 = 'https://ir.eia.gov/wpsr/table1.csv';
  const EIA_T2 = 'https://ir.eia.gov/wpsr/table2.csv';
  const EIA_SPR = 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WCSSTUS1&f=W';
  const EIA_PAGE = 'https://www.eia.gov/petroleum/supply/weekly/';
  const PRICE = sym => `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=1y&interval=1d`;
  const GDELT_Q = 'refinery (drone OR strike OR fire OR explosion OR attack OR halted OR outage) sourcelang:eng';
  const GEO_KEY = 'temporal-live:dc-geo';
  const SPR_DESIGN = 714;                   // million barrels, the SPR's design capacity

  /* What a status means, how loud it is, and how it ranks. */
  const STATUS = {
    destroyed: { label: 'Destroyed', level: 'red', rank: 7 },
    offline: { label: 'Offline', level: 'red', rank: 6 },
    damaged: { label: 'Damaged', level: 'orange', rank: 5 },
    reduced: { label: 'Reduced', level: 'orange', rank: 4 },
    attacked: { label: 'Attack reported', level: 'orange', rank: 3 },
    restored: { label: 'Restored', level: 'green', rank: 2 },
    operating: { label: 'Operating', level: 'none', rank: 1 },
    closed: { label: 'Closed', level: 'closed', rank: 0 }
  };

  /* The world's stocks, from the IEA's Oil Market Report (monthly; the
     public summary). Written in by hand, dated, linked. */
  const GLOBAL = {
    asOf: '2026-09-11',
    source: 'https://www.iea.org/reports/oil-market-report-september-2026',
    rows: [
      ['Global observed stocks, August', '−95 mb', 'about 3.1 mb/d drawn in the month'],
      ['Drawn since February', '−507 mb', '2.8 mb/d on average since the war began'],
      ['OECD government stocks, August', '−19 mb', 'commercial tanks rose 23 mb'],
      ['Oil on water, August', '−65 mb', 'tanker traffic out of the Gulf attacked again'],
      ['Gulf output shut in, August', '> 10 mb/d', 'Gulf exports about half of pre-war'],
      ['World refinery runs, August', '81.4 mb/d', '4.2 mb/d below August 2025']
    ],
    notes: [
      ['2026-03-11', 'IEA members agree the largest emergency release in the agency\'s history: 400 million barrels. They held about 1.2 billion barrels of government stocks and 0.6 billion of obligated industry stocks.', 'https://www.iea.org/news/iea-member-countries-to-carry-out-largest-ever-oil-stock-release-amid-market-disruptions-from-middle-east-conflict/'],
      ['2026-08-24', 'About 290 million barrels of the 400 delivered by July; the IEA says it stands ready to release more (Fatih Birol).', 'https://www.roic.ai/news/iea-signals-more-oil-releases-if-needed-as-80-of-emergency-reserves-remain-08-24-2026'],
      ['2026-06-11', 'China, holding an estimated 1.2–1.3 billion barrels before the war, begins drawing on its stocks — about 1 mb/d expected over the following months.', 'https://tankterminals.com/news/china-begins-tapping-oil-stockpiles-as-middle-east-crisis-drags-on/']
    ]
  };

  const state = {
    refineries: [], dcs: [], news: [],
    oil: { week: null, stocks: null, util: null, spr: null, brent: null, wti: null },
    sources: {
      eia: { label: 'EIA weekly stocks', status: 'waiting', at: null, note: '' },
      spr: { label: 'EIA SPR history', status: 'waiting', at: null, note: '' },
      prices: { label: 'Brent and WTI', status: 'waiting', at: null, note: '' },
      epoch: { label: 'Epoch AI data centres', status: 'waiting', at: null, note: '' },
      news: { label: 'Refinery news (GDELT)', status: 'waiting', at: null, note: '' }
    }
  };
  const ok = (key, note = '') => Object.assign(state.sources[key], { status: 'live', at: Date.now(), note });
  const fail = (key, error) => Object.assign(state.sources[key], { status: 'error', note: String(error && error.message || error) });

  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const num = s => { const v = Number(String(s == null ? '' : s).replace(/,/g, '').trim()); return s !== '' && Number.isFinite(v) ? v : null; };
  const levelOf = status => (STATUS[status] || STATUS.operating).level;

  /* ── Refineries ── */
  function buildRefineries() {
    const seen = new Set();
    state.refineries = ((typeof EnergyData !== 'undefined' && EnergyData.refineries) || []).map(r => {
      let id = 'ref:' + slug(r.country + ' ' + r.name);
      while (seen.has(id)) id += '-2';
      seen.add(id);
      const status = r.inc ? r.inc.s : r.status;
      return { id, kind: 'REF', name: r.name, op: r.op || '', country: r.country, region: r.region || '',
               at: [r.lat, r.lon], cap: r.cap, approx: !!r.approx, status, inc: r.inc || null, note: r.note || '', news: [] };
    });
  }
  const hit = r => !!r.inc && r.status !== 'closed';

  /* ── CSV, quoted fields and all ── */
  function parseCSV(text) {
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = ''; if (row.some(f => f !== '')) rows.push(row); row = [];
      } else field += c;
    }
    row.push(field); if (row.some(f => f !== '')) rows.push(row);
    return rows;
  }

  /* ── AI data centres ── */
  const clean = s => String(s || '').replace(/\s*#\w+/g, '').replace(/\s+/g, ' ').trim();
  let geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem(GEO_KEY)) || {}; } catch { geoCache = {}; }
  function positionOf(d) {
    const bundled = typeof EnergyData !== 'undefined' && EnergyData.dcAt && EnergyData.dcAt[d.name];
    if (bundled) return bundled;
    const c = geoCache[d.name];
    return c && Array.isArray(c.at) ? c.at : null;
  }
  function buildDcs(records) {
    state.dcs = records.filter(r => r.name).map(r => {
      const d = { id: 'dc:' + slug(r.name), kind: 'DC', name: r.name, owner: clean(r.owner), users: clean(r.users), project: clean(r.project),
                  country: clean(r.country), address: clean(r.address), mw: r.mw, h100: r.h100, capex: r.capex };
      d.at = positionOf(d);
      return d;
    }).sort((a, b) => (b.mw || 0) - (a.mw || 0));
  }
  async function readDcs() {
    try {
      const rows = parseCSV(await Net.text(EPOCH_CSV));
      const head = rows[0].map(h => h.trim());
      const col = name => head.indexOf(name);
      const C = { name: col('Name'), h100: col('Current H100 equivalents'), mw: col('Current power (MW)'), capex: col('Current total capital cost (2025 USD billions)'),
                  owner: col('Owner'), users: col('Users'), project: col('Project'), country: col('Country'), address: col('Address') };
      if (C.name < 0 || C.mw < 0) throw new Error('Epoch changed its columns');
      buildDcs(rows.slice(1).map(r => ({ name: (r[C.name] || '').trim(), h100: num(r[C.h100]), mw: num(r[C.mw]), capex: num(r[C.capex]),
        owner: r[C.owner], users: r[C.users], project: r[C.project], country: r[C.country], address: r[C.address] })));
      ok('epoch', `${state.dcs.length} sites`);
    } catch (error) {
      if (!state.dcs.length && typeof EnergyData !== 'undefined') buildDcs(EnergyData.dcSnapshot || []);
      fail('epoch', error);
    }
    geocodeMissing();
    emit();
  }
  // A site Epoch added after the bundled positions: one Nominatim look-up,
  // a second and a half apart, remembered on this computer.
  let geocoding = false;
  async function geocodeMissing() {
    if (geocoding) return;
    geocoding = true;
    try {
      for (const d of state.dcs.filter(x => !x.at)) {
        const prior = geoCache[d.name];
        if (prior && Date.now() - prior.t < 30 * DAY) continue;
        const queries = [d.address, d.address && d.address.split(',').slice(1).join(',').trim(), d.name.split(' ').slice(1).join(' ') + (d.country ? ', ' + d.country : '')].filter(Boolean);
        let at = null;
        for (const q of queries) {
          try {
            const r = await Net.json(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
            if (Array.isArray(r) && r[0]) { at = [Number(r[0].lat), Number(r[0].lon)]; break; }
          } catch { /* refused: try the next wording */ }
          await new Promise(res => setTimeout(res, 1500));
        }
        geoCache[d.name] = { at, t: Date.now() };
        try { localStorage.setItem(GEO_KEY, JSON.stringify(geoCache)); } catch { /* full */ }
        if (at) { d.at = at; emit(); }
      }
    } finally { geocoding = false; }
  }

  /* ── The weekly stocks (EIA WPSR, tables 1 and 2) ── */
  const usDate = s => { const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(String(s).trim()); return m ? Date.UTC(2000 + (+m[3] % 100), +m[1] - 1, +m[2]) : null; };
  async function readStocks() {
    try {
      const t1 = parseCSV(await Net.text(EIA_T1));
      const head = t1[0] || [];
      const row = label => t1.find(r => (r[0] || '').trim() === label);
      const pick = r => r ? { now: num(r[1]), prev: num(r[2]), yearAgo: num(r[5]) } : null;
      const stocks = {
        crude: pick(row('Crude Oil')), commercial: pick(row('Commercial (Excluding SPR)')), spr: pick(row('Strategic Petroleum Reserve (SPR)')),
        gasoline: pick(row('Total Motor Gasoline')), distillate: pick(row('Distillate Fuel Oil')), jet: pick(row('Kerosene-Type Jet Fuel')),
        total: pick(row('Total Stocks (Including SPR)'))
      };
      if (!stocks.spr || stocks.spr.now == null) throw new Error('table 1 unreadable');
      state.oil.stocks = stocks;
      state.oil.week = usDate(head[1]);
      try {
        const t2 = parseCSV(await Net.text(EIA_T2));
        const u = t2.find(r => (r[1] || '').trim() === 'Percent Utilization');
        if (u) state.oil.util = { now: num(u[2]), prev: num(u[3]), yearAgo: num(u[5]) };
      } catch { /* utilisation is a nicety */ }
      ok('eia', state.oil.week ? 'week to ' + new Date(state.oil.week).toISOString().slice(0, 10) : '');
    } catch (error) { fail('eia', error); }
    emit();
  }
  /* The SPR's weekly history since 1982 (thousand barrels, the EIA's page). */
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  async function readSpr() {
    try {
      const html = await Net.text(EIA_SPR);
      const series = [];
      const rowRe = /<td class='B6'>&nbsp;&nbsp;(\d{4})-(\w{3})<\/td>([\s\S]*?)<\/tr>/g;
      let m;
      while ((m = rowRe.exec(html))) {
        const year = +m[1], cells = m[3];
        const dates = [...cells.matchAll(/<td class='B5'>([^<]*)<\/td>/g)].map(x => x[1].replace(/&nbsp;/g, '').trim());
        const vals = [...cells.matchAll(/<td class='B3'>([^<]*)<\/td>/g)].map(x => x[1].replace(/&nbsp;/g, '').trim());
        dates.forEach((d, i) => {
          const dm = /^(\d\d)\/(\d\d)$/.exec(d), v = num(vals[i]);
          if (!dm || v == null) return;
          let y = year;
          if (MON[m[2]] === 0 && +dm[1] === 12) y--;               // a week of late December listed under January
          series.push({ t: Date.UTC(y, +dm[1] - 1, +dm[2]), v: v / 1000 });
        });
      }
      if (series.length < 100) throw new Error('history unreadable');
      series.sort((a, b) => a.t - b.t);
      state.oil.spr = series;
      ok('spr', `${series.length} weeks`);
    } catch (error) { fail('spr', error); }
    emit();
  }
  /* Brent and WTI futures, a year of daily closes. */
  async function readPrices() {
    const one = async sym => {
      const d = await Net.json(PRICE(sym));
      const r = d && d.chart && d.chart.result && d.chart.result[0];
      if (!r) throw new Error('no ' + sym);
      const closes = (r.indicators.quote[0].close || []), ts = r.timestamp || [];
      const series = ts.map((t, i) => ({ t: t * 1000, v: closes[i] })).filter(p => Number.isFinite(p.v));
      const price = Number.isFinite(r.meta.regularMarketPrice) ? r.meta.regularMarketPrice : series[series.length - 1].v;
      const prev = series.length > 1 ? series[series.length - 2].v : null;
      return { price, prev, time: (r.meta.regularMarketTime || 0) * 1000, series };
    };
    try {
      const [b, w] = await Promise.allSettled([one('BZ=F'), one('CL=F')]);
      if (b.status === 'fulfilled') state.oil.brent = b.value;
      if (w.status === 'fulfilled') state.oil.wti = w.value;
      if (b.status === 'rejected' && w.status === 'rejected') throw b.reason;
      ok('prices');
    } catch (error) { fail('prices', error); }
    emit();
  }

  /* ── Refinery news: GDELT, and the World page's own feeds ── */
  let gdelt = [];
  async function readNews() {
    try {
      const d = await Net.json(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_Q)}&mode=artlist&maxrecords=60&format=json&timespan=7d&sort=datedesc`);
      const items = (d.articles || []).map(a => {
        const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(a.seendate || '');
        return { headline: String(a.title || '').trim(), link: a.url, time: m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null,
                 outlet: a.domain || a.sourcecountry || '', source: 'gdelt' };
      }).filter(i => i.time && i.headline);
      const keep = new Map(gdelt.filter(i => Date.now() - i.time < 10 * DAY).map(i => [i.link, i]));
      for (const i of items) keep.set(i.link, i);
      gdelt = [...keep.values()];
      ok('news', `${gdelt.length} reports`);
    } catch (error) { fail('news', error); }
    matchNews();
    emit();
  }
  const GENERIC = new Set(['refinery', 'refining', 'oil', 'petrochemical', 'complex', 'plant', 'mina', 'north', 'south', 'east', 'west', 'new', 'old', 'jv',
    'national', 'company', 'energy', 'petroleum', 'city', 'port', 'bay', 'river', 'lake', 'saint', 'santa', 'san', 'fort', 'mount', 'great', 'little']);
  const ATTACK = /drone|strike|struck|attack|fire|blaze|explosion|blast|halt|shut|suspend|offline|outage|missile|damage/i;
  let tokenIndex = null;
  function tokens() {
    if (tokenIndex) return tokenIndex;
    tokenIndex = [];
    for (const r of state.refineries) {
      const words = r.name.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z]+/).filter(w => w.length >= 4 && !GENERIC.has(w.toLowerCase()));
      for (const w of words.slice(0, 2)) tokenIndex.push({ w, re: new RegExp(`\\b${w}\\b[^.]{0,60}refin|refin[^.]{0,60}\\b${w}\\b`, 'i'), r });
    }
    return tokenIndex;
  }
  function matchNews() {
    const pool = new Map();
    const world = (typeof Wire !== 'undefined' && Wire.state.world) || [];
    for (const i of world) if (/refin/i.test(i.headline) && ATTACK.test(i.headline))
      pool.set(i.headline.toLowerCase(), { headline: i.headline, link: i.link, time: i.time, outlet: i.place || i.source || '', source: i.source });
    for (const i of gdelt) if (/refin/i.test(i.headline) && !pool.has(i.headline.toLowerCase())) pool.set(i.headline.toLowerCase(), i);
    const items = [...pool.values()].filter(i => i.time && Date.now() - i.time < 10 * DAY).sort((a, b) => b.time - a.time);
    for (const r of state.refineries) { r.news = []; r.fresh = false; }
    for (const it of items) {
      it.refs = [];
      for (const t of tokens()) if (t.re.test(it.headline) && !it.refs.includes(t.r)) it.refs.push(t.r);
      // A name shared by several plants (Jubail, Yanbu…) goes to the one in the register, else the largest.
      if (it.refs.length > 1) it.refs = [it.refs.slice().sort((a, b) => (!!b.inc - !!a.inc) || (b.cap || 0) - (a.cap || 0))[0]];
      for (const r of it.refs) {
        r.news.push(it);
        const since = r.inc ? Date.parse(r.inc.d) || 0 : 0;
        if (ATTACK.test(it.headline) && it.time > since && Date.now() - it.time < 7 * DAY) r.fresh = true;
      }
    }
    state.news = items;
  }

  /* ── Reading on a schedule ── */
  let started = false;
  function start() {
    if (started) return;
    started = true;
    readStocks(); readSpr(); readPrices(); readDcs();
    // GDELT allows one request in five seconds; the World page asks at start, so this waits.
    setTimeout(readNews, 95 * 1000);
    setInterval(readStocks, 6 * HOUR);
    setInterval(readSpr, 12 * HOUR);
    setInterval(readPrices, 15 * MIN);
    setInterval(readDcs, 12 * HOUR);
    setInterval(readNews, 30 * MIN);
    if (typeof Wire !== 'undefined') Wire.onUpdate(() => { matchNews(); emit(); });
  }

  buildRefineries();
  if (typeof EnergyData !== 'undefined') buildDcs(EnergyData.dcSnapshot || []);

  /* ── Words and numbers ── */
  const fmt = (v, d = 1) => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (v, d = 1) => v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v), d);
  const dayLabel = s => {
    if (!s) return '';
    const m = /^(\d{4})(?:-(\d\d))?(?:-(\d\d))?$/.exec(s);
    if (!m) return s;
    const opts = m[3] ? { day: 'numeric', month: 'short', year: 'numeric' } : m[2] ? { month: 'short', year: 'numeric' } : { year: 'numeric' };
    return new Date(Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1)).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
  };
  const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  const kbd = cap => cap ? `${fmt(cap / 1000, cap < 10000 ? 1 : 0)} kb/d` : '';
  const levelVar = l => l === 'red' ? 'var(--crit)' : l === 'orange' ? 'var(--warn)' : l === 'green' ? 'var(--ok)' : 'var(--text-3)';
  const statusWord = r => (STATUS[r.status] || STATUS.operating).label;
  const placeOf = r => [r.region, r.country].filter(Boolean).join(', ');

  /* The SPR's lowest level since when. */
  function lowestSince() {
    const s = state.oil.spr;
    if (!s || !s.length) return null;
    const now = s[s.length - 1].v;
    for (let i = s.length - 2; i >= 0; i--) if (s[i].v <= now) return s[i].t;
    return 'record';
  }

  /* ── Pieces the globe uses ── */
  function find(id) {
    if (!id || typeof id !== 'string') return null;
    if (id.startsWith('ref:')) return state.refineries.find(r => r.id === id) || null;
    if (id.startsWith('dc:')) return state.dcs.find(d => d.id === id) || null;
    return null;
  }
  function detailHTML(x) {
    const latLon = ([lat, lon]) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
    if (x.kind === 'DC') {
      return `<span class="eyebrow" style="color:var(--accent-text)">◆ AI DATA CENTRE${x.mw ? ' · ' + esc(fmt(x.mw, 0)) + ' MW' : ''}</span>
        <strong>${esc(x.name)}</strong>
        <div class="map-desc"><p>${esc([x.owner && `Owned by ${x.owner}`, x.users && `used by ${x.users}`].filter(Boolean).join(', ') || 'Owner not stated')}${x.project ? ` · ${esc(x.project)}` : ''}.</p></div>
        <dl>
          ${x.mw ? `<div><dt>Power now</dt><dd>${esc(fmt(x.mw, 0))} MW</dd></div>` : ''}
          ${x.h100 ? `<div><dt>Compute</dt><dd>${esc(fmt(x.h100 / 1000, 0))}k H100-equivalents</dd></div>` : ''}
          ${x.capex ? `<div><dt>Capital cost</dt><dd>$${esc(fmt(x.capex, 1))} bn (2025 $)</dd></div>` : ''}
          ${x.country ? `<div><dt>Country</dt><dd>${esc(x.country)}</dd></div>` : ''}
          ${x.address ? `<div><dt>Address</dt><dd>${esc(x.address)}</dd></div>` : ''}
          ${x.at ? `<div><dt>Position</dt><dd>${latLon(x.at)}</dd></div>` : ''}
        </dl>
        <div class="map-actions"><button type="button" class="btn ghost" data-zoom>⌖ Zoom to it</button>
          <a class="btn primary" href="${EPOCH_HUB}" target="_blank" rel="noreferrer noopener">Epoch AI ↗</a></div>`;
    }
    const st = STATUS[x.status] || STATUS.operating;
    const events = x.inc ? x.inc.ev : [];
    return `<span class="eyebrow" style="color:${levelVar(st.level)}">▪ REFINERY · ${esc(st.label.toUpperCase())}${x.fresh ? ' · NEW REPORT' : ''}</span>
      <strong>${esc(x.name)}</strong>
      <div class="map-desc"><p>${esc([x.op, kbd(x.cap), placeOf(x)].filter(Boolean).join(' · '))}.${x.inc ? ` ${esc(st.label)} as of the last report, ${esc(dayLabel(x.inc.d))}.` : ''}</p></div>
      ${events.length ? `<ol class="inc-list">${events.map(([d, t, src]) => `<li><time>${esc(dayLabel(d))}</time><span>${esc(t)}${src ? ` <a href="${esc(src)}" target="_blank" rel="noreferrer noopener">source ↗</a>` : ''}</span></li>`).join('')}</ol>` : ''}
      ${x.news.length ? `<span class="eyebrow">IN THE NEWS · LAST 10 DAYS</span><ol class="inc-list news">${x.news.slice(0, 6).map(n => `<li><time>${esc(ago(n.time))}</time><span><a href="${esc(n.link)}" target="_blank" rel="noreferrer noopener">${esc(n.headline)} ↗</a>${n.outlet ? ` <small>${esc(n.outlet)}</small>` : ''}</span></li>`).join('')}</ol>` : ''}
      <dl>
        ${x.cap ? `<div><dt>Capacity</dt><dd>${esc(kbd(x.cap))}</dd></div>` : ''}
        <div><dt>Position</dt><dd>${latLon(x.at)}${x.approx ? ' · town, not the plant' : ''}</dd></div>
      </dl>
      ${!x.inc && x.note ? `<p class="map-hint">${esc(x.note)}</p>` : ''}
      <div class="map-actions"><button type="button" class="btn ghost" data-zoom>⌖ Zoom to it</button><button type="button" class="btn ghost" data-goto="energy">Energy page</button></div>`;
  }
  function tipHTML(x) {
    if (x.kind === 'DC') return `<b style="color:var(--accent-text)">◆ AI data centre${x.mw ? ' · ' + fmt(x.mw, 0) + ' MW' : ''}</b><span>${esc(x.name)}</span><small>${esc([x.owner, x.country].filter(Boolean).join(' · '))}</small>`;
    const st = STATUS[x.status] || STATUS.operating;
    return `<b style="color:${levelVar(st.level)}">▪ Refinery · ${esc(st.label)}${x.fresh ? ' · new report' : ''}</b><span>${esc(x.name)}</span><small>${esc([kbd(x.cap), x.country, x.inc ? 'last report ' + dayLabel(x.inc.d) : ''].filter(Boolean).join(' · '))}</small>`;
  }

  /* ── The Energy page ── */
  const filt = { status: 'hit', query: '', dcQuery: '' };
  let sig = '';
  function sparkSVG(series, cls = '') {
    if (!series || series.length < 2) return '';
    const vs = series.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), t0 = series[0].t, t1 = series[series.length - 1].t;
    const pts = series.map(p => `${((p.t - t0) / (t1 - t0 || 1) * 100).toFixed(2)},${(36 - (p.v - lo) / (hi - lo || 1) * 32).toFixed(2)}`).join(' ');
    const last = pts.split(' ').pop().split(',');
    return `<svg class="spark ${cls}" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/><circle cx="${last[0]}" cy="${last[1]}" r="1.6"/></svg>`;
  }
  function sprChart() {
    const s = state.oil.spr;
    if (!s || s.length < 2) return `<p class="map-hint">${state.sources.spr.status === 'error' ? 'The EIA did not answer: ' + esc(state.sources.spr.note) : 'Reading the SPR history…'}</p>`;
    const from = Date.UTC(2000, 0, 1), pts = s.filter(p => p.t >= from);
    const W = 600, H = 150, t0 = pts[0].t, t1 = pts[pts.length - 1].t, hi = SPR_DESIGN;
    const x = t => ((t - t0) / (t1 - t0)) * W, y = v => H - (v / hi) * H;
    const line = pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const years = [];
    for (let yr = 2000; yr <= new Date(t1).getUTCFullYear(); yr += 5) years.push(yr);
    return `<svg class="spr-chart" viewBox="0 0 ${W} ${H + 16}" preserveAspectRatio="none" role="img" aria-label="US Strategic Petroleum Reserve since 2000">
      ${[0.25, 0.5, 0.75, 1].map(f => `<line class="g" x1="0" x2="${W}" y1="${y(hi * f)}" y2="${y(hi * f)}"/><text x="2" y="${y(hi * f) + 10}">${Math.round(hi * f)}</text>`).join('')}
      ${years.map(yr => `<text class="yr" x="${x(Date.UTC(yr, 0, 1))}" y="${H + 13}">${yr}</text>`).join('')}
      <polygon class="a" points="0,${H} ${line} ${W},${H}"/><polyline points="${line}"/>
      <circle cx="${x(t1)}" cy="${y(pts[pts.length - 1].v)}" r="3"/></svg>`;
  }
  function kpis() {
    const o = state.oil, s = o.stocks;
    const k = (label, value, unit, small, cls = '') => `<div class="kpi ${cls}"><span>${label}</span><strong>${value}${unit ? `<i>${unit}</i>` : ''}</strong><small>${small}</small></div>`;
    const price = (label, p) => p ? k(label, fmt(p.price, 2), 'USD', `futures · ${p.prev ? signed(p.price - p.prev, 2) + ' on the day · ' : ''}${esc(sinceYear(p))}`) : k(label, '—', '', esc(state.sources.prices.note || 'reading…'));
    const hits = state.refineries.filter(hit), red = hits.filter(r => levelOf(r.status) === 'red').length;
    return [
      price('Brent', o.brent),
      price('WTI', o.wti),
      s ? k('US SPR', fmt(s.spr.now, 1), 'mb', `${signed(s.spr.now - s.spr.prev)} wk · ${signed(s.spr.now - s.spr.yearAgo)} yr`, s.spr.now < 300 ? 'warn' : '') : k('US SPR', '—', '', esc(state.sources.eia.note || 'reading…')),
      s ? k('US crude stocks', fmt(s.commercial.now, 1), 'mb', `commercial · ${signed(s.commercial.now - s.commercial.prev)} wk · ${signed(s.commercial.now - s.commercial.yearAgo)} yr`) : k('US crude stocks', '—', '', ''),
      o.util ? k('US refinery runs', fmt(o.util.now, 1), '%', `of capacity · ${signed(o.util.now - o.util.prev)} pt wk`) : k('US refinery runs', '—', '', ''),
      k('Refineries hit', String(hits.length), '', `${red} offline or destroyed`, red ? 'crit' : '')
    ].join('');
  }
  function sinceYear(p) {
    if (!p || !p.series || !p.series.length) return '';
    const first = p.series[0].v, ch = (p.price - first) / first * 100;
    return `${ch >= 0 ? '+' : '−'}${fmt(Math.abs(ch), 0)}% in a year`;
  }
  function reservePanel() {
    const o = state.oil, s = o.stocks, low = lowestSince();
    const pct = s ? s.spr.now / SPR_DESIGN * 100 : null;
    return `<div class="panel-head"><h2>Oil reserves</h2><span class="panel-meta">${o.week ? 'EIA · week to ' + esc(new Date(o.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })) : 'EIA weekly'}</span></div>
      <div class="en-body">
        <div class="en-gauge">
          <div class="en-gauge-top"><span>US STRATEGIC PETROLEUM RESERVE</span><b>${s ? fmt(s.spr.now, 1) + ' mb' : '—'}</b></div>
          <div class="en-bar" role="img" aria-label="SPR fill against its design capacity"><i style="width:${pct ? pct.toFixed(1) : 0}%"></i></div>
          <div class="en-gauge-foot"><span>${pct ? fmt(pct, 0) + '% of its 714 mb design capacity' : ''}</span><span>${low === 'record' ? 'lowest in the weekly record (from 1982)' : low ? 'lowest since ' + new Date(low).getUTCFullYear() : ''}</span></div>
        </div>
        ${sprChart()}
        ${s ? `<dl class="en-dl">
          <div><dt>Crude, all US stocks</dt><dd>${fmt(s.crude.now, 1)} mb <small>${signed(s.crude.now - s.crude.yearAgo)} on a year</small></dd></div>
          <div><dt>Gasoline</dt><dd>${fmt(s.gasoline && s.gasoline.now, 1)} mb <small>${s.gasoline ? signed(s.gasoline.now - s.gasoline.yearAgo) + ' on a year' : ''}</small></dd></div>
          <div><dt>Distillate (diesel, heating oil)</dt><dd>${fmt(s.distillate && s.distillate.now, 1)} mb <small>${s.distillate ? signed(s.distillate.now - s.distillate.yearAgo) + ' on a year' : ''}</small></dd></div>
          <div><dt>Jet fuel</dt><dd>${fmt(s.jet && s.jet.now, 1)} mb <small>${s.jet ? signed(s.jet.now - s.jet.yearAgo) + ' on a year' : ''}</small></dd></div>
          <div><dt>Everything, SPR included</dt><dd>${fmt(s.total && s.total.now, 1)} mb</dd></div>
        </dl>` : ''}
        <div class="en-sub"><span>THE WORLD · IEA OIL MARKET REPORT</span><a href="${GLOBAL.source}" target="_blank" rel="noreferrer noopener">${esc(dayLabel(GLOBAL.asOf))} ↗</a></div>
        <dl class="en-dl">${GLOBAL.rows.map(([a, b, c]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)} <small>${esc(c)}</small></dd></div>`).join('')}</dl>
        <ol class="inc-list">${GLOBAL.notes.map(([d, t, u]) => `<li><time>${esc(dayLabel(d))}</time><span>${esc(t)} <a href="${esc(u)}" target="_blank" rel="noreferrer noopener">source ↗</a></span></li>`).join('')}</ol>
        <p class="map-hint">No one publishes the world's oil stocks weekly. The US figures are live; the world's are the IEA's monthly estimate, as dated. mb = million barrels.</p>
      </div>`;
  }
  const FILTERS = [['hit', 'Hit'], ['red', 'Offline · destroyed'], ['orange', 'Damaged'], ['restored', 'Restored'], ['closed', 'Closed'], ['all', 'All']];
  function refineryRows() {
    const q = filt.query.toLowerCase();
    let rows = state.refineries;
    if (filt.status === 'hit') rows = rows.filter(r => hit(r) || r.fresh);
    else if (filt.status === 'red' || filt.status === 'orange') rows = rows.filter(r => levelOf(r.status) === filt.status);
    else if (filt.status === 'restored') rows = rows.filter(r => r.status === 'restored');
    else if (filt.status === 'closed') rows = rows.filter(r => r.status === 'closed');
    if (q) rows = rows.filter(r => `${r.name} ${r.op} ${r.country} ${r.region}`.toLowerCase().includes(q));
    return rows.slice().sort((a, b) => (b.fresh - a.fresh) || ((STATUS[b.status] || {}).rank - (STATUS[a.status] || {}).rank)
      || (Date.parse(b.inc && b.inc.d) || 0) - (Date.parse(a.inc && a.inc.d) || 0) || (b.cap || 0) - (a.cap || 0));
  }
  function refineryPanel() {
    const rows = refineryRows();
    const n = s => s === 'hit' ? state.refineries.filter(r => hit(r) || r.fresh).length : s === 'all' ? state.refineries.length
      : s === 'restored' || s === 'closed' ? state.refineries.filter(r => r.status === s).length : state.refineries.filter(r => levelOf(r.status) === s).length;
    return `<div class="panel-head"><h2>Refineries</h2><span class="panel-meta">${state.refineries.length} placed · register as of ${esc(dayLabel((typeof EnergyData !== 'undefined' && EnergyData.asOf) || ''))}</span></div>
      <div class="en-tools"><div class="chips">${FILTERS.map(([k, l]) => `<button type="button" class="chip${filt.status === k ? ' on' : ''}" data-enf="${k}">${l} <b>${n(k)}</b></button>`).join('')}</div>
        <input id="energy-query" class="control search" type="search" placeholder="Filter refineries" value="${esc(filt.query)}" aria-label="Filter refineries"></div>
      <div class="work-list en-list"><table class="grid"><thead><tr><th></th><th>Refinery</th><th>Status</th><th>Capacity</th><th>Last report</th></tr></thead><tbody>
      ${rows.length ? rows.slice(0, 300).map(r => {
        const st = STATUS[r.status] || STATUS.operating, lv = st.level;
        const last = r.fresh && r.news[0] ? ago(r.news[0].time) : r.inc ? dayLabel(r.inc.d) : '';
        const what = r.fresh && r.news[0] ? r.news[0].headline : r.inc ? r.inc.ev[r.inc.ev.length - 1][1] : r.op;
        return `<tr data-ref="${esc(r.id)}" class="lvl-${lv === 'closed' ? 'none' : lv}"><td class="c-glyph">${lv === 'closed' ? '□' : '▪'}</td>
          <td class="c-name">${esc(r.name)}<span>${esc([placeOf(r), what].filter(Boolean).join(' · '))}</span></td>
          <td class="c-value">${esc(st.label)}${r.fresh ? ' <em class="en-new">NEW</em>' : ''}</td><td class="c-kind">${esc(kbd(r.cap))}</td><td class="c-time">${esc(last)}</td></tr>`;
      }).join('') : '<tr class="empty"><td colspan="5">Nothing matches.</td></tr>'}
      </tbody></table></div>`;
  }
  /* The data centres live on the AI page (paintDc); the globe layer stays. */
  function dcPanel() {
    const q = filt.dcQuery.toLowerCase();
    const rows = state.dcs.filter(d => !q || `${d.name} ${d.owner} ${d.users} ${d.country} ${d.project}`.toLowerCase().includes(q));
    const gw = state.dcs.reduce((a, d) => a + (d.mw || 0), 0) / 1000, h = state.dcs.reduce((a, d) => a + (d.h100 || 0), 0);
    const owners = new Map();
    for (const d of state.dcs) { const o = (d.owner || 'unknown').split(/[,;]/)[0].trim() || 'unknown'; owners.set(o, (owners.get(o) || 0) + (d.mw || 0)); }
    owners.delete('unknown');
    const top = [...owners].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const countries = new Map();
    for (const d of state.dcs) countries.set(d.country || '—', (countries.get(d.country || '—') || 0) + (d.mw || 0));
    const topC = [...countries].sort((a, b) => b[1] - a[1]).slice(0, 4);
    return `<div class="panel-head"><h2>AI data centres</h2><span class="panel-meta">Epoch AI · ${state.dcs.length} frontier sites · ${state.sources.epoch.status === 'live' ? 'live' : esc(state.sources.epoch.status === 'error' ? 'bundled copy' : 'reading…')}</span></div>
      <div class="dc-sum">
        <div><span>SITES</span><b>${state.dcs.length}</b></div>
        <div><span>POWER NOW</span><b>${fmt(gw, 1)}<i>GW</i></b></div>
        <div><span>COMPUTE</span><b>${fmt(h / 1e6, 1)}<i>M H100e</i></b></div>
        <div class="wide"><span>LARGEST OWNERS · BY POWER</span><small>${top.map(([o, mw]) => `${esc(o)} ${fmt(mw / 1000, 1)} GW`).join(' · ')}</small></div>
        <div class="wide"><span>WHERE</span><small>${topC.map(([c, mw]) => `${esc(c)} ${fmt(mw / gw / 10, 0)}%`).join(' · ')}</small></div>
      </div>
      <div class="en-tools"><input id="energy-dc-query" class="control search" type="search" placeholder="Filter by name, owner, user, country" value="${esc(filt.dcQuery)}" aria-label="Filter data centres"><span class="dc-hint">Click a site to see it on the globe.</span></div>
      <div class="work-list en-list"><table class="grid"><thead><tr><th></th><th>Site</th><th>Power</th><th>H100e</th></tr></thead><tbody>
      ${rows.map(d => `<tr data-ref="${esc(d.id)}"><td class="c-glyph" style="color:var(--accent)">◆</td><td class="c-name">${esc(d.name)}<span>${esc([d.owner, d.users && d.users !== d.owner ? 'for ' + d.users : '', d.country].filter(Boolean).join(' · '))}</span></td>
        <td class="c-value">${d.mw ? esc(fmt(d.mw, 0)) + ' MW' : '—'}</td><td class="c-kind">${d.h100 ? esc(fmt(d.h100 / 1000, 0)) + 'k' : '—'}</td></tr>`).join('') || '<tr class="empty"><td colspan="4">Nothing matches.</td></tr>'}
      </tbody></table></div>`;
  }
  function newsPanel() {
    const items = state.news.slice(0, 14);
    return `<div class="panel-head"><h2>Refinery reports</h2><span class="panel-meta">GDELT and the World feeds · 10 days</span></div>
      <ol class="inc-list news en-news">${items.length ? items.map(n => `<li><time>${esc(ago(n.time))}</time><span><a href="${esc(n.link)}" target="_blank" rel="noreferrer noopener">${esc(n.headline)} ↗</a>
        ${n.refs && n.refs.length ? `<button type="button" class="en-link" data-ref="${esc(n.refs[0].id)}">▪ ${esc(n.refs[0].name)}</button>` : ''}</span></li>`).join('')
        : `<li class="map-hint">${state.sources.news.status === 'error' ? 'GDELT did not answer (' + esc(state.sources.news.note) + '); the World feeds are still read.' : state.sources.news.status === 'waiting' ? 'The first GDELT reading comes a minute and a half after start.' : 'No refinery attack or outage reported in the last ten days.'}</li>`}</ol>`;
  }
  function paint() {
    const host = $('energy-body');
    if (!host) return;
    const s = JSON.stringify([state.oil.week, state.oil.brent && state.oil.brent.price, state.oil.wti && state.oil.wti.price, state.oil.spr && state.oil.spr.length,
      state.dcs.length, state.dcs.filter(d => d.at).length, state.news.length, state.news[0] && state.news[0].time, filt, Object.values(state.sources).map(x => x.status)]);
    if (s === sig) return;
    const focus = document.activeElement && document.activeElement.id, caret = focus && document.activeElement.selectionStart;
    sig = s;
    $('energy-kpis').innerHTML = kpis();
    host.innerHTML = `<div class="en-col"><section class="panel en-reserve">${reservePanel()}</section></div>
      <div class="en-col"><section class="panel en-ref">${refineryPanel()}</section>
      <section class="panel en-feed">${newsPanel()}</section></div>`;
    const src = $('energy-sources');
    if (src) src.textContent = Object.values(state.sources).map(x => `${x.label}: ${x.status === 'live' ? 'live' : x.status}`).join(' · ');
    if (focus && $(focus)) { const n = $(focus); n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* not text */ } }
  }
  let dcSig = '';
  function paintDc() {
    const host = $('ai-dc');
    if (!host) return;
    const s = JSON.stringify([state.dcs.length, state.dcs.filter(d => d.at).length, filt.dcQuery, state.sources.epoch.status]);
    if (s === dcSig) return;
    const focus = document.activeElement && document.activeElement.id, caret = focus && document.activeElement.selectionStart;
    dcSig = s;
    host.innerHTML = dcPanel();
    if (focus && $(focus)) { const n = $(focus); n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* not text */ } }
  }
  function wirePage() {
    const dc = $('ai-dc');
    if (dc) {
      dc.addEventListener('click', e => { const r = e.target.closest('[data-ref]'); if (r && typeof DisasterMap !== 'undefined') DisasterMap.open(r.dataset.ref); });
      dc.addEventListener('input', e => { if (e.target.id === 'energy-dc-query') { filt.dcQuery = e.target.value; paintDc(); } });
    }
    const host = $('energy-body');
    if (!host) return;
    host.addEventListener('click', e => {
      const f = e.target.closest('[data-enf]');
      if (f) { filt.status = f.dataset.enf; paint(); return; }
      if (e.target.closest('a')) return;
      const r = e.target.closest('[data-ref]');
      if (r && typeof DisasterMap !== 'undefined') DisasterMap.open(r.dataset.ref);
    });
    host.addEventListener('input', e => {
      if (e.target.id === 'energy-query') { filt.query = e.target.value; paint(); }
    });
    onUpdate(() => { if (typeof Views !== 'undefined' && Views.current === 'energy') paint(); if (typeof Views !== 'undefined' && Views.current === 'ai') paintDc(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wirePage); else wirePage();

  const rescan = () => { matchNews(); emit(); };
  return { state, start, onUpdate, find, detailHTML, tipHTML, paint, paintDc, rescan, STATUS, levelOf, hit };
})();
