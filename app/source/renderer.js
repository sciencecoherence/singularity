'use strict';
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = n => `${(n * 100).toFixed(6)} %`;
const text = (id, value) => { const node = $(id); if (node && node.textContent !== String(value)) node.textContent = value; };

/* Elapsed civil time, written the way the countdown needs it. */
function span(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  return { d, h: Math.floor(total / 3600) % 24, m: Math.floor(total % 3600 / 60), s: total % 60 };
}
const spanText = ms => { const t = span(ms); return `${fmt(t.d)}d ${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`; };
const ago = ms => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};

/* ── Settings ──────────────────────────────────────────────────────────── */
let settings; try { settings = JSON.parse(localStorage.getItem('matrix-settings')) || {}; } catch { settings = {}; }
settings = { longitude: null, latitude: null, brightness: 85, streams: true, marks: true, ...settings };

function applySettings() {
  Matrix.CAL360.longitude = Number.isFinite(settings.longitude) ? settings.longitude : -new Date().getTimezoneOffset() / 4;
  // Latitude has no automatic default: without it the Moon's rise and set are
  // not stated rather than guessed.
  Matrix.CAL360.latitude = Number.isFinite(settings.latitude) ? settings.latitude : null;
  document.documentElement.style.setProperty('--brightness', settings.brightness / 100);
  text('location-label', Number.isFinite(settings.longitude)
    ? `SOLAR REFERENCE · ${Math.abs(settings.longitude).toFixed(3)}° ${settings.longitude < 0 ? 'W' : 'E'}`
    : 'SOLAR REFERENCE · TIMEZONE MERIDIAN');
  document.body.classList.toggle('no-streams', !settings.streams);
  if (typeof Net !== 'undefined' && Net.setPaused) Net.setPaused(!settings.streams);
}
applySettings();

/* ── Static geometry: ring ticks and the dilation wave ─────────────────── */
const svgNS = 'http://www.w3.org/2000/svg';
for (let i = 0; i < 120; i++) {
  const a = i / 120 * Math.PI * 2 - Math.PI / 2, major = i % 5 === 0;
  const line = document.createElementNS(svgNS, 'line'), r = major ? 266 : 271;
  for (const [k, v] of Object.entries({ x1: 300 + Math.cos(a) * r, y1: 300 + Math.sin(a) * r, x2: 300 + Math.cos(a) * 276, y2: 300 + Math.sin(a) * 276 })) line.setAttribute(k, v);
  if (major) line.classList.add('major');
  if ($('ticks')) $('ticks').append(line);
}
let path = '';
for (let i = 0; i <= 300; i++) { const v = Matrix.velocityM(i / 300); path += `${i ? 'L' : 'M'}${i},${42 - (v - Matrix.RATE_R) * 220}`; }
if ($('wave-path')) $('wave-path').setAttribute('d', path);

/* ── The two countdowns ────────────────────────────────────────────────
   Launch is the March equinox anchor the whole system already shares. The
   second is the natural absorption point τ*, which the model fixes rather
   than the interface choosing: τ* = 715.531301 Matrix dates from launch.
   It is not an outside deadline. It is where the retained entropic energy
   J_ret reaches its endpoint and the reading stops changing. Before launch
   the second card states the duration and waits; it moves when τ does. */
const LAUNCH_MS = Matrix.getMatrixEpoch();
const ABSORPTION_MS = LAUNCH_MS + Matrix.TAU_STAR * Matrix.MS_CAL;
const LAUNCH_WINDOW = 2 * 365.2421896698 * Matrix.MS_DAY;   // the bar reads the last two years of the approach

function drawCountdowns(t, now) {
  const toLaunch = LAUNCH_MS - now;
  const value = $('launch-value');
  if (toLaunch > 0) {
    const share = Math.min(1, Math.max(0, 1 - toLaunch / LAUNCH_WINDOW));
    countdownTo(value, toLaunch);
    text('launch-pct', (share * 100).toFixed(1) + '%');
    meter('launch-bar', share);
    $('card-launch').classList.add('amber');
  } else {
    text('launch-title', 'ELAPSED SINCE LAUNCH');
    countdownTo(value, -toLaunch);
    text('launch-pct', '');
    meter('launch-bar', 1);
    $('card-launch').classList.remove('amber');
  }

  const toAbsorption = ABSORPTION_MS - now;
  if (!$('absorption-value')) return;          // the card is not on this page
  if (t.absolute || toAbsorption <= 0) {
    text('absorption-value', 'τ*  REACHED');
    meter('absorption-bar', 1);
  } else if (t.pending) {
    text('absorption-value', spanText(toAbsorption));
    meter('absorption-bar', 0);
  } else {
    text('absorption-value', spanText(toAbsorption));
    meter('absorption-bar', t.trajectory);
  }
}

