'use strict';
/* ── Society ───────────────────────────────────────────────────────────────
   People: how many, how they live, how they vote, where they take to the
   street. Four readings, each from the body that keeps it:

     Population, demography   World Bank World Development Indicators (the
                              population series are the UN World Population
                              Prospects); the live count runs from the latest
                              mid-year estimate at the latest birth and death
                              rates, so it is an estimate, ticking
     Social indicators        UN Statistics Division, the global SDG
                              database (unstats.un.org/sdgapi), the official
                              series for each Sustainable Development Goal
     Elections                Wikipedia's national electoral calendars for
                              this year and next, dated and linked
     Protest and unrest       a news sweep (Google News, five languages,
                              every 20 minutes), each headline placed in the
                              country it names; your country read on its own

   What is read is kept on this computer, so the page opens complete.       */

const Society = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000, YEAR = 365.2425 * DAY;
  const COUNTRIES = typeof CountryData !== 'undefined' ? CountryData : [];
  const byIso = new Map(COUNTRIES.map(c => [c.iso2, c]));
  const byIso3 = new Map(COUNTRIES.map(c => [c.iso3, c]));
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const fmt = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const big = n => !Number.isFinite(n) ? '—' : n >= 1e9 ? fmt(n / 1e9, 2) + ' bn' : n >= 1e6 ? fmt(n / 1e6, n >= 1e8 ? 0 : 1) + ' m' : n >= 1e3 ? fmt(n / 1e3, 0) + ' k' : fmtInt(n);
  const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  const midYear = y => Date.UTC(+y, 6, 1);

  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  const state = {
    wb: {},          // iso3 → { at, v: { indicator: [value, year] } }
    pyr: {},         // iso3 → { at, bands: [[label, male%, female%]] }
    sdg: {},         // iso2|'WLD' → { at, s: { series: { v, y, base, baseY, pts:[[y,v]] } } }
    table: { at: 0, rows: {} },   // iso3 → { pop:[v,y], grow, tfr, le, urb }
    elections: { at: 0, list: [] },
    unrest: new Map(),            // normalised headline → item
    level: new Map(),             // iso2 → { level, n, violent, last }
    sources: {
      people: { label: 'Population · World Bank / UN WPP', status: 'waiting', at: null, note: '' },
      nations: { label: 'Every country · World Bank', status: 'waiting', at: null, note: '' },
      sdg: { label: 'Social indicators · UN Statistics Division', status: 'waiting', at: null, note: '' },
      elections: { label: 'Elections · Wikipedia calendars', status: 'waiting', at: null, note: '' },
      unrest: { label: 'Protest and unrest · news sweep', status: 'waiting', at: null, note: '' }
    }
  };

  /* ── Keeping what was read ── */
  const STORE = 'temporal-live:society';
  function save() {
    try {
      const items = [...state.unrest.values()].sort((a, b) => b.time - a.time).slice(0, 700);
      localStorage.setItem(STORE, JSON.stringify({ wb: state.wb, pyr: state.pyr, sdg: state.sdg, table: state.table, elections: state.elections, items }));
    } catch { /* full or refused: the next read fills it */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (!d) return;
      Object.assign(state.wb, d.wb || {}); Object.assign(state.pyr, d.pyr || {}); Object.assign(state.sdg, d.sdg || {});
      if (d.table) state.table = d.table;
      if (d.elections) state.elections = d.elections;
      for (const i of d.items || []) if (Date.now() - i.time < 4 * DAY) state.unrest.set(i.k, i);
      computeUnrest();
    } catch { /* nothing kept */ }
  }

  /* ── The country being looked at: yours, unless another is picked ── */
  let pick = null;                         // iso2 picked on this page, or 'WLD'
  const home = () => (typeof Watch !== 'undefined' && Watch.homeIso && Watch.homeIso()) || '';
  const shownIso = () => pick || home() || 'WLD';
  const iso3Of = iso => iso === 'WLD' ? 'WLD' : (byIso.get(iso) || {}).iso3;
  const nameOf = iso => iso === 'WLD' ? 'World' : (byIso.get(iso) || {}).name || iso;

  /* ── World Bank ── */
  const WB = 'https://api.worldbank.org/v2';
  const IND = [
    ['SP.POP.TOTL', 'Population'], ['SP.POP.GROW', 'Growth'], ['SP.DYN.CBRT.IN', 'Births'], ['SP.DYN.CDRT.IN', 'Deaths'],
    ['SP.DYN.TFRT.IN', 'Fertility'], ['SP.DYN.LE00.IN', 'Life expectancy'], ['SP.POP.0014.TO.ZS', 'Under 15'], ['SP.POP.65UP.TO.ZS', '65 and over'],
    ['SP.URB.TOTL.IN.ZS', 'Urban'], ['SH.DYN.MORT', 'Under-5 mortality'], ['SL.UEM.TOTL.ZS', 'Unemployment'], ['SI.POV.GINI', 'Gini'],
    ['NY.GDP.PCAP.PP.CD', 'GDP per person'], ['SI.POV.DDAY', 'Extreme poverty'], ['IT.NET.USER.ZS', 'Internet'], ['VC.IHR.PSRC.P5', 'Homicide'],
    ['SP.POP.TOTL.MA.ZS', 'Male share']
  ];
  /* One indicator at a time: the API's several-at-once form (A;B) is refused
     to the app's network stack, though not to a terminal. Six at once. */
  async function wbOne(where, code, perPage = 5) {
    const d = await Net.json(`${WB}/country/${where}/indicator/${code}?format=json&per_page=${perPage}&mrnev=1`);
    if (!Array.isArray(d) || !Array.isArray(d[1])) throw new Error('World Bank: no data for ' + code);
    return d[1];
  }
  async function pool(jobs, n = 6) {
    const out = new Array(jobs.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (i < jobs.length) { const k = i++; try { out[k] = await jobs[k](); } catch (e) { out[k] = e; } }
    }));
    return out;
  }
  async function readWB(iso3, force) {
    const have = state.wb[iso3];
    if (!force && have && Date.now() - have.at < DAY) return have;
    const res = await pool(IND.map(([code]) => () => wbOne(iso3, code)));
    const v = {};
    res.forEach((rows, k) => { const r = Array.isArray(rows) && rows.find(x => x && x.value != null); if (r) v[IND[k][0]] = [r.value, +r.date]; });
    if (!Object.keys(v).length) throw res.find(x => x instanceof Error) || new Error('World Bank: no data');
    state.wb[iso3] = { at: Date.now(), v };
    return state.wb[iso3];
  }
  const AGES = ['0004', '0509', '1014', '1519', '2024', '2529', '3034', '3539', '4044', '4549', '5054', '5559', '6064', '6569', '7074', '7579', '80UP'];
  async function readPyramid(iso3) {
    const have = state.pyr[iso3];
    if (have && Date.now() - have.at < 7 * DAY) return have;
    const codes = AGES.flatMap(a => [`SP.POP.${a}.MA.5Y`, `SP.POP.${a}.FE.5Y`]);
    const res = await pool(codes.map(code => () => wbOne(iso3, code)));
    const m = {};
    let year = 0;
    res.forEach((rows, k) => { const r = Array.isArray(rows) && rows.find(x => x && x.value != null); if (r) { m[codes[k]] = r.value; year = Math.max(year, +r.date); } });
    if (!Object.keys(m).length) throw new Error('World Bank: no age data');
    const bands = AGES.map(a => [a === '80UP' ? '80+' : `${+a.slice(0, 2)}–${+a.slice(2)}`, m[`SP.POP.${a}.MA.5Y`], m[`SP.POP.${a}.FE.5Y`]]);
    state.pyr[iso3] = { at: Date.now(), bands, year };
    return state.pyr[iso3];
  }
  async function readTable(force) {
    if (!force && Date.now() - state.table.at < DAY && Object.keys(state.table.rows).length) return;
    const key = { 'SP.POP.TOTL': 'pop', 'SP.POP.GROW': 'grow', 'SP.DYN.TFRT.IN': 'tfr', 'SP.DYN.LE00.IN': 'le', 'SP.URB.TOTL.IN.ZS': 'urb', 'SP.POP.65UP.TO.ZS': 'old' };
    const codes = Object.keys(key);
    const res = await pool(codes.map(code => () => wbOne('all', code, 400)), 3);
    const rows = {};
    res.forEach((list, k) => {
      if (!Array.isArray(list)) return;
      for (const r of list) {
        if (!r || r.value == null || !byIso3.has(r.countryiso3code)) continue;
        (rows[r.countryiso3code] = rows[r.countryiso3code] || {})[key[codes[k]]] = [r.value, +r.date];
      }
    });
    if (!Object.keys(rows).length) throw res.find(x => x instanceof Error) || new Error('World Bank: no table');
    state.table = { at: Date.now(), rows };
  }

  /* The population now: the latest mid-year count carried forward. The world
     at its birth and death rates (migration nets to zero); a country at its
     growth rate, which includes migration. */
  function worldRates() {
    const w = state.wb.WLD && state.wb.WLD.v;
    if (!w || !w['SP.POP.TOTL']) return null;
    const [p0, y0] = w['SP.POP.TOTL'];
    const cbr = (w['SP.DYN.CBRT.IN'] || [16.3])[0], cdr = (w['SP.DYN.CDRT.IN'] || [7.6])[0];
    const birthsPerMs = p0 * cbr / 1000 / YEAR, deathsPerMs = p0 * cdr / 1000 / YEAR;
    return { p0, t0: midYear(y0), y0, birthsPerMs, deathsPerMs, cbr, cdr };
  }
  function worldNow(t = Date.now()) {
    const r = worldRates();
    return r ? r.p0 + (r.birthsPerMs - r.deathsPerMs) * (t - r.t0) : null;
  }
  function countryNow(iso3, t = Date.now()) {
    if (iso3 === 'WLD') return worldNow(t);
    const v = (state.wb[iso3] && state.wb[iso3].v) || {}, row = state.table.rows[iso3] || {};
    const pop = v['SP.POP.TOTL'] || row.pop, g = (v['SP.POP.GROW'] || row.grow || [0])[0];
    if (!pop) return null;
    return pop[0] * Math.pow(1 + g / 100, (t - midYear(pop[1])) / YEAR);
  }

  /* ── UN Statistics Division: the SDG database ── */
  const SDG = [
    // series, label, unit, lower is better
    ['SI_POV_DAY1', 'Below the international poverty line', '%', true],
    ['SN_ITK_DEFC', 'Undernourished', '%', true],
    ['SH_DYN_MORT', 'Under-5 mortality', 'per 1,000 births', true],
    ['SH_STA_MORT', 'Maternal mortality', 'per 100,000 births', true],
    ['VC_IHR_PSRC', 'Homicide', 'per 100,000', true],
    ['SM_POP_REFG_OR', 'Refugees from the country', 'per 100,000', true],
    ['EG_ACS_ELEC', 'Access to electricity', '%', false],
    ['SH_H2O_SAFE', 'Safe drinking water', '%', false],
    ['IT_USE_ii99', 'Using the internet', '%', false],
    ['SG_GEN_PARL', 'Women in parliament', '% of seats', false]
  ];
  // The headline breakdown of each series: both sexes, all ages, all areas.
  const PREFER = { Sex: ['BOTHSEX', 'FEMALE'], Age: ['ALLAGE', '<5Y', '15+'], Location: ['ALLAREA'], 'Education level': ['PRIMAR'], Quantile: ['_T'], 'Reporting Type': ['G', 'N'] };
  function rank(r) {
    let s = 0;
    for (const [k, v] of Object.entries(r.dimensions || {})) {
      const p = PREFER[k];
      if (!p) continue;
      const i = p.indexOf(v);
      if (i < 0) return -1;
      s += i;
    }
    return s;
  }
  async function readSDG(iso) {
    const have = state.sdg[iso];
    if (have && Date.now() - have.at < 3 * DAY) return have;
    const area = iso === 'WLD' ? '1' : String(+(byIso.get(iso) || {}).num || '');
    if (!area) throw new Error('no M49 code');
    const url = 'https://unstats.un.org/sdgapi/v1/sdg/Series/Data?' + SDG.map(s => 'seriesCode=' + s[0]).join('&') + `&areaCode=${area}&pageSize=6000`;
    const d = await Net.json(url);
    if (!d || !Array.isArray(d.data)) throw new Error('UNSD: no data');
    const best = {};
    for (const r of d.data) {
      const v = parseFloat(String(r.value).replace(/[<>]/g, ''));
      if (!Number.isFinite(v)) continue;
      const k = rank(r);
      if (k < 0) continue;
      const b = best[r.series] || (best[r.series] = { k, pts: new Map() });
      if (k < b.k) { b.k = k; b.pts = new Map(); }
      if (k === b.k) b.pts.set(Math.round(r.timePeriodStart), v);
    }
    const s = {};
    for (const [code, b] of Object.entries(best)) {
      const pts = [...b.pts].sort((a, c) => a[0] - c[0]);
      if (!pts.length) continue;
      const last = pts[pts.length - 1], base = pts.find(p => p[0] >= 2015) || pts[0];
      s[code] = { v: last[1], y: last[0], base: base[1], baseY: base[0], pts: pts.slice(-26) };
    }
    state.sdg[iso] = { at: Date.now(), s };
    return state.sdg[iso];
  }

  /* ── Elections: Wikipedia's national electoral calendars ── */
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function countryIso(name) {
    const n = String(name || '').toLowerCase().trim();
    for (const c of COUNTRIES) if (c.name.toLowerCase() === n || c.names.some(x => x.toLowerCase() === n)) return c.iso2;
    if (typeof Watch !== 'undefined' && Watch.place) { const p = Watch.place(name); if (p.length === 1) return p[0]; }
    return '';
  }
  function parseCalendar(html, year) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('sup, .mw-editsection, style').forEach(n => n.remove());
    const out = [];
    let month = -1;
    const root = doc.querySelector('.mw-parser-output') || doc.body;
    for (const node of root.children) {
      const h = node.matches('h2') ? node : node.querySelector('h2');
      if (h) { const m = MONTHS.indexOf(h.textContent.trim().toLowerCase()); month = m; continue; }
      if (month < 0 || node.tagName !== 'UL') continue;
      for (const li of node.children) {
        const own = [...li.childNodes].filter(x => !(x.nodeType === 1 && x.tagName === 'UL'));
        const head = own.map(x => x.textContent).join('').trim();
        const dm = head.match(/^(\d{1,2})(?:\s*[–-]\s*\d{1,2})?(?:\s+([A-Za-z]+))?/);
        if (!dm) continue;
        const mi = dm[2] && MONTHS.indexOf(dm[2].toLowerCase()) >= 0 ? MONTHS.indexOf(dm[2].toLowerCase()) : month;
        const date = Date.UTC(year, mi, +dm[1]);
        const dateText = head.split(':')[0].trim();
        const entries = li.querySelector('ul') ? [...li.querySelector('ul').children] : [li];
        for (const e of entries) {
          const links = [...e.querySelectorAll(':scope > a')];
          const text = e === li ? head.slice(head.indexOf(':') + 1).trim() : [...e.childNodes].filter(x => !(x.nodeType === 1 && x.tagName === 'UL')).map(x => x.textContent).join('').trim();
          const country = links[0] ? links[0].textContent.trim() : text.split(',')[0].trim();
          const what = text.slice(text.indexOf(',') + 1).trim();
          const art = links.slice(1).find(a => /election|referendum|vote|plebiscite/i.test(a.getAttribute('href') || '')) || links[1] || links[0];
          const title = art ? decodeURIComponent((art.getAttribute('href') || '').replace(/^\/wiki\//, '')) : '';
          if (!country) continue;
          out.push({ date, dateText, country, iso: countryIso(country), what, title, link: title ? 'https://en.wikipedia.org/wiki/' + title : '' });
        }
      }
    }
    return out;
  }
  async function readElections(force) {
    if (!force && Date.now() - state.elections.at < 6 * HOUR && state.elections.list.length) return;
    const y = new Date().getUTCFullYear();
    const years = [y, y + 1];
    if (new Date().getUTCMonth() < 2) years.unshift(y - 1);
    const lists = await Promise.allSettled(years.map(async yr => {
      const d = await Net.json(`https://en.wikipedia.org/w/api.php?action=parse&page=${yr}_national_electoral_calendar&prop=text&format=json&formatversion=2&origin=*`);
      if (!d || !d.parse) throw new Error('no calendar for ' + yr);
      return parseCalendar(d.parse.text, yr);
    }));
    const list = lists.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    if (!list.length) throw lists[0].reason || new Error('no calendar');
    state.elections = { at: Date.now(), list: list.sort((a, b) => a.date - b.date) };
  }
  const summaries = new Map();
  async function summary(title) {
    if (summaries.has(title)) return summaries.get(title);
    const d = await Net.json('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
    const s = d && d.extract ? d.extract : '';
    summaries.set(title, s);
    return s;
  }

  /* ── Protest and unrest ── */
  const GN = (q, hl, gl, ceid) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${ceid}`;
  const KW = {
    en: ['protest', 'protests', 'protesters', 'demonstrators', 'riot', 'riots', 'unrest', '"tear gas"', '"general strike"', '"national strike"', 'curfew', 'coup'],
    es: ['protestas', 'manifestantes', 'disturbios', '"paro nacional"', '"huelga general"', 'enfrentamientos', '"gases lacrimógenos"', '"toque de queda"', 'saqueos', 'movilizaciones'],
    pt: ['protestos', 'manifestantes', 'tumultos', '"greve geral"', 'confrontos', '"gás lacrimogêneo"', 'paralisação'],
    fr: ['manifestation', 'manifestants', 'émeutes', '"grève générale"', 'affrontements', '"gaz lacrymogène"', '"couvre-feu"'],
    ar: ['احتجاجات', 'مظاهرات', 'متظاهرين', 'اشتباكات', 'أعمال شغب', 'إضراب عام']
  };
  const SWEEPS = [
    { k: 'en', hl: 'en-US', gl: 'US', ceid: 'en' }, { k: 'es', hl: 'es-419', gl: 'US', ceid: 'es-419' },
    { k: 'pt', hl: 'pt-BR', gl: 'BR', ceid: 'pt-419' }, { k: 'fr', hl: 'fr', gl: 'FR', ceid: 'fr' }, { k: 'ar', hl: 'ar', gl: 'EG', ceid: 'ar' }
  ];
  const ABOUT = /protest|demonstrat|riot|unrest|tear gas|general strike|national strike|nationwide strike|curfew|\bcoup\b|crackdown|march(?:ed|es)? (?:on|through|against)|rall(?:y|ies) against|protesta|manifesta|disturbio|paro nacional|huelga|enfrentamiento|lacrim[oó]gen|toque de queda|saqueo|moviliza|protesto|tumulto|greve|confronto|paralisa|manifestation|manifestant|[ée]meute|gr[eè]ve|affrontement|couvre-feu|احتجاج|مظاهر|متظاهر|اشتباك|شغب|إضراب/i;
  const VIOLENT = /\briot|rioting|tear gas|clash(?:es|ed)? with (?:police|security|troops|protesters)|police clash|killed|dead\b|deaths?\b|shot\b|looting|set (?:on )?fire|torched|violent|violence|curfew|crackdown|state of emergency|\bcoup\b|disturbio|enfrentamiento|lacrim[oó]gen|muert[oa]s|heridos|saqueo|toque de queda|represi[oó]n|golpe de estado|tumulto|confronto|mortos|feridos|saque|[ée]meute|affrontement|violences|morts|bless[ée]s|couvre-feu|اشتباك|شغب|قتلى|قتيل|جرحى/i;
  const STRIKE = /general strike|national strike|nationwide strike|walk ?out|paro nacional|huelga|greve|gr[eè]ve|paralisa|إضراب/i;
  const COUP = /\bcoup\b|golpe de estado|coup d['’][ée]tat|military takeover|junta seize/i;
  // Not unrest: games and festivals named Riot, protest votes and sport.
  const NOT = /riot games|riot fest|riot grrrl|protest vote|under protest|protest song|league of legends|valorant|\bfc\b|football|soccer|premier league|\bnba\b|\bnfl\b|tennis|cricket|world cup|airstrike|hunger games|\bfilm\b|movie|album|concert|anniversary of the|f[uú]tbol|futebol|liga ?pro|laliga|champions|copa |\bgol(?:es)?\b|golea|hinchas|barras? bravas?|torcida|estadio|est[aá]dio|\bstade\b|anfield|\bpartido de\b|\bmatch\b|derbi|cl[aá]sico/i;
  const TLD = iso => iso === 'GB' ? 'uk' : iso.toLowerCase();
  const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  function split(raw) {
    const i = raw.lastIndexOf(' - ');
    return i > 20 ? { headline: raw.slice(0, i).trim(), outlet: raw.slice(i + 3).trim() } : { headline: raw.trim(), outlet: '' };
  }
  const place = t => (typeof Watch !== 'undefined' && Watch.place) ? Watch.place(t) : [];
  function take(items, via, iso) {
    let added = 0;
    for (const it of items) {
      if (!it.time || Date.now() - it.time > 3 * DAY) continue;
      const { headline, outlet } = split(it.title);
      if (!ABOUT.test(headline) || NOT.test(headline)) continue;
      let countries = place(headline);
      // A search for one country: its own press may leave the name out, but
      // a headline naming only other countries is about them.
      if (iso && !countries.length && via.startsWith('home') && hostOf(it.source).endsWith('.' + TLD(iso))) countries = [iso];
      if (!countries.length || countries.length > 3) continue;
      const k = norm(headline);
      const prev = state.unrest.get(k);
      if (prev) { prev.countries = [...new Set([...prev.countries, ...countries])]; continue; }
      state.unrest.set(k, { k, headline, outlet, link: it.link, time: it.time, via, countries,
        violent: VIOLENT.test(headline), strike: STRIKE.test(headline), coup: COUP.test(headline) });
      added++;
    }
    return added;
  }
  const LEVELS = ['quiet', 'reports', 'protests', 'unrest'];
  const LEVEL_SAY = { quiet: 'Quiet', reports: 'Reports', protests: 'Protests', unrest: 'Unrest' };
  const tone = l => l === 'unrest' ? 'crit' : l === 'protests' ? 'warn' : l === 'reports' ? 'amber' : 'ok';
  function computeUnrest() {
    const now = Date.now(), per = new Map();
    for (const i of state.unrest.values()) {
      if (now - i.time > 2 * DAY) continue;
      for (const c of i.countries) {
        const s = per.get(c) || { n: 0, violent: 0, strike: 0, coup: 0, outlets: new Set(), vOutlets: new Set(), last: 0 };
        s.n++; s.outlets.add(i.outlet || i.k);
        if (i.violent) { s.violent++; s.vOutlets.add(i.outlet || i.k); }
        if (i.strike) s.strike++;
        if (i.coup) s.coup++;
        s.last = Math.max(s.last, i.time);
        per.set(c, s);
      }
    }
    const level = new Map();
    for (const [iso, s] of per) {
      const l = s.coup >= 2 || s.vOutlets.size >= 3 ? 'unrest' : s.outlets.size >= 3 || s.vOutlets.size >= 2 ? 'protests' : 'reports';
      level.set(iso, { level: l, n: s.n, violent: s.violent, strike: s.strike, coup: s.coup, last: s.last });
    }
    state.level = level;
  }
  const itemsOf = iso => [...state.unrest.values()].filter(i => (!iso || i.countries.includes(iso)) && Date.now() - i.time < 3 * DAY).sort((a, b) => b.time - a.time);
  async function readUnrest() {
    let ok = 0;
    const fails = [];
    for (const s of SWEEPS) {
      try { take(await Net.feed(GN(`(${KW[s.k].join(' OR ')}) when:2d`, s.hl, s.gl, s.ceid)), 'sweep:' + s.k); ok++; }
      catch (e) { fails.push(s.k + ': ' + (e.message || e)); }
      await new Promise(r => setTimeout(r, 1200));
    }
    // Your country on its own, in its language and in English.
    const h = home(), c = byIso.get(h);
    if (c) {
      const lang = (c.hl || 'en').slice(0, 2), local = KW[lang];
      const qs = [];
      if (local && lang !== 'en') qs.push({ q: `"${c.native || c.name}" (${local.join(' OR ')}) when:3d`, hl: c.hl, gl: c.iso2, ceid: c.hl });
      qs.push({ q: `"${c.name}" (${KW.en.join(' OR ')}) when:3d`, hl: 'en-US', gl: 'US', ceid: 'en' });
      for (const q of qs) { try { take(await Net.feed(GN(q.q, q.hl, q.gl, q.ceid)), 'home:' + h, h); } catch (e) { fails.push(h + ': ' + (e.message || e)); } }
    }
    for (const [k, i] of state.unrest) if (Date.now() - i.time > 4 * DAY) state.unrest.delete(k);
    computeUnrest();
    Object.assign(state.sources.unrest, ok ? { status: 'live', at: Date.now(), note: `${ok}/${SWEEPS.length} languages` } : { status: 'error', note: fails.join('; ').slice(0, 80) });
  }

  /* ── Reading, on a schedule ── */
  async function run(key, fn) {
    const s = state.sources[key];
    try { await fn(); Object.assign(s, { status: 'live', at: Date.now(), note: s.note && key === 'unrest' ? s.note : '' }); }
    catch (e) { Object.assign(s, { status: s.at ? 'stale' : 'error', note: String(e.message || e).slice(0, 80) }); }
    save(); emit();
  }
  const readPeople = () => run('people', async () => { await readWB('WLD'); const iso3 = iso3Of(shownIso()); if (iso3 && iso3 !== 'WLD') await readWB(iso3); await readPyramid(iso3 || 'WLD'); if (iso3 !== 'WLD') await readPyramid('WLD'); });
  const readNations = () => run('nations', () => readTable());
  const readSdgs = () => run('sdg', async () => { await readSDG('WLD'); const iso = shownIso(); if (iso !== 'WLD') await readSDG(iso); });
  const readVotes = () => run('elections', () => readElections());
  const readStreet = async () => { await readUnrest(); save(); emit(); };

  let started = false;
  function start() {
    if (started) return;
    started = true;
    load();
    readPeople();
    setTimeout(readNations, 3000);
    setTimeout(readVotes, 5000);
    setTimeout(readSdgs, 8000);
    setTimeout(readStreet, 12000);
    setInterval(readPeople, 6 * HOUR);
    setInterval(readNations, 12 * HOUR);
    setInterval(readVotes, 3 * HOUR);
    setInterval(readSdgs, 12 * HOUR);
    setInterval(readStreet, 20 * MIN);
  }
  // Picking another country reads what it needs.
  async function show(iso) {
    pick = iso && iso !== home() ? iso : null;
    sig = '';
    paint();
    const iso3 = iso3Of(shownIso());
    if (!iso3) return;
    const need = [];
    if (!state.wb[iso3] || !state.pyr[iso3]) need.push(run('people', async () => { await readWB(iso3); await readPyramid(iso3); }));
    if (!state.sdg[shownIso()]) need.push(run('sdg', () => readSDG(shownIso())));
    await Promise.all(need);
  }

  /* ── Drawing ── */
  let sig = '', elFilter = 'upcoming', unFilter = 'active', tableSort = 'pop', tableQ = '', openElection = null;
  const v = (iso3, code) => { const x = state.wb[iso3] && state.wb[iso3].v[code]; return x ? x[0] : null; };
  const yr = (iso3, code) => { const x = state.wb[iso3] && state.wb[iso3].v[code]; return x ? x[1] : ''; };

  function kpis() {
    const r = worldRates(), now = Date.now();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
    const cell = (id, label, value, note) => `<div class="kpi"><span>${label}</span><strong id="${id}">${value}</strong><small>${note}</small></div>`;
    if (!r) return cell('so-pop', 'World population · now', '—', 'Reading the World Bank…');
    return cell('so-pop', 'World population · now', fmtInt(worldNow(now)), `estimate from the ${r.y0} mid-year count · +${fmt((r.birthsPerMs - r.deathsPerMs) * 1000, 1)} a second`) +
      cell('so-born', 'Born today', fmtInt((now - midnight) * r.birthsPerMs), `${fmt(r.birthsPerMs * 1000, 1)} a second · ${fmt(r.cbr, 1)} per 1,000 a year`) +
      cell('so-died', 'Died today', fmtInt((now - midnight) * r.deathsPerMs), `${fmt(r.deathsPerMs * 1000, 1)} a second · ${fmt(r.cdr, 1)} per 1,000 a year`) +
      cell('so-year', 'Net growth this year', '+' + fmtInt((now - jan1) * (r.birthsPerMs - r.deathsPerMs)), `born ${big((now - jan1) * r.birthsPerMs)} · died ${big((now - jan1) * r.deathsPerMs)}`) +
      cell('so-le', 'Life expectancy · world', fmt(v('WLD', 'SP.DYN.LE00.IN'), 1) + '<i>yr</i>', `${yr('WLD', 'SP.DYN.LE00.IN')} · World Bank`) +
      cell('so-tfr', 'Children per woman · world', fmt(v('WLD', 'SP.DYN.TFRT.IN'), 2), `replacement is about 2.1 · ${yr('WLD', 'SP.DYN.TFRT.IN')}`);
  }
  function tick() {
    if (typeof Views === 'undefined' || Views.current !== 'society') return;
    const r = worldRates();
    if (!r) return;
    const now = Date.now(), midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
    const set = (id, t) => { const n = $(id); if (n && n.firstChild && n.firstChild.nodeType === 3 && n.firstChild.nodeValue !== t) n.firstChild.nodeValue = t; else if (n && !n.firstChild) n.textContent = t; };
    set('so-pop', fmtInt(worldNow(now)));
    set('so-born', fmtInt((now - midnight) * r.birthsPerMs));
    set('so-died', fmtInt((now - midnight) * r.deathsPerMs));
    set('so-year', '+' + fmtInt((now - jan1) * (r.birthsPerMs - r.deathsPerMs)));
    const cp = $('so-cpop');
    if (cp) { const iso3 = cp.dataset.iso3, n = countryNow(iso3, now); if (Number.isFinite(n)) cp.textContent = fmtInt(n); }
  }

  /* Unrest: every country with reports, and the headlines. */
  function unrestPanel() {
    const h = home(), show = shownIso();
    const rows = [...state.level].map(([iso, L]) => ({ iso, L, c: byIso.get(iso) })).filter(x => x.c)
      .filter(x => unFilter === 'active' ? true : x.L.level === unFilter)
      .sort((a, b) => LEVELS.indexOf(b.L.level) - LEVELS.indexOf(a.L.level) || b.L.n - a.L.n);
    const count = l => [...state.level.values()].filter(x => x.level === l).length;
    const focus = show !== 'WLD' && state.level.has(show) ? show : null;
    const items = itemsOf(focus).slice(0, 40);
    const src = state.sources.unrest;
    return `<section class="panel so-unrest">
      <header class="panel-head"><h2>Protest and unrest · 48 h</h2><span class="panel-meta">${esc(src.status === 'live' ? 'sweep ' + ago(src.at) + ' · ' + src.note : src.status === 'error' ? 'sweep failed · ' + src.note : 'first sweep…')}</span></header>
      <div class="en-tools"><div class="chips">${[['active', 'All with reports', state.level.size], ['unrest', 'Unrest', count('unrest')], ['protests', 'Protests', count('protests')], ['reports', 'Reports', count('reports')]]
        .map(([k, l, n]) => `<button type="button" class="chip${unFilter === k ? ' on' : ''}" data-sof="${k}">${l} <b>${n}</b></button>`).join('')}</div></div>
      <div class="so-split">
        <div class="work-list so-ulist"><table class="grid"><colgroup><col style="width:24px"><col><col style="width:78px"><col style="width:40px"></colgroup>
          <thead><tr><th></th><th>Country</th><th>Level</th><th>48 h</th></tr></thead><tbody>
          ${rows.length ? rows.map(({ iso, L, c }) => `<tr data-so="${iso}" class="${iso === show ? 'on ' : ''}lvl-${tone(L.level) === 'crit' ? 'red' : tone(L.level) === 'warn' ? 'orange' : 'none'}">
            <td class="c-glyph">${iso === h ? '⌂' : L.coup ? '◆' : '●'}</td><td class="c-name">${esc(c.name)}${L.violent ? `<span>${L.violent} violent${L.strike ? ` · ${L.strike} strike` : ''}</span>` : L.strike ? `<span>${L.strike} strike</span>` : ''}</td>
            <td class="c-value t-${tone(L.level)}">${esc(LEVEL_SAY[L.level])}</td><td class="c-kind">${L.n}</td></tr>`).join('')
            : `<tr class="empty"><td colspan="4">${src.at ? 'No country has reports in this filter.' : 'Reading the news…'}</td></tr>`}
        </tbody></table></div>
        <div class="so-news">
          <span class="eyebrow">${focus ? esc(nameOf(focus).toUpperCase()) + ' · ' : ''}NEWEST REPORTS${focus ? ` <button type="button" class="link" data-so="WLD">all countries</button>` : ''}</span>
          <ol class="inc-list news">${items.length ? items.map(i => `<li><time>${esc(ago(i.time))}</time><span>${i.violent ? '<em class="so-tag crit">VIOLENT</em> ' : i.strike ? '<em class="so-tag warn">STRIKE</em> ' : ''}<a href="${esc(i.link)}" target="_blank" rel="noreferrer noopener">${esc(i.headline)} ↗</a> <small>${esc([i.outlet, i.countries.map(nameOf).join(', ')].filter(Boolean).join(' · '))}</small></span></li>`).join('')
            : '<li class="map-hint">Nothing in the last three days.</li>'}</ol>
        </div>
      </div>
    </section>`;
  }

  /* Elections: coming and recent. */
  function electionsPanel() {
    const now = Date.now(), h = home(), today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const all = state.elections.list;
    const list = elFilter === 'upcoming' ? all.filter(e => e.date >= today && e.date - today < 180 * DAY)
      : elFilter === 'recent' ? all.filter(e => e.date < today && today - e.date < 60 * DAY).reverse()
      : all.filter(e => e.iso && e.iso === h);
    const days = e => Math.round((e.date - today) / DAY);
    const when = e => { const d = days(e); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d > 0 ? `in ${d} d` : d === -1 ? 'yesterday' : `${-d} d ago`; };
    const src = state.sources.elections;
    return `<section class="panel so-elect">
      <header class="panel-head"><h2>Elections</h2><span class="panel-meta">${esc(src.status === 'live' ? 'Wikipedia · ' + ago(src.at) : src.status === 'waiting' ? 'reading…' : state.elections.at ? `Wikipedia · ${ago(state.elections.at)} · last read failed (${src.note})` : src.note)}</span></header>
      <div class="en-tools"><div class="chips">${[['upcoming', 'Next six months'], ['recent', 'Last two months'], ['home', h ? nameOf(h) : 'Your country']]
        .map(([k, l]) => `<button type="button" class="chip${elFilter === k ? ' on' : ''}" data-soe="${k}">${esc(l)}</button>`).join('')}</div></div>
      <ol class="so-elist">${list.length ? list.slice(0, 120).map((e, i) => {
        const id = e.date + '|' + e.country + '|' + e.what, open = openElection === id;
        return `<li class="${e.iso && e.iso === h ? 'home ' : ''}${days(e) >= 0 && days(e) <= 7 ? 'soon ' : ''}${open ? 'open' : ''}" data-soel="${esc(id)}">
          <time><b>${esc(e.dateText)}</b><small>${esc(when(e))}</small></time>
          <span><b>${esc(e.country)}</b>${e.iso && e.iso === h ? ' <em class="so-tag">YOUR COUNTRY</em>' : ''}<small>${esc(e.what)}</small>
          ${open ? `<p class="so-sum" id="so-sum">${summaries.has(e.title) ? esc(summaries.get(e.title) || 'No summary on Wikipedia yet.') : 'Reading Wikipedia…'}</p>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noreferrer noopener">Wikipedia ↗</a>` : ''}` : ''}</span></li>`; }).join('')
        : `<li class="map-hint">${src.at ? (elFilter === 'home' ? 'No national election listed for your country this year or next.' : 'None listed.') : 'Reading the calendars…'}</li>`}</ol>
    </section>`;
  }

  /* Demography: the pyramid and the readings, against the world. */
  function pyramidSVG(p) {
    if (!p || !p.bands) return '<p class="map-hint">Reading the ages…</p>';
    const W = 300, rowH = 13, H = p.bands.length * rowH + 22, mid = W / 2, lab = 30;
    const iso3 = Object.keys(state.pyr).find(k => state.pyr[k] === p);
    const male = (v(iso3, 'SP.POP.TOTL.MA.ZS') || 50) / 100;
    const vals = p.bands.flatMap(b => [(b[1] || 0) * male, (b[2] || 0) * (1 - male)]);
    const max = Math.max(5, ...vals), sc = (mid - lab / 2 - 4) / max;
    const rows = p.bands.slice().reverse().map((b, i) => {
      const y = i * rowH, m = (b[1] || 0) * male * sc, f = (b[2] || 0) * (1 - male) * sc;
      return `<rect class="py-m" x="${(mid - lab / 2 - m).toFixed(1)}" y="${y}" width="${m.toFixed(1)}" height="${rowH - 2}"><title>${b[0]} · men ${fmt((b[1] || 0) * male, 1)}% of everyone</title></rect>
        <rect class="py-f" x="${(mid + lab / 2).toFixed(1)}" y="${y}" width="${f.toFixed(1)}" height="${rowH - 2}"><title>${b[0]} · women ${fmt((b[2] || 0) * (1 - male), 1)}% of everyone</title></rect>
        <text x="${mid}" y="${y + rowH - 4}">${b[0]}</text>`;
    }).join('');
    const yb = p.bands.length * rowH + 14;
    return `<svg class="so-pyr" viewBox="0 0 ${W} ${H}" role="img" aria-label="Population by age and sex">${rows}<text class="py-key" x="4" y="${yb}">◀ MEN</text><text class="py-key" x="${W - 4}" y="${yb}" text-anchor="end">WOMEN ▶</text></svg>`;
  }
  function demoPanel() {
    const iso = shownIso(), iso3 = iso3Of(iso), c = byIso.get(iso), h = home();
    const st = state.sources.people;
    const rowsDef = [
      ['SP.DYN.TFRT.IN', 'Children per woman', 2], ['SP.DYN.LE00.IN', 'Life expectancy, years', 1], ['SP.POP.GROW', 'Population growth, % a year', 2],
      ['SP.DYN.CBRT.IN', 'Births per 1,000', 1], ['SP.DYN.CDRT.IN', 'Deaths per 1,000', 1], ['SP.POP.0014.TO.ZS', 'Under 15, %', 1], ['SP.POP.65UP.TO.ZS', '65 and over, %', 1],
      ['SP.URB.TOTL.IN.ZS', 'Living in cities, %', 1], ['SH.DYN.MORT', 'Under-5 deaths per 1,000 births', 1], ['SL.UEM.TOTL.ZS', 'Unemployment, %', 1],
      ['SI.POV.DDAY', 'Extreme poverty ($3 a day), %', 1], ['SI.POV.GINI', 'Inequality (Gini, 0–100)', 1], ['NY.GDP.PCAP.PP.CD', 'Income per person, PPP $', 0],
      ['IT.NET.USER.ZS', 'Using the internet, %', 1], ['VC.IHR.PSRC.P5', 'Homicides per 100,000', 1]
    ];
    const opts = `<option value="WLD"${iso === 'WLD' ? ' selected' : ''}>World</option>` + COUNTRIES.map(x => `<option value="${x.iso2}"${x.iso2 === iso ? ' selected' : ''}>${esc(x.name)}${x.iso2 === h ? ' (your country)' : ''}</option>`).join('');
    const now = countryNow(iso3);
    return `<section class="panel so-demo">
      <header class="panel-head"><h2>People · ${esc(nameOf(iso))}</h2><label class="cw-pick">Country <select id="so-pick" aria-label="Country">${opts}</select></label></header>
      <div class="so-demo-body">
        <div class="so-demo-left">
          <span class="eyebrow">POPULATION NOW · ESTIMATE</span>
          <div class="so-cpop" id="so-cpop" data-iso3="${esc(iso3 || '')}">${Number.isFinite(now) ? fmtInt(now) : '—'}</div>
          <small class="so-dim">${iso3 && v(iso3, 'SP.POP.TOTL') ? `${fmtInt(v(iso3, 'SP.POP.TOTL'))} at mid-${yr(iso3, 'SP.POP.TOTL')}, carried forward at ${fmt(v(iso3, 'SP.POP.GROW'), 2)}% a year` : st.status === 'error' ? esc(st.note) : 'Reading…'}</small>
          <span class="eyebrow" style="margin-top:12px">AGE AND SEX · % OF EVERYONE${state.pyr[iso3] && state.pyr[iso3].year ? ' · ' + state.pyr[iso3].year : ''}</span>
          ${pyramidSVG(state.pyr[iso3])}
        </div>
        <table class="so-cmp"><thead><tr><th></th><th>${esc(iso === 'WLD' ? 'World' : c ? c.name : '')}</th>${iso !== 'WLD' ? '<th>World</th>' : ''}</tr></thead><tbody>
          ${rowsDef.map(([code, label, d]) => { const a = v(iso3, code), w = v('WLD', code);
            return `<tr><td>${esc(label)}</td><td title="${esc(yr(iso3, code))}">${a == null ? '—' : fmt(a, d)}<small>${esc(yr(iso3, code))}</small></td>${iso !== 'WLD' ? `<td>${w == null ? '—' : fmt(w, d)}</td>` : ''}</tr>`; }).join('')}
        </tbody></table>
      </div>
    </section>`;
  }

  /* UN SDG indicators for the same country, against the world. */
  function spark(pts, lowerBetter) {
    if (!pts || pts.length < 2) return '';
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = 84, H = 22, sx = x => (x - x0) / Math.max(1, x1 - x0) * W, sy = y => H - 2 - (y - y0) / Math.max(1e-9, y1 - y0) * (H - 4);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    const good = lowerBetter ? ys[ys.length - 1] <= ys[0] : ys[ys.length - 1] >= ys[0];
    return `<svg class="so-spark ${good ? 'good' : 'bad'}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function sdgPanel() {
    const iso = shownIso(), mine = state.sdg[iso], world = state.sdg.WLD;
    const st = state.sources.sdg;
    return `<section class="panel so-sdg">
      <header class="panel-head"><h2>How people live · UN SDG indicators</h2><span class="panel-meta">${esc(nameOf(iso))}${iso !== 'WLD' ? ' vs world' : ''} · UN Statistics Division</span></header>
      <table class="so-sdgt"><thead><tr><th>Indicator</th><th>${esc(nameOf(iso))}</th><th>Since 2015</th><th>Trend</th>${iso !== 'WLD' ? '<th>World</th>' : ''}</tr></thead><tbody>
      ${SDG.map(([code, label, unit, lower]) => {
        const a = mine && mine.s[code], w = world && world.s[code];
        const ch = a && a.y > a.baseY ? a.v - a.base : null;
        const better = ch == null ? null : (lower ? ch < 0 : ch > 0);
        const d = a && Math.abs(a.v) < 10 ? 1 : 0;
        const flat = ch != null && Math.abs(ch) < Math.pow(10, -d) / 2;
        return `<tr><td>${esc(label)}<small>${esc(unit)}</small></td>
          <td>${a ? `<b>${fmt(a.v, d)}</b><small>${a.y}</small>` : (mine ? '<span class="so-dim">no data</span>' : '…')}</td>
          <td class="${better == null || flat ? '' : better ? 't-ok' : 't-crit'}">${ch == null ? '' : `${flat ? '' : ch > 0 ? '+' : '−'}${fmt(Math.abs(flat ? 0 : ch), d)}<small>from ${a.baseY}</small>`}</td>
          <td>${a ? spark(a.pts, lower) : ''}</td>
          ${iso !== 'WLD' ? `<td>${w ? `${fmt(w.v, Math.abs(w.v) < 10 ? 1 : 0)}<small>${w.y}</small>` : '…'}</td>` : ''}</tr>`; }).join('')}
      </tbody></table>
      <p class="so-foot">${st.status === 'error' ? esc('Not read: ' + st.note) : 'Green: moving the right way since 2015. Values are the latest year each series has for the country; some series lag by several years.'}</p>
    </section>`;
  }

  /* Every country, sortable. */
  function nextElection(iso) {
    const today = Date.now() - DAY;
    return state.elections.list.find(e => e.iso === iso && e.date >= today);
  }
  function tablePanel() {
    const h = home(), show = shownIso(), q = tableQ.trim().toLowerCase();
    const rows = COUNTRIES.map(c => ({ c, r: state.table.rows[c.iso3] || {}, L: state.level.get(c.iso2), e: nextElection(c.iso2) }))
      .filter(x => x.r.pop && (!q || x.c.name.toLowerCase().includes(q)));
    const key = { pop: x => -(countryNow(x.c.iso3) || 0), grow: x => -((x.r.grow || [])[0] ?? -99), tfr: x => -((x.r.tfr || [])[0] ?? -99), le: x => -((x.r.le || [])[0] ?? -99),
      urb: x => -((x.r.urb || [])[0] ?? -99), old: x => -((x.r.old || [])[0] ?? -99), unrest: x => -(x.L ? LEVELS.indexOf(x.L.level) * 1000 + x.L.n : 0), vote: x => x.e ? x.e.date : 9e15, name: x => x.c.name }[tableSort];
    rows.sort((a, b) => { const ka = key(a), kb = key(b); return typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb; });
    const th = (k, label) => `<th data-sots="${k}" class="${tableSort === k ? 'sorted' : ''}">${label}</th>`;
    const cell = (x, d) => x ? fmt(x[0], d) : '—';
    return `<section class="panel so-table">
      <header class="panel-head"><h2>Every country</h2><span class="panel-meta">${esc(state.sources.nations.status === 'live' ? `World Bank · ${ago(state.sources.nations.at)}` : state.sources.nations.status === 'waiting' ? 'reading…' : state.sources.nations.note)}</span>
        <input id="so-q" class="control search" type="search" placeholder="Find a country" value="${esc(tableQ)}" aria-label="Find a country"></header>
      <div class="work-list so-tlist"><table class="grid"><thead><tr><th></th>${th('name', 'Country')}${th('pop', 'Population now')}${th('grow', 'Growth %')}${th('tfr', 'Children / woman')}${th('le', 'Life exp.')}${th('urb', 'Urban %')}${th('old', '65+ %')}${th('unrest', 'Street, 48 h')}${th('vote', 'Next national vote')}</tr></thead><tbody>
        ${rows.length ? rows.map(({ c, r, L, e }) => `<tr data-so="${c.iso2}" class="${c.iso2 === show ? 'on' : ''}"><td class="c-glyph">${c.iso2 === h ? '⌂' : ''}</td><td>${esc(c.name)}</td><td class="num">${fmtInt(countryNow(c.iso3) || 0)}</td>
          <td class="num">${cell(r.grow, 2)}</td><td class="num">${cell(r.tfr, 2)}</td><td class="num">${cell(r.le, 1)}</td><td class="num">${cell(r.urb, 0)}</td><td class="num">${cell(r.old, 1)}</td>
          <td class="${L ? 't-' + tone(L.level) : 'so-dim'}">${L ? `${LEVEL_SAY[L.level]} · ${L.n}` : '—'}</td><td>${e ? `${esc(e.dateText)} ${new Date(e.date).getUTCFullYear()}<small> · ${esc(e.what)}</small>` : '<span class="so-dim">—</span>'}</td></tr>`).join('')
          : `<tr class="empty"><td colspan="10">${state.table.at ? 'Nothing matches.' : 'Reading the World Bank…'}</td></tr>`}
      </tbody></table></div>
    </section>`;
  }

  function paint() {
    const host = $('society-body');
    if (!host) return;
    const s = JSON.stringify([shownIso(), home(), elFilter, unFilter, tableSort, tableQ, openElection, Object.values(state.sources).map(x => x.status + x.at),
      state.unrest.size, Object.keys(state.wb).length, Object.keys(state.pyr).length, Object.keys(state.sdg).length, state.elections.at, Math.floor(Date.now() / (10 * MIN))]);
    if (s === sig) { tick(); return; }
    sig = s;
    const focus = document.activeElement && document.activeElement.id, caret = focus && document.activeElement.selectionStart;
    const scrolls = [...host.querySelectorAll('.work-list, .so-elist, .so-news')].map(n => n.scrollTop);
    const k = $('society-kpis');
    if (k) k.innerHTML = kpis();
    host.innerHTML = `<div class="so-row1">${unrestPanel()}${electionsPanel()}</div><div class="so-row2">${demoPanel()}${sdgPanel()}</div>${tablePanel()}`;
    [...host.querySelectorAll('.work-list, .so-elist, .so-news')].forEach((n, i) => { if (scrolls[i]) n.scrollTop = scrolls[i]; });
    if (focus && $(focus)) { const n = $(focus); n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* not text */ } }
    const srcs = $('society-sources');
    if (srcs) { const all = Object.values(state.sources); srcs.textContent = `${all.filter(x => x.status === 'live').length}/${all.length} sources live`; }
  }

  function wire() {
    document.addEventListener('click', e => {
      if (!e.target.closest('#view-society')) return;
      const f = e.target.closest('[data-sof]'); if (f) { unFilter = f.dataset.sof; sig = ''; paint(); return; }
      const g = e.target.closest('[data-soe]'); if (g) { elFilter = g.dataset.soe; openElection = null; sig = ''; paint(); return; }
      const t = e.target.closest('[data-sots]'); if (t) { tableSort = t.dataset.sots; sig = ''; paint(); return; }
      if (e.target.closest('a')) return;
      const el = e.target.closest('[data-soel]');
      if (el) {
        const id = el.dataset.soel;
        openElection = openElection === id ? null : id;
        sig = ''; paint();
        const ev = state.elections.list.find(x => x.date + '|' + x.country + '|' + x.what === id);
        if (openElection && ev && ev.title && !summaries.has(ev.title)) summary(ev.title).catch(() => summaries.set(ev.title, '')).then(() => { sig = ''; paint(); });
        return;
      }
      const row = e.target.closest('[data-so]');
      if (row) show(row.dataset.so);
    });
    document.addEventListener('change', e => { if (e.target.id === 'so-pick') show(e.target.value); });
    document.addEventListener('input', e => { if (e.target.id === 'so-q') { tableQ = e.target.value; sig = ''; paint(); } });
    onUpdate(() => {
      // The sidebar count: countries with protests or unrest in 48 hours.
      const n = [...state.level.values()].filter(x => x.level === 'protests' || x.level === 'unrest').length, t = $('tab-count-society');
      if (t) t.textContent = n ? String(n) : '';
      if (typeof Views !== 'undefined' && Views.current === 'society') paint();
    });
    if (typeof Watch !== 'undefined') Watch.onUpdate(() => { if (typeof Views !== 'undefined' && Views.current === 'society') paint(); });
    setInterval(tick, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  // Everything again, now (and past the caches).
  async function refresh() {
    await Promise.all([run('elections', () => readElections(true)), run('nations', () => readTable(true)),
      run('people', async () => { await readWB('WLD', true); const iso3 = iso3Of(shownIso()); if (iso3 !== 'WLD') await readWB(iso3, true); })]);
    await readStreet();
  }
  return { state, start, paint, refresh, onUpdate, worldNow, countryNow, LEVEL_SAY, tone, itemsOf };
})();
