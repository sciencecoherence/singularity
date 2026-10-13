'use strict';
/* ── The Sun ───────────────────────────────────────────────────────────────
   The Solar page's map of the Sun, its forecast, and the K index you can
   open bar by bar.

   The map. Full-disc images: SDO's HMI (sunspots, magnetic field) and AIA
   (the corona at 193 Å, the chromosphere at 304 Å) through Helioviewer, which
   serves the newest frames (SDO's own "latest" files can lag by weeks); GOES-19
   SUVI at 195 Å and SOHO's LASCO C3 coronagraph from NOAA; the WSA-Enlil model
   of the solar wind out to Earth. Over the SDO frames, NOAA's numbered active
   regions (json/solar_regions.json), each turned from the time it was measured
   to the time of the image with the Sun's differential rotation, and placed
   with the tilt of the Sun's axis towards us (B0). Click one for its class,
   its flare odds and its history.

   The forecast. What NOAA has in effect (watches days ahead, warnings hours
   ahead, alerts as it happens, cancellations honoured), the three-day forecast
   (storm, radio blackout and radiation odds, with NOAA's own reasons), the
   solar wind at L1 — the point a million and a half kilometres sunward where
   DSCOVR and IMAP sit, so what they measure reaches us in about 40 to 90
   minutes — and the WSA-Enlil run, whose predicted wind at Earth gives the
   arrival of a fast stream or a CME days ahead.

   The K index. Seven days observed and three forecast, one bar per three
   hours; a bar opens to what that window was: the storm level, how far
   towards the equator the aurora reached, NOAA's messages and the flares in
   it, and the wind at L1 when the record covers it.

   Everything is from services.swpc.noaa.gov except the SDO frames
   (api.helioviewer.org, images only).                                       */