/* The countdown in quiet parts: the days carry it, the clock beside them is
   set back. Rebuilt only when the days change; the seconds are a text update. */
function countdownTo(node, ms) {
  if (!node) return;
  const t = span(ms);
  if (!node.firstElementChild) node.innerHTML = '<b></b><small>d</small><span></span>';
  const [d, , hms] = node.children;
  const days = fmt(t.d), clock = `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;
  if (d.textContent !== days) d.textContent = days;
  if (hms.textContent !== clock) hms.textContent = clock;
}

function meter(id, value) {
  const bar = $(id);
  if (!bar) return;                 // the card this bar belongs to may not be on the page
  bar.style.width = `${value * 100}%`;
  bar.parentElement.setAttribute('aria-valuenow', (value * 100).toFixed(4));
}

/* ── The wire, on the left ─────────────────────────────────────────────
   What became real. The face shows the top slice; the Discovery page carries
   the whole list. A launch that has not happened yet is included and marked,
   because a launch forty minutes out is the most temporal thing on the page. */
let wireSignature = null, wireSeen = new Set(), wireFirst = true;

function wireWhen(e) {
  const d = e.time - Date.now();
  if (d > 0) {
    const m = Math.round(d / 60000);
    return m < 60 ? 'in ' + m + 'm' : m < 1440 ? 'in ' + Math.round(m / 60) + 'h' : 'in ' + Math.round(m / 1440) + 'd';
  }
  return ago(e.time);
}

function drawWire() {
  const list = $('wire');
  if (!list) return;
  const now = Date.now();
  const items = Wire.state.realization
    .filter(e => e.time > now - 7 * 86400000 && e.time < now + 3 * 86400000)
    .slice(0, 24);

  if (!items.length) {
    if (wireSignature !== 'empty') {
      wireSignature = 'empty';
      const opening = Object.values(Wire.state.sources).some(h => h.status === 'waiting');
      list.innerHTML = `<li class="stream-empty">${opening ? 'Opening the wire…'
        : 'Nothing has crossed the line in the last week. The Discovery page carries everything below it.'}</li>`;
    }
    return;
  }

  const signature = items.map(e => e.id).join('|');
  if (signature === wireSignature) {
    const ages = list.querySelectorAll('.s-meta i');
    items.forEach((e, i) => { if (ages[i]) { const v = wireWhen(e); if (ages[i].textContent !== v) ages[i].textContent = v; } });
  } else {
    wireSignature = signature;
    list.innerHTML = items.map(e => {
      const fresh = !wireFirst && !wireSeen.has(e.id);
      const glyph = e.kind === 'LAUNCH' ? '↑' : e.kind === 'BUILT' ? '◆' : '◇';
      const tone = e.level === 'red' ? 'lvl-red' : e.level === 'amber' ? 'lvl-orange' : 'lvl-green';
      return `<li class="${tone}${fresh ? ' fresh' : ''}">
        <span class="s-glyph">${glyph}</span>
        <span class="s-body"><strong>${escape(e.headline)}</strong><em>${escape(e.detail || e.place || '')}</em></span>
        <span class="s-meta"><b>${escape(e.ahead && e.time > now ? 'AHEAD' : e.kind)}</b><i>${wireWhen(e)}</i></span>
      </li>`;
    }).join('');
    for (const e of items) wireSeen.add(e.id);
    if (wireSeen.size > 300) wireSeen = new Set(items.map(e => e.id));
    wireFirst = false;
    refit();
  }

}

/* ── The tickers ───────────────────────────────────────────────────────
   Five flows, counting from the moment the page opened. Each names the rate it
   integrates, because the number is arithmetic on a measurement rather than a
   reading of anything. Rates arrive with the vitals, so the row is rebuilt
   when they do. */
const OPENED = performance.now();
let tickCells = null;

/* The slot under a stopped ticker is one short line wide, so the two failures
   a reader can actually act on get a short form. Everything else shows the
   source's own note, and the full text is on the hover title either way. */
function shortNote(note) {
  const n = String(note || '');
  if (n.includes('proxy.php')) return 'open the app';
  if (n.includes('Build Runtime')) return 'rebuild the app';
  return (n || 'unread').slice(0, 22);
}

const FACE_FLOWS = ['co2t', 'compute'];   // CO₂ emitted, AI compute
function buildTickers() {
  const row = $('tick-row');
  if (!row) return;
  // The face keeps two of the five flows; all five stay on the Vitals page.
  // The row keeps its five-column grid, so the freed columns stay free.
  const all = Vitals.flows();
  const flows = Object.fromEntries(FACE_FLOWS.filter(k => all[k]).map(k => [k, all[k]]));
  // Each flow: its name, the running total with its unit beside it, and the
  // source in one quiet line beneath.
  row.innerHTML = Object.entries(flows).map(([k, x]) =>
    `<div title="${escape(x.note)}"${x.known ? '' : ' class="unread"'}>
       <span>${escape(x.label)}</span>
       <strong><b id="tick-${k}">${x.known ? '0' : '\u2014'}</b><i id="tick-${k}-u">${escape(x.known ? x.unit : '')}</i></strong>
       <small>${escape(x.known ? x.note : shortNote(x.note))}</small></div>`).join('');
  tickCells = Object.entries(flows).map(([k, x]) => ({ node: $('tick-' + k), unitNode: $('tick-' + k + '-u'),
    rate: x.rate, dp: x.dp, unit: x.unit, known: x.known }));
}

function drawTickers() {
  if (!tickCells) return;
  const s = (performance.now() - OPENED) / 1000;
  for (const c of tickCells) {
    if (!c.node || !c.known) continue;       // no rate means nothing honest to count
    const v = Vitals.scaled(c.rate * s, c.unit, c.dp);
    c.node.textContent = v.text;
    if (c.unitNode && c.unitNode.textContent !== v.unit) c.unitNode.textContent = v.unit;
  }
}

/* ── The live field ────────────────────────────────────────────────────
   The face does not carry everything that happens; the Seismic and Disasters
   views do that. Here it shows only what would make someone look up: an
   earthquake large enough to be felt and reported on, a cyclone that is
   actually spinning right now, and a volcano that is erupting. Magnitude 5 is
   roughly where an earthquake stops being an instrument reading and starts
   being an event with a place and people in it.

   The list is the whole of that, not a window onto it. If it is longer than
   the rail, it scrolls.                                                     */
const FACE_MIN_MAGNITUDE = 5;
const FACE_KINDS = new Set(['TC', 'VO']);   // cyclones (named storms among them), volcanoes
function faceEvents() {
  return Feeds.state.events.filter(e =>
    (e.kind === 'EQ' && e.value >= FACE_MIN_MAGNITUDE) ||
    // Long-running eruptions the Smithsonian counts as ongoing (Kilauea,
    // Stromboli…) live on the Disasters page; the face keeps the eruptions
    // GDACS reported in the last week.
    (FACE_KINDS.has(e.kind) && e.current !== false && !e.ongoing));
}

let lastTopId = null, seenIds = new Set(), firstStreamPaint = true, streamSignature = null;

function levelClass(level) { return level === 'red' ? 'lvl-red' : level === 'orange' ? 'lvl-orange' : level === 'none' ? 'lvl-none' : 'lvl-green'; }

function drawStream() {
  const events = faceEvents();
  const list = $('stream');

  if (!events.length) {
    if (streamSignature !== 'empty') {
      streamSignature = 'empty';
      const opening = Object.values(Feeds.state.sources).some(h => h.status !== 'live');
      list.innerHTML = `<li class="stream-empty">${opening
        ? 'Opening the streams\u2026'
        : 'Nothing above the threshold right now \u2014 no earthquake at magnitude 5, no active cyclone, no erupting volcano. The Seismic and Disasters views carry everything below it.'}</li>`;

    }
    return;
  }

  const top = events[0];
  if (top.id !== lastTopId) { lastTopId = top.id; list.scrollTop = 0; }

  const signature = events.map(e => e.id + (e.kind === 'TC' ? ':' + Math.round(e.value || 0) : '')).join('|');
  if (signature === streamSignature) {
    const ageNodes = list.querySelectorAll('.s-meta i');
    events.forEach((e, i) => { if (ageNodes[i]) { const value = ago(e.time); if (ageNodes[i].textContent !== value) ageNodes[i].textContent = value; } });
  } else {
    streamSignature = signature;
    list.innerHTML = events.map(e => {
      const kind = Feeds.EVENT_KINDS[e.kind] || { label: e.kind, glyph: '\u00b7' };
      const fresh = !firstStreamPaint && !seenIds.has(e.id);
      const value = e.kind === 'TC' && typeof Storms !== 'undefined' && Storms.short(e) ? Storms.short(e)
        : Number.isFinite(e.value)
        ? (e.kind === 'EQ' ? 'M ' + e.value.toFixed(1) : Math.round(e.value) + (e.unit ? ' ' + e.unit : ''))
        : (e.headline || '');
      return `<li class="${levelClass(e.level)}${fresh ? ' fresh' : ''}">
        <span class="s-glyph">${kind.glyph}</span>
        <span class="s-body"><strong>${escape(e.kind === 'EQ' ? value : e.headline)}</strong><em>${escape(e.place || kind.label)}</em></span>
        <span class="s-meta"><b>${escape(e.kind === 'EQ' ? kind.label : value)}</b><i>${ago(e.time)}</i></span>
      </li>`;
    }).join('');
    for (const e of events) seenIds.add(e.id);
    if (seenIds.size > 400) seenIds = new Set(events.map(e => e.id));
    firstStreamPaint = false;
  }

  const overflowing = list.scrollHeight - list.clientHeight > 4;
  list.classList.toggle('scrolls', overflowing);
}

function escape(value) { return String(value == null ? '' : value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* Significant quakes (M5.0 and up, last 24 h) placed on the clock ring at the
   Matrix time they arrived — the same living phase that moves the ring dot,
   so a mark sits where the hand stood when the planet moved. Size follows
   magnitude, opacity follows age. */
const MARK_MIN_MAG = 5;
function drawEventMarks() {
  if (!$('event-marks')) return;            // the clock ring is no longer on the Overview
  if (!settings.marks) { $('event-marks').innerHTML = ''; return; }
  const now = Date.now();
  const recent = Feeds.state.events.filter(e => e.kind === 'EQ' && e.value >= MARK_MIN_MAG && now - e.time < 86400000).slice(0, 40);
  $('event-marks').innerHTML = recent.map(e => {
    const a = Matrix.cal360(new Date(e.time)).phi * Math.PI * 2 - Math.PI / 2;
    const r = 283;
    const size = Math.max(2, Math.min(6, (e.value - 4) * 1.6));
    const age = 1 - (now - e.time) / 86400000;
    return `<circle cx="${(300 + Math.cos(a) * r).toFixed(1)}" cy="${(300 + Math.sin(a) * r).toFixed(1)}" r="${size.toFixed(2)}" class="mark ${levelClass(e.level)}" opacity="${(0.25 + age * 0.6).toFixed(2)}"><title>M${e.value.toFixed(1)} · ${escape(e.place || e.title || '')}</title></circle>`;
  }).join('');
}

/* ── Field conditions ──────────────────────────────────────────────────── */
/* The readings stay — it is an instrument — but each one now says what it
   means underneath, and the band opens with the one-line answer to the
   question people actually have: is anything happening, and does it matter. */
function drawVerdict(prefix) {
  const v = Reading.verdict(Feeds.state.space);
  const set = (id, value) => { const n = $(id); if (n && n.textContent !== String(value)) n.textContent = value; };
  set(prefix + 'verdict-state', v.state);
  set(prefix + 'verdict-plain', v.plain);
  const card = $(prefix === '' ? 'verdict' : 's-verdict');
  if (card) card.className = 'verdict' + (prefix ? ' big' : '') + ' v-' + (v.word || 'waiting');
  for (const [key, part] of [['aurora', v.aurora], ['radio', v.radio], ['drag', v.drag]]) {
    set(`${prefix}eff-${key}`, part.short || '—');
    set(`${prefix}eff-${key}-plain`, part.plain);
    const node = $(`${prefix}eff-${key}`);
    if (node) node.className = Reading.tone(part.level);
    // The Overview shows only the word; the sentence is on hover.
    if (node && !prefix && node.parentElement.title !== part.plain) node.parentElement.title = part.plain || '';
  }
  const say = $(prefix + 'verdict-state');
  if (say && !prefix && say.parentElement.title !== v.plain) say.parentElement.title = v.plain || '';
  return v;
}

/* The debris cascade, in the same three tones as the space weather beside
   it. The rules are the alert rules (kessler.js): red for a breakup found by
   comparing two readings of the catalogue, or a pass of 1 in 100 where
   neither object can move; amber for a pass of 1 in 10 against an object that
   cannot move; otherwise normal, with what is being watched. A breakup found
   on the first reading (no earlier reading to compare) is reported, not lit. */
function drawKessler() {
  const node = $('eff-kessler'), plain = $('eff-kessler-plain');
  if (!node || typeof Kessler === 'undefined') return;
  const k = Kessler.state, now = Date.now();
  const inSpan = ms => { const h = Math.max(0, Math.round((ms - now) / 3600000)); return h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)}d`; };
  const oneIn = p => p >= 0.5 ? '1 in 2' : '1 in ' + Math.round(1 / p).toLocaleString('en-US');
  const passes = (k.conj || []).filter(x => x.tca > now);
  const against = x => !Kessler.CAN_MOVE.has(x.s2), stuck = x => !Kessler.CAN_MOVE.has(x.s1);
  const breakup = (k.frag.events || []).find(e => !e.firstLook && now - e.detected < 7 * 86400000);
  const stuckPass = passes.filter(x => stuck(x) && against(x) && x.p >= Kessler.P_ALERT_STUCK).sort((a, b) => b.p - a.p)[0];
  const riskPass = passes.filter(x => against(x) && x.p >= Kessler.P_ALERT).sort((a, b) => b.p - a.p)[0];
  let level = 0, short, say;
  if (breakup) {
    level = 3; short = 'Breakup';
    say = `${breakup.parent} shed ${breakup.pieces} new pieces of tracked debris.`;
  } else if (stuckPass) {
    level = 3; short = 'Collision risk';
    say = `${stuckPass.name1} and ${stuckPass.name2}, neither able to move: ${oneIn(stuckPass.p)}, ${inSpan(stuckPass.tca)}.`;
  } else if (riskPass) {
    level = 2; short = 'High-risk pass';
    say = `${riskPass.name1} and ${riskPass.name2}: ${oneIn(riskPass.p)}, ${inSpan(riskPass.tca)}. Only the satellite can move.`;
  } else if (k.counts) {
    short = 'Normal';
    say = `No breakup. ${k.counts.fast.toLocaleString('en-US')} high-speed passes this week; satellites can dodge the risky ones.`;
  } else {
    short = '—';
    say = k.status.conj === 'waiting' ? 'Reading CelesTrak…' : 'CelesTrak has not answered yet.';
  }
  if (node.textContent !== short) node.textContent = short;
  if (plain.textContent !== say) plain.textContent = say;
  node.className = Reading.tone(level);
  return level;
}

