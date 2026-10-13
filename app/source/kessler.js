'use strict';
/* ── Kessler watch ─────────────────────────────────────────────────────────
   The Kessler syndrome is a cascade: in a crowded orbit, one collision makes
   fragments, and the fragments make the next collisions more likely. No
   source announces it. What can be watched are its three terms, each from
   CelesTrak (T.S. Kelso), the public mirror of the US Space Force catalogue:

   POPULATION   How much is up there, and how much of it is dead: payloads on
                orbit and active, and debris with spent rocket bodies. From the
                SATCAT boxscore, twice a day.

   PRESSURE     SOCRATES Plus screens every active satellite against every
                tracked object for the next seven days and lists each pass
                within 5 km, with its maximum collision probability. Its top
                entries are satellites flying in formation — co-located at no
                relative speed, probability 1, no danger — so only passes at
                1 km/s or more are counted here: those are the ones that would
                shatter. Only the head of the file is read (it is sorted by
                probability; every pass of 1 in 1,000 or more lies in its
                first 2.7 MB of 22).

   BREAKUPS     The event itself. The whole catalogue is read twice a day in
                the desktop app and compared with the last reading: ten or more
                new debris pieces from one object launched more than thirty
                days ago is a fragmentation — an explosion or a collision. The
                first reading, having nothing to compare with, looks back over
                the newest 1,500 catalogue numbers. (Not on the website: the
                catalogue is 6.7 MB.)

   A satellite marked [+] is operational and can move out of the way; debris,
   dead satellites ([-]) and unknowns ([?]) cannot. SOCRATES's first object is
   always an active satellite, so a pass between two pieces of debris — the
   cascade proper — is not in its list; that is the gap the breakup watch
   covers.                                                                   */

