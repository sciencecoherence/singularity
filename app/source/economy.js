'use strict';
/* ── Economy ───────────────────────────────────────────────────────────────
   The economic situation of every country, from the bodies that measure it:

     Markets             Yahoo Finance: the main stock indices, the US 10-year
                         yield, volatility, the dollar, gold and bitcoin,
                         every five minutes (delayed as Yahoo publishes them)
     Policy rates        the Bank for International Settlements' central bank
                         policy rate series (38 central banks, the euro area
                         as one), daily, with the date and size of each change
     The outlook         the IMF World Economic Outlook (its SDMX API):
                         growth, inflation, unemployment, public debt, the
                         fiscal balance, the current account, GDP; this year
                         and next are the IMF's projections
     Currencies          daily reference rates for every currency against the
                         US dollar (fawazahmed0/currency-api, from central bank
                         and market sources), now and a week, a month and a
                         year ago
     Economic stress     a news sweep in five languages every 20 minutes:
                         recession, default, devaluation, bailouts, rate moves;
                         your country read on its own

   What is read is kept on this computer, so the page opens complete.       */

const Economy = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const COUNTRIES = typeof CountryData !== 'undefined' ? CountryData : [];
  const CUR = typeof CurrencyData !== 'undefined' ? CurrencyData : {};
  const byIso = new Map(COUNTRIES.map(c => [c.iso2, c]));
  const fmt = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const sgn = (n, d = 1) => !Number.isFinite(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), d);
  const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  const day = t => new Date(t).toISOString().slice(0, 10);
  const nameOf = iso => iso === 'WLD' ? 'World' : (byIso.get(iso) || {}).name || iso;

  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  // The euro area's members take the ECB's rate (BIS area XM).
  const EURO = new Set(['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES']);
  const BANK = { US: 'Federal Reserve', XM: 'European Central Bank', GB: 'Bank of England', JP: 'Bank of Japan', CN: "People's Bank of China", CH: 'Swiss National Bank',
    CA: 'Bank of Canada', AU: 'Reserve Bank of Australia', NZ: 'Reserve Bank of New Zealand', BR: 'Banco Central do Brasil', MX: 'Banco de México', IN: 'Reserve Bank of India',
    RU: 'Bank of Russia', TR: 'Central Bank of Türkiye', ZA: 'South African Reserve Bank', KR: 'Bank of Korea', SE: 'Riksbank', NO: 'Norges Bank', CL: 'Banco Central de Chile',
    CO: 'Banco de la República', PE: 'Banco Central de Reserva del Perú', ID: 'Bank Indonesia', PL: 'National Bank of Poland', HU: 'Magyar Nemzeti Bank', CZ: 'Czech National Bank' };

  const state = {
    markets: { at: 0, list: [] },
    rates: { at: 0, series: {} },        // BIS area → [[date, rate]] (changes only, plus the latest day)
    weo: { at: 0, v: {} },               // indicator → iso3 → { year: value }
    fx: { at: 0, date: '', now: {}, w: {}, m: {}, y: {} },
    news: new Map(),
    level: new Map(),
    sources: {
      markets: { label: 'Markets · Yahoo Finance', status: 'waiting', at: null, note: '' },
      rates: { label: 'Policy rates · BIS', status: 'waiting', at: null, note: '' },
      weo: { label: 'Outlook · IMF World Economic Outlook', status: 'waiting', at: null, note: '' },
      fx: { label: 'Currencies · daily reference rates', status: 'waiting', at: null, note: '' },
      news: { label: 'Economic news sweep', status: 'waiting', at: null, note: '' }
    }
  };

  /* ── Keeping what was read ── */
  const STORE = 'temporal-live:economy';
  function save() {
    try {
      const news = [...state.news.values()].sort((a, b) => b.time - a.time).slice(0, 700);
      localStorage.setItem(STORE, JSON.stringify({ markets: state.markets, rates: state.rates, weo: state.weo, fx: state.fx, news }));
    } catch { /* full or refused */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (!d) return;
      for (const k of ['markets', 'rates', 'weo', 'fx']) if (d[k]) state[k] = d[k];
      for (const i of d.news || []) if (Date.now() - i.time < 5 * DAY) { i.tag = (TAGS.find(([, re]) => re.test(i.headline)) || ['other'])[0]; state.news.set(i.k, i); }
      computeNews();
    } catch { /* nothing kept */ }
  }

  /* ── Markets ── */
  const MARKETS = [
    ['^GSPC', 'S&P 500', 0], ['^IXIC', 'Nasdaq', 0], ['^STOXX50E', 'Euro Stoxx 50', 0], ['^FTSE', 'FTSE 100', 0], ['^N225', 'Nikkei 225', 0], ['000001.SS', 'Shanghai', 0],
    ['^BVSP', 'Bovespa', 0], ['^TNX', 'US 10-year yield', 2], ['^VIX', 'Volatility (VIX)', 2], ['DX-Y.NYB', 'Dollar index', 2], ['GC=F', 'Gold $/oz', 0], ['BTC-USD', 'Bitcoin $', 0]
  ];
  async function readMarkets() {
    const syms = MARKETS.map(m => encodeURIComponent(m[0])).join(',');
    const d = await Net.json(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=1mo&interval=1d`);
    const res = (d && d.spark && d.spark.result) || [];
    if (!res.length) throw new Error('Yahoo: no data');
    const list = [];
    for (const [sym, label, dp] of MARKETS) {
      const r = res.find(x => x.symbol === sym);
      const resp = r && r.response && r.response[0];
      if (!resp) continue;
      const m = resp.meta, closes = ((resp.indicators && resp.indicators.quote && resp.indicators.quote[0].close) || []).filter(Number.isFinite);
      const price = m.regularMarketPrice, chg = Number.isFinite(m.regularMarketChangePercent) ? m.regularMarketChangePercent : null;
      const month = closes.length ? (price / closes[0] - 1) * 100 : null;
      list.push({ sym, label, dp, price, chg, month, time: (m.regularMarketTime || 0) * 1000, closes: closes.slice(-30) });
    }
    state.markets = { at: Date.now(), list };
  }

  /* ── Policy rates: BIS ── */
  async function readRates(force) {
    if (!force && Date.now() - state.rates.at < 12 * HOUR && Object.keys(state.rates.series).length) return;
    const from = day(Date.now() - 400 * DAY);
    const csv = await Net.text(`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.?startPeriod=${from}&format=csv&detail=dataonly`);
    const lines = csv.trim().split(/\r?\n/);
    const head = lines.shift().split(',');
    const ia = head.indexOf('REF_AREA'), it = head.indexOf('TIME_PERIOD'), iv = head.indexOf('OBS_VALUE');
    if (ia < 0 || it < 0 || iv < 0) throw new Error('BIS: unreadable');
    const series = {};
    for (const line of lines) {
      const f = line.split(',');
      const v = parseFloat(f[iv]);
      if (!Number.isFinite(v)) continue;
      const s = series[f[ia]] || (series[f[ia]] = []);
      // Only the changes are kept (and the latest day), which is what is shown.
      if (!s.length || s[s.length - 1][1] !== v) s.push([f[it], v]);
      else s.latest = f[it];
      s.last = f[it];
    }
    const out = {};
    for (const [k, s] of Object.entries(series)) out[k] = { pts: s.slice(), last: s.last };
    if (!Object.keys(out).length) throw new Error('BIS: no rates');
    state.rates = { at: Date.now(), series: out };
  }
  function rateOf(iso) {
    const key = EURO.has(iso) ? 'XM' : iso;
    const s = state.rates.series[key];
    if (!s || !s.pts.length) return null;
    const pts = s.pts, cur = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const yearAgo = Date.now() - 365 * DAY;
    const base = [...pts].reverse().find(p => Date.parse(p[0]) <= yearAgo) || pts[0];
    return { key, bank: BANK[key] || '', rate: cur[1], since: cur[0], move: prev ? cur[1] - prev[1] : null, prevDate: prev ? prev[0] : null, year: cur[1] - base[1], pts, asOf: s.last };
  }

  /* ── The outlook: IMF WEO ── */
  const WEO = [
    ['NGDP_RPCH', 'Real GDP growth', '%', 1, false], ['PCPIPCH', 'Inflation', '%', 1, true], ['LUR', 'Unemployment', '%', 1, true],
    ['GGXWDG_NGDP', 'Public debt', '% of GDP', 0, true], ['GGXCNL_NGDP', 'Fiscal balance', '% of GDP', 1, false], ['BCA_NGDPD', 'Current account', '% of GDP', 1, false],
    ['NGDPD', 'GDP', 'US$ bn', 0, false], ['NGDPDPC', 'GDP per person', 'US$', 0, false]
  ];
  // The IMF's SDMX API: every country, the eight series, in one request
  // (about 1.3 MB). The older DataMapper API refuses the app's requests.
  async function readWEO(force) {
    if (!force && Date.now() - state.weo.at < DAY && Object.keys(state.weo.v).length) return;
    const codes = WEO.map(w => w[0]).join('+');
    const d = await Net.json(`https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/+/*.${codes}.A?attributes=none&measures=all`);
    const st = d && d.data && d.data.structures && d.data.structures[0], ds = d && d.data && d.data.dataSets && d.data.dataSets[0];
    if (!st || !ds) throw new Error('IMF: unreadable');
    const dims = st.dimensions.series, time = st.dimensions.observation[0].values.map(x => x.value || x.id);
    const ci = dims.findIndex(x => x.id === 'COUNTRY'), ii = dims.findIndex(x => x.id === 'INDICATOR');
    const v = {};
    for (const [key, ser] of Object.entries(ds.series || {})) {
      const parts = key.split(':').map(Number);
      let country = dims[ci].values[parts[ci]].id;
      const code = dims[ii].values[parts[ii]].id;
      if (country === 'G001') country = 'WEOWORLD';
      const out = ((v[code] = v[code] || {})[country] = {});
      for (const [t, o] of Object.entries(ser.observations || {})) {
        const x = parseFloat(o[0]);
        if (Number.isFinite(x)) out[time[+t]] = code === 'NGDPD' ? x / 1e9 : x;
      }
    }
    if (!Object.keys(v).length) throw new Error('IMF: no data');
    state.weo = { at: Date.now(), v };
  }
  const weoKey = iso => iso === 'WLD' ? 'WEOWORLD' : (byIso.get(iso) || {}).iso3;
  const weo = (code, iso, year) => { const s = state.weo.v[code] && state.weo.v[code][weoKey(iso)]; const x = s && s[year]; return Number.isFinite(x) ? x : null; };
  const thisYear = () => new Date().getUTCFullYear();
  // The latest year with a value, up to this year (debt and deficits lag).
  function weoLatest(code, iso) {
    for (let y = thisYear(); y >= thisYear() - 4; y--) { const x = weo(code, iso, y); if (x != null) return [x, y]; }
    return [null, null];
  }

  /* ── Currencies ── */
  const FXURL = d => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/usd.json`;
  async function readFX(force) {
    if (!force && Date.now() - state.fx.at < 6 * HOUR && Object.keys(state.fx.now).length) return;
    const dates = ['latest', day(Date.now() - 7 * DAY), day(Date.now() - 30 * DAY), day(Date.now() - 365 * DAY)];
    const res = await Promise.allSettled(dates.map(d => Net.json(FXURL(d))));
    if (res[0].status !== 'fulfilled' || !res[0].value.usd) throw res[0].reason || new Error('currency rates: no data');
    const pick = r => r.status === 'fulfilled' && r.value && r.value.usd ? r.value.usd : {};
    state.fx = { at: Date.now(), date: res[0].value.date, now: pick(res[0]), w: pick(res[1]), m: pick(res[2]), y: pick(res[3]) };
  }
  // Units of the currency per dollar, and how much the currency itself moved
  // against the dollar (a negative number: it lost value).
  function fxOf(code) {
    const c = String(code || '').toLowerCase(), f = state.fx;
    const now = f.now[c];
    if (!Number.isFinite(now)) return null;
    const ch = then => Number.isFinite(then) ? (then / now - 1) * 100 : null;
    return { code: code.toUpperCase(), now, w: ch(f.w[c]), m: ch(f.m[c]), y: ch(f.y[c]) };
  }

  /* ── Economic stress: the news sweep ── */
  const GN = (q, hl, gl, ceid) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${ceid}`;
  const KW = {
    en: ['recession', '"debt default"', 'devaluation', 'hyperinflation', '"IMF bailout"', '"IMF loan"', '"currency crisis"', '"bank run"', '"rate hike"', '"rate cut"', '"debt crisis"', '"inflation surges"', '"economic crisis"'],
    es: ['recesión', 'devaluación', 'impago', '"crisis económica"', '"FMI"', 'hiperinflación', '"tasa de interés"', '"riesgo país"', '"tasas de interés"'],
    fr: ['récession', 'dévaluation', '"défaut de paiement"', 'FMI', '"crise économique"', '"taux directeur"', 'hyperinflation'],
    pt: ['recessão', 'desvalorização', 'calote', 'FMI', '"crise econômica"', 'Selic', '"taxa de juros"'],
    ar: ['ركود', '"تخفيض قيمة"', '"صندوق النقد"', '"أزمة اقتصادية"', '"سعر الفائدة"', 'التضخم']
  };
  const SWEEPS = [
    { k: 'en', hl: 'en-US', gl: 'US', ceid: 'en' }, { k: 'es', hl: 'es-419', gl: 'US', ceid: 'es-419' },
    { k: 'fr', hl: 'fr', gl: 'FR', ceid: 'fr' }, { k: 'pt', hl: 'pt-BR', gl: 'BR', ceid: 'pt-419' }, { k: 'ar', hl: 'ar', gl: 'EG', ceid: 'ar' }
  ];
  const TAGS = [
    ['crisis', /default|impago|calote|d[ée]faut de paiement|hyperinfla|hiperinfla|bank run|currency crisis|debt crisis|crisis de deuda|crise de la dette|collapse|colapso|effondrement|bankrupt|quiebra|faillite|riesgo pa[ií]s|devalu|desvaloriz|d[ée]valu|تخفيض قيمة|انهيار|أزمة/i],
    // The IMF as lender of last resort; its forecasts are the outlook, not stress.
    ['imf', /bailout|rescue package|rescate|sauvetage|resgate|(?:imf|fmi)[^.]{0,40}(?:loan|programme|program|pr[ée]stamo|cr[ée]dit|acuerdo|accord|desembolso|disbursement|tranche|staff-level)|(?:loan|programme|program|pr[ée]stamo|acuerdo|accord|desembolso|disbursement)[^.]{0,40}(?:imf|fmi)|قرض|صندوق النقد/i],
    ['outlook', /\bimf\b|\bfmi\b|forecast|outlook|pron[oó]stico|proyecci[oó]n|perspectivas?|pr[ée]vision|proje[cç][aã]o|crecimiento|croissance|crescimento|growth/i],
    ['recession', /recession|recesi[oó]n|r[ée]cession|recess[aã]o|contraction|contracci[oó]n|ركود|انكماش/i],
    ['rates', /rate (?:hike|cut|decision|rise)|raises? rates|cuts? rates|interest rate|policy rate|tasas? de inter[ée]s|taux directeur|taxa de juros|selic|سعر الفائدة|central bank|banco central|banque centrale/i],
    ['inflation', /inflation|inflaci[oó]n|infla[cç][aã]o|التضخم|prices? (?:soar|surge|jump)/i]
  ];
  const TAG_SAY = { crisis: 'CRISIS', imf: 'IMF RESCUE', recession: 'RECESSION', rates: 'RATES', inflation: 'INFLATION', outlook: 'OUTLOOK', other: 'ECONOMY' };
  const NOT = /recession[- ]proof|stock picks|best stocks|crypto(?:currency)? price prediction|horoscope|football|f[uú]tbol|soccer|nfl|nba|movie|film|album/i;
  const ABOUT = /recession|default|devalu|inflation|imf|bailout|currency|bank run|rate|debt|econom|recesi|devalua|impago|crisis|fmi|inflaci|tasa|riesgo|r[ée]cession|d[ée]valu|d[ée]faut|taux|crise|recess|desvaloriz|calote|selic|juros|infla|ركود|تخفيض|صندوق|أزمة|الفائدة|التضخم/i;
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const TLD = iso => iso === 'GB' ? 'uk' : iso.toLowerCase();
  const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
  function split(raw) {
    const i = raw.lastIndexOf(' - ');
    return i > 20 ? { headline: raw.slice(0, i).trim(), outlet: raw.slice(i + 3).trim() } : { headline: raw.trim(), outlet: '' };
  }
  const place = t => (typeof Watch !== 'undefined' && Watch.place) ? Watch.place(t) : [];
  function take(items, via, iso) {
    for (const it of items) {
      if (!it.time || Date.now() - it.time > 4 * DAY) continue;
      const { headline, outlet } = split(it.title);
      if (!ABOUT.test(headline) || NOT.test(headline)) continue;
      let countries = place(headline);
      if (iso && !countries.length && hostOf(it.source).endsWith('.' + TLD(iso))) countries = [iso];
      if (!countries.length || countries.length > 3) continue;
      const k = norm(headline);
      if (state.news.has(k)) continue;
      const tag = (TAGS.find(([, re]) => re.test(headline)) || ['other'])[0];
      state.news.set(k, { k, headline, outlet, link: it.link, time: it.time, via, countries, tag });
    }
  }
  const home = () => (typeof Watch !== 'undefined' && Watch.homeIso && Watch.homeIso()) || '';
  async function readNews() {
    let ok = 0;
    const fails = [];
    for (const s of SWEEPS) {
      try { take(await Net.feed(GN(`(${KW[s.k].join(' OR ')}) when:2d`, s.hl, s.gl, s.ceid)), 'sweep:' + s.k); ok++; }
      catch (e) { fails.push(s.k + ': ' + (e.message || e)); }
      await new Promise(r => setTimeout(r, 1200));
    }
    const h = home(), c = byIso.get(h);
    if (c) {
      const lang = (c.hl || 'en').slice(0, 2), local = KW[lang];
      const qs = [];
      if (local && lang !== 'en') qs.push({ q: `"${c.native || c.name}" (${local.join(' OR ')} OR economía OR économie OR economia) when:4d`, hl: c.hl, gl: c.iso2, ceid: c.hl });
      qs.push({ q: `"${c.name}" (economy OR ${KW.en.join(' OR ')}) when:4d`, hl: 'en-US', gl: 'US', ceid: 'en' });
      for (const q of qs) { try { take(await Net.feed(GN(q.q, q.hl, q.gl, q.ceid)), 'home:' + h, h); } catch (e) { fails.push(h + ': ' + (e.message || e)); } }
    }
    for (const [k, i] of state.news) if (Date.now() - i.time > 5 * DAY) state.news.delete(k);
    computeNews();
    Object.assign(state.sources.news, ok ? { status: 'live', at: Date.now(), note: `${ok}/${SWEEPS.length} languages` } : { status: state.sources.news.at ? 'stale' : 'error', note: fails.join('; ').slice(0, 80) });
  }
  function computeNews() {
    const per = new Map();
    for (const i of state.news.values()) {
      if (Date.now() - i.time > 3 * DAY) continue;
      for (const c of i.countries) {
        const s = per.get(c) || { n: 0, crisis: 0, outlets: new Set(), last: 0 };
        s.n++; if (i.tag === 'crisis' || i.tag === 'imf') { s.crisis++; s.outlets.add(i.outlet || i.k); }
        s.last = Math.max(s.last, i.time);
        per.set(c, s);
      }
    }
    const level = new Map();
    for (const [iso, s] of per) level.set(iso, { level: s.outlets.size >= 3 ? 'stress' : s.crisis ? 'watch' : 'news', n: s.n, crisis: s.crisis, last: s.last });
    state.level = level;
  }
  const newsOf = iso => [...state.news.values()].filter(i => (!iso || iso === 'WLD' || i.countries.includes(iso)) && Date.now() - i.time < 4 * DAY).sort((a, b) => b.time - a.time);

  /* ── Reading, on a schedule ── */
  async function run(key, fn) {
    const s = state.sources[key];
    try { await fn(); if (key !== 'news') Object.assign(s, { status: 'live', at: Date.now(), note: '' }); }
    catch (e) { Object.assign(s, { status: s.at ? 'stale' : 'error', note: String(e.message || e).slice(0, 80) }); }
    sig = ''; save(); emit();
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    load();
    for (const [k, at] of [['markets', state.markets.at], ['rates', state.rates.at], ['weo', state.weo.at], ['fx', state.fx.at]]) if (at) Object.assign(state.sources[k], { status: 'live', at, note: 'kept' });
    setTimeout(() => run('markets', readMarkets), 2000);
    setTimeout(() => run('rates', () => readRates()), 5000);
    setTimeout(() => run('weo', () => readWEO()), 7000);
    setTimeout(() => run('fx', () => readFX()), 9000);
    setTimeout(() => run('news', readNews), 20000);
    setInterval(() => run('markets', readMarkets), 5 * MIN);
    setInterval(() => run('rates', () => readRates()), 2 * HOUR);
    setInterval(() => run('weo', () => readWEO()), 6 * HOUR);
    setInterval(() => run('fx', () => readFX()), HOUR);
    setInterval(() => run('news', readNews), 20 * MIN);
  }
  async function refresh() {
    await Promise.all([run('markets', readMarkets), run('rates', () => readRates(true)), run('weo', () => readWEO(true)), run('fx', () => readFX(true))]);
    await run('news', readNews);
  }

  /* ── Drawing ── */
  let sig = '', pick = null, rateSort = 'rate', fxFilter = 'weak', tableSort = 'size', tableQ = '', newsFilter = 'all';
  const shownIso = () => pick || home() || 'US';
  function spark(vals, W = 84, H = 22, cls = '') {
    const v = (vals || []).filter(Number.isFinite);
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), sx = i => i / (v.length - 1) * W, sy = x => H - 2 - (x - lo) / Math.max(1e-9, hi - lo) * (H - 4);
    return `<svg class="ec-spark ${cls || (v[v.length - 1] >= v[0] ? 'up' : 'down')}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${v.map((x, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(x).toFixed(1)}`).join('')}"/></svg>`;
  }
  // A step line of a policy rate over its last year.
  function rateSpark(pts) {
    if (!pts || !pts.length) return '';
    const t1 = Date.now(), t0 = t1 - 365 * DAY, W = 90, H = 22;
    const steps = pts.map(p => [Math.max(t0, Date.parse(p[0])), p[1]]);
    const vals = steps.map(s => s[1]), lo = Math.min(...vals), hi = Math.max(...vals);
    const sx = t => (t - t0) / (t1 - t0) * W, sy = v => hi === lo ? H / 2 : H - 3 - (v - lo) / (hi - lo) * (H - 6);
    let d = `M0,${sy(steps[0][1]).toFixed(1)}`;
    for (const [t, v] of steps.slice(1)) d += `H${sx(t).toFixed(1)}V${sy(v).toFixed(1)}`;
    d += `H${W}`;
    const cls = vals[vals.length - 1] > vals[0] ? 'up' : vals[vals.length - 1] < vals[0] ? 'down' : 'flat';
    return `<svg class="ec-spark rate ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function marketsStrip() {
    const list = state.markets.list;
    if (!list.length) return `<div class="ec-mk-empty">${esc(state.sources.markets.status === 'error' ? 'Markets not read: ' + state.sources.markets.note : 'Reading the markets…')}</div>`;
    return list.map(m => `<div class="ec-mk"><span>${esc(m.label)}</span><strong>${fmt(m.price, m.dp)}</strong>
      <small class="${m.chg > 0 ? 'up' : m.chg < 0 ? 'down' : ''}">${m.chg == null ? '' : sgn(m.chg, 2) + '%'} <i>day</i> · ${m.month == null ? '' : sgn(m.month, 1) + '%'} <i>month</i></small>${spark(m.closes, 120, 20)}</div>`).join('');
  }
  function ratesPanel() {
    const rows = Object.keys(state.rates.series).map(k => ({ k, r: rateOf(k === 'XM' ? 'DE' : k), name: k === 'XM' ? 'Euro area' : nameOf(k) })).filter(x => x.r);
    // Euro area: rateOf('DE') reads XM.
    rows.forEach(x => { if (x.k === 'XM') x.r.key = 'XM'; });
    const sorts = { rate: (a, b) => b.r.rate - a.r.rate, recent: (a, b) => (b.r.prevDate ? Date.parse(b.r.since) : 0) - (a.r.prevDate ? Date.parse(a.r.since) : 0), year: (a, b) => a.r.year - b.r.year, name: (a, b) => a.name.localeCompare(b.name) };
    rows.sort(sorts[rateSort]);
    const recent = rows.filter(x => x.r.prevDate && Date.now() - Date.parse(x.r.since) < 45 * DAY);
    const cuts = recent.filter(x => x.r.move < 0).length, hikes = recent.filter(x => x.r.move > 0).length;
    const show = shownIso(), showKey = EURO.has(show) ? 'XM' : show;
    const src = state.sources.rates;
    return `<section class="panel ec-rates">
      <header class="panel-head"><h2>Central bank policy rates</h2><span class="panel-meta">${esc(src.status === 'live' || state.rates.at ? `BIS · ${ago(state.rates.at)} · in 45 days: ${cuts} cut${cuts === 1 ? '' : 's'}, ${hikes} hike${hikes === 1 ? '' : 's'}` : src.status === 'waiting' ? 'reading…' : src.note)}</span></header>
      <div class="en-tools"><div class="chips">${[['rate', 'Highest rate'], ['recent', 'Latest decision'], ['year', 'Most cut in a year'], ['name', 'A–Z']].map(([k, l]) => `<button type="button" class="chip${rateSort === k ? ' on' : ''}" data-ecr="${k}">${l}</button>`).join('')}</div></div>
      <div class="work-list ec-rlist"><table class="grid"><colgroup><col><col style="width:62px"><col style="width:118px"><col style="width:62px"><col style="width:96px"></colgroup>
        <thead><tr><th>Central bank</th><th>Rate</th><th>Last change</th><th>12 mo</th><th>Last year</th></tr></thead><tbody>
        ${rows.length ? rows.map(({ k, r, name }) => `<tr data-ec="${k === 'XM' ? 'DE' : k}" class="${k === showKey ? 'on' : ''}"><td class="c-name">${esc(name)}<span>${esc(r.bank)}</span></td>
          <td class="num"><b>${fmt(r.rate, 2)}%</b></td>
          <td class="num ${r.move > 0 ? 't-crit' : r.move < 0 ? 't-ok' : ''}">${r.prevDate ? `${r.move > 0 ? '▲' : '▼'} ${sgn(r.move * 100, 0)} bp<small>${esc(r.since)}</small>` : '<span class="so-dim">no change</span>'}</td>
          <td class="num ${r.year > 0 ? 't-crit' : r.year < 0 ? 't-ok' : 'so-dim'}">${Math.abs(r.year) < 0.001 ? '0' : sgn(r.year, 2)}</td><td>${rateSpark(r.pts)}</td></tr>`).join('')
          : `<tr class="empty"><td colspan="5">${src.at ? 'No rates.' : 'Reading the BIS…'}</td></tr>`}
      </tbody></table></div>
    </section>`;
  }
  function countryPanel() {
    const iso = shownIso(), c = byIso.get(iso), h = home();
    const cur = CUR[iso], fx = cur ? fxOf(cur[0]) : null, r = rateOf(iso);
    const dollar = cur && cur[0] === 'USD' && iso !== 'US', euro = EURO.has(iso);
    const y = thisYear(), years = [y - 2, y - 1, y, y + 1];
    const L = state.level.get(iso), items = newsOf(iso).slice(0, 25);
    const opts = COUNTRIES.map(x => `<option value="${x.iso2}"${x.iso2 === iso ? ' selected' : ''}>${esc(x.name)}${x.iso2 === h ? ' (your country)' : ''}</option>`).join('');
    const rateLine = r ? `<b>${fmt(r.rate, 2)}%</b> · ${esc(r.bank || (euro ? 'European Central Bank' : ''))}${r.prevDate ? ` · last ${r.move > 0 ? 'raised' : 'cut'} ${sgn(r.move * 100, 0)} bp on ${esc(r.since)}` : ''}`
      : dollar ? `Uses the US dollar: no rate of its own; the Federal Reserve's is ${rateOf('US') ? fmt(rateOf('US').rate, 2) + '%' : '—'}`
      : 'Not in the BIS series (38 central banks)';
    return `<section class="panel ec-country">
      <header class="panel-head"><h2>${esc(nameOf(iso))}</h2><label class="cw-pick">Country <select id="ec-pick" aria-label="Country">${opts}</select></label></header>
      <div class="ec-cbody">
        <div class="ec-facts">
          <div><span>Policy rate</span><strong>${rateLine}</strong></div>
          <div><span>Currency</span><strong>${cur ? `${esc(cur[1])} (${esc(cur[0])})` : '—'}${fx && cur[0] !== 'USD' ? ` · ${fmt(fx.now, fx.now < 10 ? 4 : 2)} per US$` : ''}</strong>
            ${fx && cur[0] !== 'USD' ? `<small>against the dollar: <i class="${fx.w < 0 ? 'down' : 'up'}">${sgn(fx.w, 1)}% week</i> · <i class="${fx.m < 0 ? 'down' : 'up'}">${sgn(fx.m, 1)}% month</i> · <i class="${fx.y < 0 ? 'down' : 'up'}">${sgn(fx.y, 1)}% year</i></small>` : dollar ? '<small>dollarized: prices and wages are in US dollars</small>' : ''}</div>
          <div><span>Economic news · 72 h</span><strong class="${L && L.level === 'stress' ? 't-crit' : L && L.level === 'watch' ? 't-warn' : ''}">${L ? `${L.n} reports${L.crisis ? ` · ${L.crisis} on crisis, default, devaluation or the IMF` : ''}` : 'none'}</strong></div>
        </div>
        <table class="so-cmp ec-weo"><thead><tr><th>IMF World Economic Outlook</th>${years.map(yy => `<th>${yy}${yy >= y ? '<small>proj.</small>' : ''}</th>`).join('')}<th>World ${y}</th></tr></thead><tbody>
          ${WEO.map(([code, label, unit, d, lowerBetter]) => `<tr><td>${esc(label)}<small>${esc(unit)}</small></td>${years.map(yy => { const v = weo(code, iso, yy); return `<td>${v == null ? '—' : code === 'NGDPD' || code === 'NGDPDPC' ? fmt(v, 0) : fmt(v, d)}</td>`; }).join('')}
            <td class="so-dim">${(() => { const w = weo(code, 'WLD', y); return w == null ? '' : code === 'NGDPD' ? fmt(w / 1000, 1) + ' tn' : code === 'NGDPDPC' ? fmt(w, 0) : fmt(w, d); })()}</td></tr>`).join('')}
        </tbody></table>
        <span class="eyebrow">ECONOMIC NEWS</span>
        <ol class="inc-list news">${items.length ? items.map(i => `<li><time>${esc(ago(i.time))}</time><span><em class="ec-tag t-${i.tag}">${TAG_SAY[i.tag]}</em> <a href="${esc(i.link)}" target="_blank" rel="noreferrer noopener">${esc(i.headline)} ↗</a> <small>${esc(i.outlet)}</small></span></li>`).join('')
          : `<li class="map-hint">${state.sources.news.at ? 'Nothing in the last four days.' : 'Reading the news…'}</li>`}</ol>
      </div>
    </section>`;
  }
  function fxPanel() {
    const seen = new Map();
    for (const c of COUNTRIES) { const cur = CUR[c.iso2]; if (!cur || cur[0] === 'USD') continue; const a = seen.get(cur[0]) || { code: cur[0], name: cur[1], isos: [] }; a.isos.push(c.iso2); seen.set(cur[0], a); }
    let rows = [...seen.values()].map(a => ({ ...a, fx: fxOf(a.code) })).filter(a => a.fx && a.fx.m != null);
    rows = fxFilter === 'weak' ? rows.sort((a, b) => a.fx.m - b.fx.m) : fxFilter === 'strong' ? rows.sort((a, b) => b.fx.m - a.fx.m) : rows.sort((a, b) => (a.fx.y ?? 0) - (b.fx.y ?? 0));
    const show = shownIso();
    return `<section class="panel ec-fx">
      <header class="panel-head"><h2>Currencies against the dollar</h2><span class="panel-meta">${esc(state.fx.date ? `rates of ${state.fx.date}` : state.sources.fx.status === 'error' ? state.sources.fx.note : 'reading…')}</span></header>
      <div class="en-tools"><div class="chips">${[['weak', 'Weakest this month'], ['strong', 'Strongest this month'], ['year', 'Weakest this year']].map(([k, l]) => `<button type="button" class="chip${fxFilter === k ? ' on' : ''}" data-ecf="${k}">${l}</button>`).join('')}</div></div>
      <div class="work-list ec-flist"><table class="grid"><colgroup><col><col style="width:96px"><col style="width:64px"><col style="width:64px"><col style="width:64px"></colgroup>
        <thead><tr><th>Currency</th><th>Per US$</th><th>Week</th><th>Month</th><th>Year</th></tr></thead><tbody>
        ${rows.length ? rows.map(a => `<tr data-ec="${a.isos[0]}" class="${a.isos.includes(show) ? 'on' : ''}"><td class="c-name">${esc(a.name)} <small class="so-dim">${esc(a.code)}</small><span>${esc(a.isos.slice(0, 4).map(nameOf).join(', ') + (a.isos.length > 4 ? ` +${a.isos.length - 4}` : ''))}</span></td>
          <td class="num">${fmt(a.fx.now, a.fx.now < 10 ? 4 : 2)}</td>${['w', 'm', 'y'].map(k => `<td class="num ${a.fx[k] <= -5 ? 't-crit' : a.fx[k] < 0 ? 'down' : a.fx[k] > 0 ? 'up' : ''}">${a.fx[k] == null ? '—' : sgn(a.fx[k], 1)}</td>`).join('')}</tr>`).join('')
          : `<tr class="empty"><td colspan="5">${state.fx.at ? 'No rates.' : 'Reading…'}</td></tr>`}
      </tbody></table></div>
    </section>`;
  }
  function newsPanel() {
    const list = newsOf(null).filter(i => newsFilter === 'all' || i.tag === newsFilter).slice(0, 150);
    const lv = [...state.level].filter(([, L]) => L.level !== 'news').sort((a, b) => b[1].crisis - a[1].crisis || b[1].n - a[1].n).slice(0, 14);
    const src = state.sources.news;
    return `<section class="panel ec-news">
      <header class="panel-head"><h2>Economic stress · news</h2><span class="panel-meta">${esc(src.status === 'live' ? 'sweep ' + ago(src.at) + ' · ' + src.note : src.status === 'waiting' ? 'first sweep…' : src.note)}</span></header>
      <div class="ec-hot">${lv.length ? lv.map(([iso, L]) => `<button type="button" class="chip ${L.level === 'stress' ? 'lvl-red on' : 'lvl-orange on'}" data-ec="${iso}">${esc(nameOf(iso))} <b>${L.crisis}</b></button>`).join('') : '<span class="so-dim">No country with crisis, default, devaluation or IMF reports in 72 hours.</span>'}</div>
      <div class="en-tools"><div class="chips">${[['all', 'All'], ['crisis', 'Crisis'], ['imf', 'IMF rescue'], ['recession', 'Recession'], ['rates', 'Rates'], ['inflation', 'Inflation'], ['outlook', 'Outlook']].map(([k, l]) => `<button type="button" class="chip${newsFilter === k ? ' on' : ''}" data-ecn="${k}">${l}</button>`).join('')}</div></div>
      <ol class="inc-list news ec-nlist">${list.length ? list.map(i => `<li><time>${esc(ago(i.time))}</time><span><em class="ec-tag t-${i.tag}">${TAG_SAY[i.tag]}</em> <a href="${esc(i.link)}" target="_blank" rel="noreferrer noopener">${esc(i.headline)} ↗</a> <small>${esc([i.outlet, i.countries.map(nameOf).join(', ')].filter(Boolean).join(' · '))}</small></span></li>`).join('')
        : '<li class="map-hint">Nothing yet.</li>'}</ol>
    </section>`;
  }
  function tablePanel() {
    const y = thisYear(), h = home(), show = shownIso(), q = tableQ.trim().toLowerCase();
    const rows = COUNTRIES.map(c => {
      const cur = CUR[c.iso2], fx = cur && cur[0] !== 'USD' ? fxOf(cur[0]) : null, r = rateOf(c.iso2);
      return { c, gdp: weo('NGDP_RPCH', c.iso2, y), inf: weo('PCPIPCH', c.iso2, y), un: weoLatest('LUR', c.iso2)[0], debt: weoLatest('GGXWDG_NGDP', c.iso2)[0],
        fis: weoLatest('GGXCNL_NGDP', c.iso2)[0], size: weo('NGDPD', c.iso2, y), rate: r ? r.rate : null, fx: fx ? fx.y : null, L: state.level.get(c.iso2) };
    }).filter(x => (x.gdp != null || x.inf != null) && (!q || x.c.name.toLowerCase().includes(q)));
    const desc = k => (a, b) => (b[k] ?? -1e9) - (a[k] ?? -1e9);
    const sorts = { gdp: desc('gdp'), inf: desc('inf'), un: desc('un'), debt: desc('debt'), fis: (a, b) => (a.fis ?? 1e9) - (b.fis ?? 1e9), size: desc('size'), rate: desc('rate'), fx: (a, b) => (a.fx ?? 1e9) - (b.fx ?? 1e9), news: (a, b) => ((b.L && b.L.crisis) || 0) - ((a.L && a.L.crisis) || 0), name: (a, b) => a.c.name.localeCompare(b.c.name) };
    rows.sort(sorts[tableSort]);
    const th = (k, l) => `<th data-ecs="${k}" class="${tableSort === k ? 'sorted' : ''}">${l}</th>`;
    const tone = (v, bad, worse, low) => v == null ? 'so-dim' : low ? (v <= worse ? 't-crit' : v <= bad ? 't-warn' : '') : (v >= worse ? 't-crit' : v >= bad ? 't-warn' : '');
    return `<section class="panel ec-table">
      <header class="panel-head"><h2>Every economy · ${y}</h2><span class="panel-meta">IMF WEO${state.weo.at ? ' · ' + ago(state.weo.at) : ''} · growth and inflation are IMF projections for ${y}</span>
        <input id="ec-q" class="control search" type="search" placeholder="Find a country" value="${esc(tableQ)}" aria-label="Find a country"></header>
      <div class="work-list ec-tlist"><table class="grid"><thead><tr><th></th>${th('name', 'Country')}${th('size', 'GDP, US$ bn')}${th('gdp', 'Growth %')}${th('inf', 'Inflation %')}${th('un', 'Unemployment %')}${th('debt', 'Debt % GDP')}${th('fis', 'Fiscal bal. %')}${th('rate', 'Policy rate')}${th('fx', 'Currency, year')}${th('news', 'Crisis news')}</tr></thead><tbody>
        ${rows.length ? rows.map(x => `<tr data-ec="${x.c.iso2}" class="${x.c.iso2 === show ? 'on' : ''}"><td class="c-glyph">${x.c.iso2 === h ? '⌂' : ''}</td><td>${esc(x.c.name)}</td>
          <td class="num">${x.size == null ? '—' : fmt(x.size, 0)}</td><td class="num ${tone(x.gdp, 0.5, 0, true)}">${x.gdp == null ? '—' : fmt(x.gdp, 1)}</td><td class="num ${tone(x.inf, 8, 20)}">${x.inf == null ? '—' : fmt(x.inf, 1)}</td>
          <td class="num ${tone(x.un, 10, 20)}">${x.un == null ? '—' : fmt(x.un, 1)}</td><td class="num ${tone(x.debt, 90, 120)}">${x.debt == null ? '—' : fmt(x.debt, 0)}</td><td class="num ${tone(x.fis, -5, -8, true)}">${x.fis == null ? '—' : fmt(x.fis, 1)}</td>
          <td class="num">${x.rate == null ? (CUR[x.c.iso2] && CUR[x.c.iso2][0] === 'USD' && x.c.iso2 !== 'US' ? '<span class="so-dim">US$</span>' : '—') : fmt(x.rate, 2)}</td>
          <td class="num ${x.fx == null ? 'so-dim' : x.fx <= -15 ? 't-crit' : x.fx <= -5 ? 't-warn' : ''}">${x.fx == null ? '—' : sgn(x.fx, 1) + '%'}</td>
          <td class="num ${x.L && x.L.level === 'stress' ? 't-crit' : x.L && x.L.crisis ? 't-warn' : 'so-dim'}">${x.L && x.L.crisis ? x.L.crisis : '—'}</td></tr>`).join('')
          : `<tr class="empty"><td colspan="11">${state.weo.at ? 'Nothing matches.' : 'Reading the IMF…'}</td></tr>`}
      </tbody></table></div>
    </section>`;
  }

  function paint() {
    const host = $('economy-body');
    if (!host) return;
    const s = JSON.stringify([shownIso(), home(), rateSort, fxFilter, tableSort, tableQ, newsFilter, Object.values(state.sources).map(x => x.status + x.at), state.news.size, Math.floor(Date.now() / (5 * MIN))]);
    if (s === sig) return;
    sig = s;
    const focus = document.activeElement && document.activeElement.id, caret = focus && document.activeElement.selectionStart;
    const scrolls = [...host.querySelectorAll('.work-list, .ec-cbody, .ec-nlist')].map(n => n.scrollTop);
    const k = $('economy-markets');
    if (k) k.innerHTML = marketsStrip();
    host.innerHTML = `<div class="ec-row1">${ratesPanel()}${countryPanel()}</div><div class="ec-row2">${fxPanel()}${newsPanel()}</div>${tablePanel()}`;
    [...host.querySelectorAll('.work-list, .ec-cbody, .ec-nlist')].forEach((n, i) => { if (scrolls[i]) n.scrollTop = scrolls[i]; });
    if (focus && $(focus)) { const n = $(focus); n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* not text */ } }
    const srcs = $('economy-sources');
    if (srcs) { const all = Object.values(state.sources); srcs.textContent = `${all.filter(x => x.status === 'live').length}/${all.length} sources live`; }
  }
  function wire() {
    document.addEventListener('click', e => {
      if (!e.target.closest('#view-economy')) return;
      const f = (attr, set) => { const b = e.target.closest(`[data-${attr}]`); if (b) { set(b.dataset[attr.replace(/-(\w)/g, (m, c) => c.toUpperCase())]); sig = ''; paint(); return true; } return false; };
      if (f('ecr', v => { rateSort = v; }) || f('ecf', v => { fxFilter = v; }) || f('ecs', v => { tableSort = v; }) || f('ecn', v => { newsFilter = v; })) return;
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-ec]');
      if (row) { pick = row.dataset.ec === home() ? null : row.dataset.ec; sig = ''; paint(); const b = document.querySelector('.ec-cbody'); if (b) b.scrollTop = 0; }
    });
    document.addEventListener('change', e => { if (e.target.id === 'ec-pick') { pick = e.target.value === home() ? null : e.target.value; sig = ''; paint(); } });
    document.addEventListener('input', e => { if (e.target.id === 'ec-q') { tableQ = e.target.value; sig = ''; paint(); } });
    onUpdate(() => {
      const n = [...state.level.values()].filter(x => x.level === 'stress').length, b = $('tab-count-economy');
      if (b) b.textContent = n ? String(n) : '';
      if (typeof Views !== 'undefined' && Views.current === 'economy') paint();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  return { state, start, paint, refresh, onUpdate, rateOf, fxOf, weo };
})();