/* The four corner doors to Seismic, Disasters, Solar and Orbital take the
   tone of what they watch: a quake of M6 (amber) or M7 (red) in the last day;
   red only for an active GDACS red alert, droughts aside (they hold their
   alert for months); the worst space-weather effect; the Kessler column. */
const RANK = { red: 3, orange: 2 };
function drawCorners(v, kessler) {
  const now = Date.now();
  const worst = list => list.reduce((m, e) => Math.max(m, RANK[e.level] || 0), 0);
  const solar = v ? Math.max(...[v.aurora, v.radio, v.drag].map(p => (p && p.level) || 0)) : 0;
  const tones = {
    seismic: Feeds.state.events.filter(e => e.kind === 'EQ' && now - e.time < 86400000)
      .reduce((m, e) => Math.max(m, e.value >= 7 ? 3 : e.value >= 6 ? 2 : 0), 0),
    disasters: worst(Feeds.state.events.filter(e => e.kind !== 'EQ' && e.kind !== 'DR')) >= 3 ? 3 : 0,
    solar, orbital: kessler || 0,
  };
  // The sidebar entries take the same tone: amber or red when their reading is.
  for (const [view, level] of Object.entries(tones)) {
    const node = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (!node) continue;
    const want = level >= 2 ? String(level) : '';
    if ((node.dataset.level || '') !== want) { if (want) node.dataset.level = want; else delete node.dataset.level; }
  }
}