const Kessler = (() => {
  const HOUR = 3600000, DAY = 24 * HOUR;
  const SOCRATES_CSV = 'https://celestrak.org/SOCRATES/sort-maxProb.csv';
  const SOCRATES_HEAD = 3200000;            // bytes; covers every pass of p ≥ 1e-3 with room
  const SOCRATES_SUMMARY = 'https://celestrak.org/SOCRATES/table-socrates.php?NAME=,&ORDER=TCA&MAX=1';
  const BOXSCORE = 'https://celestrak.org/satcat/boxscore.php';
  const SATCAT = 'https://celestrak.org/pub/satcat.csv';

  const P_LISTED = 1e-3;                    // a pass is listed from 1 in 1,000
  const FAST_KMS = 1;                       // below this, two objects are flying together
  const P_ALERT = 0.1;                      // shown amber: 1 in 10, against something that cannot move (not alerted)
  const P_ALERT_STUCK = 0.01;               // shown red: 1 in 100 when the satellite cannot move either (not alerted)
  const FRAG_PIECES = 10;                   // new debris pieces from one parent between readings
  const FRAG_PARENT_AGE = 30 * DAY;         // a new launch sheds pieces; an old object that does has broken up
  const FIRST_LOOKBACK = 1500;              // catalogue numbers the first reading looks back over

  const EVERY = { conj: 6 * HOUR, box: 12 * HOUR, satcat: 12 * HOUR };   // CelesTrak asks for restraint; its data runs twice a day
  const STORE = 'temporal-live:kessler:v1';

  const state = {
    conj: [],             // risky passes, highest probability first
    counts: null,         // { listed, fast, againstDebris }
    summary: null,        // { primaries, secondaries, conjunctions, from, to }
    box: null,            // { payloads, active, debris, all }
    frag: { maxId: null, since: null, events: [] },
    fresh: {},
    status: { conj: 'waiting', box: 'waiting', satcat: 'waiting' },
    note: {}
  };
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } };

  function save() {
    try {
      const { conj, counts, summary, box, frag, fresh } = state;
      localStorage.setItem(STORE, JSON.stringify({ conj, counts, summary, box, frag, fresh }));
    } catch { /* storage refused; next start is cold */ }
  }
  function load() {
    try { Object.assign(state, JSON.parse(localStorage.getItem(STORE)) || {}); } catch { /* cold */ }
    state.frag = { maxId: null, since: null, events: [], ...(state.frag || {}) };
    state.fresh = state.fresh || {};
    state.status = { conj: 'waiting', box: 'waiting', satcat: 'waiting' };
    state.note = {};
  }

  const statusOf = name => (/\[(.)\]\s*$/.exec(name) || [])[1] || '';
  const bare = name => String(name).replace(/\s*\[.\]\s*$/, '').trim();
  const CAN_MOVE = new Set(['+']);          // operational; P (partly), B, S, X are not counted on

  /* ── Pressure ── */
  async function readConjunctions() {
    // The head read must reach below 1 in 1,000, or the counts would be cut
    // short without saying so. If it does not, the read is made again,
    // twice as long, up to the 8 MB a single read allows.
    let lines, reached = false;
    for (let head = SOCRATES_HEAD; ; head *= 2) {
      const text = await Net.text(SOCRATES_CSV, { head: Math.min(head, 8000000) });
      lines = text.split('\n');
      if (!/^NORAD_CAT_ID_1,/.test(lines[0] || '')) throw new Error('unexpected SOCRATES format');
      reached = lines.some((line, i) => { if (!i) return false; const c = line.split(','); return c.length === 11 && Number(c[9]) < P_LISTED; });
      if (reached || head >= 8000000) break;
    }
    const out = [];
    let listed = 0;
    for (const line of lines.slice(1)) {
      const c = line.split(',');
      if (c.length !== 11) continue;
      const p = Number(c[9]);
      if (!(p >= P_LISTED)) break;          // sorted by probability: nothing further qualifies
      listed++;
      const speed = Number(c[8]);
      if (!(speed >= FAST_KMS)) continue;
      const tca = Date.parse(c[6].replace(' ', 'T') + 'Z');
      out.push({
        id1: c[0], name1: bare(c[1]), s1: statusOf(c[1]),
        id2: c[3], name2: bare(c[4]), s2: statusOf(c[4]),
        tca, rangeKm: Number(c[7]), speed, p
      });
    }
    state.conj = out;
    state.counts = { listed, fast: out.length, againstDebris: out.filter(x => !CAN_MOVE.has(x.s2)).length, complete: reached };
    // The run's own header: how many objects were screened, how many passes found.
    try {
      const html = await Net.text(SOCRATES_SUMMARY);
      const t = new DOMParser().parseFromString(html, 'text/html').body.textContent.replace(/\s+/g, ' ');
      const m = /Considering:\s*([\d,]+)\s*Primaries,\s*([\d,]+)\s*Secondaries\s*\(([\d,]+)\s*Conjunctions\)/i.exec(t);
      const w = /Start\s*=\s*(\d{4} \w{3} \d\d \d\d:\d\d:\d\d) UTC,\s*Stop\s*=\s*(\d{4} \w{3} \d\d \d\d:\d\d:\d\d) UTC/i.exec(t);
      const num = s => Number(String(s).replace(/,/g, ''));
      // When the run's data was taken, and when CelesTrak published it.
      const asOf = /Data current as of (\d{4} \w{3} \d\d \d\d:\d\d:\d\d) UTC/i.exec(t);
      const published = /Last updated:\s*(\d{4} \w{3} \d\d \d\d:\d\d:\d\d) UTC/i.exec(t);
      if (m) state.summary = { primaries: num(m[1]), secondaries: num(m[2]), conjunctions: num(m[3]),
        from: w ? Date.parse(w[1] + ' UTC') : null, to: w ? Date.parse(w[2] + ' UTC') : null,
        asOf: asOf ? Date.parse(asOf[1] + ' UTC') : null, published: published ? Date.parse(published[1] + ' UTC') : null };
    } catch { /* the list stands without its header */ }
  }

  /* ── Population ── */
  async function readBoxscore() {
    const html = await Net.text(BOXSCORE);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const row = [...doc.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()))
      .find(cells => cells[0] === 'All' && cells.length >= 11);
    if (!row) throw new Error('boxscore totals not found');
    const n = i => Number(row[i].replace(/,/g, ''));
    // Columns: payloads on orbit, decayed, total, active; debris on orbit, decayed, total; all on orbit, decayed, total.
    // The boxscore states the day its counts are for ("Current as of 2026 September 27").
    const asOf = /Current as of (\d{4} \w+ \d{1,2})/.exec(doc.body.textContent.replace(/\s+/g, ' '));
    state.box = { payloads: n(1), active: n(4), debris: n(5), all: n(8), at: Date.now(),
                  asOf: asOf ? Date.parse(asOf[1] + ' 00:00 UTC') || null : null };
  }

  /* ── Breakups (desktop app only) ── */
  async function readSatcat() {
    const text = await Net.text(SATCAT);
    const lines = text.split('\n');
    const head = (lines[0] || '').split(',');
    const col = name => head.indexOf(name);
    const iName = col('OBJECT_NAME'), iId = col('OBJECT_ID'), iCat = col('NORAD_CAT_ID'), iType = col('OBJECT_TYPE'),
      iLaunch = col('LAUNCH_DATE'), iDecay = col('DECAY_DATE');
    if ([iName, iId, iCat, iType, iLaunch, iDecay].some(i => i < 0)) throw new Error('unexpected SATCAT format');
    // The first reading has nothing to compare with, so it looks back over the
    // newest FIRST_LOOKBACK catalogue numbers — the last few weeks of
    // cataloguing — and says that is what it did.
    const rows = lines.slice(1).filter(Boolean).map(line => line.startsWith('"')
      ? [line.slice(1, line.indexOf('",')), ...line.slice(line.indexOf('",') + 2).split(',')] : line.split(','));
    let maxId = 0;
    for (const c of rows) { const cat = Number(c[iCat]); if (cat > maxId) maxId = cat; }
    if (!maxId) throw new Error('empty catalogue');
    const firstLook = !state.frag.maxId;
    const prevMax = state.frag.maxId || maxId - FIRST_LOOKBACK;
    const parents = new Map();             // launch designator → { name, launched }
    const fresh = new Map();               // launch designator → new debris pieces on orbit
    for (const c of rows) {
      const cat = Number(c[iCat]);
      const launch = String(c[iId]).slice(0, 8);
      if (c[iType] === 'PAY' || c[iType] === 'R/B') {
        const p = parents.get(launch);
        if (!p || c[iType] === 'PAY') parents.set(launch, { name: c[iName], launched: Date.parse(c[iLaunch]) });
      }
      if (cat > prevMax && c[iType] === 'DEB' && !c[iDecay]) fresh.set(launch, (fresh.get(launch) || 0) + 1);
    }
    for (const [launch, pieces] of fresh) {
      const parent = parents.get(launch) || { name: launch, launched: NaN };
      if (pieces < FRAG_PIECES || !(Date.now() - parent.launched > FRAG_PARENT_AGE)) continue;
      state.frag.events.unshift({ key: `${launch}:${Date.now()}`, launch, parent: parent.name,
        launched: parent.launched, pieces, detected: Date.now(), firstLook });
    }
    state.frag.events = state.frag.events.filter(e => Date.now() - e.detected < 365 * DAY).slice(0, 40);
    state.frag.maxId = maxId;
    if (!state.frag.since) state.frag.since = Date.now();
  }

  /* ── Scheduling: nothing is asked again before its interval, restarts included ── */
  const RETRY = 20 * 60000;                 // a refused read is tried again in twenty minutes, not six hours
  async function run(key, read) {
    let ok = false;
    try {
      await read();
      state.fresh[key] = Date.now(); state.status[key] = 'live'; state.note[key] = '';
      save();
      ok = true;
    } catch (e) {
      state.status[key] = state.fresh[key] ? 'stale' : 'unreachable';
      state.note[key] = String(e.message || e).slice(0, 70);
    }
    emit();
    return ok;
  }
  function plan(key, read, delay) {
    const age = state.fresh[key] ? Date.now() - state.fresh[key] : Infinity;
    if (age < EVERY[key]) state.status[key] = 'live';
    const first = age < EVERY[key] ? EVERY[key] - age : delay;
    const loop = async () => { const ok = await run(key, read); setTimeout(loop, (ok ? EVERY[key] : RETRY) + Math.random() * 60000); };
    setTimeout(loop, first + Math.random() * 3000);
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    plan('conj', readConjunctions, 8000);
    plan('box', readBoxscore, 14000);
    if (window.desktop && window.desktop.feedText) plan('satcat', readSatcat, 20000);
    else state.status.satcat = 'app only';
    emit();
  }

  /* ── For the alert log ── */
  /* An alert is raised only for something that has happened: a breakup —
     new debris catalogued between two readings of the catalogue, whether from
     a collision or an explosion. A predicted close pass is a probability, not
     an event; it stays on the Orbital page and is never alerted. A breakup
     found on the very first reading, with no earlier reading to compare, is
     listed on the page but not alerted either: when it happened is unknown. */
  function candidates() {
    const out = [];
    for (const f of state.frag.events.filter(e => !e.firstLook))
      out.push({ key: `kessler:frag:${f.key}`, rule: 'kessler', level: 'red',
        title: `Breakup · ${f.parent} launch (${f.launch}) · ${f.pieces} new debris pieces`,
        body: `Launch ${f.launch}${Number.isFinite(f.launched) ? ', ' + new Date(f.launched).getUTCFullYear() : ''}. Catalogued since the previous reading of the US Space Force catalogue (CelesTrak SATCAT).`,
        time: f.detected, link: `https://celestrak.org/satcat/records.php?INTDES=${f.launch}` });
    return out;
  }

  load();
  return { state, start, candidates, EVERY, onUpdate: fn => listeners.add(fn), CAN_MOVE, P_LISTED, FAST_KMS, P_ALERT, P_ALERT_STUCK, FRAG_PIECES };
})();
