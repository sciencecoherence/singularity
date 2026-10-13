'use strict';
/* ── Country energy watch ──────────────────────────────────────────────────
   The state of the power and fuel supply in every country, and in yours.

   What is read. Google News, which carries each country's own press in its
   own language: four sweeps every twenty minutes (English, Spanish,
   Portuguese, French, Arabic) for blackouts, power cuts, load shedding,
   rationing, fuel shortages and energy crises, each headline placed in the
   country it names; and, every ten minutes, a dedicated search for your
   country in its own language and in English. A country you open is read
   the same way, once, on demand.

   What it becomes. A level for each country from the last 72 hours of
   reports — newer counts more, the words for rationing, emergencies and
   nationwide cuts count more — plus the refineries in the incident register
   (energy.js) and the disasters GDACS has there (feeds.js):
     CRISIS    many reports, or few with the gravest words
     STRAINED  a steady run of reports
     WATCH     isolated reports
     QUIET     nothing in three days
   This is a reading of the press, not of the grid: a country whose press is
   not on Google News, or that does not report its cuts, reads quiet.

   The outlook. What makes a country's supply fragile and whether that is in
   play now: how much of its electricity is hydro and whether water is short
   (drought, low river flows), how much of its oil it imports and what oil
   costs, imported electricity and gas, refineries down, disasters on the
   ground, and the cuts its authorities have announced ahead. The profile is
   Our World in Data's energy dataset (latest year), bundled in
   lib/countries-data.js.

   Alerts (alerts.js): new reports in your country, at most one alert in six
   hours, red when the words are grave; a rise in its level; and, if chosen,
   any country reaching crisis.                                             */