function drawConditions() {
  const v = drawVerdict('');
  const kessler = drawKessler();
  drawCorners(v, kessler);

  const health = Feeds.state.sources;
  const live = Object.values(health).filter(h => h.status === 'live').length;
  const total = Object.keys(health).length;
  text('run-status', !settings.streams ? 'STREAMS PAUSED'
    : live ? `${live} OF ${total} STREAMS LIVE` : 'OPENING STREAMS');
  $('status-lamp').className = live === total ? '' : live ? 'partial' : 'down';

  // The counts are of everything under way, not of the rows on show. The list
  // is deliberately selective; the numbers above it are not.
  text('event-count', Feeds.state.events.length || '\u2014');
  text('seismic-count', Feeds.state.seismic.count24h || '\u2014');
  text('storm-count', Feeds.state.storms.length || '0');
}

/* ── The tick ──────────────────────────────────────────────────────────── */
const REGIME_SAY = { race: 'RACING · 00–04', repay: 'REPAYING · 04–12', true: 'RUNNING TRUE · 12–24' };
function tick() {
  const now = new Date();
  if (settings.longitude === null) Matrix.CAL360.longitude = -now.getTimezoneOffset() / 4;
  const t = Matrix.cal360(now);
  const mDateStr = `${Matrix.CAL360.days[t.weekday].name} ${t.day} ${Matrix.CAL360.months[t.month]}`;
  const mTimeStr = `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;

  // The compact reading in the top bar of every page.
  text('mx-time', mTimeStr);
  text('mx-date', mDateStr);
  text('mx-v', `v ${t.v.toFixed(4)}×`);

  drawCountdowns(t, now.getTime());

  // The Matrix page's clock face and readings only need painting when the
  // Matrix page is on screen.
  if (typeof Views !== 'undefined' && Views.current !== 'matrix') return;

  text('hours', pad(t.h)); text('minutes', pad(t.m)); text('seconds', pad(t.s));
  text('matrix-date', mDateStr);
  text('vector', `${t.v.toFixed(6)}×`);
  text('ov-regime', REGIME_SAY[t.regime] || '');
  text('mx-p-time', mTimeStr);
  text('mx-p-date', mDateStr);
  text('mx-p-regime', REGIME_SAY[t.regime] || '—');
  text('mx-p-v', `${t.v.toFixed(6)}×`);
  text('mx-p-civil', `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} local`);
  text('mx-p-tau', t.pending ? `τ 0 · protocol launch in ${Math.ceil(t.toLaunchMs / 86400000)} days` : `τ ${t.tau.toFixed(4)} · q ${Number.isFinite(t.q) ? t.q.toFixed(3) : '—'}`);

  if (!$('phase-arc')) return;               // the Matrix clock face is not on this page
  $('phase-arc').setAttribute('stroke-dasharray', `${t.phi * 100} 100`);
  const a = t.phi * Math.PI * 2 - Math.PI / 2;
  $('orbit-dot').setAttribute('cx', 300 + 260 * Math.cos(a)); $('orbit-dot').setAttribute('cy', 300 + 260 * Math.sin(a));
  $('wave-dot').setAttribute('cx', t.phi * 300); $('wave-dot').setAttribute('cy', 42 - (t.v - Matrix.RATE_R) * 220);
}

/* The field repaints on its own cadence: fast enough that ages stay honest,
   slow enough that the panel is not rewriting itself between readings. */
function fieldTick() {
  if (!settings.streams) return;
  if (typeof Views !== 'undefined' && Views.current !== 'field') { drawConditions(); return; }
  drawStream(); drawWire(); drawEventMarks(); drawConditions();
}

/* ── Layout and controls ────────────────────────────────────────── */
/* The layout is built to fill the window exactly, so nothing is scaled unless
   the content genuinely will not fit — a very short window, or a font that
   loaded wider than expected. Scaling by default was what left the instrument
   sitting slightly small inside its own frame. */
/* Measure with the scale cleared, or the previous scale is baked into the
   reading. This used to run once, often before the fonts had swapped and the
   feeds had filled, conclude the page overflowed, shrink the whole instrument
   and never look again — which is how it ended up at 63% inside its own frame.
   Now anything that changes the layout asks it to look again. */
// Since the console redesign (October 2026) every page scrolls inside its own
// panels, so nothing is ever scaled to fit; this only clears an old scale.
function fitInstrument() { const node = $('instrument'); if (node) node.style.transform = ''; }
let refitPending = 0;
function refit() { clearTimeout(refitPending); refitPending = setTimeout(fitInstrument, 120); }
window.addEventListener('resize', refit);

async function fullscreen() { if (window.desktop) window.desktop.fullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }

$('fullscreen-button').onclick = fullscreen;

function openSettings() {
  $('longitude').value = settings.longitude ?? ''; $('latitude').value = settings.latitude ?? ''; text('locate-status', '');
  $('brightness').value = settings.brightness;
  $('streams-toggle').checked = settings.streams; if ($('marks-toggle')) $('marks-toggle').checked = settings.marks;
  text('save-status', ''); $('settings').showModal();
}
$('settings-button').onclick = openSettings;
/* Fills the two fields from the device's own location. It can be refused, and
   inside the desktop app Chromium's network locator may not answer at all —
   either way the fields stay editable by hand. Nothing is saved until Save. */
$('locate-button').onclick = () => {
  if (!navigator.geolocation) { text('locate-status', 'This device offers no location. Enter it by hand.'); return; }
  text('locate-status', 'Asking the device…');
  navigator.geolocation.getCurrentPosition(p => {
    $('latitude').value = p.coords.latitude.toFixed(4);
    $('longitude').value = p.coords.longitude.toFixed(4);
    text('locate-status', `Found, to about ${Math.round(p.coords.accuracy)} m. Save to use it.`);
  }, err => text('locate-status', `No location (${err.message || 'refused'}). Enter it by hand.`),
  { timeout: 15000, maximumAge: 600000 });
};

$('close-settings').onclick = () => $('settings').close();
$('settings-form').onsubmit = e => {
  e.preventDefault();
  const raw = $('longitude').value.trim();
  const longitude = raw === '' ? null : Number(raw);
  if (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) return;
  const rawLat = $('latitude').value.trim();
  const latitude = rawLat === '' ? null : Number(rawLat);
  if (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) return;
  settings = { longitude, latitude, brightness: Number($('brightness').value),
               streams: $('streams-toggle').checked, marks: $('marks-toggle') ? $('marks-toggle').checked : settings.marks };
  localStorage.setItem('matrix-settings', JSON.stringify(settings));
  applySettings(); tick(); fieldTick(); if (settings.streams) startStreams(); text('save-status', 'Settings saved.');
};
document.addEventListener('keydown', e => { if ($('settings').open || (typeof Reader !== 'undefined' && Reader.isOpen()) || (typeof DisasterMap !== 'undefined' && DisasterMap.isOpen())) return; if (e.key === 'Enter') fullscreen(); });
window.addEventListener('storage', e => { if (e.key === 'matrix-settings') { try { settings = { ...settings, ...JSON.parse(e.newValue) }; applySettings(); } catch {} } });

if (window.desktop) document.body.classList.add('desktop');

function startStreams() {
  Feeds.start(); Vitals.start(); Wire.start(); Kessler.start();
  if (typeof Energy !== 'undefined') Energy.start();
  if (typeof Sun !== 'undefined') Sun.start();
  if (typeof Watch !== 'undefined') Watch.start();
  if (typeof Society !== 'undefined') Society.start();
  if (typeof War !== 'undefined') War.start();
  if (typeof Economy !== 'undefined') Economy.start();
}

window.App = { fit: fitInstrument, verdict: drawVerdict, tick };
Matrix.getMatrixEpoch();
fitInstrument();
tick(); setInterval(tick, 250);
Feeds.onUpdate(fieldTick);
fieldTick(); setInterval(fieldTick, 2000);
if (settings.streams) startStreams();
buildTickers();
Vitals.onUpdate(buildTickers);
Kessler.onUpdate(drawKessler);
Wire.onUpdate(() => drawWire());
(function tickerFrame(){ if (!document.hidden && (typeof Views === 'undefined' || Views.current === 'field')) drawTickers(); requestAnimationFrame(tickerFrame); })();
document.fonts.ready.then(refit);
