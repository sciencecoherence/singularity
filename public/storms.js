'use strict';
/* ── Cyclones now ──────────────────────────────────────────────────────────
   GDACS rates a tropical cyclone by the strongest wind it has had or is
   forecast to have — its lifetime peak — so a hurricane that has weakened
   still reads at its peak. The agencies that warn on the storm publish what
   it is doing now, every three to six hours:

     NOAA National Hurricane Center   Atlantic, eastern and central Pacific
                                      CurrentStorms.json, and each storm's
                                      forecast/advisory (TCM) for gusts and
                                      the forecast intensities
     Joint Typhoon Warning Center     every other basin (and a second copy of
                                      NHC's), as the warning text listed in
                                      its RSS feed

   Each warned storm is matched to GDACS's event by name, or by position when
   the names differ. A matched event's value becomes the wind now; the peak is
   kept beside it. A GDACS cyclone no agency still warns on keeps its peak and
   says so. A storm the agencies warn on that GDACS has not listed yet is
   added as an unrated event, so a newly formed depression appears at once.

   Winds are one-minute sustained, in knots at source (× 1.852 for km/h).   */

const Storms = (() => {
  const KT = 1.852;
  const NHC = 'https://www.nhc.noaa.gov/CurrentStorms.json';
  const JTWC = 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss';
  const DAY = 864e5;

  const state = { list: [], at: null, errors: [] };
  const textCache = new Map();          // url → { key, text } — re-read only when the advisory number moves

  /* ── helpers ── */
  const norm = s => String(s || '').toLowerCase().replace(/^(tropical cyclone|typhoon|hurricane|tropical storm|tropical depression)\s+/, '')
    .replace(/-\d{2}$/, '').replace(/[^a-z]/g, '');
  const coord = (v, h) => (+v) * (/[SW]/.test(h) ? -1 : 1);
  const title = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  // DDHHMM (UTC) in the current month, or the last one when that would be in the future.
  function ddhhmm(dd, hh, mm) {
    const n = new Date();
    let t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), +dd, +hh, +mm);
    if (t > Date.now() + 2 * DAY) t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, +dd, +hh, +mm);
    if (t < Date.now() - 27 * DAY) t = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, +dd, +hh, +mm);
    return t;
  }
  function km(a, b) {
    const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  async function cachedText(url, key) {
    const c = textCache.get(url);
    if (c && c.key === key) return c.text;
    const text = await Net.text(url);
    textCache.set(url, { key, text });
    return text;
  }

  /* ── NHC ── */
  const NHC_CLASS = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm',
                      STD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-tropical Cyclone', TY: 'Typhoon' };
  function parseTCM(text, s) {
    const g = text.match(/MAX SUSTAINED WINDS\s+(\d+) KT WITH GUSTS TO\s+(\d+) KT/);
    if (g) { s.kt = +g[1]; s.gustKt = +g[2]; }
    const mv = text.match(/PRESENT MOVEMENT TOWARD THE [A-Z-]+ OR\s+(\d+) DEGREES AT\s+(\d+) KT/);
    if (mv) { s.dir = +mv[1]; s.speedKt = +mv[2]; }
    else if (/PRESENT MOVEMENT\.\.\.STATIONARY|STATIONARY/.test(text)) s.speedKt = 0;
    const p = text.match(/ESTIMATED MINIMUM CENTRAL PRESSURE\s+(\d+) MB/);
    if (p) s.mb = +p[1];
    const re = /(?:FORECAST|OUTLOOK) VALID (\d\d)\/(\d\d)(\d\d)Z\s+([\d.]+)([NS])\s+([\d.]+)([EW])([^\n]*)\n\s*MAX WIND\s+(\d+) KT\.\.\.GUSTS\s+(\d+) KT/g;
    s.fc = [];
    for (let m; (m = re.exec(text));) {
      s.fc.push({ t: ddhhmm(m[1], m[2], m[3]), lat: coord(m[4], m[5]), lon: coord(m[6], m[7]), kt: +m[9], gustKt: +m[10],
                  note: /INLAND/.test(m[8]) ? 'inland' : /POST-TROP|EXTRATROP/.test(m[8]) ? 'post-tropical' : /DISSIPATED/.test(m[8]) ? 'dissipated' : '' });
    }
  }
  async function readNHC() {
    const data = await Net.json(NHC);
    const out = [];
    for (const a of data.activeStorms || []) {
      const s = {
        src: 'NHC', id: a.id, name: title(a.name), key: norm(a.name),
        cls: NHC_CLASS[a.classification] || a.classification || 'Tropical cyclone',
        kt: +a.intensity, gustKt: null, mb: +a.pressure || null,
        lat: a.latitudeNumeric, lon: a.longitudeNumeric,
        dir: Number.isFinite(+a.movementDir) ? +a.movementDir : null,
        speedKt: Number.isFinite(+a.movementSpeed) ? +a.movementSpeed / 1.15078 : null,   // the JSON gives mph
        time: Date.parse(a.lastUpdate) || null, adv: a.publicAdvisory && a.publicAdvisory.advNum,
        link: (a.publicAdvisory && a.publicAdvisory.url) || 'https://www.nhc.noaa.gov/', fc: []
      };
      const tcm = a.forecastAdvisory && a.forecastAdvisory.url;
      if (tcm) {
        try { parseTCM(await cachedText(tcm, a.forecastAdvisory.issuance + '|' + a.forecastAdvisory.advNum), s); }
        catch (e) { state.errors.push('NHC advisory ' + s.name); }
      }
      if (Number.isFinite(s.kt)) out.push(s);
    }
    return out;
  }

  /* ── JTWC ── */
  function parseJTWC(text, url) {
    const subj = text.match(/SUBJ\/(.+?)\s+(\d{2}[A-Z])\s+\(([^)]+)\)\s+WARNING NR\s+(\d+)/);
    if (!subj) return null;
    const pos = text.match(/WARNING POSITION:\s*\n\s*(\d\d)(\d\d)(\d\d)Z\s+---\s+NEAR\s+([\d.]+)([NS])\s+([\d.]+)([EW])/);
    const wind = text.match(/MAX SUSTAINED WINDS - (\d+) KT, GUSTS (\d+) KT/);
    if (!pos || !wind) return null;
    const mv = text.match(/MOVEMENT PAST SIX HOURS - (\d+) DEGREES AT (\d+) KTS/);
    const mb = text.match(/MINIMUM CENTRAL PRESSURE AT \d{6}Z IS (\d+) MB/);
    const s = {
      src: 'JTWC', id: subj[2], name: title(subj[3]), key: norm(subj[3]), cls: title(subj[1]),
      kt: +wind[1], gustKt: +wind[2], mb: mb ? +mb[1] : null,
      lat: coord(pos[4], pos[5]), lon: coord(pos[6], pos[7]),
      dir: mv ? +mv[1] : null, speedKt: mv ? +mv[2] : null,
      time: ddhhmm(pos[1], pos[2], pos[3]), adv: String(+subj[4]), link: url, fc: [],
      final: /FINAL WARNING/.test(text)
    };
    const fcText = text.split(/FORECASTS:/)[1] || '';
    const re = /(\d+) HRS, VALID AT:\s*\n\s*(\d\d)(\d\d)(\d\d)Z\s+---\s+([\d.]+)([NS])\s+([\d.]+)([EW])\s*\n\s*MAX SUSTAINED WINDS - (\d+) KT, GUSTS (\d+) KT([\s\S]*?)(?=---)/g;
    for (let m; (m = re.exec(fcText));) {
      s.fc.push({ t: ddhhmm(m[2], m[3], m[4]), lat: coord(m[5], m[6]), lon: coord(m[7], m[8]), kt: +m[9], gustKt: +m[10],
                  note: /DISSIPAT/.test(m[11]) ? 'dissipated' : /EXTRATROPICAL/.test(m[11]) ? 'post-tropical' : /OVER LAND|INLAND/.test(m[11]) ? 'inland' : '' });
    }
    return s;
  }
  async function readJTWC() {
    const rss = await Net.text(JTWC);
    // Each warning is announced as "<b>Typhoon  27W (Koguma) Warning #31 </b>" followed by its text link.
    const items = [];
    const re = /Warning #(\d+)[\s\S]*?(https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/([a-z]{2})(\d{2})(\d{2})web\.txt)/g;
    for (let m; (m = re.exec(rss));) if (+m[4] < 90) items.push({ num: m[1], url: m[2] });   // 90–99 are invests (formation alerts)
    const out = [];
    await Promise.all(items.map(async it => {
      try { const s = parseJTWC(await cachedText(it.url, it.num), it.url); if (s) out.push(s); }
      catch (e) { state.errors.push('JTWC ' + it.url.split('/').pop()); }
    }));
    return out;
  }

  /* The stream: both agencies, NHC preferred where both warn on one storm. */
  async function read() {
    state.errors = [];
    const [n, j] = await Promise.allSettled([readNHC(), readJTWC()]);
    if (n.status === 'rejected' && j.status === 'rejected') throw n.reason;
    const list = n.status === 'fulfilled' ? n.value.slice() : [];
    for (const s of j.status === 'fulfilled' ? j.value : []) {
      const dup = list.find(x => x.key === s.key || km([x.lat, x.lon], [s.lat, s.lon]) < 150);
      if (!dup) list.push(s);
      else if (!dup.fc.length && s.fc.length) dup.fc = s.fc;
    }
    state.list = list;
    state.at = Date.now();
    state.partial = n.status === 'rejected' ? 'NHC unreachable' : j.status === 'rejected' ? 'JTWC unreachable' : '';
    return list;
  }

  /* ── reading a storm ── */
  function category(kt) {
    if (kt >= 137) return 'Category 5'; if (kt >= 113) return 'Category 4'; if (kt >= 96) return 'Category 3';
    if (kt >= 83) return 'Category 2'; if (kt >= 64) return 'Category 1'; if (kt >= 34) return 'Tropical storm strength';
    return 'Depression strength';
  }
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = d => COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  // The forecast nearest twenty-four hours ahead (or the nearest there is).
  function ahead(s) {
    if (!s.fc || !s.fc.length || !s.time) return null;
    const want = s.time + DAY;
    return s.fc.reduce((a, b) => Math.abs(b.t - want) < Math.abs(a.t - want) ? b : a);
  }
  function trend(s) {
    const f = ahead(s);
    if (!f) return null;
    const d = f.kt - s.kt, h = Math.round((f.t - s.time) / 36e5);
    const word = f.note === 'dissipated' ? 'dissipating' : d >= 10 ? 'strengthening' : d <= -10 ? 'weakening' : 'holding steady';
    return { word, kmh: f.kt * KT, h, note: f.note };
  }

  /* ── applying to the event list ── */
  function makeNow(s) {
    return {
      kmh: s.kt * KT, gustKmh: Number.isFinite(s.gustKt) ? s.gustKt * KT : null, mb: s.mb, cls: s.cls,
      cat: category(s.kt), src: s.src, adv: s.adv, time: s.time, link: s.link,
      dir: s.dir, speedKmh: Number.isFinite(s.speedKt) ? s.speedKt * KT : null, at: [s.lat, s.lon], trend: trend(s), final: !!s.final
    };
  }
  /* Called by Feeds before every update. Mutates GDACS's cyclones in place
     and returns the list with unmatched warned storms added (and any stale
     added ones dropped). Idempotent: the peak is captured once per event. */
  function apply(events) {
    if (!state.at) return events;
    const list = events.filter(e => e.source !== 'storms');
    const tcs = list.filter(e => e.kind === 'TC' && e.current !== false);
    const used = new Set();
    for (const e of tcs) {
      if (!('peak' in e)) e.peak = Number.isFinite(e.value) ? e.value : null;
      if (!('gdacsDetail' in e)) e.gdacsDetail = e.detail;
      const key = norm(e.headline);
      let s = state.list.find(x => !used.has(x) && x.key && x.key === key);
      if (!s && e.at) s = state.list.filter(x => !used.has(x)).map(x => [x, km(e.at, [x.lat, x.lon])])
        .filter(p => p[1] < 500).sort((a, b) => a[1] - b[1]).map(p => p[0])[0];
      if (s) {
        used.add(s);
        e.now = makeNow(s);
        e.value = e.now.kmh; e.unit = 'km/h';
        // GDACS's peak is rounded from knots too; it is never below the wind now.
        const peak = Math.max(e.peak || 0, e.now.kmh);
        e.detail = `${s.cls} · ${e.now.cat}${peak - e.now.kmh >= 5 ? ` · peak ${Math.round(peak)} km/h` : ''}`;
      } else {
        e.now = null;
        e.value = e.peak; e.detail = e.gdacsDetail;
        e.noAdvisory = true;
      }
    }
    // Warned storms GDACS has not listed (yet): their own rows, unrated.
    for (const s of state.list) {
      if (used.has(s)) continue;
      const now = makeNow(s);
      list.push({
        id: 'storms:' + s.src + s.id, source: 'storms', kind: 'TC', level: 'none',
        rating: 'Not rated yet — GDACS has not listed this storm; the wind is the warning agency’s',
        value: now.kmh, unit: 'km/h', peak: null, now,
        headline: `${s.cls} ${s.name}`, place: 'warned by ' + (s.src === 'NHC' ? 'NOAA NHC' : 'JTWC'),
        detail: `${s.cls} · ${now.cat}`, time: s.time || Date.now(), at: [s.lat, s.lon], link: s.link, current: true
      });
    }
    return list.sort((a, b) => b.time - a.time);
  }

  /* ── display ── */
  const r = Math.round;
  // The short label beside a cyclone's name: the wind now, or its peak marked as such.
  function short(e) {
    if (e.now) return `${r(e.now.kmh)} km/h`;
    if (Number.isFinite(e.value)) return state.at ? `peak ${r(e.value)} km/h` : `${r(e.value)} km/h`;
    return '';
  }
  function ago(t) {
    const m = Math.max(0, r((Date.now() - t) / 6e4));
    return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${r(m / 60)} h ago` : `${r(m / 1440)} d ago`;
  }
  function clock(t) { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`; }
  /* Definition-list rows for a cyclone's detail pane. esc is the caller's escaper. */
  function rows(e, esc) {
    const n = e.now;
    if (!n) {
      return Number.isFinite(e.value) ? `<div><dt>Peak wind</dt><dd>${r(e.value)} km/h</dd></div>
        <div><dt>Wind now</dt><dd>${state.at ? 'No current warning from NHC or JTWC — the storm has weakened below warning level or left the tropics. GDACS shows its peak.' : 'Reading the warning agencies…'}</dd></div>` : '';
    }
    const t = n.trend;
    return `<div><dt>Wind now</dt><dd><b>${r(n.kmh)} km/h</b>${n.gustKmh ? ` · gusts ${r(n.gustKmh)} km/h` : ''} · ${esc(n.cat)}</dd></div>
      ${Number.isFinite(e.peak) && e.peak - n.kmh >= 5 ? `<div><dt>Peak</dt><dd>${r(e.peak)} km/h <span class="dim">(GDACS, lifetime)</span></dd></div>` : ''}
      ${n.mb ? `<div><dt>Pressure</dt><dd>${n.mb} hPa</dd></div>` : ''}
      ${Number.isFinite(n.speedKmh) ? `<div><dt>Moving</dt><dd>${n.speedKmh < 2 ? 'nearly stationary' : `${Number.isFinite(n.dir) ? compass(n.dir) + ' ' : ''}at ${r(n.speedKmh)} km/h`}</dd></div>` : ''}
      ${t ? `<div><dt>Next ${t.h} h</dt><dd>${esc(t.word)} — ${r(t.kmh)} km/h forecast${t.note && t.note !== 'dissipated' ? ' · ' + esc(t.note) : ''}</dd></div>` : ''}
      <div><dt>Advisory</dt><dd><a href="${esc(n.link)}" target="_blank" rel="noreferrer noopener">${n.src === 'NHC' ? 'NOAA NHC' : 'JTWC'} #${esc(n.adv || '')}</a> · ${n.time ? `${clock(n.time)} · ${ago(n.time)}` : ''}${n.final ? ' · final warning' : ''}</dd></div>`;
  }
  // A one-line summary for tooltips and the stream.
  function line(e) {
    const n = e.now;
    if (!n) return short(e);
    return `${r(n.kmh)} km/h now${n.trend ? ', ' + n.trend.word : ''}`;
  }
  // A signature that changes when the reading does (for repaint checks).
  const sig = e => e.now ? `${r(e.now.kmh)}|${e.now.time}|${e.now.adv}` : (e.noAdvisory ? 'peak' : '');

  return { state, read, apply, short, rows, line, sig, category };
})();