const Watch = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const HOME_KEY = 'temporal-live:home-country';
  const listeners = new Set();
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };

  const COUNTRIES = typeof CountryData !== 'undefined' ? CountryData : [];
  const byIso = new Map(COUNTRIES.map(c => [c.iso2, c]));
  const byNum = new Map(COUNTRIES.map(c => [String(Number(c.num)), c]));

  /* ── The words ── */
  const KW = {
    en: ['"power outage"', '"power outages"', '"power cuts"', '"load shedding"', '"energy crisis"', '"fuel shortage"', '"electricity rationing"', '"nationwide blackout"', 'blackout'],
    es: ['apagón', 'apagones', '"cortes de luz"', '"cortes de energía"', 'racionamiento', '"crisis energética"', '"escasez de combustible"', 'estiaje'],
    pt: ['apagão', '"falta de energia"', '"falta de luz"', 'racionamento', '"crise energética"', '"escassez de combustível"'],
    fr: ['"coupure de courant"', '"coupures de courant"', 'délestage', '"pénurie de carburant"', '"crise énergétique"'],
    de: ['Stromausfall', 'Energiekrise', 'Stromknappheit', 'Treibstoffmangel'],
    it: ['blackout', '"crisi energetica"', '"interruzione di corrente"', 'razionamento'],
    ar: ['"انقطاع الكهرباء"', '"أزمة الطاقة"', '"أزمة الوقود"', '"تخفيف الأحمال"']
  };
  const ENERGY = /power outage|power cut|outages|load[- ]?shedding|rolling (?:outage|blackout)|electricity (?:rationing|shortage|crisis|cuts?)|power (?:rationing|shortage|crisis)|energy (?:crisis|emergency|shortage)|fuel (?:shortage|crisis|rationing)|(?:petrol|gasoline|diesel) (?:shortage|crisis|queues)|grid (?:collapse|failure)|blackout|apag[oó]n|apagones|cortes? de (?:luz|energ[ií]a|electricidad)|racionamiento|crisis (?:energ[eé]tica|el[eé]ctrica)|escasez de (?:combustible|gasolina|di[eé]sel|energ[ií]a)|d[eé]ficit (?:de generaci[oó]n|energ[eé]tico)|estiaje|apag[aã]o|apag[õo]es|falta de (?:energia|luz)|racionamento|crise (?:energ[eé]tica|h[ií]drica)|escassez de combust[ií]vel|coupures? (?:de courant|d'[ée]lectricit[ée])|d[ée]lestage|p[ée]nurie (?:de carburant|d'[ée]lectricit[ée]|d'essence)|crise [ée]nerg[ée]tique|stromausf[aä]ll|energiekrise|stromknappheit|treibstoffmangel|crisi energetica|interruzion[ei] di corrente|انقطاع الكهرباء|أزمة الطاقة|أزمة الوقود|تخفيف الأحمال/i;
  const GRAVE = /nationwide|national blackout|across the country|state of emergency|emergency|rationing|load[- ]?shedding|grid collapse|total blackout|apag[oó]n (?:nacional|total|general)|racionamiento|emergencia|estado de excepci[oó]n|\d{2,3} horas|cortes programados|horarios de cortes|cronograma de cortes|racionamento|apag[aã]o (?:geral|nacional)|d[ée]lestage|[ée]tat d'urgence|notstand|تخفيف الأحمال/i;
  /* What kind of report it is. SUPPLY: the supply is failing for the people
     who depend on it — rationing, load shedding, scheduled cuts, shortages, a
     generation deficit, a nationwide blackout, hydro dams running dry. OUTAGE:
     a cut, usually local (a storm, a fault). CONTEXT: "energy crisis" with no
     cut or shortage in it — usually the oil market, not anyone's lights. */
  const SUPPLY = /load[- ]?shedding|rolling (?:outage|blackout|cut)|rationing|racionamient|racionament|cortes programad|apagones programad|cronograma de cortes|horarios? de (?:cortes|apagones)|horas (?:semanales|sin luz|de corte)|cortes de luz (?:a|en|para) (?:industrias|hogares|todo)|(?:fuel|petrol|gasoline|diesel|power|electricity|energy|gas) shortage|shortages? of (?:fuel|petrol|diesel|power|electricity)|escasez de (?:combustible|gasolina|di[eé]sel|energ[ií]a|luz)|escassez de (?:combust[ií]vel|energia)|falta de (?:combustible|combust[ií]vel|gasolina)|d[eé]ficit (?:de generaci[oó]n|energ[eé]tico|de energ[ií]a)|estiaje|crise h[ií]drica|nationwide (?:blackout|outage)|national (?:blackout|grid)|(?:grid|system) collapse|apag[oó]n (?:nacional|total|general|masivo)|apag[aã]o (?:geral|nacional)|black-?out g[ée]n[ée]ralis|d[ée]lestage|p[ée]nurie|stromknappheit|treibstoffmangel|gasmangel|تخفيف الأحمال|أزمة الوقود|power outage schedule|outage schedules?|emergency (?:power|outages?|shutdowns?)|energy emergency|emergencia (?:energ[eé]tica|el[eé]ctrica)|state of emergency/i;
  const CONTEXT_ONLY = /^(?:(?!outage|cut|blackout|shortage|shedding|rationing|apag|corte|racion|escasez|falta|d[ée]lestage|coupure|p[ée]nurie|stromausf|انقطاع).)*$/i;
  const kindOf = t => SUPPLY.test(t) ? 'supply' : CONTEXT_ONLY.test(t) ? 'context' : 'outage';
  const WEIGHT = { supply: 1.6, outage: 0.6, context: 0.25 };
  const NOT_CRISIS = /['"‘“]\s*apag[a-zãõóáéíñ]+\s*['"’”]|['"‘“]\s*blackout\s*['"’”]|apag[aã]o de dados|racionamiento de agua|racionamento de [aá]gua|water rationing|rationing of water|cortes de agua|apag[oó]n (?:informativo|de datos|mental|anal[oó]gico)|blackout de (?:dados|datos)|planned (?:power )?outage|scheduled (?:power )?outage|maintenance|curtain|blackout (?:curtain|period|dates|game)|poker|sports? blackout|tv blackout|media blackout|news blackout|information blackout|internet blackout/i;
  const BLACKOUT_CONTEXT = /power|electric|grid|nationwide|national|energy|outage|apag|luz/i;
  const WATER = /drought|low (?:water|river|reservoir)|reservoir|dam level|sequ[ií]a|estiaje|caudal|caudales|embalse|nivel de agua|crise h[ií]drica|reservat[oó]rio|seca\b|s[ée]cheresse/i;
  const AHEAD = /schedule|timetable|from (?:mon|tue|wed|thu|fri|sat|sun)\w*|starting|will (?:cut|ration)|horario|cronograma|programad|desde el|a partir de|hasta el|semanales|calendrier|à partir|programm|cronograma|a partir|stage \d/i;
  function isEnergy(t) {
    if (!ENERGY.test(t) || NOT_CRISIS.test(t)) return false;
    if (/blackout/i.test(t) && !/apag|power|electric|grid|outage|energy|luz/i.test(t.replace(/blackout/ig, ''))) return BLACKOUT_CONTEXT.test(t.replace(/blackout/ig, ''));
    return true;
  }

  /* ── Placing a headline ── */
  const BLOCK = new Set(['victoria', 'kingston', 'hamilton', 'georgetown', 'washington', 'santiago', 'saint john', 'san josé', 'san jose', 'valletta', 'praia', 'avarua', 'salvador', 'el salvador']);
  // Names that are also places elsewhere count only with their country's context.
  const CONTEXT = { georgia: /tbilisi|georgian|sakartvelo/i, jordan: /amman|jordanian/i, chad: /chadian|n'?djamena/i,
    'costa rica': /^(?![\s\S]*\b(?:moradores|bairro|prefeitura|MS\b|Mato Grosso))/i };
  const SV_NAME = /\bEl Salvador\b|salvadoreñ|salvadoran|San Salvador/i;
  let TERMS = null;
  let DEMS = null;
  function terms() {
    if (TERMS) return TERMS;
    const build = list => {
      const owner = new Map();
      for (const [c, n] of list) {
        const t = n.toLowerCase().trim();
        if (t.length < 4 || BLOCK.has(t)) continue;
        const s = owner.get(t) || new Set(); s.add(c.iso2); owner.set(t, s);
      }
      return [...owner].filter(([, s]) => s.size === 1).map(([t, s]) => ({ t, iso: [...s][0] })).sort((a, b) => b.t.length - a.t.length);
    };
    TERMS = build(COUNTRIES.flatMap(c => c.names.map(n => [c, n])));
    DEMS = build(COUNTRIES.flatMap(c => c.dem.map(n => [c, n])));
    return TERMS;
  }
  const isLetter = ch => !!ch && /[\p{L}\p{N}]/u.test(ch);
  const placeMemo = new Map();
  function place(title) {
    const hit = placeMemo.get(title);
    if (hit) return hit;
    const out = placeRaw(title);
    if (placeMemo.size > 5000) placeMemo.clear();
    placeMemo.set(title, out);
    return out;
  }
  function placeRaw(title) {
    const named = scan(title, terms());
    if (SV_NAME.test(title)) named.push('SV');
    // A nationality ("Russian forces…") only when no country or capital is named.
    return [...new Set(named.length ? named : scan(title, DEMS))];
  }
  function scan(title, list) {
    let low = title.toLowerCase();
    const found = new Set();
    for (const { t, iso } of list) {
      let i = low.indexOf(t);
      while (i >= 0) {
        if (!isLetter(low[i - 1]) && !isLetter(low[i + t.length]) && (!CONTEXT[t] || CONTEXT[t].test(title))) {
          found.add(iso);
          low = low.slice(0, i) + ' '.repeat(t.length) + low.slice(i + t.length);   // the longer name owns it
        }
        i = low.indexOf(t, i + 1);
      }
    }
    return [...found];
  }
  /* Which outlets are a country's own press: its country-code domain, or
     outlets seen naming that country in their headlines. */
  const outletVotes = new Map();          // outlet → Map(iso → count)
  const TLD = iso => iso === 'GB' ? 'uk' : iso.toLowerCase();
  function localPress(iso, outlet, source) {
    let host = '';
    try { host = source ? new URL(source).hostname : ''; } catch { host = ''; }
    if (host && (host.endsWith('.' + TLD(iso)))) return true;
    const v = outletVotes.get(outlet);
    if (!v) return false;
    const mine = v.get(iso) || 0, all = [...v.values()].reduce((a, b) => a + b, 0);
    return mine >= 2 && mine / all >= 0.6;
  }

  /* ── Reading ── */
  const GN = (q, hl, gl, ceid) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${ceid}`;
  const SWEEPS = [
    { k: 'en', q: `(${KW.en.filter(w => w !== 'blackout').join(' OR ')}) when:3d`, hl: 'en-US', gl: 'US', ceid: 'en' },
    { k: 'es', q: `(${KW.es.join(' OR ')}) when:3d`, hl: 'es-419', gl: 'US', ceid: 'es-419' },
    { k: 'pt', q: `(${KW.pt.join(' OR ')}) when:3d`, hl: 'pt-BR', gl: 'BR', ceid: 'pt-419' },
    { k: 'fr', q: `(${KW.fr.join(' OR ')}) when:3d`, hl: 'fr', gl: 'FR', ceid: 'fr' },
    { k: 'ar', q: `(${KW.ar.join(' OR ')}) when:3d`, hl: 'ar', gl: 'EG', ceid: 'ar' }
  ];
  const state = {
    items: new Map(),            // normalised title → item
    level: new Map(),            // iso2 → { level, score, n, last }
    dedicated: new Map(),        // iso2 → { at, status }
    sources: {
      sweep: { label: 'Energy news sweep (Google News)', status: 'waiting', at: null, note: '' },
      home: { label: 'Your country, energy news', status: 'waiting', at: null, note: '' }
    }
  };
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  function split(raw) {
    const i = raw.lastIndexOf(' - ');
    return i > 20 ? { headline: raw.slice(0, i).trim(), outlet: raw.slice(i + 3).trim() } : { headline: raw.trim(), outlet: '' };
  }
  function take(items, via, iso, local) {
    let added = 0;
    // Named headlines first, so their outlets are known before the unnamed ones are judged.
    items = items.slice().sort((a, b) => (place(split(b.title).headline).length > 0) - (place(split(a.title).headline).length > 0));
    for (const it of items) {
      if (!it.time || Date.now() - it.time > 8 * DAY) continue;
      const { headline, outlet } = split(it.title);
      const dedicated = !!iso;
      if (!dedicated && !isEnergy(headline)) continue;
      // Google matches a dedicated search anywhere in the article; only a
      // headline about the power or fuel supply counts. Low water counts too
      // where the grid runs on hydro.
      if (dedicated && !(isEnergy(headline) || (WATER.test(headline) && ((byIso.get(iso).p || {}).hydro || 0) >= 40))) continue;
      // And about that country: an English-language result must name it in
      // the headline; a result from the country's own press may leave the
      // name out (its readers know where they are) but must not name another.
      if (dedicated) {
        const named = place(headline);
        if (named.includes(iso) && outlet) { const v = outletVotes.get(outlet) || new Map(); v.set(iso, (v.get(iso) || 0) + 1); outletVotes.set(outlet, v); }
        if (named.length ? !named.includes(iso) : !(local && localPress(iso, outlet, it.source))) continue;
      }
      const k = norm(headline);
      const prev = state.items.get(k);
      const countries = new Set(prev ? prev.countries : []);
      for (const c of place(headline)) countries.add(c);
      if (iso) countries.add(iso);
      if (!countries.size) continue;
      if (prev) { prev.countries = [...countries]; continue; }
      state.items.set(k, { k, headline, outlet, link: it.link, time: it.time, via, countries: [...countries], grave: GRAVE.test(headline), kind: kindOf(headline),
        water: WATER.test(headline), ahead: AHEAD.test(headline), seen: Date.now() });
      added++;
    }
    return added;
  }
  async function readSweeps() {
    let ok = 0, fails = [];
    for (const s of SWEEPS) {
      try { take(await Net.feed(GN(s.q, s.hl, s.gl, s.ceid)), 'sweep:' + s.k); ok++; }
      catch (e) { fails.push(s.k + ': ' + (e.message || e)); }
      await new Promise(r => setTimeout(r, 1500));
    }
    Object.assign(state.sources.sweep, ok ? { status: 'live', at: Date.now(), note: `${ok}/${SWEEPS.length} languages` } : { status: 'error', note: fails.join('; ') });
    prune(); compute(); emit(); save(true);
  }
  function queriesFor(c) {
    const lang = (c.hl || 'en').slice(0, 2);
    const out = [];
    const local = KW[lang];
    if (local && lang !== 'en') out.push({ q: `"${c.native || c.name}" (${local.join(' OR ')}) when:7d`, hl: c.hl, gl: c.iso2, ceid: c.hl, local: true });
    // An English-speaking country's own press: its own edition of Google News.
    else if (lang === 'en' && c.iso2 !== 'US') out.push({ q: `"${c.name}" (${KW.en.join(' OR ')}) when:7d`, hl: 'en-' + c.iso2, gl: c.iso2, ceid: 'en', local: true });
    out.push({ q: `"${c.name}" (${KW.en.join(' OR ')}) when:7d`, hl: 'en-US', gl: 'US', ceid: 'en' });
    return out;
  }
  async function readCountry(iso, force) {
    const c = byIso.get(iso);
    if (!c) return;
    const d = state.dedicated.get(iso);
    if (!force && d && (d.pending || Date.now() - d.at < 9 * MIN)) return;
    state.dedicated.set(iso, { ...(d || {}), pending: true, at: Date.now() });
    let ok = 0, err = '';
    if (!force && d && d.failedAt && Date.now() - d.failedAt < 2 * MIN) { state.dedicated.set(iso, { ...d, pending: false }); return 0; }
    for (const q of queriesFor(c)) {
      try { take(await Net.feed(GN(q.q, q.hl, q.gl, q.ceid)), 'country:' + iso, iso, !!q.local); ok++; }
      catch (e) { err = String(e.message || e); }
    }
    // A failed read keeps the last good one's results and time, so the level stands.
    state.dedicated.set(iso, ok ? { pending: false, at: Date.now(), status: 'live' } : { ...(d || {}), pending: false, failedAt: Date.now(), note: err, status: d && d.status === 'live' ? 'live' : 'error' });
    if (iso === homeIso()) Object.assign(state.sources.home, ok ? { status: 'live', at: Date.now(), note: c.name } : { status: 'error', note: err });
    if (iso === homeIso() || iso === viewIso) { compute(); emit(); } else soon();
    return ok;
  }
  function prune() {
    for (const [k, it] of state.items) if (Date.now() - it.time > 8 * DAY) state.items.delete(k);
  }
  // Many reads land close together: one recompute and repaint for them all.
  let soonTimer = 0;
  function soon() { if (soonTimer) return; soonTimer = setTimeout(() => { soonTimer = 0; compute(); emit(); save(); }, 2500); }

  /* What has been read is kept on this computer, so every country has its
     level the moment the app opens; the reading then brings it up to date. */
  const STORE = 'temporal-live:energy-watch';
  let savedAt = 0;
  function save(force) {
    if (!force && Date.now() - savedAt < 30000) return;
    savedAt = Date.now();
    try {
      const items = [...state.items.values()].sort((a, b) => b.time - a.time).slice(0, 4000);
      const dedicated = [...state.dedicated].filter(([, d]) => d.status === 'live').map(([iso, d]) => [iso, d.at]);
      const votes = [...outletVotes].slice(-3000).map(([o, m]) => [o, [...m]]);
      localStorage.setItem(STORE, JSON.stringify({ v: 1, items, dedicated, votes, sweep: state.sources.sweep.at }));
    } catch { /* full or refused: the next run reads afresh */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (!d || d.v !== 1) return;
      for (const it of d.items || []) if (Date.now() - it.time < 8 * DAY) state.items.set(it.k, it);
      for (const [iso, at] of d.dedicated || []) state.dedicated.set(iso, { at, status: 'live', pending: false, restored: true });
      for (const [o, m] of d.votes || []) outletVotes.set(o, new Map(m));
      if (d.sweep) Object.assign(state.sources.sweep, { status: 'live', at: d.sweep, note: 'kept from the last run' });
    } catch { /* unreadable: start afresh */ }
  }

  /* ── Levels ── */
  const LEVELS = ['quiet', 'watch', 'strained', 'crisis'];
  const LEVEL_SAY = { crisis: 'Crisis', strained: 'Strained', watch: 'Watch', quiet: 'Quiet' };
  const tone = l => l === 'crisis' ? 'crit' : l === 'strained' ? 'warn' : l === 'watch' ? 'amber' : 'ok';
  function itemsOf(iso, days = 8) {
    return [...state.items.values()].filter(i => i.countries.includes(iso) && Date.now() - i.time < days * DAY).sort((a, b) => b.time - a.time);
  }
  const placeIso = name => { const p = place(String(name || '')); return p.length === 1 ? p[0] : null; };
  function refineriesOf(iso) {
    if (typeof Energy === 'undefined') return [];
    return Energy.state.refineries.filter(r => r.inc && r.status !== 'closed' && placeIso(r.country) === iso);
  }
  function hazardsOf(iso) {
    const ev = (typeof Feeds !== 'undefined' && Feeds.state.events) || [];
    return ev.filter(e => e.kind !== 'EQ' && (e.level === 'red' || e.level === 'orange' || e.kind === 'DR') && e.place && place(String(e.place)).includes(iso));
  }
  function compute() {
    const now = Date.now(), score = new Map();
    for (const it of state.items.values()) {
      const age = now - it.time;
      if (age > 3 * DAY) continue;
      const kind = it.kind || kindOf(it.headline);
      const w = (age < DAY ? 1 : age < 2 * DAY ? 0.6 : 0.3) * WEIGHT[kind] / Math.max(1, it.countries.length);
      for (const c of it.countries) { const s = score.get(c) || { s: 0, n: 0, last: 0, grave: 0, supply: 0 }; s.s += w; s.n++; s.last = Math.max(s.last, it.time); if (it.grave) s.grave++; if (kind === 'supply') s.supply++; score.set(c, s); }
    }
    const level = new Map();
    for (const c of COUNTRIES) {
      const s = score.get(c.iso2) || { s: 0, n: 0, last: 0, grave: 0, supply: 0 };
      let pts = s.s;
      const refs = refineriesOf(c.iso2).filter(r => /destroyed|offline/.test(r.status));
      if (refs.length) pts += 1.5;
      const p = c.p || {};
      // A drought on a hydro grid weighs only where the press already reports trouble.
      if (s.n && (p.hydro || 0) >= 40 && hazardsOf(c.iso2).some(e => e.kind === 'DR')) pts += 1.5;
      // Crisis and strained need reports of the supply failing; cuts alone
      // (a storm, a fault) or market talk stay at watch however many.
      const l = s.supply >= 5 && pts >= 8 ? 'crisis' : s.supply >= 2 && pts >= 3.5 ? 'strained' : pts >= 1 || s.n >= 2 ? 'watch' : 'quiet';
      level.set(c.iso2, { level: l, score: Math.round(pts * 10) / 10, n: s.n, last: s.last, grave: s.grave, supply: s.supply });
    }
    state.level = level;
  }

  /* ── Your country ── */
  function homeIso() {
    let v = '';
    try { v = localStorage.getItem(HOME_KEY) || ''; } catch { /* default */ }
    if (v && byIso.has(v)) return v;
    return autoIso();
  }
  let autoCache = { key: '', iso: '' };
  function autoIso() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('matrix-settings')) || {}; } catch { /* none */ }
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) || typeof GlobeKit === 'undefined' || typeof d3 === 'undefined') return '';
    const key = s.latitude + ',' + s.longitude;
    if (autoCache.key === key) return autoCache.iso;
    const f = GlobeKit.countryFeatureAt ? GlobeKit.countryFeatureAt(s.latitude, s.longitude) : GlobeKit.data().countries.find(x => d3.geoContains(x, [s.longitude, s.latitude]));
    const c = f && byNum.get(String(Number(f.id)));
    autoCache = { key, iso: c ? c.iso2 : '' };
    return autoCache.iso;
  }
  function setHome(iso) {
    try { if (iso) localStorage.setItem(HOME_KEY, iso); else localStorage.removeItem(HOME_KEY); } catch { /* refused */ }
    viewIso = null;
    const h = homeIso();
    if (h) readCountry(h, true);
    compute(); emit(); paintSelect();
  }

  /* ── The outlook ── */
  function outlook(iso) {
    const c = byIso.get(iso), p = (c && c.p) || {}, items = itemsOf(iso, 8), out = [];
    const water = items.filter(i => i.water && Date.now() - i.time < 7 * DAY);
    const drought = hazardsOf(iso).filter(e => e.kind === 'DR');
    if ((p.hydro || 0) >= 40) {
      const short = water.length || drought.length;
      out.push({ t: short ? 'crit' : 'ok', h: `Hydro ${Math.round(p.hydro)}% of electricity`,
        s: short ? `Water is short: ${[water.length ? `${water.length} report${water.length > 1 ? 's' : ''} of low rivers or reservoirs this week` : '', drought.length ? 'a GDACS drought on record' : ''].filter(Boolean).join(' and ')}. With this much hydro, cuts last until the rains return.`
          : 'Supply follows rainfall and river flows; no low-water report this week.' });
    }
    if (Number.isFinite(p.oilSelf)) {
      const brent = typeof Energy !== 'undefined' && Energy.state.oil.brent;
      const yr = brent && brent.series && brent.series.length ? (brent.price - brent.series[0].v) / brent.series[0].v * 100 : null;
      if (p.oilSelf < 50) out.push({ t: yr != null && yr > 25 ? 'warn' : 'ok', h: `Imports most of its oil (produces ${p.oilSelf}% of what it uses)`,
        s: brent ? `Brent ${brent.price.toFixed(0)} USD, ${yr >= 0 ? '+' : '−'}${Math.abs(yr || 0).toFixed(0)}% in a year: fuel and oil-fired power cost more.` : 'Exposed to the oil price.' });
      else if (p.oilSelf >= 100) out.push({ t: 'ok', h: `Produces more oil than it uses (${p.oilSelf}%)`, s: 'Shortages here come from refining, distribution or money, not from the crude.' });
    }
    if ((p.oil || 0) >= 15) out.push({ t: 'ok', h: `Oil burns ${Math.round(p.oil)}% of its electricity`, s: 'Diesel and fuel-oil plants: the backup when hydro or gas fails, and the first hit by fuel shortages.' });
    if (Number.isFinite(p.gasSelf) && p.gasSelf < 50 && (p.gas || 0) >= 25) out.push({ t: 'warn', h: `Gas makes ${Math.round(p.gas)}% of its electricity, mostly imported`, s: 'LNG and pipeline supply decide the grid.' });
    if ((p.elecImport || 0) >= 10) out.push({ t: 'warn', h: `Imports ${Math.round(p.elecImport)}% of its electricity`, s: 'A neighbour’s shortage becomes its own.' });
    const refs = refineriesOf(iso);
    if (refs.length) out.push({ t: refs.some(r => /destroyed|offline/.test(r.status)) ? 'crit' : 'warn', h: `${refs.length} refiner${refs.length > 1 ? 'ies' : 'y'} in the incident register`, s: refs.map(r => `${r.name} (${Energy.STATUS[r.status].label.toLowerCase()})`).join(', ') + '.' });
    const hz = hazardsOf(iso).filter(e => e.kind !== 'DR');
    if (hz.length) out.push({ t: hz.some(e => e.level === 'red') ? 'crit' : 'warn', h: `${hz.length} disaster${hz.length > 1 ? 's' : ''} on the ground (GDACS)`, s: hz.slice(0, 3).map(e => e.headline).join(' · ') });
    const ahead = items.filter(i => i.ahead && Date.now() - i.time < 5 * DAY).slice(0, 4);
    return { factors: out, ahead };
  }

  /* ── The page (Energy) ── */
  let viewIso = null, filt = { level: 'active', q: '' }, sig = '';
  const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  function mixBar(p) {
    const parts = [['hydro', 'Hydro', '#3d8bfd'], ['gas', 'Gas', '#e8a33d'], ['oil', 'Oil', '#b5651d'], ['coal', 'Coal', '#6e6e6e'], ['nuclear', 'Nuclear', '#9b6bff'], ['wind', 'Wind', '#36c2b4'], ['solar', 'Solar', '#f2cc39'], ['biofuel', 'Bio', '#6cab4c'], ['other_renewables', 'Other', '#8fb3a6']]
      .filter(([k]) => (p[k] || 0) > 0.4);
    if (!parts.length) return '<p class="map-hint">No electricity mix on record.</p>';
    return `<div class="cw-mix" role="img" aria-label="Electricity mix">${parts.map(([k, l, col]) => `<i style="flex:${p[k]};background:${col}" title="${l} ${p[k]}%"></i>`).join('')}</div>
      <div class="cw-mix-key">${parts.map(([k, l, col]) => `<span><b style="background:${col}"></b>${l} ${Math.round(p[k])}%</span>`).join('')}</div>
      <p class="cw-mix-src">Electricity ${p.year || ''}${p.twh ? ` · ${p.twh} TWh` : ''} · Our World in Data</p>`;
  }
  function countryCard(iso, isHome) {
    const c = byIso.get(iso);
    if (!c) return '';
    const L = state.level.get(iso) || { level: 'quiet', n: 0 }, items = itemsOf(iso, 8), o = outlook(iso), d = state.dedicated.get(iso);
    const fresh = it => Date.now() - it.seen < 30 * MIN && Date.now() - it.time < 12 * HOUR;
    return `<div class="cw-head t-${tone(L.level)}">
        <div><span class="eyebrow">${isHome ? 'YOUR COUNTRY' : 'COUNTRY'} · ENERGY</span><strong>${esc(c.name)}</strong></div>
        <div class="cw-level"><b>${esc(LEVEL_SAY[L.level].toUpperCase())}</b><small>${L.n} report${L.n === 1 ? '' : 's'} in 72 h${L.last ? ' · latest ' + ago(L.last) : ''}</small></div>
      </div>
      <div class="cw-cols">
        <div class="cw-news"><span class="eyebrow">REPORTS · ${esc((c.hl || 'en').toUpperCase())} AND ENGLISH · ${d && d.at ? 'READ ' + ago(d.at) : 'READING…'}</span>
          <ol class="inc-list news">${items.length ? items.slice(0, 14).map(i => `<li><time>${esc(ago(i.time))}</time><span>${fresh(i) ? '<em class="en-new">NEW</em> ' : ''}<a href="${esc(i.link)}" target="_blank" rel="noreferrer noopener" class="${i.grave ? 'cw-grave' : ''}">${esc(i.headline)} ↗</a>${i.outlet ? ` <small>${esc(i.outlet)}</small>` : ''}</span></li>`).join('')
            : `<li class="map-hint">${d && d.status === 'error' ? 'Google News did not answer: ' + esc(d.note) : d && d.at ? 'No report of cuts, shortages or an energy crisis in the last eight days.' : 'Reading…'}</li>`}</ol>
        </div>
        <div class="cw-outlook"><span class="eyebrow">OUTLOOK · WHAT MAKES THE SUPPLY FRAGILE, AND WHETHER IT IS IN PLAY</span>
          ${o.ahead.length ? `<div class="cw-ahead"><span class="eyebrow">ANNOUNCED AHEAD</span>${o.ahead.map(i => `<a href="${esc(i.link)}" target="_blank" rel="noreferrer noopener">${esc(i.headline)} ↗</a>`).join('')}</div>` : ''}
          <ul class="cw-factors">${o.factors.map(f => `<li class="t-${f.t}"><b>${esc(f.h)}</b><span>${esc(f.s)}</span></li>`).join('') || '<li><span>No profile on record for this country.</span></li>'}</ul>
          ${mixBar(c.p || {})}
        </div>
      </div>`;
  }
  function tableRows() {
    const q = filt.q.toLowerCase();
    return COUNTRIES.map(c => ({ c, L: state.level.get(c.iso2) || { level: 'quiet', score: 0, n: 0, last: 0 } }))
      .filter(({ c, L }) => (filt.level === 'all' || (filt.level === 'active' ? L.level !== 'quiet' : L.level === filt.level)) && (!q || `${c.name} ${c.names.join(' ')}`.toLowerCase().includes(q)))
      .sort((a, b) => LEVELS.indexOf(b.L.level) - LEVELS.indexOf(a.L.level) || b.L.score - a.L.score || a.c.name.localeCompare(b.c.name));
  }
  function paint() {
    const host = $('watch-body');
    if (!host) return;
    const home = homeIso(), show = viewIso || home;
    const s = JSON.stringify([home, show, filt, state.items.size, coverage().n, [...state.level.values()].map(v => v.level[0]).join(''), [...state.dedicated.values()].map(d => d.at),
      Object.values(state.sources).map(x => x.status), Math.floor(Date.now() / MIN)]);
    if (s === sig) return;
    const focus = document.activeElement && document.activeElement.id, caret = focus && document.activeElement.selectionStart;
    sig = s;
    const rows = tableRows();
    const count = l => [...state.level.values()].filter(v => l === 'active' ? v.level !== 'quiet' : v.level === l).length;
    host.innerHTML = `<section class="panel cw-main">
        <header class="panel-head"><h2>${show ? (show === home ? 'Your country' : 'Country') : 'Your country'}</h2>
          ${viewIso && home && viewIso !== home ? `<button type="button" class="btn ghost sm" data-cw-home>← ${esc(byIso.get(home).name)}</button>` : ''}
          <label class="cw-pick">Home country <select id="cw-home-select" aria-label="Your home country">${selectOptions()}</select></label></header>
        <div class="cw-body">${show ? countryCard(show, show === home) : `<p class="cw-empty">Choose your country above (or set your latitude and longitude in Settings) for a dedicated watch and alerts.</p>`}</div>
      </section>
      <section class="panel cw-list">
        <header class="panel-head"><h2>Every country</h2><span class="panel-meta">${(() => { const cv = coverage(); return esc(`${cv.n} of ${cv.of} read in full · ` + (state.sources.sweep.status === 'live' ? 'sweep ' + ago(state.sources.sweep.at) : state.sources.sweep.status === 'error' ? 'sweep failed' : 'first sweep…')); })()}</span></header>
        <div class="en-tools"><div class="chips">${[['active', 'With reports'], ['crisis', 'Crisis'], ['strained', 'Strained'], ['watch', 'Watch'], ['all', 'All']].map(([k, l]) => `<button type="button" class="chip${filt.level === k ? ' on' : ''}" data-cwf="${k}">${l} <b>${k === 'all' ? COUNTRIES.length : count(k)}</b></button>`).join('')}</div>
          <input id="cw-query" class="control search" type="search" placeholder="Find a country" value="${esc(filt.q)}" aria-label="Find a country"></div>
        <div class="work-list en-list cw-table"><table class="grid"><colgroup><col style="width:28px"><col><col style="width:84px"><col style="width:42px"><col style="width:64px"></colgroup><thead><tr><th></th><th>Country</th><th>Level</th><th>72 h</th><th>Latest</th></tr></thead><tbody>
          ${rows.length ? rows.slice(0, 260).map(({ c, L }) => { const top = itemsOf(c.iso2, 3)[0];
            return `<tr data-cw="${c.iso2}" class="lvl-${tone(L.level) === 'crit' ? 'red' : tone(L.level) === 'warn' || tone(L.level) === 'amber' ? 'orange' : 'none'}${c.iso2 === show ? ' on' : ''}"><td class="c-glyph">${c.iso2 === home ? '⌂' : '●'}</td>
              <td class="c-name">${esc(c.name)}<span>${esc(top ? top.headline : '')}</span></td><td class="c-value"${checked(c.iso2) ? '' : ' title="Provisional: from the news sweep only; this country’s own search has not run yet"'}>${esc(LEVEL_SAY[L.level])}${checked(c.iso2) ? '' : '<i class="cw-prov">?</i>'}</td><td class="c-kind">${L.n || ''}</td><td class="c-time">${L.last ? esc(ago(L.last)) : ''}</td></tr>`; }).join('')
            : '<tr class="empty"><td colspan="5">Nothing matches.</td></tr>'}
        </tbody></table></div>
      </section>`;
    if (focus && $(focus)) { const n = $(focus); n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* not text */ } }
  }
  function selectOptions() {
    let stored = '';
    try { stored = localStorage.getItem(HOME_KEY) || ''; } catch { /* none */ }
    const auto = autoIso();
    return `<option value=""${!stored ? ' selected' : ''}>${auto ? `Automatic — ${esc(byIso.get(auto).name)} (from your location)` : 'Automatic — set your location in Settings'}</option>` +
      COUNTRIES.map(c => `<option value="${c.iso2}"${stored === c.iso2 ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  function paintSelect() {
    const s = $('home-country');
    if (s) s.innerHTML = selectOptions();
  }
  function wire() {
    document.addEventListener('click', e => {
      const f = e.target.closest('[data-cwf]');
      if (f) { filt.level = f.dataset.cwf; paint(); return; }
      if (e.target.closest('[data-cw-home]')) { viewIso = null; paint(); return; }
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-cw]');
      if (row) { viewIso = row.dataset.cw === homeIso() ? null : row.dataset.cw; readCountry(row.dataset.cw); sig = ''; paint(); const m = document.querySelector('.cw-main'); if (m) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    document.addEventListener('input', e => { if (e.target.id === 'cw-query') { filt.q = e.target.value; paint(); } });
    document.addEventListener('change', e => { if (e.target.id === 'cw-home-select' || e.target.id === 'home-country') setHome(e.target.value); });
    onUpdate(() => { if (typeof Views !== 'undefined' && Views.current === 'energy') paint(); });
    paintSelect();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  /* ── For the alert log ── */
  // The last level seen for your country, kept on this computer: a restart
  // starts from nothing, and that is not a rise.
  const LEVEL_KEY = 'temporal-live:energy-level';
  let lastLevel = {};
  try { lastLevel = JSON.parse(localStorage.getItem(LEVEL_KEY)) || {}; } catch { lastLevel = {}; }
  const ready = iso => { const d = state.dedicated.get(iso); return !!(d && d.status === 'live' && state.sources.sweep.status === 'live'); };
  function alertCandidates(opts = {}) {
    const out = [], home = homeIso();
    if (home && opts.home !== false) {
      const c = byIso.get(home), items = itemsOf(home, 1).filter(i => Date.now() - i.time < 12 * HOUR);
      // At most one alert in six hours: the gravest, newest report of the window.
      const buckets = new Map();
      for (const i of items) { const b = Math.floor(i.time / (6 * HOUR)); (buckets.get(b) || buckets.set(b, []).get(b)).push(i); }
      for (const [b, list] of buckets) {
        const top = list.slice().sort((x, y) => y.grave - x.grave || y.time - x.time)[0];
        out.push({ key: `energy:home:${home}:${b}`, rule: 'energy', level: list.some(i => i.grave) ? 'red' : 'orange', time: top.time,
          title: `${c.name} · ${top.headline}`, body: `${list.length} report${list.length > 1 ? 's' : ''} on the power and fuel supply in ${c.name} since ${new Date(b * 6 * HOUR).toUTCString().slice(17, 22)} UTC${top.outlet ? ' · ' + top.outlet : ''}`, link: top.link });
      }
      const L = state.level.get(home);
      if (L && ready(home)) {
        const prev = lastLevel[home];
        if (prev && LEVELS.indexOf(L.level) > LEVELS.indexOf(prev)) out.push({ key: `energy:level:${home}:${L.level}:${new Date().toISOString().slice(0, 10)}`, rule: 'energy', level: L.level === 'crisis' ? 'red' : 'orange', time: Date.now(),
          title: `${c.name} · energy level now ${LEVEL_SAY[L.level].toLowerCase()}`, body: `${L.n} reports in 72 hours on cuts, shortages or rationing.`, link: '' });
      }
      if (L && ready(home) && lastLevel[home] !== L.level) { lastLevel[home] = L.level; try { localStorage.setItem(LEVEL_KEY, JSON.stringify(lastLevel)); } catch { /* refused */ } }
    }
    if (opts.world) for (const [iso, L] of state.level) {
      if (L.level !== 'crisis' || iso === home) continue;
      const c = byIso.get(iso), top = itemsOf(iso, 3)[0];
      out.push({ key: `energy:world:${iso}:${new Date().toISOString().slice(0, 10)}`, rule: 'energy', level: 'orange', time: L.last || Date.now(),
        title: `${c.name} · energy crisis`, body: top ? top.headline : `${L.n} reports in 72 hours`, link: top ? top.link : '' });
    }
    return out;
  }

  /* ── For the globe: countries shaded by level ── */
  function fills() {
    if (typeof GlobeKit === 'undefined') return [];
    const out = [];
    for (const f of GlobeKit.data().countries) {
      const c = byNum.get(String(Number(f.id)));
      const L = c && state.level.get(c.iso2);
      if (L && L.level !== 'quiet') out.push({ g: f, level: L.level === 'crisis' ? 'red' : L.level === 'strained' ? 'orange' : 'amber', iso: c.iso2 });
    }
    return out;
  }
  function statusAt(lat, lon) {
    if (typeof GlobeKit === 'undefined') return null;
    const f = GlobeKit.countryFeatureAt ? GlobeKit.countryFeatureAt(lat, lon) : GlobeKit.data().countries.find(x => d3.geoContains(x, [lon, lat]));
    const c = f && byNum.get(String(Number(f.id)));
    return c ? { c, L: state.level.get(c.iso2) || { level: 'quiet', n: 0 } } : null;
  }

  /* ── Every country read the same way ──
     The sweeps only find a country when one of a few hundred headlines a
     day names it; a country's own search finds far more. So every country
     gets its own search, in the background: those the sweeps or the
     register flag first and then every half hour, the rest in rotation
     about every ninety minutes. Three countries are read at once, a second
     apart; when Google refuses, the readers wait and slow down. The first
     full round takes a few minutes; what was read is kept for the next run.
     Until its first search, a country's level is marked provisional. */
  const READ_EVERY = { flagged: 10 * MIN, rest: 90 * MIN };
  const READERS = 3;
  let backoff = 0, pauseUntil = 0;
  async function reader() {
    for (;;) {
      await new Promise(r => setTimeout(r, Math.max(1200, pauseUntil - Date.now())));
      const iso = nextToRead();
      if (!iso) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const ok = await readCountry(iso);
      if (ok === 0) { backoff = Math.min(6, backoff + 1); pauseUntil = Date.now() + 15000 * 2 ** backoff; }
      else if (ok) backoff = Math.max(0, backoff - 1);
    }
  }
  const REAL = COUNTRIES.filter(c => c.p && Object.keys(c.p).length > 1);
  function nextToRead() {
    const now = Date.now(), last = iso => { const d = state.dedicated.get(iso); return d ? d.at || 0 : 0; };
    const busy = iso => { const d = state.dedicated.get(iso); return d && (d.pending || (d.failedAt && now - d.failedAt < 2 * MIN)); };
    const flagged = REAL.filter(c => { const L = state.level.get(c.iso2); return L && L.level !== 'quiet' && !busy(c.iso2) && now - last(c.iso2) > READ_EVERY.flagged; })
      .sort((a, b) => (state.level.get(b.iso2).score - state.level.get(a.iso2).score) || last(a.iso2) - last(b.iso2));
    if (flagged.length) return flagged[0].iso2;
    const rest = REAL.filter(c => !busy(c.iso2) && now - last(c.iso2) > READ_EVERY.rest).sort((a, b) => last(a.iso2) - last(b.iso2));
    return rest.length ? rest[0].iso2 : null;
  }
  const checked = iso => { const d = state.dedicated.get(iso); return !!(d && d.status === 'live'); };
  function coverage() { const n = REAL.filter(c => checked(c.iso2)).length; return { n, of: REAL.length }; }

  /* ── Running ── */
  let started = false;
  function start() {
    if (started) return;
    started = true;
    load(); compute(); emit();
    setTimeout(() => { const h = homeIso(); if (h) readCountry(h, true); }, 4000);
    setTimeout(readSweeps, 9000);
    setInterval(() => { const h = homeIso(); if (h) readCountry(h, true); }, 10 * MIN);
    setInterval(readSweeps, 20 * MIN);
    // The readers start a little after the first sweep, which flags where to look first.
    setTimeout(() => { for (let i = 0; i < READERS; i++) setTimeout(reader, i * 400); }, 20000);
    setInterval(() => { compute(); emit(); }, 5 * MIN);
    window.addEventListener('beforeunload', () => save(true));
  }
  function view(iso) { viewIso = iso === homeIso() ? null : iso; readCountry(iso); sig = ''; paint(); }
  return { state, start, onUpdate, paint, view, coverage, homeIso, setHome, fills, statusAt, alertCandidates, LEVEL_SAY, tone, byIso, place, isEnergy };
})();
