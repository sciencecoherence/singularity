'use strict';
/* ── War observatory ──────────────────────────────────────────────────────
   Every ongoing armed conflict, and what is happening in each now.

     The theatres         Wikipedia's List of ongoing armed conflicts: each
                          war with where it is fought, when it began, and its
                          editors' death tallies for this year and last, in
                          four tiers (10,000+ deaths a year, 1,000+, 100+,
                          fewer). Read twice a day.
     The reports          what the World feeds already read for war —
                          Wikipedia's curated Current events ("Armed
                          conflicts and attacks"), the foreign desks of Al
                          Jazeera, BBC World and UN News, GDELT — and a news
                          sweep of its own in six languages every 20
                          minutes, each headline placed in the countries it
                          names and filed under the theatre fought there.

   The death tallies are Wikipedia's, sourced row by row on the page and only
   as current as its editors; they are lower bounds where a range is given.  */

const War = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const COUNTRIES = typeof CountryData !== 'undefined' ? CountryData : [];
  const byIso = new Map(COUNTRIES.map(c => [c.iso2, c]));
  const byNum = new Map(COUNTRIES.map(c => [String(Number(c.num)), c]));
  const fmtInt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  const ago = ms => { const s = (Date.now() - ms) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  const TIERS = [
    { k: 'major', id: 'conflicts10000', label: 'Major war', say: '10,000+ deaths a year', tone: 'crit' },
    { k: 'minor', id: 'conflicts1000', label: 'Minor war', say: '1,000–9,999 deaths a year', tone: 'warn' },
    { k: 'conflict', id: 'conflicts100', label: 'Conflict', say: '100–999 deaths a year', tone: 'amber' },
    { k: 'skirmish', id: 'conflicts1', label: 'Skirmishes', say: 'fewer than 100 deaths a year', tone: 'ok' }
  ];
  const TIER = Object.fromEntries(TIERS.map((t, i) => [t.k, { ...t, rank: 4 - i }]));

  const state = {
    theatres: [],          // { id, name, title, tier, since, continent, places:[iso2], placeNames, names:[lowercase sub-conflicts], dead:{year:n}, cum }
    years: [],             // the two year columns of the list, e.g. [2025, 2026]
    at: 0,
    items: new Map(),      // the news sweep: normalised headline → item
    sources: {
      theatres: { label: 'War · Wikipedia list of ongoing conflicts', status: 'waiting', at: null, note: '' },
      sweep: { label: 'War · news sweep', status: 'waiting', at: null, note: '' }
    }
  };

  /* ── Keeping what was read ── */
  const STORE = 'temporal-live:war';
  function save() {
    try {
      const items = [...state.items.values()].sort((a, b) => b.time - a.time).slice(0, 900);
      localStorage.setItem(STORE, JSON.stringify({ theatres: state.bundled ? [] : state.theatres, years: state.years, at: state.bundled ? 0 : state.at, items }));
    } catch { /* full or refused */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (!d) return;
      state.theatres = d.theatres || []; state.years = d.years || []; state.at = d.at || 0;
      for (const i of d.items || []) if (Date.now() - i.time < 5 * DAY) state.items.set(i.k, i);
    } catch { /* nothing kept */ }
  }

  /* ── Countries ── */
  const ALIAS = { 'palestine': 'PS', 'state of palestine': 'PS', 'gaza strip': 'PS', 'west bank': 'PS', 'sahrawi republic': 'EH', 'western sahara': 'EH',
    'democratic republic of the congo': 'CD', 'dr congo': 'CD', 'republic of the congo': 'CG', 'congo': 'CG', 'ivory coast': 'CI', "côte d'ivoire": 'CI',
    'north korea': 'KP', 'south korea': 'KR', 'kosovo': 'XK', 'east timor': 'TL', 'myanmar': 'MM', 'burma': 'MM', 'turkey': 'TR', 'türkiye': 'TR',
    'united states': 'US', 'united kingdom': 'GB', 'russia': 'RU', 'syria': 'SY', 'iran': 'IR', 'laos': 'LA', 'vietnam': 'VN', 'bolivia': 'BO', 'venezuela': 'VE',
    'tanzania': 'TZ', 'moldova': 'MD', 'transnistria': 'MD', 'abkhazia': 'GE', 'south ossetia': 'GE', 'northern cyprus': 'CY', 'somaliland': 'SO', 'taiwan': 'TW' };
  function isoOf(name) {
    const n = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!n) return '';
    if (ALIAS[n]) return byIso.has(ALIAS[n]) ? ALIAS[n] : '';
    for (const c of COUNTRIES) if (c.name.toLowerCase() === n || c.names.some(x => x.toLowerCase() === n)) return c.iso2;
    return '';
  }
  // Places and parties that name a war's country without naming the country.
  const WAR_PLACES = [
    [/\bgaza|\bhamas\b|west bank|cisjordan|ramallah|rafah|khan you?nis|غزة|حماس|газ[аеу]\b/i, 'PS'],
    [/hezbollah|hizbollah|hizbul|حزب الله|хезболл/i, 'LB'],
    [/houthi|hut[ií]e?s|houthiste|ansar allah|sana'?a\b|الحوثي|хусит/i, 'YE'],
    [/donbas|donbass|donetsk|luhansk|lugansk|kharkiv|kharkov|zaporizh|kherson|crimea|crim[eé]e|odesa|odessa|kyiv|kiev|kiew|kursk|pokrovsk|донбасс|донецк|луганск|харьков|запорож|херсон|крым|киев|одесс|всу\b/i, 'UA'],
    [/\bidf\b|tel aviv|netanyahu|tsahal|נתניהו/i, 'IL'],
    [/darfur|el[- ]fasher|kordofan|\brsf\b|rapid support forces|khartoum|جنجويد|الدعم السريع|дарфур/i, 'SD'],
    [/\bm23\b|goma|kivu|ituri|bukavu/i, 'CD'],
    [/tigray|amhara|fano\b|oromia/i, 'ET'],
    [/al-?shabaa?b|mogadishu|puntland/i, 'SO'],
    [/rakhine|arakan army|myanmar junta|tatmadaw|naypyidaw/i, 'MM'],
    [/taliban|kabul/i, 'AF'],
    [/balochistan|baluchistan|khyber|waziristan|\bttp\b/i, 'PK'],
    [/boko haram|iswap|borno|zamfara/i, 'NG'],
    [/\bjnim\b|azawad|bamako/i, 'ML'], [/ouagadougou/i, 'BF'], [/niamey/i, 'NE'],
    [/cartel de sinaloa|sinaloa cartel|\bcjng\b|culiac[aá]n|michoac[aá]n/i, 'MX'],
    [/\beln\b|catatumbo|farc dissident|disidencias de las farc/i, 'CO'],
    [/haitian gang|viv ansanm|port-au-prince|puerto pr[ií]ncipe/i, 'HT'],
    [/\birgc\b|tehran|teher[aá]n|t[ée]h[ée]ran|طهران|тегеран/i, 'IR'],
    [/kremlin|moscow|moscú|moscou|москв|кремл/i, 'RU']
  ];
  function place(t) {
    const base = (typeof Watch !== 'undefined' && Watch.place) ? Watch.place(t) : [];
    const extra = WAR_PLACES.filter(([re]) => re.test(t)).map(([, iso]) => iso);
    return [...new Set([...base, ...extra])];
  }
  const nameOf = iso => (byIso.get(iso) || {}).name || iso;

  /* ── The theatres: Wikipedia's List of ongoing armed conflicts ── */
  const firstNum = s => { const m = String(s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  function parseList(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('sup, style, .mw-editsection').forEach(n => n.remove());
    const out = [];
    let years = [];
    for (const t of TIERS) {
      const table = doc.getElementById(t.id);
      if (!table) continue;
      const rows = [...table.querySelectorAll('tr')];
      const head = rows[0] ? [...rows[0].querySelectorAll('th')].map(th => th.textContent.trim()) : [];
      const yc = head.map((h, i) => [i, (h.match(/^(\d{4}) fatalities/i) || [])[1]]).filter(x => x[1]);
      if (yc.length) years = yc.map(x => +x[1]);
      for (const tr of rows.slice(1)) {
        const td = [...tr.querySelectorAll('td')];
        if (td.length < 5) continue;
        const cell = td[1];
        const top = cell.querySelector('li') || cell;
        const own = [...top.childNodes].filter(n => !(n.nodeType === 1 && n.tagName === 'UL')).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
        const name = own.replace(/\s*\((?:since|from)[^)]*\)\s*$/i, '').trim() || cell.textContent.trim().split('\n')[0];
        const a = top.querySelector('a');
        const title = a ? decodeURIComponent((a.getAttribute('href') || '').replace(/^\/wiki\//, '')) : '';
        const names = [...cell.querySelectorAll('a')].map(x => x.textContent.trim().toLowerCase()).filter(x => x.length > 4 && !/^since|^from|^\d/.test(x));
        const placeNames = [...td[3].querySelectorAll('a')].map(x => x.textContent.trim()).filter(Boolean);
        const places = [...new Set(placeNames.map(isoOf).filter(Boolean))];
        const dead = {};
        yc.forEach(([i, y]) => { const v = firstNum(td[i] && td[i].textContent); if (v != null) dead[y] = v; });
        out.push({ id: t.k + ':' + (title || name), name, title, tier: t.k, since: firstNum(td[0].textContent), continent: td[2].textContent.trim(),
          places, placeNames, names, dead, cum: firstNum(td[4].textContent), cumText: td[4].textContent.replace(/\s+/g, ' ').trim() });
      }
    }
    return { theatres: out, years };
  }
  async function readTheatres(force) {
    if (!force && Date.now() - state.at < 12 * HOUR && state.theatres.length) return;
    const d = await Net.json('https://en.wikipedia.org/w/api.php?action=parse&page=List_of_ongoing_armed_conflicts&prop=text&format=json&formatversion=2&origin=*');
    if (!d || !d.parse) throw new Error('Wikipedia: no list');
    const r = parseList(d.parse.text);
    if (!r.theatres.length) throw new Error('Wikipedia: the list could not be read');
    state.theatres = r.theatres; state.years = r.years; state.at = Date.now(); state.bundled = false;
  }

  /* ── The news sweep ── */
  const GN = (q, hl, gl, ceid) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${ceid}`;
  const SWEEPS = [
    { k: 'en', hl: 'en-US', gl: 'US', ceid: 'en', q: '(airstrike OR "air strike" OR "missile strike" OR "drone strike" OR shelling OR offensive OR ceasefire OR "front line" OR militants OR insurgents OR "armed clashes" OR troops) when:1d' },
    { k: 'fr', hl: 'fr', gl: 'FR', ceid: 'fr', q: '(frappe OR frappes OR bombardement OR drone OR offensive OR "cessez-le-feu" OR combats OR jihadistes OR rebelles) when:1d' },
    { k: 'es', hl: 'es-419', gl: 'US', ceid: 'es-419', q: '(bombardeo OR ataque OR misiles OR drones OR ofensiva OR "alto el fuego" OR combates OR guerrilla OR insurgentes) when:1d' },
    { k: 'ar', hl: 'ar', gl: 'EG', ceid: 'ar', q: '(غارة OR غارات OR قصف OR صواريخ OR مسيرة OR "وقف إطلاق النار" OR اشتباكات) when:1d' },
    { k: 'ru', hl: 'ru', gl: 'RU', ceid: 'ru', q: '(обстрел OR удар OR беспилотник OR наступление OR перемирие OR ВСУ OR фронт) when:1d' },
    { k: 'pt', hl: 'pt-BR', gl: 'BR', ceid: 'pt-419', q: '(bombardeio OR ataque OR ofensiva OR "cessar-fogo" OR combates OR insurgentes) when:1d' }
  ];
  const ABOUT = typeof Wire !== 'undefined' && Wire.CONFLICT ? Wire.CONFLICT : /\bwar\b|strike|attack|troops|fighting/i;
  const MORE = /frappe|bombard|drone|offensive|cessez|combats|jihad|rebelle|ataque|misil|ofensiva|alto el fuego|combate|guerrill|insurgent|غارة|غارات|قصف|صواريخ|مسيرة|إطلاق النار|اشتباك|обстрел|удар|беспилот|наступлен|перемири|ВСУ|фронт|bombardeio|cessar-fogo/i;
  const NOT = /hacker|hackers|ciberataque|cyberattaque|a tiros|tiroteo|fusillade|school shooting|mass shooting|tiroteio|escola|colegio|offensive (?:line|coordinator|lineman|rebound|player|end|tackle|comments?|remarks?|post|joke|language|content)|charm offensive|shelling out|front ?line (?:workers?|staff|nurses?|heroes)|fc\b|football|soccer|nfl|nba|cricket|tennis|game review|video game|film|movie|series|trailer|anniversary|stock|shares|market|price war|trade war|culture war|war on drugs|star wars|console war|ataque (?:de nervios|al corazón|card[ií]aco)|heart attack|panic attack|cyber ?attack/i;
  const KIND = [
    ['diplomacy', /ceasefire|truce|peace (?:talks|deal|plan|agreement|process)|negotiat|prisoner (?:swap|exchange)|cessez-le-feu|négociation|alto el fuego|negociaci|cessar-fogo|وقف إطلاق النار|مفاوضات|перемири|переговор/i],
    ['strike', /air ?strike|missile|drone|shelling|bombard|rocket|frappe|bombardeo|misil|dron|bombardeio|غارة|غارات|قصف|صواريخ|مسيرة|обстрел|удар|беспилот|ракет/i],
    ['ground', /offensive|advance|captur|seiz|front ?line|clash|fighting|combat|troops|incursion|ofensiva|combates|enfrentamiento|avance|combats|offensive|اشتباك|наступлен|фронт|штурм/i],
    ['toll', /killed|dead\b|deaths|casualt|wounded|massacre|muertos|morts|mortos|tués|قتلى|قتيل|погиб|убит/i],
    ['relief', /aid|famine|displaced|refugees|humanitarian|hunger|hambruna|desplazados|réfugiés|déplacés|نازحين|لاجئين|гуманитар|беженц/i]
  ];
  const KIND_SAY = { diplomacy: 'CEASEFIRE · TALKS', strike: 'STRIKE', ground: 'GROUND', toll: 'CASUALTIES', relief: 'HUMANITARIAN' };
  const kindOf = t => (KIND.find(([, re]) => re.test(t)) || ['other'])[0];
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  function split(raw) {
    const i = raw.lastIndexOf(' - ');
    if (i <= 20) return { headline: raw.trim(), outlet: '' };
    let headline = raw.slice(0, i).trim(), outlet = raw.slice(i + 3).trim();
    // Some outlets append their own name twice ("… Por Reuters - Investing.com Brasil - Finanças").
    const j = headline.lastIndexOf(' - ');
    if (j > 20 && /\.(?:com|net|org)\b|reuters|afp|news/i.test(headline.slice(j))) { outlet = headline.slice(j + 3).trim(); headline = headline.slice(0, j).trim(); }
    return { headline, outlet };
  }
  function take(items, via) {
    let added = 0;
    for (const it of items) {
      if (!it.time || Date.now() - it.time > 3 * DAY) continue;
      const { headline, outlet } = split(it.title);
      if (!(ABOUT.test(headline) || MORE.test(headline)) || NOT.test(headline)) continue;
      const countries = place(headline);
      if (!countries.length || countries.length > 4) continue;
      const k = norm(headline);
      if (state.items.has(k)) continue;
      state.items.set(k, { k, headline, outlet, link: it.link, time: it.time, via, countries, tier: 'news' });
      added++;
    }
    return added;
  }
  async function readSweep() {
    let ok = 0;
    const fails = [];
    for (const s of SWEEPS) {
      try { take(await Net.feed(GN(s.q, s.hl, s.gl, s.ceid)), 'sweep:' + s.k); ok++; }
      catch (e) { fails.push(s.k + ': ' + (e.message || e)); }
      await new Promise(r => setTimeout(r, 1200));
    }
    for (const [k, i] of state.items) if (Date.now() - i.time > 5 * DAY) state.items.delete(k);
    Object.assign(state.sources.sweep, ok ? { status: 'live', at: Date.now(), note: `${ok}/${SWEEPS.length} languages` } : { status: state.sources.sweep.at ? 'stale' : 'error', note: fails.join('; ').slice(0, 80) });
  }

  /* ── Every report, filed under its theatre ── */
  // The theatre a report belongs to: one whose sub-conflicts it names (the
  // curated portal files its entries by story), else the strongest theatre
  // fought in every country it names, else in most of them.
  function theatreOf(r) {
    const text = (r.story || '').toLowerCase();
    if (text) { const t = state.theatres.find(x => x.names.some(n => text.includes(n)) || text.includes(x.name.toLowerCase())); if (t) return t; }
    const cs = r.countries || [];
    if (!cs.length) return null;
    let best = null, bestScore = -1;
    for (const t of state.theatres) {
      const hit = cs.filter(c => t.places.includes(c)).length;
      // Filed where it names two of the countries fought in, or one of the two
      // the list names first: a neighbour named alone is not that war's news.
      if (!hit || (hit < 2 && !cs.includes(primary(t)) && !(primary(t) === '' && t.places.length))) continue;
      // Where it is fought first (the list names the main country first) counts double.
      const score = hit * 10 + (cs.includes(t.places[0]) ? 6 : 0) + TIER[t.tier].rank - t.places.length * 0.05;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }
  let cache = { key: '', list: [] };
  function reports() {
    const wire = (typeof Wire !== 'undefined' && Wire.state.world) || [];
    const key = wire.length + '|' + state.items.size + '|' + state.at + '|' + (wire[0] && wire[0].id);
    if (cache.key === key) return cache.list;
    const out = [];
    for (const e of wire) {
      if (e.topic !== 'CONFLICT') continue;
      const story = String(e.detail || '').split(' · ').slice(1).join(' · ');
      const countries = place(e.headline + ' ' + story);
      out.push({ k: e.id, headline: e.headline, outlet: e.place, link: e.link, time: e.time, dayOnly: e.dayOnly, countries, story,
        tier: e.tier === 'curated' ? 'curated' : e.tier === 'reported' ? 'reported' : 'unconfirmed', summary: e.tier === 'reported' ? e.detail : '' });
    }
    const seen = new Set(out.map(r => norm(r.headline)));
    for (const i of state.items.values()) if (!seen.has(i.k) && !NOT.test(i.headline)) { i.countries = place(i.headline); out.push(i); }
    for (const r of out) { const t = theatreOf(r); r.theatre = t ? t.id : null; r.kind = kindOf(r.headline); }
    out.sort((a, b) => b.time - a.time);
    cache = { key, list: out };
    return out;
  }
  const within = (r, ms) => Date.now() - r.time < ms;
  function activity() {
    const per = new Map();
    for (const r of reports()) {
      if (!r.theatre || !within(r, 2 * DAY)) continue;
      const a = per.get(r.theatre) || { n: 0, day: 0, strike: 0, last: 0 };
      a.n++; if (within(r, DAY)) a.day++; if (r.kind === 'strike') a.strike++; a.last = Math.max(a.last, r.time);
      per.set(r.theatre, a);
    }
    return per;
  }

  /* ── The globe: countries at war, hatched by tier ── */
  /* A country takes a conflict's tier where the list names it first (where
     it is fought). Named further down — a neighbour, a backer, a place of
     spillover — it shows on the evidence of the week's reports filed under
     that conflict naming it: twelve or more, the conflict's tier; five or
     more, one tier lower; two or more, the lowest shading; fewer, nothing. */
  const TIER_INDEX = k => TIERS.findIndex(x => x.k === k);
  // Where a conflict is fought: the country the list names first — unless the
  // list is alphabetical (the Sahel's is), which says nothing about where.
  function primary(t) {
    const n = t.placeNames || [];
    const alpha = n.length >= 4 && n.every((x, i) => !i || n[i - 1].localeCompare(x) <= 0);
    return alpha ? '' : isoOf(n[0]);
  }
  function levelOf(iso) {
    let best = null, bestIdx = 9;
    for (const t of state.theatres) {
      if (!t.places.includes(iso)) continue;
      let idx = TIER_INDEX(t.tier);
      if (primary(t) !== iso) {
        const n = reports().filter(r => r.theatre === t.id && r.countries.includes(iso) && within(r, 7 * DAY)).length;
        // An alphabetical list names where it is fought without ranking it:
        // each of its countries shades at least at the lowest tier.
        const floor = primary(t) === '' ? 2 : 9;
        idx = n >= 12 ? idx : n >= 5 ? Math.max(idx, Math.min(2, idx + 1)) : n >= 2 ? Math.max(idx, 2) : floor;
      }
      if (idx < bestIdx) { bestIdx = idx; best = t; }
    }
    return best && bestIdx < 4 ? { tier: TIERS[bestIdx].k, theatre: best } : null;
  }
  let fillCache = { key: '', out: [] };
  function fills() {
    if (typeof GlobeKit === 'undefined' || !state.theatres.length) return [];
    reports();
    if (fillCache.key === cache.key + state.at) return fillCache.out;
    const out = [];
    for (const f of GlobeKit.data().countries) {
      const c = byNum.get(String(Number(f.id)));
      const L = c && levelOf(c.iso2);
      if (L) out.push({ g: f, level: L.tier === 'major' ? 'red' : L.tier === 'minor' ? 'orange' : 'amber', hatch: true, alpha: L.tier === 'skirmish' ? 0.25 : undefined, iso: c.iso2 });
    }
    fillCache = { key: cache.key + state.at, out };
    return out;
  }
  function statusAt(lat, lon) {
    if (typeof GlobeKit === 'undefined' || typeof d3 === 'undefined') return null;
    const f = GlobeKit.countryFeatureAt ? GlobeKit.countryFeatureAt(lat, lon) : GlobeKit.data().countries.find(x => d3.geoContains(x, [lon, lat]));
    const c = f && byNum.get(String(Number(f.id)));
    const L = c && levelOf(c.iso2);
    return L ? { c, ...L, label: TIER[L.tier].label } : null;
  }

  /* ── Reading, on a schedule ── */
  async function run(key, fn) {
    const s = state.sources[key];
    try { await fn(); if (key !== 'sweep') Object.assign(s, { status: 'live', at: Date.now(), note: '' }); }
    catch (e) { Object.assign(s, { status: state.theatres.length && key === 'theatres' ? 'stale' : s.at ? 'stale' : 'error', note: String(e.message || e).slice(0, 80) }); }
    cache.key = ''; save(); emit();
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    load();
    // Nothing read yet on this computer: the list as bundled, until Wikipedia answers.
    if (!state.theatres.length && typeof WarData !== 'undefined') {
      state.theatres = WarData.theatres.map(t => ({ ...t, places: [...new Set(t.placeNames.map(isoOf).filter(Boolean))] }));
      state.years = WarData.years; state.at = WarData.at; state.bundled = true;
    }
    if (state.at) Object.assign(state.sources.theatres, { status: 'live', at: state.at, note: state.bundled ? 'bundled list' : 'kept' });
    setTimeout(() => run('theatres', () => readTheatres(state.bundled)), 4000);
    // A refused read is tried again in ten minutes, not three hours.
    setInterval(() => { if (state.sources.theatres.status !== 'live' || state.bundled) run('theatres', () => readTheatres(true)); }, 10 * MIN);
    setTimeout(() => run('sweep', readSweep), 15000);
    setInterval(() => run('theatres', () => readTheatres()), 3 * HOUR);
    setInterval(() => run('sweep', readSweep), 20 * MIN);
    if (typeof Wire !== 'undefined') Wire.onUpdate(() => { cache.key = ''; emit(); });
  }
  async function refresh() { await run('theatres', () => readTheatres(true)); await run('sweep', readSweep); }

  /* ── The page ── */
  let sig = '', pick = null, feedFilter = 'all', feedQ = '', tierFilter = 'all';
  const summaries = new Map();
  async function summary(title) {
    if (summaries.has(title)) return summaries.get(title);
    summaries.set(title, null);
    try { const d = await Net.json('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title)); summaries.set(title, (d && d.extract) || ''); }
    catch { summaries.set(title, ''); }
    sig = ''; paint();
    return summaries.get(title);
  }
  const TIER_TAG = { curated: 'CURATED', reported: 'NEWSROOM', unconfirmed: 'GDELT', news: 'NEWS' };
  function reportLi(r, showTheatre) {
    const t = showTheatre && r.theatre && state.theatres.find(x => x.id === r.theatre);
    return `<li><time>${esc(r.dayOnly ? new Date(r.time).toISOString().slice(5, 10).replace('-', '/') : ago(r.time))}</time><span>
      <em class="wr-tag k-${r.kind}">${esc(KIND_SAY[r.kind] || 'REPORT')}</em> <a href="${esc(r.link)}" target="_blank" rel="noreferrer noopener">${esc(r.headline)} ↗</a>
      <small>${esc([TIER_TAG[r.tier], r.outlet, t ? t.name : r.countries.map(nameOf).join(', ')].filter(Boolean).join(' · '))}</small></span></li>`;
  }
  function kpis(act, all) {
    const count = k => state.theatres.filter(t => t.tier === k).length;
    const y = state.years[state.years.length - 1];
    const dead = state.theatres.reduce((s, t) => s + (t.dead[y] || 0), 0);
    const day = all.filter(r => within(r, DAY));
    const cell = (label, value, note, cls = '') => `<div class="kpi ${cls}"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
    return cell('Major wars', count('major') || '—', '10,000+ deaths a year', 'wr-k-crit') + cell('Minor wars', count('minor') || '—', '1,000–9,999 deaths a year', 'wr-k-warn') +
      cell('Conflicts · skirmishes', state.theatres.length ? `${count('conflict')} · ${count('skirmish')}` : '—', 'under 1,000 deaths a year') +
      cell(`Deaths in ${y || 'this year'}`, dead ? fmtInt(dead) + '+' : '—', 'Wikipedia tallies, lower bounds') +
      cell('Reports · 24 h', day.length || '—', `${day.filter(r => r.kind === 'strike').length} strikes · ${day.filter(r => r.kind === 'diplomacy').length} ceasefire or talks`) +
      cell('Theatres active · 48 h', act.size || '—', 'with reports filed under them');
  }
  function theatresPanel(act) {
    const y = state.years[state.years.length - 1], y0 = state.years[0];
    const rows = state.theatres.filter(t => tierFilter === 'all' || t.tier === tierFilter)
      .sort((a, b) => TIER[b.tier].rank - TIER[a.tier].rank || (b.dead[y] || 0) - (a.dead[y] || 0));
    const src = state.sources.theatres;
    return `<section class="panel wr-theatres">
      <header class="panel-head"><h2>Ongoing armed conflicts</h2><span class="panel-meta">${esc(state.bundled ? `Wikipedia · list as of ${new Date(state.at).toISOString().slice(0, 10)} (bundled) · live read ${src.status === 'waiting' ? 'pending' : 'failed: ' + src.note}` : src.status === 'live' ? 'Wikipedia · ' + ago(state.at) : src.status === 'waiting' ? 'reading…' : (state.at ? 'Wikipedia · ' + ago(state.at) + ' · last read failed' : src.note))}</span></header>
      <div class="en-tools"><div class="chips">${[['all', 'All', state.theatres.length], ...TIERS.map(t => [t.k, t.label + (t.k === 'skirmish' ? '' : 's'), state.theatres.filter(x => x.tier === t.k).length])]
        .map(([k, l, n]) => `<button type="button" class="chip${tierFilter === k ? ' on' : ''}" data-wrt="${k}">${esc(l)} <b>${n}</b></button>`).join('')}</div></div>
      <div class="work-list wr-tlist"><table class="grid"><colgroup><col style="width:24px"><col><col style="width:52px"><col style="width:84px"><col style="width:84px"><col style="width:52px"></colgroup>
        <thead><tr><th></th><th>Conflict</th><th>Since</th><th>Deaths ${esc(y || '')}</th><th>${esc(y0 || '')}</th><th>48 h</th></tr></thead><tbody>
        ${rows.length ? rows.map(t => { const a = act.get(t.id);
          return `<tr data-wr="${esc(t.id)}" class="${t.id === pick ? 'on ' : ''}lvl-${TIER[t.tier].tone === 'crit' ? 'red' : TIER[t.tier].tone === 'warn' ? 'orange' : 'none'}">
            <td class="c-glyph t-${TIER[t.tier].tone}">${t.tier === 'major' ? '■' : t.tier === 'minor' ? '◆' : '●'}</td>
            <td class="c-name">${esc(t.name)}<span>${esc(t.placeNames.slice(0, 6).join(', ') + (t.placeNames.length > 6 ? ` +${t.placeNames.length - 6}` : ''))}</span></td>
            <td class="num">${t.since || ''}</td><td class="num">${t.dead[y] != null ? fmtInt(t.dead[y]) : '—'}</td><td class="num so-dim">${t.dead[y0] != null ? fmtInt(t.dead[y0]) : '—'}</td>
            <td class="num ${a && a.day ? 't-warn' : 'so-dim'}">${a ? a.n : ''}</td></tr>`; }).join('')
          : `<tr class="empty"><td colspan="6">${src.at ? 'None in this tier.' : 'Reading Wikipedia…'}</td></tr>`}
      </tbody></table></div>
    </section>`;
  }
  function detailPanel(act, all) {
    const t = state.theatres.find(x => x.id === pick);
    if (!t) return `<section class="panel wr-detail"><header class="panel-head"><h2>Theatre</h2></header><p class="cw-empty" style="padding:14px">Select a conflict.</p></section>`;
    const y = state.years[state.years.length - 1], y0 = state.years[0], a = act.get(t.id) || { n: 0, day: 0, strike: 0 };
    const mine = all.filter(r => r.theatre === t.id).slice(0, 40);
    const tr = TIER[t.tier];
    if (t.title && !summaries.has(t.title)) summary(t.title);
    const sum = t.title ? summaries.get(t.title) : '';
    return `<section class="panel wr-detail">
      <header class="panel-head"><h2>${esc(t.name)}</h2><button type="button" class="btn ghost sm" data-goto="globe">On the globe →</button></header>
      <div class="wr-dbody">
        <div class="cw-head t-${tr.tone}"><div><span class="eyebrow">${esc(tr.label.toUpperCase())} · ${esc(tr.say.toUpperCase())}</span><strong>${esc(t.placeNames.join(', '))}</strong></div>
          <div class="cw-level"><b>${t.dead[y] != null ? fmtInt(t.dead[y]) : '—'}</b><small>deaths in ${esc(y || '')} · ${t.dead[y0] != null ? fmtInt(t.dead[y0]) : '—'} in ${esc(y0 || '')}</small></div></div>
        <dl class="wr-facts"><div><dt>Since</dt><dd>${t.since || '—'}</dd></div><div><dt>Total deaths</dt><dd>${esc(t.cumText || '—')}</dd></div>
          <div><dt>Reports · 48 h</dt><dd>${a.n} · ${a.strike} strikes</dd></div><div><dt>Continent</dt><dd>${esc(t.continent)}</dd></div></dl>
        ${sum ? `<p class="wr-sum">${esc(sum)} ${t.title ? `<a href="https://en.wikipedia.org/wiki/${esc(t.title)}" target="_blank" rel="noreferrer noopener">Wikipedia ↗</a>` : ''}</p>` : sum === null ? '<p class="wr-sum so-dim">Reading Wikipedia…</p>' : ''}
        <span class="eyebrow">LATEST REPORTS</span>
        <ol class="inc-list news">${mine.length ? mine.map(r => reportLi(r, false)).join('') : '<li class="map-hint">Nothing filed under this conflict in the last days. The sweep places a headline by the countries it names; many small conflicts go days without a headline.</li>'}</ol>
      </div>
    </section>`;
  }
  function feedPanel(all) {
    const q = feedQ.trim().toLowerCase();
    const list = all.filter(r => (feedFilter === 'all' || (feedFilter === 'curated' ? r.tier === 'curated' : feedFilter === 'newsroom' ? r.tier === 'reported' : r.kind === feedFilter))
      && (!q || r.headline.toLowerCase().includes(q) || (r.countries || []).some(c => nameOf(c).toLowerCase().includes(q))) && within(r, 4 * DAY));
    const n = k => all.filter(r => within(r, 4 * DAY) && (k === 'curated' ? r.tier === 'curated' : k === 'newsroom' ? r.tier === 'reported' : r.kind === k)).length;
    return `<section class="panel wr-feed">
      <header class="panel-head"><h2>Every report · 4 days</h2><span class="panel-meta">${esc(state.sources.sweep.status === 'live' ? 'sweep ' + ago(state.sources.sweep.at) + ' · ' + state.sources.sweep.note : state.sources.sweep.status === 'waiting' ? 'first sweep…' : state.sources.sweep.note)} · Wikipedia, Al Jazeera, BBC, UN News, GDELT</span>
        <input id="wr-q" class="control search" type="search" placeholder="Filter by word or country" value="${esc(feedQ)}" aria-label="Filter reports"></header>
      <div class="en-tools"><div class="chips">${[['all', 'All', all.filter(r => within(r, 4 * DAY)).length], ['strike', 'Strikes'], ['ground', 'Ground fighting'], ['toll', 'Casualties'], ['diplomacy', 'Ceasefire · talks'], ['relief', 'Humanitarian'], ['curated', 'Wikipedia curated'], ['newsroom', 'Newsrooms']]
        .map(([k, l, c]) => `<button type="button" class="chip${feedFilter === k ? ' on' : ''}" data-wrf="${k}">${esc(l)} <b>${c != null ? c : n(k)}</b></button>`).join('')}</div></div>
      <ol class="inc-list news wr-list">${list.length ? list.slice(0, 250).map(r => reportLi(r, true)).join('') : '<li class="map-hint">Nothing matches.</li>'}</ol>
    </section>`;
  }
  function paint() {
    const host = $('war-body');
    if (!host) return;
    const all = reports(), act = activity();
    if (!pick || !state.theatres.some(t => t.id === pick)) {
      const busiest = [...act].sort((a, b) => b[1].day - a[1].day || b[1].n - a[1].n)[0];
      pick = busiest ? busiest[0] : (state.theatres[0] || {}).id || null;
    }
    const s = JSON.stringify([pick, feedFilter, feedQ, tierFilter, cache.key, Object.values(state.sources).map(x => x.status + x.at), [...summaries.keys()].length, [...summaries.values()].filter(v => v !== null).length, Math.floor(Date.now() / (5 * MIN))]);
    if (s === sig) return;
    sig = s;
    const focus = document.activeElement && document.activeElement.id, caret = focus && document.activeElement.selectionStart;
    const scrolls = [...host.querySelectorAll('.work-list, .wr-dbody, .wr-list')].map(n => n.scrollTop);
    const k = $('war-kpis');
    if (k) k.innerHTML = kpis(act, all);
    host.innerHTML = `<div class="wr-row">${theatresPanel(act)}${detailPanel(act, all)}</div>${feedPanel(all)}`;
    [...host.querySelectorAll('.work-list, .wr-dbody, .wr-list')].forEach((n, i) => { if (scrolls[i]) n.scrollTop = scrolls[i]; });
    if (focus && $(focus)) { const n = $(focus); n.focus(); try { n.setSelectionRange(caret, caret); } catch { /* not text */ } }
    const srcs = $('war-sources');
    if (srcs) srcs.textContent = `${state.theatres.length} conflicts · ${all.filter(r => within(r, DAY)).length} reports in 24 h`;
  }
  function wire() {
    document.addEventListener('click', e => {
      if (!e.target.closest('#view-war')) return;
      const f = e.target.closest('[data-wrf]'); if (f) { feedFilter = f.dataset.wrf; sig = ''; paint(); return; }
      const t = e.target.closest('[data-wrt]'); if (t) { tierFilter = t.dataset.wrt; sig = ''; paint(); return; }
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-wr]');
      if (row) { pick = row.dataset.wr; sig = ''; paint(); const d = document.querySelector('.wr-dbody'); if (d) d.scrollTop = 0; }
    });
    document.addEventListener('input', e => { if (e.target.id === 'wr-q') { feedQ = e.target.value; sig = ''; paint(); } });
    onUpdate(() => {
      const n = state.theatres.filter(t => t.tier === 'major' || t.tier === 'minor').length, b = $('tab-count-war');
      if (b) b.textContent = n ? String(n) : '';
      if (typeof Views !== 'undefined' && Views.current === 'war') paint();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  return { state, start, paint, refresh, onUpdate, fills, statusAt, reports, TIER };
})();
