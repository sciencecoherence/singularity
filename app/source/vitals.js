'use strict';
/* ── Planetary vitals ──────────────────────────────────────────────────────
   Continuous state, as against the discrete events on the right of the face.
   Two things come out of each source: a level, which is a measurement and
   carries the date it was taken, and where the quantity is a flow, a rate.

   Levels do not tick. Flows do. A level extrapolated forward is a guess
   dressed as a reading — tested on the record, taking CO₂ from 90 days ago and
   projecting it at the measured trend lands 3.92 ppm out, because the seasonal
   cycle is nearly four times the annual rise. So the tickers count elapsed
   change from a measured rate, which is arithmetic, and never claim a level.  */

const Vitals = (() => {

  const HOUR = 3600000, YEAR_S = 365.25 * 86400;

  const state = {
    co2: null, ch4: null, temp: null, ice: null, slr: null, oni: null, compute: null,
    sources: {}
  };

  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } };
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  /* ── CO₂, global, daily ───────────────────────────────────────────────
     Two columns matter: the daily value and the seasonally adjusted trend.
     The trend is what the annual growth is read from; the daily value is what
     the atmosphere actually held that day, and it swings 6.3 ppm a year. */
  async function readCO2() {
    const body = await Net.text('https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_trend_gl.txt');
    const rows = [];
    for (const line of body.split('\n')) {
      if (line.startsWith('#')) continue;
      const p = line.trim().split(/\s+/);
      if (p.length < 5) continue;
      const [y, m, d, value, trend] = p.map(num);
      if (y && m && d && value !== null) rows.push({ t: Date.UTC(y, m - 1, d), value, trend });
    }
    if (!rows.length) throw new Error('no rows');
    rows.sort((a, b) => a.t - b.t);
    const last = rows[rows.length - 1];
    const yearAgo = rows.filter(r => r.t <= last.t - 365 * 24 * HOUR).pop();
    const growth = yearAgo ? last.trend - yearAgo.trend : null;   // trend against trend
    state.co2 = {
      value: last.value, trend: last.trend, time: last.t, unit: 'ppm', growth,
      series: rows.filter((_, i) => i % 7 === 0).slice(-320).map(r => r.value)
    };
  }

  /* ── Methane, global, monthly ─────────────────────────────────────── */
  async function readCH4() {
    const body = await Net.text('https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt');
    const rows = [];
    for (const line of body.split('\n')) {
      if (line.startsWith('#')) continue;
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      const [y, m, , value] = p.map(num);
      if (y && m && value !== null && value > 0) rows.push({ t: Date.UTC(y, m - 1, 15), value });
    }
    if (!rows.length) throw new Error('no rows');
    const last = rows[rows.length - 1];
    state.ch4 = { value: last.value, time: last.t, unit: 'ppb', series: rows.slice(-96).map(r => r.value) };
  }

  /* ── Global temperature anomaly, monthly, against 1951–80 ─────────── */
  async function readTemp() {
    const body = await Net.text('https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv');
    const rows = [];
    for (const line of body.split('\n')) {
      const p = line.split(',').map(s => s.trim());
      if (!/^\d{4}$/.test(p[0])) continue;
      const year = +p[0];
      for (let m = 1; m <= 12; m++) {
        const v = num(p[m]);
        if (v !== null) rows.push({ t: Date.UTC(year, m - 1, 15), value: v });
      }
    }
    if (!rows.length) throw new Error('no rows');
    const last = rows[rows.length - 1];
    state.temp = { value: last.value, time: last.t, unit: '°C', series: rows.slice(-480).map(r => r.value) };
  }

  /* ── Arctic sea-ice extent, daily ─────────────────────────────────────
     1.9 MB of record; only the tail is fetched. The rate is taken from the
     last seven days and is signed — the ice gains from October and loses from
     March, and a counter that only ever went one way would be a lie. */
  async function readIce() {
    const body = await Net.text(
      'https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv',
      { tail: 420000 });
    const rows = [];
    for (const line of body.split('\n')) {
      const p = line.split(',').map(s => s.trim());
      if (p.length < 4 || !/^\d{4}$/.test(p[0])) continue;
      const [y, m, d, extent] = p.map(num);
      if (y && extent !== null && extent > 0) rows.push({ t: Date.UTC(y, m - 1, d), value: extent });
    }
    if (!rows.length) throw new Error('no rows');
    rows.sort((a, b) => a.t - b.t);
    const last = rows[rows.length - 1];
    const weekAgo = rows.filter(r => r.t <= last.t - 7 * 24 * HOUR).pop();
    const perDay = weekAgo ? (last.value - weekAgo.value) / ((last.t - weekAgo.t) / (24 * HOUR)) : 0;
    state.ice = {
      value: last.value, time: last.t, unit: 'M km²',
      perDay, perSecond: perDay * 1e6 / 86400,          // km² per second, signed
      series: rows.filter((_, i) => i % 5 === 0).slice(-370).map(r => r.value)
    };
  }

  /* ── Mean sea level, satellite altimetry ─────────────────────────── */
  async function readSLR() {
    const body = await Net.text('https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/slr/slr_sla_gbl_free_all_66.csv');
    const rows = [];
    for (const line of body.split('\n')) {
      const p = line.split(',').map(s => s.trim());
      if (p.length < 2 || !/^\d{4}\.\d+$/.test(p[0])) continue;
      const frac = num(p[0]), value = num(p[p.length - 1]);
      if (frac !== null && value !== null) rows.push({ frac, value });
    }
    if (!rows.length) throw new Error('no rows');
    const last = rows[rows.length - 1];
    const recent = rows.filter(r => r.frac >= last.frac - 10);
    let rate = 3.99;                                    // mm/yr, replaced by a fit when possible
    if (recent.length > 8) {
      const n = recent.length;
      const mx = recent.reduce((s, r) => s + r.frac, 0) / n;
      const my = recent.reduce((s, r) => s + r.value, 0) / n;
      const den = recent.reduce((s, r) => s + (r.frac - mx) ** 2, 0);
      if (den) rate = recent.reduce((s, r) => s + (r.frac - mx) * (r.value - my), 0) / den;
    }
    // Decimal year to a date, so the panel can say how stale this is.
    const y = Math.floor(last.frac);
    const t = Date.UTC(y, 0, 1) + (last.frac - y) * 365.25 * 24 * HOUR;
    state.slr = {
      value: last.value, time: t, unit: 'mm', ratePerYear: rate,
      perSecond: rate / YEAR_S * 1e9,                   // picometres per second
      series: rows.slice(-400).map(r => r.value)
    };
  }

  /* ── El Niño · Oceanic Niño Index, three-month running mean ──────────
     An index, not a flow: it cannot tick, and it is shown as a level only. */
  async function readONI() {
    const body = await Net.text('https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt');
    const rows = [];
    for (const line of body.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      const anom = num(p[3]);
      if (anom !== null) rows.push({ season: p[0], year: +p[1], value: anom });
    }
    if (!rows.length) throw new Error('no rows');
    const last = rows[rows.length - 1];
    const phase = last.value >= 1.5 ? 'very strong El Niño' : last.value >= 1 ? 'strong El Niño'
      : last.value >= 0.5 ? 'El Niño' : last.value <= -1.5 ? 'very strong La Niña'
      : last.value <= -1 ? 'strong La Niña' : last.value <= -0.5 ? 'La Niña' : 'neutral';
    state.oni = { value: last.value, label: `${last.season} ${last.year}`, phase,
                  unit: 'index', series: rows.slice(-240).map(r => r.value) };
  }

  /* ── Installed AI compute ─────────────────────────────────────────────
     The disclosed record froze in July 2025 because the labs stopped
     publishing, and no amount of arithmetic recovers a number nobody
     released. The hardware is a different matter: Epoch tracks the world's AI
     data centres from satellite imagery and construction permits and
     publishes each site's current chip count in H100 equivalents. Multiply by
     what an H100 does and the result is a measured rate — installed 16-bit
     throughput, in FLOP per second — which is what the compute ticker
     integrates.

     Peak, not effective. No utilisation factor is applied, because none is
     published for these sites and inventing one would turn a measurement into
     an estimate. The face says "installed, peak" so the number is read as
     what it is: capacity in the ground, not work done. */
  const H100_FLOPS = 989.4e12;   // Epoch's 16-bit figure for one H100 — the unit its H100e column counts in

  async function readInstalled() {
    const table = parseCSV(await Net.text('https://epoch.ai/data/data_centers/data_centers.csv'));
    const head = (table[0] || []).map(h => h.replace(/^\uFEFF/, '').trim());
    const iH = head.indexOf('Current H100 equivalents');
    const iName = head.indexOf('Name'), iMW = head.indexOf('Current power (MW)');
    const iOwner = head.indexOf('Owner'), iUsers = head.indexOf('Users');
    const iCountry = head.indexOf('Country');
    if (iH < 0 || iName < 0) throw new Error('the source changed its columns');

    // Epoch tags each name with its confidence — "Anthropic #confident". The
    // tag belongs in the note, not in the name.
    const names = v => String(v || '').replace(/\s*#\w+/g, '').trim();

    const sites = [];
    for (let i = 1; i < table.length; i++) {
      const c = table[i];
      if (c.length <= iH) continue;
      const h100e = num(c[iH]);
      if (h100e === null || h100e <= 0) continue;
      sites.push({
        h100e, name: names(c[iName]), owner: names(c[iOwner]), users: names(c[iUsers]),
        country: names(c[iCountry]), mw: num(c[iMW])
      });
    }
    if (!sites.length) throw new Error('no sites');
    sites.sort((a, b) => b.h100e - a.h100e);

    const top = sites[0];
    const totalH100e = sites.reduce((t, x) => t + x.h100e, 0);
    state.installed = {
      site: top.name, owner: top.owner, users: top.users, country: top.country,
      h100e: top.h100e, mw: top.mw, sitePeak: top.h100e * H100_FLOPS,
      sites: sites.length, totalH100e, perSecond: totalH100e * H100_FLOPS,
      totalMW: sites.reduce((t, x) => t + (x.mw || 0), 0),
      top: sites.slice(0, 6)
    };
  }

  /* ── Autonomy time horizon ────────────────────────────────────────────
     METR fits, for each model, the length of task it finishes on its own half
     the time — measured in minutes of human expert work. The reading that
     matters is not one model's score but how fast the frontier of that score
     moves: METR's own fit since 2023 doubles it roughly every four months.
     This is the file METR's published chart reads. It is a level, not a flow,
     so it does not tick. */
  async function readHorizon() {
    const y = parseYAML(await Net.text('https://metr.org/assets/benchmark_results_1_1.yaml'));
    const rows = [];
    for (const [key, v] of Object.entries(y.results || {})) {
      const m = v.metrics || {};
      const p50 = (m.p50_horizon_length || {}).estimate;
      const when = Date.parse(String(v.release_date || '') + 'T00:00:00Z');
      if (typeof p50 !== 'number' || !Number.isFinite(when)) continue;
      rows.push({
        t: when, minutes: p50,
        p80: typeof (m.p80_horizon_length || {}).estimate === 'number' ? m.p80_horizon_length.estimate : null,
        // METR's key carries the scaffold it was run under; the model is the rest.
        name: key.replace(/_inspect$/, '').replace(/_/g, ' ').toUpperCase()
      });
    }
    if (!rows.length) throw new Error('no models');
    rows.sort((a, b) => a.t - b.t);

    let best = 0; const run = [];
    for (const r of rows) { if (r.minutes > best) best = r.minutes; run.push(Math.log10(best)); }
    const top = rows.slice().sort((a, b) => b.minutes - a.minutes)[0];
    const dbl = ((y.doubling_time_in_days || {}).from_2023_on || {}).point_estimate;
    state.horizon = {
      minutes: top.minutes, model: top.name, time: top.t, p80: top.p80,
      doublingDays: typeof dbl === 'number' ? dbl : null,
      models: rows.length, series: run,
      benchmark: String(y.benchmark_name || 'METR-Horizon')
    };
  }

  /* Enough YAML for one file, and no more. METR's is plain keys, plain
     scalars and two-space indent, so a reader that handles exactly that is
     easier to audit than a library — and it fails loudly if the shape
     changes, which is what we want. */
  function parseYAML(text) {
    const root = {};
    const stack = [{ indent: -1, node: root }];
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '').replace(/\s+#.*$/, '');
      const body = line.trim();
      if (!body || body[0] === '#' || body[0] === '-') continue;
      const m = /^([^:]+):\s*(.*)$/.exec(body);
      if (!m) continue;
      const indent = line.length - line.replace(/^\s+/, '').length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1].node;
      const key = m[1].trim(), value = m[2].trim();
      if (value === '') { const child = {}; parent[key] = child; stack.push({ indent, node: child }); }
      else parent[key] = value === 'true' ? true : value === 'false' ? false
        : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    }
    return root;
  }

  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ── The flows the tickers integrate ──────────────────────────────────
     Two are read from the data above; two are published annual totals, which
     is why each names its source on the face. A published annual total used as
     a constant rate is an honest thing to tick as long as it says so. */
  const EMISSIONS_T_PER_YEAR = 37.4e9;        // Global Carbon Budget, fossil CO₂
  const ENERGY_IMBALANCE_W_M2 = 1.3;          // CERES-era estimate
  const EARTH_AREA_M2 = 5.10072e14;

  function flows() {
    const why = key => {
      const h = state.sources[key];
      return h && h.note ? h.note : 'source unread';
    };
    return {
      co2t:    { rate: EMISSIONS_T_PER_YEAR / YEAR_S, unit: 't', dp: 0, known: true,
                 label: 'CO₂ EMITTED', note: 'Global Carbon Budget · 37.4 Gt/yr' },
      heat:    { rate: ENERGY_IMBALANCE_W_M2 * EARTH_AREA_M2 / 1e12, unit: 'TJ', dp: 0, known: true,
                 label: 'HEAT IN', note: `energy imbalance ≈${ENERGY_IMBALANCE_W_M2} W/m²` },
      compute: { rate: (state.installed ? state.installed.perSecond : 0) / 1e21, unit: 'ZFLOP', dp: 0,
                 known: !!state.installed, label: 'AI COMPUTE',
                 note: state.installed
                   ? `Epoch AI · ${state.installed.sites} data centres, installed peak`
                   : why('installed') },
      ice:     { rate: state.ice ? state.ice.perSecond : 0, unit: 'km²', dp: 2,
                 known: !!state.ice, label: 'ARCTIC ICE',
                 note: state.ice ? 'NSIDC · 7-day rate, signed' : why('ice') },
      slr:     { rate: state.slr ? state.slr.perSecond : 0, unit: 'pm', dp: 0,
                 known: !!state.slr, label: 'SEA LEVEL',
                 note: state.slr ? 'NOAA STAR · satellite altimetry' : why('slr') }
    };
  }

  /* ── Scheduler ────────────────────────────────────────────────────────
     These sources publish daily at best and monthly at worst, so they are read
     once on open and then rarely. A failure backs off and the panel says the
     sign is unread rather than showing a stale number as current. */
  const SIGNS = [
    { key: 'co2',     label: 'CO₂',          every: 6 * HOUR,  read: readCO2 },
    { key: 'ice',     label: 'SEA ICE',      every: 6 * HOUR,  read: readIce },
    { key: 'horizon', label: 'AUTONOMY',    every: 24 * HOUR, read: readHorizon },
    { key: 'installed', label: 'AI HARDWARE', every: 6 * HOUR,  read: readInstalled },
    { key: 'oni',     label: 'EL NIÑO',      every: 12 * HOUR, read: readONI },
    { key: 'temp',    label: 'TEMPERATURE',  every: 24 * HOUR, read: readTemp },
    { key: 'slr',     label: 'SEA LEVEL',    every: 24 * HOUR, read: readSLR },
    { key: 'ch4',     label: 'METHANE',      every: 24 * HOUR, read: readCH4 }
  ];
  for (const s of SIGNS) state.sources[s.key] = { label: s.label, status: 'waiting', at: null, failures: 0, note: '' };

  async function run(sign) {
    const h = state.sources[sign.key];
    try {
      await sign.read();
      h.status = 'live'; h.at = Date.now(); h.failures = 0; h.note = '';
    } catch (error) {
      h.failures += 1;
      h.status = h.at ? 'stale' : 'unreachable';
      h.note = String(error.message || error).slice(0, 60);
    }
    emit();
  }
  function schedule(sign) {
    const h = state.sources[sign.key];
    const wait = h.failures ? Math.min(sign.every * Math.pow(2, h.failures), 6 * HOUR) : sign.every;
    setTimeout(async () => { await run(sign); schedule(sign); }, wait + Math.random() * 5000);
  }
  function start() {
    SIGNS.forEach((sign, i) => setTimeout(async () => { await run(sign); schedule(sign); }, 600 + i * 700));
  }

  /* A running total grows through several orders of magnitude while the page
     is open, so it is shown in the unit that keeps it readable — tonnes to
     kilotonnes to megatonnes, zettaFLOP to yottaFLOP — always three decimals
     once it has left the base unit, so the last digits keep moving. The steps
     are the SI prefixes, a thousand apart; a unit without a ladder (the
     signed sea-ice rate) is shown as it is. */
  const LADDERS = {
    't':     ['t', 'kt', 'Mt', 'Gt', 'Tt'],
    'TJ':    ['TJ', 'PJ', 'EJ', 'ZJ', 'YJ'],
    'ZFLOP': ['ZFLOP', 'YFLOP', 'RFLOP', 'QFLOP'],
    'pm':    ['pm', 'nm', 'µm', 'mm', 'm']
  };
  function scaled(value, unit, dp) {
    const ladder = LADDERS[unit];
    let k = 0, v = value;
    if (ladder) while (k < ladder.length - 1 && Math.abs(v) >= 1000) { v /= 1000; k++; }
    const digits = k ? 3 : dp;
    return { text: v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }),
             unit: ladder ? ladder[k] : unit };
  }

  return { state, start, onUpdate, flows, scaled };
})();