const Sun = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const SWPC = 'https://services.swpc.noaa.gov';
  const R = Math.PI / 180;
  const pad = n => String(n).padStart(2, '0');
  const utc = s => { if (!s) return NaN; const t = String(s).trim().replace(' ', 'T'); return Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z'); };
  const listeners = new Set();
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };

  const state = {
    regions: [], regionDate: null, history: new Map(),
    scales: null, kpf: [], fc3: null, messages: [], flares: [], wind: [], mag: [], enlil: [],
    sources: {
      regions: { label: 'SWPC active regions', status: 'waiting', at: null, note: '' },
      forecast: { label: 'SWPC forecast', status: 'waiting', at: null, note: '' },
      alerts: { label: 'SWPC alerts', status: 'waiting', at: null, note: '' },
      l1: { label: 'Solar wind at L1', status: 'waiting', at: null, note: '' },
      enlil: { label: 'WSA-Enlil', status: 'waiting', at: null, note: '' }
    }
  };
  const ok = (k, note = '') => Object.assign(state.sources[k], { status: 'live', at: Date.now(), note });
  const fail = (k, e) => Object.assign(state.sources[k], { status: 'error', note: String(e && e.message || e) });

  /* ── Reading ── */
  async function readRegions() {
    try {
      const rows = await Net.json(`${SWPC}/json/solar_regions.json`);
      if (!Array.isArray(rows) || !rows.length) throw new Error('no regions');
      const latest = rows.reduce((a, r) => r.observed_date > a ? r.observed_date : a, '');
      state.regionDate = latest;
      state.history = new Map();
      for (const r of rows) { const h = state.history.get(r.region) || []; h.push(r); state.history.set(r.region, h); }
      for (const h of state.history.values()) h.sort((a, b) => a.observed_date.localeCompare(b.observed_date));
      state.regions = rows.filter(r => r.observed_date === latest && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
      ok('regions', `${state.regions.length} regions`);
    } catch (e) { fail('regions', e); }
    emit();
  }
  async function readForecast() {
    try {
      const [scales, kpf, txt, flares] = await Promise.allSettled([
        Net.json(`${SWPC}/products/noaa-scales.json`),
        Net.json(`${SWPC}/products/noaa-planetary-k-index-forecast.json`),
        Net.text(`${SWPC}/text/3-day-forecast.txt`),
        Net.json(`${SWPC}/json/goes/primary/xray-flares-7-day.json`)
      ]);
      if (scales.status === 'fulfilled') state.scales = scales.value;
      if (kpf.status === 'fulfilled' && Array.isArray(kpf.value)) {
        const rows = kpf.value[0] && Array.isArray(kpf.value[0]) ? kpf.value.slice(1).map(r => ({ time_tag: r[0], kp: r[1], observed: r[2], noaa_scale: r[3] })) : kpf.value;
        state.kpf = rows.map(r => ({ t: utc(r.time_tag), kp: Number(r.kp), kind: r.observed, scale: r.noaa_scale })).filter(r => Number.isFinite(r.t) && Number.isFinite(r.kp));
        // NOAA labels the rest of today "estimated" before it happens: a window not yet begun is a forecast.
        for (const r of state.kpf) if (r.t > Date.now() && r.kind !== 'observed') r.kind = 'predicted';
      }
      if (txt.status === 'fulfilled') state.fc3 = parse3Day(txt.value);
      if (flares.status === 'fulfilled' && Array.isArray(flares.value)) state.flares = flares.value.map(f => ({ begin: utc(f.begin_time), max: utc(f.max_time), end: utc(f.end_time), cls: f.max_class })).filter(f => Number.isFinite(f.max));
      if ([scales, kpf, txt].every(x => x.status === 'rejected')) throw scales.reason;
      ok('forecast');
    } catch (e) { fail('forecast', e); }
    emit();
  }
  async function readAlerts() {
    try {
      const rows = await Net.json(`${SWPC}/products/alerts.json`);
      state.messages = (rows || []).map(parseMessage).filter(Boolean).sort((a, b) => b.issue - a.issue);
      ok('alerts', `${state.messages.length} messages`);
    } catch (e) { fail('alerts', e); }
    emit();
  }
  /* NOAA serves only about a day of the one-minute record from L1. So that
     every K-index bar can say what the wind was doing, each reading is
     folded into three-hour summaries kept on this computer (twelve days). */
  const L1_KEY = 'temporal-live:l1-windows';
  let l1Hist = {};
  try { l1Hist = JSON.parse(localStorage.getItem(L1_KEY)) || {}; } catch { l1Hist = {}; }
  function foldL1() {
    const win = t => Math.floor(t / (3 * HOUR)) * 3 * HOUR;
    const acc = {};
    for (const r of state.wind) { const k = win(r.t), a = acc[k] || (acc[k] = { vMin: Infinity, vMax: -Infinity, nMax: -Infinity, bzMin: Infinity, btMax: -Infinity, nW: 0, nM: 0 });
      a.vMin = Math.min(a.vMin, r.v); a.vMax = Math.max(a.vMax, r.v); if (Number.isFinite(r.n)) a.nMax = Math.max(a.nMax, r.n); a.nW++; }
    for (const r of state.mag) { const k = win(r.t), a = acc[k] || (acc[k] = { vMin: Infinity, vMax: -Infinity, nMax: -Infinity, bzMin: Infinity, btMax: -Infinity, nW: 0, nM: 0 });
      a.bzMin = Math.min(a.bzMin, r.bz); if (Number.isFinite(r.bt)) a.btMax = Math.max(a.btMax, r.bt); a.nM++; }
    for (const [k, a] of Object.entries(acc)) {
      const prev = l1Hist[k];
      // A window seen more completely replaces a partial one; otherwise the extremes merge.
      const fin = v => Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
      const next = { vMin: fin(a.vMin), vMax: fin(a.vMax), nMax: fin(a.nMax), bzMin: fin(a.bzMin), btMax: fin(a.btMax), cover: Math.min(1, (a.nW + a.nM) / 360) };
      if (prev && prev.cover > next.cover) {
        const lo = (x, y) => x == null ? y : y == null ? x : Math.min(x, y), hi = (x, y) => x == null ? y : y == null ? x : Math.max(x, y);
        l1Hist[k] = { vMin: lo(prev.vMin, next.vMin), vMax: hi(prev.vMax, next.vMax), nMax: hi(prev.nMax, next.nMax), bzMin: lo(prev.bzMin, next.bzMin), btMax: hi(prev.btMax, next.btMax), cover: prev.cover };
      } else l1Hist[k] = next;
    }
    const cut = Date.now() - 12 * DAY;
    for (const k of Object.keys(l1Hist)) if (+k < cut) delete l1Hist[k];
    try { localStorage.setItem(L1_KEY, JSON.stringify(l1Hist)); } catch { /* full */ }
  }
  // The one-minute record from L1 is large (4 MB): read every ten minutes
  // while the page is open, hourly otherwise (to keep the record above).
  async function readL1() {
    try {
      const [w, m] = await Promise.all([Net.json(`${SWPC}/json/rtsw/rtsw_wind_1m.json`), Net.json(`${SWPC}/json/rtsw/rtsw_mag_1m.json`)]);
      state.wind = (w || []).filter(r => r.active && Number.isFinite(r.proton_speed)).map(r => ({ t: utc(r.time_tag), v: r.proton_speed, n: r.proton_density, src: r.source })).sort((a, b) => a.t - b.t);
      state.mag = (m || []).filter(r => r.active && Number.isFinite(r.bz_gsm)).map(r => ({ t: utc(r.time_tag), bz: r.bz_gsm, bt: r.bt, src: r.source })).sort((a, b) => a.t - b.t);
      if (!state.wind.length) throw new Error('no wind record');
      foldL1();
      ok('l1', state.wind[state.wind.length - 1].src || '');
    } catch (e) { fail('l1', e); }
    emit();
  }
  async function readEnlil() {
    try {
      const rows = await Net.json(`${SWPC}/json/enlil_time_series.json`);
      state.enlil = (rows || []).map(r => ({ t: utc(r.time_tag), v: r.v_r, n: r.earth_particles_per_cm3, cloud: r.cloud })).filter(r => Number.isFinite(r.t) && Number.isFinite(r.v)).sort((a, b) => a.t - b.t);
      ok('enlil', `${state.enlil.length} steps`);
    } catch (e) { fail('enlil', e); }
    emit();
  }

  /* ── NOAA's messages ── */
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const swpcTime = s => { const m = /(\d{4}) (\w{3}) (\d{1,2}) (\d{2})(\d{2}) UTC/.exec(s || ''); return m ? Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]) : null; };
  function parseMessage(x) {
    if (!x || !x.message) return null;
    const lines = String(x.message).replace(/\r/g, '').split('\n').map(l => l.trim());
    const field = name => { const l = lines.find(v => v.startsWith(name + ':')); return l ? l.slice(name.length + 1).trim() : ''; };
    const head = lines.find(l => /^(CANCEL |EXTENDED |CONTINUED )?(ALERT|WARNING|WATCH|SUMMARY)\b/.test(l)) || '';
    const kind = /^CANCEL/.test(head) ? 'cancel' : /WATCH/.test(head) ? 'watch' : /WARNING/.test(head) ? 'warning' : /ALERT/.test(head) ? 'alert' : /SUMMARY/.test(head) ? 'summary' : 'other';
    const msg = {
      id: x.product_id + ':' + field('Serial Number'), code: x.product_id, kind, head: head.replace(/\s+/g, ' ').trim(),
      serial: field('Serial Number'), cancels: field('Cancel Serial Number'), extends: field('Extension to Serial Number'),
      issue: swpcTime(field('Issue Time')) || utc(x.issue_datetime),
      from: swpcTime(field('Valid From')), to: swpcTime(field('Valid To')) || swpcTime(field('Now Valid Until')),
      at: swpcTime(field('Observed')) || swpcTime(field('Threshold Reached')) || swpcTime(field('Maximum Time')) || swpcTime(field('Begin Time')),
      shock: field('Ip Shock'), xclass: field('Xray Class'), where: field('Location'), speed: field('Estimate Velocity'),
      impact: (lines.find(l => l.startsWith('Potential Impacts:')) || '').replace('Potential Impacts:', '').trim(),
      aurora: (lines.find(l => l.startsWith('Aurora -')) || '').replace('Aurora -', '').trim(),
      days: []
    };
    const k = /K-index of (\d)/.exec(head); if (k) msg.kp = +k[1];
    const g = /Category G(\d)/.exec(head); if (g) msg.g = +g[1];
    const i = lines.findIndex(l => /^Highest Storm Level Predicted by Day:/.test(l));
    if (i >= 0) for (const m of (lines[i + 1] || '').matchAll(/(\w{3}) (\d{1,2}):\s+(None \(Below G1\)|G(\d) \(\w+\))/g)) {
      const year = new Date(msg.issue).getUTCFullYear();
      let t = Date.UTC(year, MON[m[1]], +m[2]);
      if (t < msg.issue - 200 * DAY) t = Date.UTC(year + 1, MON[m[1]], +m[2]);
      msg.days.push({ t, g: m[4] ? +m[4] : 0 });
    }
    return msg;
  }
  /* What NOAA has in effect now: the newest geomagnetic watch (each one
     supersedes the last) unless cancelled; warnings whose window is open;
     alerts of the last three hours. */
  function inEffect(now = Date.now()) {
    const cancelled = new Set(state.messages.filter(m => m.kind === 'cancel').map(m => m.cancels));
    const live = state.messages.filter(m => !cancelled.has(m.serial));
    const out = [];
    const watch = live.filter(m => m.kind === 'watch' && m.g).sort((a, b) => b.issue - a.issue)[0];
    const lastCancel = state.messages.filter(m => m.kind === 'cancel' && /WATCH/.test(m.head)).sort((a, b) => b.issue - a.issue)[0];
    if (watch && !(lastCancel && lastCancel.issue > watch.issue && lastCancel.cancels === watch.serial)
        && watch.days.some(d => d.g > 0 && d.t + DAY > now)) out.push(watch);
    const seen = new Set();
    for (const m of live.filter(m => m.kind === 'warning' && m.to && m.to > now).sort((a, b) => b.issue - a.issue)) {
      const key = m.head.replace(/^EXTENDED /, '');
      if (seen.has(key)) continue; seen.add(key); out.push(m);
    }
    for (const m of live.filter(m => m.kind === 'alert' && now - (m.at || m.issue) < 3 * HOUR)) out.push(m);
    return out;
  }
  /* For the alert log: a storm watch of G2 or more, a warning of Kp 6 or more,
     a shock at L1 with an impulse expected — each is hours to days ahead. */
  function alertCandidates() {
    const out = [];
    const cancelled = new Set(state.messages.filter(m => m.kind === 'cancel').map(m => m.cancels));
    for (const m of state.messages) {
      if (cancelled.has(m.serial)) continue;
      if (m.kind === 'watch' && m.g >= 2) {
        const day = m.days.filter(d => d.g >= 2).map(d => `${dayName(d.t)} G${d.g}`).join(', ');
        out.push({ key: `space:watch:${m.id}`, rule: 'space', level: m.g >= 4 ? 'red' : 'orange', time: m.issue,
          title: `Storm watch · G${m.g} expected${day ? ' · ' + day : ''}`, body: `NOAA SWPC watch · ${m.aurora || m.impact}`.slice(0, 220), link: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings' });
      } else if (m.kind === 'warning' && m.kp >= 6 && !/^EXTENDED/.test(m.head)) {
        out.push({ key: `space:warn:${m.id}`, rule: 'space', level: m.kp >= 8 ? 'red' : 'orange', time: m.issue,
          title: `Storm warning · Kp ${m.kp} expected${m.to ? ' until ' + hhmm(m.to) + ' UTC' : ''}`, body: `NOAA SWPC warning · ${m.aurora || m.impact}`.slice(0, 220), link: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings' });
      } else if (m.kind === 'warning' && /Sudden Impulse/.test(m.head)) {
        out.push({ key: `space:shock:${m.id}`, rule: 'space', level: 'orange', time: m.issue,
          title: `Solar wind shock at L1 · impact ${m.from ? hhmm(m.from) + '–' + hhmm(m.to) + ' UTC' : 'within the hour'}`, body: 'NOAA SWPC · a CME or fast stream has reached the spacecraft upstream; Earth follows within the hour', link: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings' });
      }
    }
    return out;
  }

  /* ── The 3-day forecast text ── */
  function parse3Day(txt) {
    const lines = String(txt).replace(/\r/g, '').split('\n');
    const out = { issued: swpcTime((lines.find(l => l.startsWith(':Issued:')) || '').replace(':Issued:', '').trim() + ' UTC'), why: {} };
    let section = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^A\. /.test(l)) section = 'G'; else if (/^B\. /.test(l)) section = 'S'; else if (/^C\. /.test(l)) section = 'R';
      if (/^Rationale:/.test(l) && section) {
        let s = l.replace(/^Rationale:\s*/, '');
        for (let j = i + 1; j < lines.length && lines[j].trim(); j++) s += ' ' + lines[j].trim();
        out.why[section] = s.replace(/\s+/g, ' ');
      }
    }
    return out;
  }

  /* ── Formatting ── */
  const hhmm = t => { const d = new Date(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const dayName = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const local = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const span = ms => { const a = Math.abs(ms), d = Math.floor(a / DAY), h = Math.floor(a % DAY / HOUR), m = Math.round(a % HOUR / MIN);
    return d ? `${d} d ${h} h` : h ? `${h} h ${pad(m)} min` : `${m} min`; };
  const when = t => { const d = new Date(t), n = new Date(); return d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10) ? hhmm(t) + ' UTC' : dayName(t) + ' ' + hhmm(t) + ' UTC'; };
  const until = t => t > Date.now() ? 'in ' + span(t - Date.now()) : span(Date.now() - t) + ' ago';
  const G_WORD = ['', 'minor', 'moderate', 'strong', 'severe', 'extreme'];
  const gOf = kp => kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0;
  const tone = kp => kp >= 7 ? 'crit' : kp >= 5 ? 'warn' : kp >= 4 ? 'amber' : 'ok';
  // Where the aurora reaches overhead, in geomagnetic latitude, by Kp (NOAA's
  // rule of thumb: 66.5° at Kp 0, about two degrees nearer the equator per step).
  const auroraLat = kp => 66.5 - 2.05 * kp;
  function geomagLat(lat, lon) {
    const pl = 80.8 * R, pn = -72.7 * R, a = lat * R, b = lon * R;   // IGRF dipole pole, 2025
    return Math.asin(Math.sin(a) * Math.sin(pl) + Math.cos(a) * Math.cos(pl) * Math.cos(b - pn)) / R;
  }
  function home() {
    try { const s = JSON.parse(localStorage.getItem('matrix-settings')) || {}; return Number.isFinite(s.latitude) && Number.isFinite(s.longitude) ? [s.latitude, s.longitude] : null; } catch { return null; }
  }

  /* ── The Sun's geometry ── */
  function sunGeometry(t) {
    const n = (t - Date.UTC(2000, 0, 1, 12)) / DAY;
    const g = (357.529 + 0.98560028 * n) * R, L = (280.459 + 0.98564736 * n) * R;
    const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * R;
    const au = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
    const jd = t / DAY + 2440587.5;
    const omega = (73.6667 + 1.3958333 * (jd - 2396758) / 36525) * R;
    const b0 = Math.asin(Math.sin(lam - omega) * Math.sin(7.25 * R)) / R;
    return { radiusArcsec: 959.63 / au, b0 };
  }
  // Synodic rotation, degrees a day, at a latitude (Snodgrass, minus Earth's motion).
  const rot = lat => 14.713 - 2.396 * Math.sin(lat * R) ** 2 - 1.787 * Math.sin(lat * R) ** 4 - 0.9856;
  // NOAA's positions hold at 24:00 UT of the day they are listed under. NOAA
  // counts longitude positive to the east; here it is positive to the west,
  // the way the Sun turns.
  const regionAt = (r, t) => -r.longitude + rot(r.latitude) * (t - (utc(r.observed_date + 'T00:00:00') + DAY)) / DAY;
  function project(lat, lon, b0) {
    const x = Math.cos(lat * R) * Math.sin(lon * R);
    const y = Math.sin(lat * R) * Math.cos(b0 * R) - Math.cos(lat * R) * Math.cos(lon * R) * Math.sin(b0 * R);
    const z = Math.cos(lat * R) * Math.cos(lon * R) * Math.cos(b0 * R) + Math.sin(lat * R) * Math.sin(b0 * R);
    return { x, y, z };
  }
  const MAG = { A: 'Alpha', B: 'Beta', G: 'Gamma', D: 'Delta' };
  const magName = c => c ? c.split('').map(ch => MAG[ch] || ch).join('-') : '';
  const magTone = c => !c ? 'none' : /D/.test(c) ? 'crit' : /G/.test(c) ? 'warn' : 'ok';
  const MAG_SAY = {
    crit: 'A delta spot: opposite magnetic polarities squeezed inside one penumbra. This is the configuration that produces most large flares.',
    warn: 'A gamma group: polarities mixed with no clean dividing line. Capable of M-class flares.',
    ok: 'A simple group: one polarity (alpha) or two cleanly separated (beta). Usually quiet.',
    none: 'Plage only: a bright magnetic area with no spots measured today.'
  };

  /* ── The map ── */
  const HV = (id, t) => `https://api.helioviewer.org/v2/takeScreenshot/?date=${new Date(Math.floor(t / (15 * MIN)) * 15 * MIN - 20 * MIN).toISOString().slice(0, 19)}Z&imageScale=2.3&layers=%5B${id},1,100%5D&x0=0&y0=0&width=1024&height=1024&display=true&watermark=false`;
  const STAMP = t => Math.floor(t / (10 * MIN));
  const LAYERS = [
    { k: 'spots', label: 'Sunspots', hv: 18, scale: 2.3, note: 'SDO/HMI visible light · the dark spots are the active regions' },
    { k: 'mag', label: 'Magnetic field', hv: 19, scale: 2.3, note: 'SDO/HMI magnetogram · white and black are the two polarities' },
    { k: 'a193', label: 'Corona 193 Å', hv: 11, scale: 2.3, note: 'SDO/AIA · the dark patches are coronal holes, sources of fast wind' },
    { k: 'a304', label: 'Chromosphere 304 Å', hv: 13, scale: 2.3, note: 'SDO/AIA · filaments (dark threads) can erupt as CMEs' },
    { k: 'suvi', label: 'GOES SUVI', url: () => `${SWPC}/images/animations/suvi/primary/195/latest.png?${STAMP(Date.now())}`, note: 'GOES-19 Solar Ultraviolet Imager, 195 Å, every four minutes' },
    { k: 'lasco', label: 'Coronagraph', url: () => `${SWPC}/images/animations/lasco-c3/latest.jpg?${STAMP(Date.now())}`, anim: 'lasco-c3', note: 'SOHO LASCO C3 · the disc blocks the Sun; a CME leaves as an expanding cloud. A halo all round means it is coming at us' },
    { k: 'enlil', label: 'Enlil model', url: () => `${SWPC}/images/animations/enlil/latest.jpg?${STAMP(Date.now())}`, anim: 'enlil', wide: true, note: 'NOAA WSA-Enlil · the solar wind from the Sun to Earth, forecast four days ahead; Earth is the dot on the right' }
  ];
  let layer = 'spots', picked = null, imgTime = Date.now(), loop = null;
  function stageHTML() {
    const L = LAYERS.find(x => x.k === layer);
    return `<div class="sun-chips chips">${LAYERS.map(x => `<button type="button" class="chip${x.k === layer ? ' on' : ''}" data-sunlayer="${x.k}">${esc(x.label)}</button>`).join('')}</div>
      <div class="sun-stage${L.wide ? ' wide' : ''}${layer === 'spots' ? ' tint' : ''}" id="sun-stage">
        <img id="sun-img" alt="${esc(L.label)}" decoding="async">
        <svg id="sun-over" viewBox="0 0 1024 1024" aria-hidden="true"></svg>
        <div class="sun-loading" id="sun-loading">Loading the image…</div>
      </div>
      <div class="sun-cap"><span id="sun-note">${esc(L.note)}</span>${L.anim ? `<button type="button" class="btn ghost sm" data-sunplay>${loop ? '■ Stop' : '▶ Play the last day'}</button>` : ''}<span id="sun-time"></span></div>`;
  }
  function loadImage() {
    const L = LAYERS.find(x => x.k === layer), img = $('sun-img'), wait = $('sun-loading');
    if (!img) return;
    stopLoop();
    imgTime = Date.now() - 20 * MIN;
    const src = L.hv ? HV(L.hv, Date.now()) : L.url();
    if (img.dataset.src === src) return;
    img.dataset.src = src;
    if (wait) { wait.hidden = false; wait.textContent = 'Loading the image…'; }
    img.onload = () => { if (wait) wait.hidden = true; paintOverlay(); };
    img.onerror = () => { if (wait) { wait.hidden = false; wait.textContent = 'The image did not load. The source may be busy; try another layer or wait a few minutes.'; } };
    img.src = src;
    $('sun-time').textContent = L.hv ? `frame nearest ${hhmm(imgTime)} UTC` : '';
    paintOverlay();
  }
  async function playLoop() {
    const L = LAYERS.find(x => x.k === layer);
    if (!L.anim) return;
    if (loop) { stopLoop(); loadImage(); const b0 = document.querySelector('[data-sunplay]'); if (b0) b0.textContent = '▶ Play the last day'; return; }
    const btn = document.querySelector('[data-sunplay]');
    if (btn) btn.textContent = 'Loading frames…';
    let frames;
    try {
      const list = await Net.json(`${SWPC}/products/animations/${L.anim}.json`);
      const urls = (list || []).map(f => SWPC + f.url);
      const every = Math.max(1, Math.round(urls.length / 48));
      frames = urls.filter((_, i) => i % every === 0 || i === urls.length - 1);
    } catch { if (btn) btn.textContent = 'Frames unavailable'; return; }
    const imgs = frames.map(u => { const im = new Image(); im.src = u; return im; });
    let i = 0;
    loop = setInterval(() => {
      const img = $('sun-img');
      if (!img || layer !== L.k) { stopLoop(); return; }
      const im = imgs[i % imgs.length];
      if (im.complete && im.naturalWidth) { img.src = im.src; const m = /(\d{8})[T_](\d{4})/.exec(im.src); $('sun-time').textContent = m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)} ${m[2].slice(0, 2)}:${m[2].slice(2)} UTC · frame ${i % imgs.length + 1}/${imgs.length}` : ''; }
      i++;
    }, 140);
    const b = document.querySelector('[data-sunplay]'); if (b) b.textContent = '■ Stop';
    const wait = $('sun-loading'); if (wait) wait.hidden = true;
  }
  function stopLoop() { if (loop) { clearInterval(loop); loop = null; const img = $('sun-img'); if (img) delete img.dataset.src; } }

  function placed() {
    const L = LAYERS.find(x => x.k === layer);
    if (!L.hv) return [];
    const geo = sunGeometry(imgTime), Rpx = geo.radiusArcsec / L.scale;
    return state.regions.map(r => {
      const lon = regionAt(r, imgTime), p = project(r.latitude, lon, geo.b0);
      return { r, lon, p, x: 512 + Rpx * p.x, y: 512 - Rpx * p.y, Rpx };
    }).filter(o => o.p.z > 0.02);
  }
  function paintOverlay() {
    const svg = $('sun-over');
    if (!svg) return;
    const list = placed().sort((a, b) => (b.r.area || 0) - (a.r.area || 0));
    // Each label takes the first free side: right, left, below, above.
    const boxes = list.map(({ x, y, r }) => { const s = 10 + Math.sqrt(r.area || 0) * 0.9; return { x: x - s, y: y - s, w: 2 * s, h: 2 * s }; });
    const hit = b => boxes.some(o => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
    const html = list.map(({ r, x, y }) => {
      const t = magTone(r.mag_class), size = 10 + Math.sqrt(r.area || 0) * 0.9, w = 18 * String(r.region).length, h = 24;
      const tries = [[x + size + 6, y + 8, 'start'], [x - size - 6, y + 8, 'end'], [x, y + size + 24, 'middle'], [x, y - size - 8, 'middle']];
      let pick = tries[0];
      for (const c of tries) {
        const bx = c[2] === 'start' ? c[0] : c[2] === 'end' ? c[0] - w : c[0] - w / 2, b = { x: bx, y: c[1] - h + 4, w, h };
        if (bx > 4 && bx + w < 1020 && !hit(b)) { pick = c; boxes.push(b); break; }
      }
      return `<g class="sun-reg t-${t}${picked === r.region ? ' on' : ''}" data-region="${r.region}">
        <circle class="halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}"/>
        <text x="${pick[0].toFixed(1)}" y="${pick[1].toFixed(1)}" text-anchor="${pick[2]}">${r.region}</text></g>`;
    }).join('');
    if (svg.dataset.html !== html) { svg.innerHTML = html; svg.dataset.html = html; }
  }
  function regionSide() {
    const rows = state.regions.slice().sort((a, b) => (b.m_flare_probability || 0) - (a.m_flare_probability || 0) || (b.area || 0) - (a.area || 0));
    if (picked && state.history.has(picked)) {
      const h = state.history.get(picked), r = h[h.length - 1], t = magTone(r.mag_class);
      const lonNow = regionAt(r, Date.now());
      const facing = Math.abs(lonNow) < 30, gone = lonNow > 90;
      const limb = gone ? 'It has rotated off the western limb.' : `It rotates off the western limb in about ${Math.max(0, (90 - lonNow) / rot(r.latitude)).toFixed(1)} days.`;
      return `<div class="sun-back"><button type="button" class="btn ghost sm" data-region-back>← All regions</button></div>
        <span class="eyebrow t-${t}">REGION ${r.region} · ${esc(magName(r.mag_class).toUpperCase() || 'NO SPOTS')}</span>
        <strong class="sun-h">AR ${r.region}</strong>
        <p class="sun-p">${esc(MAG_SAY[t])} ${facing ? 'It faces Earth now: a CME launched from here would head our way.' : ''} ${limb}</p>
        <dl class="sun-dl">
          <div><dt>Position now</dt><dd>${r.latitude < 0 ? 'S' : 'N'}${pad(Math.abs(r.latitude))} ${lonNow < 0 ? 'E' : 'W'}${pad(Math.abs(Math.round(lonNow)))}</dd></div>
          <div><dt>Spots</dt><dd>${r.number_spots ?? '—'} · class ${esc(r.spot_class || '—')}</dd></div>
          <div><dt>Area</dt><dd>${r.area ?? '—'} millionths of the hemisphere</dd></div>
          <div><dt>Flare odds · 24 h</dt><dd><b class="t-ok">C ${r.c_flare_probability ?? '—'}%</b> · <b class="t-warn">M ${r.m_flare_probability ?? '—'}%</b> · <b class="t-crit">X ${r.x_flare_probability ?? '—'}%</b></dd></div>
          <div><dt>First seen</dt><dd>${esc(dayName(utc(r.first_date)))}</dd></div>
        </dl>
        <span class="eyebrow">DAY BY DAY</span>
        <table class="sun-hist"><thead><tr><th>Day</th><th>Class</th><th>Area</th><th>Spots</th><th>Flares C/M/X</th></tr></thead><tbody>
          ${h.slice().reverse().map(d => `<tr><td>${esc(new Date(utc(d.observed_date + 'T00:00:00')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }))}</td><td>${esc(magName(d.mag_class) || '—')}</td><td>${d.area ?? '—'}</td><td>${d.number_spots ?? '—'}</td><td>${d.c_xray_events ?? 0}/${d.m_xray_events ?? 0}/${d.x_xray_events ?? 0}</td></tr>`).join('')}
        </tbody></table>`;
    }
    return `<span class="eyebrow">ACTIVE REGIONS · ${esc(state.regionDate || '')}</span>
      <table class="sun-regions"><thead><tr><th>Region</th><th>Where</th><th>Magnetic</th><th>M</th><th>X</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr data-region="${r.region}"><td><b>${r.region}</b></td><td>${esc(r.location)}</td><td class="t-${magTone(r.mag_class)}">${esc(magName(r.mag_class) || '—')}</td><td>${r.m_flare_probability ?? '—'}%</td><td>${r.x_flare_probability ?? '—'}%</td></tr>`).join('')
        : `<tr><td colspan="5" class="sun-empty">${state.sources.regions.status === 'error' ? 'NOAA did not answer.' : 'Reading…'}</td></tr>`}
      </tbody></table>
      <p class="sun-hint">Click a region on the disc or in the table. Positions are NOAA's, turned to the time of the image; they are drawn on the SDO layers.</p>`;
  }
  let sunSig = '';
  function paintSun() {
    const host = $('sun-map'), side = $('sun-side');
    if (!host) return;
    const sig = layer;
    if (sunSig !== sig || !$('sun-img')) { host.innerHTML = stageHTML(); sunSig = sig; loadImage(); }
    else paintOverlay();
    const html = regionSide();
    if (side && side.dataset.html !== html) { side.innerHTML = html; side.dataset.html = html; }
  }

  /* ── The forecast ── */
  function nextStorm() {
    const now = Date.now();
    const bar = state.kpf.find(r => r.t + 3 * HOUR > now && r.kind !== 'observed' && r.kp >= 5);
    const eff = inEffect();
    const watch = eff.find(m => m.kind === 'watch');
    const wday = watch && watch.days.find(d => d.g > 0 && d.t + DAY > now);
    return { bar, watch, wday };
  }
  function l1Now() {
    const w = state.wind[state.wind.length - 1], m = state.mag[state.mag.length - 1];
    if (!w) return null;
    const lead = 1.5e6 / w.v / 60;                       // minutes from L1 to Earth
    return { w, m, lead };
  }
  function enlilEvents() {
    const now = Date.now(), ahead = state.enlil.filter(r => r.t > now);
    if (!ahead.length) return {};
    const cme = ahead.find(r => r.cloud > 0.05);
    const nowV = (state.enlil.filter(r => r.t <= now).pop() || ahead[0]).v;
    const fast = ahead.find(r => r.v >= Math.max(500, nowV + 100));
    const peak = ahead.reduce((a, r) => r.v > a.v ? r : a, ahead[0]);
    return { cme, fast, peak, nowV };
  }
  function spark(series, key, lo, hi, now, opts = {}) {
    if (series.length < 2) return '';
    const t0 = series[0].t, t1 = series[series.length - 1].t, W = 300, H = 56;
    const x = t => ((t - t0) / (t1 - t0 || 1)) * W, y = v => H - ((v - lo) / (hi - lo)) * H;
    const step = Math.max(1, Math.floor(series.length / 300));
    const pts = series.filter((_, i) => i % step === 0).map(r => `${x(r.t).toFixed(1)},${Math.max(0, Math.min(H, y(r[key]))).toFixed(1)}`).join(' ');
    return `<svg class="fc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${opts.zero != null ? `<line class="z" x1="0" x2="${W}" y1="${y(opts.zero)}" y2="${y(opts.zero)}"/>` : ''}
      ${now && now > t0 && now < t1 ? `<line class="now" x1="${x(now)}" x2="${x(now)}" y1="0" y2="${H}"/>` : ''}<polyline points="${pts}"/></svg>`;
  }
  function forecastHTML() {
    const now = Date.now(), eff = inEffect(now), ns = nextStorm(), l1 = l1Now(), en = enlilEvents();
    // The headline: the soonest thing coming.
    let head = 'No storm in NOAA’s three-day outlook.', headTone = 'ok', headSub = 'Kp is forecast to stay under 5.';
    const shock = eff.find(m => /Sudden Impulse/.test(m.head));
    const warn = eff.find(m => m.kind === 'warning' && m.kp >= 5);
    if (shock) { head = `Shock at L1 · impact ${shock.from ? 'from ' + hhmm(shock.from) + ' UTC' : 'within the hour'}`; headTone = 'crit'; headSub = 'A CME or fast stream has reached the spacecraft upstream. Earth follows within the hour.'; }
    else if (warn) { head = `Kp ${warn.kp} expected now${gOf(warn.kp) ? ' · G' + gOf(warn.kp) + ' ' + G_WORD[gOf(warn.kp)] + ' storm' : ', just below storm level'}`; headTone = warn.kp >= 6 ? 'crit' : warn.kp >= 5 ? 'warn' : 'ok'; headSub = `NOAA warning until ${hhmm(warn.to)} UTC (${until(warn.to)}).`; }
    else if (ns.bar) { const g = gOf(ns.bar.kp); head = `G${g} ${G_WORD[g]} storm expected ${until(ns.bar.t)}`; headTone = g >= 3 ? 'crit' : 'warn'; headSub = `NOAA forecasts Kp ${ns.bar.kp.toFixed(2)} for ${dayName(ns.bar.t)} ${hhmm(ns.bar.t)}–${hhmm(ns.bar.t + 3 * HOUR)} UTC (${local(ns.bar.t)} your time).`; }
    else if (ns.wday) { head = `G${ns.wday.g} watch for ${dayName(ns.wday.t)}`; headTone = 'warn'; headSub = 'NOAA has a geomagnetic storm watch in effect.'; }
    else if (eff.some(m => m.kind === 'warning' && m.kp === 4)) { head = 'Active: Kp 4 expected, just below storm level'; headSub = 'NOAA warning in effect; no storm in the three-day outlook.'; }
    const days = [1, 2, 3].map(i => {
      const s = state.scales && state.scales[String(i)];
      const t = s ? utc(s.DateStamp + 'T00:00:00') : Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + i - 1);
      const bars = state.kpf.filter(r => r.t >= t && r.t < t + DAY);
      const kp = bars.length ? Math.max(...bars.map(r => r.kp)) : null;
      return { t, kp, g: kp == null ? (s && s.G ? +s.G.Scale || 0 : 0) : gOf(kp), r12: s && s.R ? s.R.MinorProb : null, r3: s && s.R ? s.R.MajorProb : null, s1: s && s.S ? s.S.Prob : null };
    });
    const msgRow = m => {
      const what = m.kind === 'watch' ? m.days.filter(d => d.g > 0).map(d => `${dayName(d.t)}: G${d.g} ${G_WORD[d.g]}`).join(' · ')
        : m.kind === 'warning' ? `${m.from ? hhmm(m.from) : ''}–${m.to ? hhmm(m.to) : ''} UTC · ${m.to > now ? 'ends ' + until(m.to) : 'ended ' + until(m.to)}`
        : `${m.at ? hhmm(m.at) + ' UTC · ' + until(m.at) : ''}`;
      return `<li class="fc-${m.kind}"><span class="fc-kind">${m.kind.toUpperCase()}</span><span><b>${esc(m.head.replace(/^(EXTENDED |CONTINUED )?(WATCH|WARNING|ALERT): /, ''))}</b><small>${esc(what)}${m.aurora ? ' · Aurora: ' + esc(m.aurora) : ''}</small></span><time>issued ${esc(when(m.issue))}</time></li>`;
    };
    const recent = state.messages.filter(m => now - m.issue < 2 * DAY && m.kind !== 'cancel' && !eff.includes(m)).slice(0, 8);
    const bz = l1 && l1.m ? l1.m.bz : null;
    const driving = l1 && bz != null && bz <= -10 && l1.w.v >= 500;
    const day1 = state.wind.filter(r => r.t > now - DAY), mag1 = state.mag.filter(r => r.t > now - DAY);
    const enAhead = state.enlil.filter(r => r.t > now - DAY);
    return `<div class="fc-head t-${headTone}"><span class="eyebrow">WHAT IS COMING</span><strong>${esc(head)}</strong><small>${esc(headSub)}</small></div>
      <div class="fc-block"><span class="eyebrow">IN EFFECT · NOAA SWPC</span>
        <ol class="fc-msgs">${eff.length ? eff.map(msgRow).join('') : '<li class="fc-none">No watch, warning or alert in effect.</li>'}</ol>
      </div>
      <div class="fc-block"><span class="eyebrow">NEXT THREE DAYS${state.fc3 && state.fc3.issued ? ' · ISSUED ' + esc(dayName(state.fc3.issued)) + ' ' + esc(hhmm(state.fc3.issued)) + ' UTC' : ''}</span>
        <table class="fc-days"><thead><tr><th></th>${days.map(d => `<th>${esc(dayName(d.t))}</th>`).join('')}</tr></thead><tbody>
          <tr><td>Geomagnetic · max Kp</td>${days.map(d => `<td class="t-${tone(d.kp || 0)}">${d.kp != null ? d.kp.toFixed(2) : '—'}${d.g ? ` <b>G${d.g}</b>` : ''}</td>`).join('')}</tr>
          <tr><td>Radio blackout R1–R2</td>${days.map(d => `<td>${d.r12 != null ? d.r12 + '%' : '—'}</td>`).join('')}</tr>
          <tr><td>Radio blackout R3+</td>${days.map(d => `<td class="${+d.r3 >= 20 ? 't-warn' : ''}">${d.r3 != null ? d.r3 + '%' : '—'}</td>`).join('')}</tr>
          <tr><td>Radiation storm S1+</td>${days.map(d => `<td class="${+d.s1 >= 20 ? 't-warn' : ''}">${d.s1 != null ? d.s1 + '%' : '—'}</td>`).join('')}</tr>
        </tbody></table>
        ${state.fc3 ? ['G', 'R', 'S'].filter(k => state.fc3.why[k]).map(k => `<p class="fc-why"><b>${{ G: 'Storms', R: 'Radio', S: 'Radiation' }[k]}</b> ${esc(state.fc3.why[k])}</p>`).join('') : ''}
      </div>
      <div class="fc-block fc-two">
        <div><span class="eyebrow">UPSTREAM · L1, 1.5 MILLION KM SUNWARD</span>
          ${l1 ? `<div class="fc-l1"><div><small>Speed</small><b>${Math.round(l1.w.v)}<i>km/s</i></b></div><div><small>Density</small><b>${l1.w.n != null ? l1.w.n.toFixed(1) : '—'}<i>/cm³</i></b></div>
            <div><small>Bz</small><b class="${bz != null && bz <= -10 ? 't-crit' : bz != null && bz <= -5 ? 't-warn' : ''}">${bz != null ? bz.toFixed(1) : '—'}<i>nT</i></b></div><div><small>Reaches Earth</small><b>${Math.round(l1.lead)}<i>min</i></b></div></div>
            ${driving ? '<p class="fc-alarm">Storm-driving wind now: fast, with the field turned south. Expect Kp to climb within the hour.</p>' : `<p class="fc-note">Bz is the north–south part of the wind’s magnetic field: the further south (negative), the more energy gets into Earth’s field. What is measured here arrives in about ${Math.round(l1.lead)} minutes.</p>`}
            <div class="fc-sp"><small>Speed · 24 h</small>${spark(day1, 'v', 250, 900)}</div><div class="fc-sp"><small>Bz · 24 h</small>${spark(mag1, 'bz', -20, 20, null, { zero: 0 })}</div>`
            : `<p class="fc-note">${state.sources.l1.status === 'error' ? 'NOAA’s real-time wind did not answer.' : 'Reading the wind at L1…'}</p>`}
        </div>
        <div><span class="eyebrow">MODEL · WSA-ENLIL, WIND AT EARTH</span>
          ${enAhead.length ? `<div class="fc-sp big"><small>Predicted speed, km/s · the line is now</small>${spark(enAhead, 'v', 250, 900, now)}</div>
            <ul class="fc-model">
              ${en.cme ? `<li class="t-crit"><b>CME at Earth</b> ${esc(dayName(en.cme.t))} ${esc(hhmm(en.cme.t))} UTC · ${esc(until(en.cme.t))}</li>` : '<li>No CME in the current run reaches Earth.</li>'}
              ${en.fast ? `<li class="t-warn"><b>Fast wind arrives</b> ${esc(dayName(en.fast.t))} ${esc(hhmm(en.fast.t))} UTC · ${esc(until(en.fast.t))} · ${Math.round(en.fast.v)} km/s</li>` : '<li>No fast stream in the forecast window.</li>'}
              <li>Peak ${Math.round(en.peak ? en.peak.v : 0)} km/s on ${esc(en.peak ? dayName(en.peak.t) : '—')}</li>
            </ul>
            <button type="button" class="btn ghost sm" data-sunlayer="enlil">See the model run ↗</button>`
            : `<p class="fc-note">${state.sources.enlil.status === 'error' ? 'The model run did not load.' : 'Reading the model run…'}</p>`}
        </div>
      </div>
      ${recent.length ? `<div class="fc-block"><span class="eyebrow">LAST 48 HOURS</span><ol class="fc-msgs">${recent.map(msgRow).join('')}</ol></div>` : ''}`;
  }
  function paintForecast() {
    const host = $('sun-forecast');
    if (!host) return;
    const html = forecastHTML();
    if (host.dataset.html !== html) { host.innerHTML = html; host.dataset.html = html; }
  }

  /* ── The K index, bar by bar ── */
  let kpPick = null;
  function kpRows() {
    if (state.kpf.length) return state.kpf;
    return ((Feeds.state.space && Feeds.state.space.kpSeries) || []).map(r => ({ t: r.time, kp: r.kp, kind: 'observed' }));
  }
  function paintKp() {
    const svg = $('kp-chart');
    if (!svg) return;
    const rows = kpRows();
    if (!rows.length) return;
    const W = 900, H = 150, max = 9, n = rows.length, step = W / n, now = Date.now();
    const nowX = rows.findIndex(r => r.t + 3 * HOUR > now);
    let html = '', labels = '';
    for (let d = Math.ceil(rows[0].t / DAY) * DAY; d < rows[n - 1].t + 3 * HOUR; d += DAY) {
      const x = ((d - rows[0].t) / (3 * HOUR)) * step;
      html += `<line class="kp-day" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${H}"/>`;
      if (x / W < 0.95) labels += `<span style="left:${(x / W * 100).toFixed(2)}%">${esc(new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }))}</span>`;
    }
    html += rows.map((r, i) => {
      const bh = Math.max(1.5, r.kp / max * H), cls = `kp-bar k-${tone(r.kp)} ${r.kind}${i === kpPick ? ' on' : ''}`;
      return `<rect class="${cls}" data-kp="${i}" x="${(i * step + 0.8).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${Math.max(2, step - 1.6).toFixed(1)}" height="${bh.toFixed(1)}"><title>Kp ${r.kp.toFixed(2)} · ${dayName(r.t)} ${hhmm(r.t)} UTC · ${r.kind}</title></rect>`;
    }).join('');
    html += `<line x1="0" y1="${(H - 5 / max * H).toFixed(1)}" x2="${W}" y2="${(H - 5 / max * H).toFixed(1)}" class="kp-threshold"/>`;
    if (nowX >= 0) html += `<line class="kp-now" x1="${(nowX * step + ((now - rows[nowX].t) / (3 * HOUR)) * step).toFixed(1)}" x2="${(nowX * step + ((now - rows[nowX].t) / (3 * HOUR)) * step).toFixed(1)}" y1="0" y2="${H}"/>`;
    if (svg.dataset.html !== html) { svg.innerHTML = html; svg.dataset.html = html; }
    const lab = $('kp-days');
    if (lab && lab.innerHTML !== labels) lab.innerHTML = labels;
    const obs = rows.filter(r => r.kind === 'observed');
    const set = (id, v) => { const nd = $(id); if (nd && nd.textContent !== v) nd.textContent = v; };
    set('kp-range', `${dayName(rows[0].t)} → ${dayName(rows[n - 1].t)} · three-hour bars · solid observed, pale estimated, outlined forecast · click a bar`);
    set('kp-peak', obs.length ? 'observed peak ' + Math.max(...obs.map(r => r.kp)).toFixed(2) : '');
    paintKpDetail(rows);
  }
  function paintKpDetail(rows) {
    const host = $('kp-detail');
    if (!host) return;
    if (kpPick == null || !rows[kpPick]) { if (host.innerHTML) host.innerHTML = ''; delete host.dataset.html; host.hidden = true; return; }
    const r = rows[kpPick], t0 = r.t, t1 = r.t + 3 * HOUR, g = gOf(r.kp), al = auroraLat(r.kp);
    const seenHead = new Set();
    const msgs = state.messages.filter(m => m.kind !== 'cancel' && (((m.at || m.issue) >= t0 && (m.at || m.issue) < t1) || (m.kind === 'warning' && m.from < t1 && m.to > t0)))
      .filter(m => { const k = m.head.replace(/^(EXTENDED|CONTINUED) /, ''); if (seenHead.has(k)) return false; seenHead.add(k); return true; }).slice(0, 8);
    const fl = state.flares.filter(f => f.max >= t0 && f.max < t1 && /^[MX]|^C[5-9]/.test(f.cls || ''));
    const w = state.wind.filter(x => x.t >= t0 && x.t < t1), m = state.mag.filter(x => x.t >= t0 && x.t < t1);
    const kept = l1Hist[t0];
    const vLo = w.length ? Math.min(...w.map(x => x.v)) : kept && kept.vMin, vHi = w.length ? Math.max(...w.map(x => x.v)) : kept && kept.vMax;
    const bzLo = m.length ? Math.min(...m.map(x => x.bz)) : kept && kept.bzMin;
    const btHi = m.length ? Math.max(...m.filter(x => Number.isFinite(x.bt)).map(x => x.bt)) : kept && kept.btMax;
    const nHi = w.length ? Math.max(...w.filter(x => Number.isFinite(x.n)).map(x => x.n)) : kept && kept.nMax;
    const why = r.kind === 'predicted' ? '' : vLo == null ? '' : bzLo != null && bzLo <= -10 && vHi >= 500 ? 'The wind was fast and its field turned hard south: the classic storm driver.'
      : bzLo != null && bzLo <= -10 ? 'The wind’s field turned hard south (Bz below −10 nT): energy poured into Earth’s field.'
      : vHi >= 600 ? 'Fast wind, a high-speed stream, with the field only briefly south.'
      : bzLo != null && bzLo <= -5 ? 'The field leaned south for a while: some energy got in.' : 'Slow wind with a mostly northward field: little got in.';
    const en = state.enlil.filter(x => x.t >= t0 && x.t < t1);
    const h = home();
    const mine = h ? geomagLat(h[0], h[1]) : null;
    const reach = mine == null ? '' : Math.abs(mine) >= al ? ` At your place (geomagnetic latitude ${Math.abs(mine).toFixed(0)}°) it would be overhead or near it.`
      : ` At your place (geomagnetic latitude ${Math.abs(mine).toFixed(0)}°) it would take Kp ${Math.min(9, (66.5 - Math.abs(mine)) / 2.05).toFixed(0)}${(66.5 - Math.abs(mine)) / 2.05 > 9 ? '+, beyond the scale' : ''}.`;
    const G_SAY = ['Quiet to unsettled: no storm.', 'G1 minor storm: weak power-grid fluctuations, aurora at high latitudes.',
      'G2 moderate storm: high-latitude grids may alarm, satellite drag rises, HF radio fades near the poles.',
      'G3 strong storm: voltage corrections on grids, surface charging on satellites, GPS and HF problems; aurora to mid-latitudes.',
      'G4 severe storm: widespread voltage control problems, satellite tracking trouble, GPS degraded for hours; aurora seen far south.',
      'G5 extreme storm: grid collapse possible, satellites lost, HF radio out for days; aurora near the tropics.'];
    host.hidden = false;
    const html = `<div class="kpd-head"><span class="eyebrow">${esc(r.kind === 'predicted' ? 'FORECAST' : r.kind.toUpperCase())} · ${esc(dayName(t0))} ${hhmm(t0)}–${hhmm(t1)} UTC · ${local(t0)}–${local(t1)} YOUR TIME</span>
        <button type="button" class="btn ghost sm" data-kp-close>Close ✕</button></div>
      <div class="kpd-body">
        <div class="kpd-big t-${tone(r.kp)}"><b>${r.kp.toFixed(2)}</b><span>${g ? 'G' + g + ' ' + G_WORD[g] : 'no storm'}</span></div>
        <div class="kpd-text">
          <p>${esc(G_SAY[g])}</p>
          <p>Aurora overhead down to about ${al.toFixed(0)}° geomagnetic latitude, and visible on the horizon some 5–10° further towards the equator.${esc(reach)}</p>
          ${why ? `<p>${esc(why)}</p>` : ''}
          ${w.length > 20 ? `<div class="kpd-sp"><small>Wind speed in the window, km/s</small>${spark(w, 'v', 250, 900)}</div>` : ''}
          ${m.length > 20 ? `<div class="kpd-sp"><small>Bz in the window, nT · the line is zero</small>${spark(m, 'bz', -20, 20, null, { zero: 0 })}</div>` : ''}
          ${r.kind === 'predicted' && state.fc3 && state.fc3.why.G ? `<p class="kpd-why"><b>NOAA’s reason</b> ${esc(state.fc3.why.G)}</p>` : ''}
        </div>
        <dl class="kpd-dl">
          ${vLo != null && Number.isFinite(vLo) ? `<div><dt>Wind speed at L1</dt><dd>${Math.round(vLo)}–${Math.round(vHi)} km/s</dd></div>` : ''}
          ${nHi != null && Number.isFinite(nHi) ? `<div><dt>Density, highest</dt><dd>${nHi.toFixed(1)} /cm³</dd></div>` : ''}
          ${bzLo != null && Number.isFinite(bzLo) ? `<div><dt>Bz, most southward</dt><dd class="${bzLo <= -10 ? 't-crit' : bzLo <= -5 ? 't-warn' : ''}">${bzLo.toFixed(1)} nT</dd></div>` : ''}
          ${btHi != null && Number.isFinite(btHi) ? `<div><dt>Field strength Bt, highest</dt><dd>${btHi.toFixed(1)} nT</dd></div>` : ''}
          ${r.kind !== 'predicted' && t0 < Date.now() && vLo == null ? '<div><dt>Wind at L1</dt><dd>before the record kept here</dd></div>' : ''}
          ${en.length ? `<div><dt>Model wind at Earth</dt><dd>${Math.round(Math.max(...en.map(x => x.v)))} km/s${en.some(x => x.cloud > 0.05) ? ' · CME' : ''}</dd></div>` : ''}
          ${t0 < Date.now() ? `<div><dt>Flares C5 and above</dt><dd>${fl.length ? fl.map(f => esc(f.cls) + ' ' + hhmm(f.max)).join(', ') : 'none'}</dd></div>` : ''}
        </dl>
      </div>
      ${msgs.length ? `<ol class="fc-msgs kpd-msgs">${msgs.map(x => `<li class="fc-${x.kind}"><span class="fc-kind">${x.kind.toUpperCase()}</span><span><b>${esc(x.head.replace(/^(EXTENDED |CONTINUED )?(WATCH|WARNING|ALERT|SUMMARY): /, ''))}</b><small>${esc([x.xclass, x.where, x.speed && 'shock ' + x.speed, x.shock && 'shock at L1 ' + x.shock].filter(Boolean).join(' · '))}</small></span><time>${esc(x.kind === 'warning' && x.from ? 'valid ' + when(x.from) + (x.to ? ' → ' + when(x.to) : '') : when(x.at || x.issue))}</time></li>`).join('')}</ol>`
        : `<p class="kpd-none">${r.kind === 'predicted' ? 'A forecast window: NOAA’s messages and the measurements arrive when it comes.' : 'NOAA issued nothing in this window.'}</p>`}`;
    if (host.dataset.html !== html) { host.innerHTML = html; host.dataset.html = html; }
  }

  /* ── The Overview's Sun ──
     The corona at 193 Å (SDO/AIA through Helioviewer), the same frame as the
     Solar page's Corona layer, with NOAA's active regions numbered on it. A
     new frame every quarter hour; a GOES SUVI image (195 Å, the same corona)
     if Helioviewer does not answer. */
  let ovFrame = 0, ovFallback = false;
  function paintCorona() {
    const img = $('ov-sun-img');
    if (!img) return;
    const frame = Math.floor(Date.now() / (15 * MIN));
    if (frame !== ovFrame) {
      ovFrame = frame; ovFallback = false;
      const wait = $('ov-sun-wait');
      img.onload = () => { if (wait) wait.hidden = true; };
      img.onerror = () => {
        if (!ovFallback) { ovFallback = true; img.src = `${SWPC}/images/animations/suvi/primary/195/latest.png?${STAMP(Date.now())}`; return; }
        if (wait) { wait.hidden = false; wait.textContent = 'The image did not load; trying again in a few minutes.'; }
        ovFrame = 0;
      };
      img.src = HV(11, Date.now());
    }
    const t = Math.floor(Date.now() / (15 * MIN)) * 15 * MIN - 20 * MIN;
    const time = $('ov-sun-time');
    if (time) time.textContent = ovFallback ? 'GOES SUVI 195 Å · latest' : `frame ${hhmm(t)} UTC`;
    const svg = $('ov-sun-over');
    if (!svg) return;
    if (ovFallback) { svg.innerHTML = ''; return; }      // SUVI is framed differently; no labels on it
    const geo = sunGeometry(t), Rpx = geo.radiusArcsec / 2.3;
    const html = state.regions.map(r => ({ r, p: project(r.latitude, regionAt(r, t), geo.b0) }))
      .filter(o => o.p.z > 0.05)
      .sort((a, b) => (b.r.area || 0) - (a.r.area || 0))
      .map(({ r, p }) => ({ r, x: 512 + Rpx * p.x, y: 512 - Rpx * p.y }));
    // Each number takes the first side free of the others: right, left, below, above.
    const taken = html.map(o => ({ x: o.x - 10, y: o.y - 10, w: 20, h: 20 }));
    const clash = b => taken.some(o => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
    const marks = html.map(({ r, x, y }) => {
      const w = 76, h = 30;
      const tries = [[x + 16, y + 10, 'start', x + 14], [x - 16, y + 10, 'end', x - 16 - w], [x, y + 42, 'middle', x - w / 2], [x, y - 18, 'middle', x - w / 2]];
      let pick = tries[0];
      for (const c of tries) { const box = { x: c[3], y: c[1] - h + 6, w, h }; if (!clash(box)) { pick = c; taken.push(box); break; } }
      return `<g class="ov-reg t-${magTone(r.mag_class)}"><circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="9"/><text x="${pick[0].toFixed(0)}" y="${pick[1].toFixed(0)}" text-anchor="${pick[2]}">${esc(String(r.region).slice(-4))}</text></g>`;
    }).join('');
    if (svg.dataset.html !== marks) { svg.innerHTML = marks; svg.dataset.html = marks; }
  }

  /* ── The page ── */
  function paint() { paintSun(); paintForecast(); paintKp(); }
  /* The Sun sits small on the page; full screen shows every layer, the
     region labels and the region detail. Esc or the button closes it. */
  function setFull(on) {
    const panel = document.querySelector('.sun-panel'), b = $('sun-full');
    if (!panel) return;
    panel.classList.toggle('full', on);
    document.body.classList.toggle('sun-full-open', on);
    if (b) { b.textContent = on ? '✕ Close' : '⤢ Full screen'; b.title = on ? 'Back to the page (Esc)' : 'Open the Sun full screen (Esc to close)'; }
    if (!on) stopLoop();
    paintOverlay();
  }
  const isFull = () => { const p = document.querySelector('.sun-panel'); return !!(p && p.classList.contains('full')); };
  function wire() {
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isFull()) { setFull(false); e.stopPropagation(); } }, true);
    document.addEventListener('click', e => {
      if (e.target.closest('[data-sunfull]')) { setFull(!isFull()); return; }
      if (e.target.closest('#sun-stage') && !isFull() && !e.target.closest('[data-region]')) { setFull(true); return; }
      const lay = e.target.closest('[data-sunlayer]');
      if (lay) { layer = lay.dataset.sunlayer; stopLoop(); paintSun(); const s = $('sun-map'); if (s && lay.closest('#sun-forecast')) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (e.target.closest('[data-sunplay]')) { playLoop(); return; }
      if (e.target.closest('[data-region-back]')) { picked = null; paintSun(); return; }
      const reg = e.target.closest('[data-region]');
      if (reg && reg.closest('#view-solar')) { picked = Number(reg.dataset.region); paintSun(); if (reg.closest('#sun-stage') && !isFull()) setFull(true); return; }
      const bar = e.target.closest('[data-kp]');
      if (bar) { const i = Number(bar.dataset.kp); kpPick = kpPick === i ? null : i; paintKp(); return; }
      if (e.target.closest('[data-kp-close]')) { kpPick = null; paintKp(); }
    });
    onUpdate(() => { if (typeof Views !== 'undefined' && Views.current === 'solar') paint(); });
    onUpdate(paintCorona);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  let started = false, l1Timer = 0, lastL1 = 0;
  function start() {
    if (started) return;
    started = true;
    readRegions(); readForecast(); readAlerts(); readEnlil();
    paintCorona();
    setInterval(paintCorona, MIN);
    setInterval(readRegions, 60 * MIN);
    setInterval(readForecast, 30 * MIN);
    setInterval(readAlerts, 5 * MIN);
    setInterval(readEnlil, 60 * MIN);
    // The L1 record: on opening the page, then every ten minutes while it is open.
    l1Timer = setInterval(() => { const open = typeof Views !== 'undefined' && Views.current === 'solar';
      if (Date.now() - lastL1 > (open ? 10 : 60) * MIN) { lastL1 = Date.now(); readL1(); } }, 30000);
    setTimeout(() => { if (!lastL1) { lastL1 = Date.now(); readL1(); } }, 2 * MIN);
  }
  function shown(view) {
    if (view !== 'solar') { stopLoop(); if (isFull()) setFull(false); return; }
    if (Date.now() - lastL1 > 10 * MIN) { lastL1 = Date.now(); readL1(); }
    // A fresh frame if the one on screen is old.
    const img = $('sun-img');
    if (img && Date.now() - imgTime > 30 * MIN + 20 * MIN) { delete img.dataset.src; loadImage(); }
    paint();
  }
  void l1Timer;
  return { state, start, paint, shown, onUpdate, alertCandidates, inEffect };
})();
