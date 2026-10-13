'use strict';
/* ── Alerts ────────────────────────────────────────────────────────────────
   The instrument watches the streams it already reads and speaks up when one
   of them crosses a line. It fetches nothing of its own: every alert is an
   item already on one of the pages, with the rule that raised it.

   The rules, each stated here with its threshold and nothing hidden:

     SEVERE  An earthquake of magnitude 6.5 or more anywhere (USGS), with the
             tsunami flag noted when USGS sets it. A GDACS red alert of any
             kind; an orange one for a cyclone, flood, eruption or wildfire.
             Drought changes over months and is alerted at red only.
     NEAR    Anything within your radius (500 km unless you change it) of the
             place set in Settings: an earthquake of 4.5 or more, or any rated
             or listed disaster whose source gives a position. Needs latitude
             and longitude; without them the rule is off and says so.
     WAR     A curated or newsroom report of armed conflict whose words mark an
             escalation (ESCALATION below), or that counts 30 or more dead in
             one attack. GDELT's unconfirmed articles never raise an alert.
     SPACE   A geomagnetic storm of G3 or stronger (planetary K index 7 and
             above), or an X-class solar flare (NOAA SWPC). Ahead of time:
             a NOAA storm watch of G2 or more, a warning of Kp 6 or more
             expected, or a solar-wind shock at L1 with an impulse expected.
     AI      A report of an AI system escaping the control of the people
             running it — self-exfiltration, self-replication, escaping a
             sandbox, resisting shutdown — from the AI Incident Database or
             the newsroom feeds (see Wire.AI_ESCAPE).
     KESSLER A breakup in orbit: new debris catalogued since the previous
             reading (see kessler.js). Predicted passes are never alerted.
     ENERGY  New reports of power cuts, fuel shortages or rationing in your
             home country (Settings), at most one alert in six hours, red when
             the words are grave (nationwide, emergency, rationing, load
             shedding); and a rise in its level. Optionally, any country
             reaching crisis, once a day (see watch.js).

   An alert is raised once. What has been raised is remembered across
   restarts, and an event already older than its rule's window when it is
   first seen goes to the log without a sound: the log is a record, the sound
   is for what is happening now. On the very first run, what is already
   underway is logged quietly for the same reason.

   Delivery: a banner on the face until acknowledged, a tone, and the log —
   everywhere. In the desktop app also a Windows notification and, if a topic
   is set, a push to your phone through ntfy (ntfy.sh). Notifications and
   pushes are made once by the main process however many windows are open. */

const Alerts = (() => {
  const $ = id => document.getElementById(id);
  const HOUR = 3600000, DAY = 24 * HOUR;

  const SEVERE_QUAKE = 6.5, SEVERE_QUAKE_RED = 7.0;
  const NEAR_QUAKE = 4.5;
  const ORANGE_KINDS = new Set(['TC', 'FL', 'VO', 'WF']);
  const KP_STORM = 7;                         // G3 on NOAA's scale
  const WINDOW = { severe: 12 * HOUR, near: 12 * HOUR, war: 36 * HOUR, space: 6 * HOUR, ai: 7 * DAY, kessler: 7 * DAY, energy: 12 * HOUR };
  /* What counts as escalation, in words. An ongoing war's context — "the
     Russian invasion of Ukraine" in an item about talks — is not a new act,
     so invasion counts only as something begun or done. */
  const ESCALATION = /(declar\w* (?:a )?(?:state of )?war|declar\w* war on|(?:launch\w*|begin\w*|began|start\w*|order\w*) (?:an? |the )?(?:new |major |fresh |large[- ]scale )?(?:ground |full[- ]scale )?(?:invasion|offensive|war)|invade[sd]? |full[- ]scale (?:war|attack|offensive)|nuclear (?:strike|attack|test|warheads? (?:moved|deployed))|(?:fires?|fired|launch\w*|test\w*) (?:an? |a new )?(?:intercontinental |ballistic |hypersonic )+missiles?|general mobili[sz]ation|(?:declar\w*|impos\w*) martial law|ceasefire (?:collaps\w*|ends?|ended|broken|violated|breaks? down|fails?)|(?:breaks?|broke|violat\w*) (?:the |a )?ceasefire|troops (?:cross\w*|enter\w*) |opens? (?:a )?new front|chemical (?:weapons? (?:used|attack)|attack)|strikes? (?:on|hit\w*) (?:the )?capital|(?:hundreds|thousands) (?:of (?:people|civilians|soldiers) )?(?:were |are |have been )?killed)/i;
  // A single attack with this many dead is an escalation whatever the words.
  const MASS_CASUALTY = 30;
  function dead(text) {
    let most = 0;
    for (const m of String(text).matchAll(/(?:(?:at least|more than|over|nearly|some) )?(\d[\d,]*) (?:people |civilians |soldiers |persons )?(?:were |have been |are )?killed|kill(?:s|ed|ing)? (?:at least |more than |over |nearly )?(\d[\d,]*)/gi)) {
      const n = Number(String(m[1] || m[2]).replace(/,/g, ''));
      if (n > most && n < 1e6) most = n;
    }
    return most;
  }
  const escalates = text => ESCALATION.test(text) || dead(text) >= MASS_CASUALTY;

  const SETTINGS_KEY = 'temporal-live:alert-settings:v1';
  const LOG_KEY = 'temporal-live:alerts:v1';
  const DEFAULTS = { severe: true, near: true, war: true, space: true, ai: true, kessler: true, energy: true, energyWorld: false,
                     radiusKm: 500, sound: true, system: true, phoneTopic: '' };
  const RULE_LABEL = { severe: 'SEVERE', near: 'NEAR YOU', war: 'WAR', space: 'SPACE WEATHER', ai: 'AI CONTAINMENT', kessler: 'KESSLER', energy: 'ENERGY' };

  let settings = { ...DEFAULTS };
  let log = [];                  // newest first
  let seen = new Set();          // every key raised or logged, remembered
  let primed = false;            // whether a log existed before this run
  const startedAt = Date.now();

  function read() {
    try { settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; } catch { settings = { ...DEFAULTS }; }
    try {
      const d = JSON.parse(localStorage.getItem(LOG_KEY));
      if (d && Array.isArray(d.log)) { log = d.log; seen = new Set(d.seen || []); primed = true; }
      // Predicted close passes used to be alerted; they no longer are, and the
      // ones already logged are removed.
      log = log.filter(a => !String(a.key).startsWith('kessler:conj:'));
    } catch { /* start with an empty log */ }
  }
  function write() {
    // Another window of the same page (the website open in two tabs) may have
    // written since; its alerts are kept.
    try {
      const d = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
      if (d && Array.isArray(d.log)) {
        const have = new Set(log.map(a => a.key));
        for (const a of d.log) if (!have.has(a.key)) log.push(a);
        for (const k of d.seen || []) seen.add(k);
        log.sort((a, b) => b.fired - a.fired);
      }
    } catch { /* unreadable — ours stands */ }
    log = log.filter(a => Date.now() - a.fired < 30 * DAY && !String(a.key).startsWith('kessler:conj:')).slice(0, 300);
    const keep = [...seen].slice(-3000);
    seen = new Set(keep);
    try { localStorage.setItem(LOG_KEY, JSON.stringify({ log, seen: keep })); } catch { /* storage refused */ }
  }

  /* ── Place ── */
  function home() {
    const lat = Matrix.CAL360.latitude;
    let lon = null;
    try { lon = (JSON.parse(localStorage.getItem('matrix-settings')) || {}).longitude; } catch { /* none */ }
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  /* ── The rules ── */
  function candidates() {
    const out = [];
    const events = Feeds.state.events || [];
    const kindLabel = e => (Feeds.EVENT_KINDS[e.kind] || { label: e.kind }).label;

    if (settings.severe) for (const e of events) {
      if (e.kind === 'EQ' && e.value >= SEVERE_QUAKE) {
        out.push({ key: `severe:${e.id}`, rule: 'severe', level: e.value >= SEVERE_QUAKE_RED ? 'red' : 'orange',
          title: `M ${e.value.toFixed(1)} earthquake · ${e.place}`,
          body: `USGS · ${e.detail || ''}${e.tsunami ? ' · USGS tsunami flag set: tsunami information issued for this region' : ''}`,
          time: e.time, link: e.link || '' });
      } else if (e.kind !== 'EQ' && (e.level === 'red' || (e.level === 'orange' && ORANGE_KINDS.has(e.kind)))) {
        out.push({ key: `severe:${e.id}:${e.level}`, rule: 'severe', level: e.level,
          title: `${kindLabel(e)} · ${e.headline}${e.place && !String(e.headline).includes(e.place) ? ' · ' + e.place : ''}`,
          body: `GDACS ${e.level} alert — ${e.level === 'red' ? 'severe' : 'moderate'} expected impact on people${e.detail ? ' · ' + e.detail : ''}`,
          time: e.time, link: e.link || '' });
      }
    }

    const here = home();
    if (settings.near && here) for (const e of events) {
      if (!e.at) continue;
      if (e.kind === 'EQ' && e.value < NEAR_QUAKE) continue;
      const d = km(here, e.at);
      if (d > settings.radiusKm) continue;
      const what = e.kind === 'EQ' ? `M ${e.value.toFixed(1)} earthquake` : `${kindLabel(e)} · ${e.headline}`;
      out.push({ key: `near:${e.id}`, rule: 'near', level: (e.kind === 'EQ' ? e.value >= 6 : e.level === 'red') ? 'red' : 'orange',
        title: `${what} · ${Math.round(d)} km from you`,
        body: `${e.place || ''}${e.detail ? ' · ' + e.detail : ''}${e.level && e.kind !== 'EQ' && e.level !== 'none' ? ' · GDACS ' + e.level : ''}`,
        time: e.time, link: e.link || '' });
    }

    if (settings.war) for (const e of Wire.state.world || []) {
      if (e.topic !== 'CONFLICT' || !(e.tier === 'curated' || e.tier === 'reported')) continue;
      if (!escalates(e.headline)) continue;
      out.push({ key: `war:${e.id}`, rule: 'war', level: 'red', title: e.headline,
        body: `${e.place || ''} · ${e.tier === 'curated' ? 'curated (Wikipedia)' : 'reported'}`,
        time: e.dayOnly ? e.time + 12 * HOUR : e.time, link: e.link || '', readable: true });
    }

    if (settings.space) {
      const s = Feeds.state.space || {};
      if (Number.isFinite(s.kp) && s.kp >= KP_STORM) {
        const g = s.kp >= 9 ? 5 : s.kp >= 8 ? 4 : 3;
        out.push({ key: `space:G${g}:${new Date(s.kpTime).toISOString().slice(0, 10)}`, rule: 'space', level: g >= 4 ? 'red' : 'orange',
          title: `Geomagnetic storm G${g} · Kp ${s.kp.toFixed(2)}`,
          body: 'NOAA Space Weather Prediction Center · aurora at lower latitudes; power grids and satellites may be affected',
          time: s.kpTime, link: 'https://www.swpc.noaa.gov/' });
      }
      if (/^X/.test(s.xrayPeak || '') && s.xrayPeakTime) {
        out.push({ key: `space:flare:${s.xrayPeakTime}`, rule: 'space', level: 'red',
          title: `X-class solar flare · ${s.xrayPeak}`,
          body: 'NOAA SWPC (GOES) · radio blackouts on the sunlit side of Earth are likely',
          time: s.xrayPeakTime, link: 'https://www.swpc.noaa.gov/' });
      }
    }

    // NOAA's watches and warnings: hours to days before the storm (sun.js).
    if (settings.space && typeof Sun !== 'undefined') out.push(...Sun.alertCandidates());

    if (settings.ai) for (const e of Wire.state.incidents || []) {
      if (!e.escape) continue;
      out.push({ key: `ai:${e.id}`, rule: 'ai', level: 'red', title: e.headline,
        body: `${e.place || ''} · ${e.source === 'aiid' ? 'AI Incident Database' : 'newsroom report'}`,
        time: e.time, link: e.link || '', readable: true });
    }
    if (settings.kessler && typeof Kessler !== 'undefined') out.push(...Kessler.candidates());
    // The energy watch (watch.js): your country, and if chosen every country at crisis.
    if ((settings.energy || settings.energyWorld) && typeof Watch !== 'undefined') out.push(...Watch.alertCandidates({ home: !!settings.energy, world: !!settings.energyWorld }));
    return out.filter(a => Number.isFinite(a.time));
  }

  /* ── Checking ── */
  let unread = [];               // keys raised this run and not yet acknowledged
  function check() {
    const fresh = [];
    let added = 0;
    for (const a of candidates()) {
      if (seen.has(a.key)) continue;
      seen.add(a.key); added++;
      // The first time the app ever runs, the streams take a few minutes to
      // fill; what they bring in that time was already underway.
      const quiet = (!primed && Date.now() - startedAt < 5 * 60000) || Date.now() - a.time > WINDOW[a.rule];
      const entry = { ...a, fired: Date.now(), quiet };
      log.unshift(entry);
      if (!quiet) fresh.push(entry);
    }
    if (!added) return;
    write();
    if (fresh.length) deliver(fresh);
    paintBell();
    if (logOpen()) paintLog();
  }

  /* ── Delivery ── */
  let audio = null;
  function tone(level) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const notes = level === 'red' ? [880, 660, 880, 660] : [740, 554];
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.22;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.21);
      });
    } catch { /* no audio device */ }
  }
  async function deliver(fresh) {
    fresh.sort((a, b) => (b.level === 'red') - (a.level === 'red'));
    unread.unshift(...fresh.map(a => a.key));
    paintBanner();
    let playFor = null;
    for (const a of fresh) {
      let first = true;
      if (window.desktop && window.desktop.alert) {
        try {
          const r = await window.desktop.alert({ key: a.key, level: a.level, title: `${RULE_LABEL[a.rule]} · ${a.title}`,
            body: a.body, link: a.link, system: !!settings.system, topic: settings.phoneTopic || '' });
          first = !!(r && r.first);
        } catch { /* the main process will be asked again for the next one */ }
      } else if (settings.system && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(`${RULE_LABEL[a.rule]} · ${a.title}`, { body: a.body, tag: a.key }); } catch { /* refused */ }
      }
      if (first && !playFor) playFor = a;
    }
    // The music (spotify-sync.js) listens for this and ducks itself.
    if (playFor) window.dispatchEvent(new CustomEvent('matrix:alert-fired', { detail: { level: fresh.some(a => a.level === 'red') ? 'red' : playFor.level, title: playFor.title } }));
    if (settings.sound && playFor) tone(playFor.level);
  }

  /* ── Banner ── */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function ageOf(ms) {
    const d = Math.floor((Date.now() - ms) / 1000);
    if (d < 0) { const f = -d; return 'in ' + (f < 3600 ? Math.floor(f / 60) + 'm' : f < 86400 ? Math.floor(f / 3600) + 'h' : Math.floor(f / 86400) + 'd'); }
    const s = d;
    return s < 3600 ? Math.floor(s / 60) + 'm ago' : s < DAY / 1000 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago';
  }
  function paintBanner() {
    const el = $('alert-banner');
    if (!el) return;
    const items = unread.map(k => log.find(a => a.key === k)).filter(Boolean);
    if (!items.length) { el.hidden = true; return; }
    const a = items.find(x => x.level === 'red') || items[0];
    el.hidden = false;
    el.className = 'alert-banner lvl-' + a.level;
    el.innerHTML = `<span class="ab-rule">${esc(RULE_LABEL[a.rule])}</span>
      <button type="button" class="ab-title" data-open-log>${esc(a.title)}</button>
      <span class="ab-when">${ageOf(a.time)}</span>
      ${items.length > 1 ? `<span class="ab-more">+${items.length - 1} more</span>` : ''}
      <button type="button" class="ab-btn" data-open-log>LOG</button>
      <button type="button" class="ab-btn" data-ack aria-label="Acknowledge">✓</button>`;
  }
  function acknowledge() { unread = []; paintBanner(); paintBell(); }

  /* ── The log ── */
  const logOpen = () => !!($('alerts-log') && $('alerts-log').open);
  function paintBell() {
    const b = $('alerts-count');
    if (b) b.textContent = unread.length ? String(unread.length) : '';
    const bell = $('alerts-button');
    if (bell) bell.classList.toggle('ringing', unread.length > 0);
  }
  function matrixWhen(ms) {
    const t = Matrix.cal360(new Date(ms));
    const pad = n => String(n).padStart(2, '0');
    return `${Matrix.CAL360.days[t.weekday].name} ${t.day} ${Matrix.CAL360.months[t.month]} · ${pad(t.h)}:${pad(t.m)}`;
  }
  function paintLog() {
    const list = $('alerts-list');
    if (!list) return;
    const here = home();
    $('alerts-rules').textContent = [
      settings.severe && 'severe', settings.near && (here ? `near you (${settings.radiusKm} km)` : 'near you — off until latitude and longitude are set'),
      settings.war && 'war', settings.space && 'space weather', settings.ai && 'AI containment', settings.kessler && 'Kessler',
      settings.energy && 'energy in your country', settings.energyWorld && 'energy crises worldwide'
    ].filter(Boolean).join(' · ') || 'every rule is off';
    list.innerHTML = log.length ? log.map((a, i) => `
      <li class="lvl-${esc(a.level)}${a.quiet ? ' quiet' : ''}">
        <span class="al-rule">${esc(RULE_LABEL[a.rule])}</span>
        <div class="al-main"><strong>${esc(a.title)}</strong><span>${esc(a.body)}</span>
          <em>${esc(matrixWhen(a.time))} · ${ageOf(a.time)}${a.quiet ? ' · logged without sound (already underway when first seen)' : ''}</em></div>
        ${a.link ? `<button type="button" class="al-open" data-i="${i}">${a.readable && typeof Reader !== 'undefined' && Reader.available() ? 'Read' : 'Open ↗'}</button>` : ''}
      </li>`).join('') : '<li class="al-empty">No alerts yet. When a rule is crossed it appears here.</li>';
  }
  function openLog() { const d = $('alerts-log'); if (!d) return; acknowledge(); paintLog(); if (!d.open) d.showModal(); }

  /* ── Settings ── */
  function paintSettings() {
    const f = $('alert-settings');
    if (!f) return;
    for (const k of ['severe', 'near', 'war', 'space', 'ai', 'kessler', 'energy', 'energyWorld', 'sound', 'system'])
      { const c = f.querySelector(`[data-alert="${k}"]`); if (c) c.checked = !!settings[k]; }
    $('alert-radius').value = settings.radiusKm;
    $('alert-topic').value = settings.phoneTopic || '';
    const app = !!(window.desktop && window.desktop.alert);
    for (const n of f.querySelectorAll('.app-only')) n.hidden = !app;
    $('alert-near-note').textContent = home() ? '' : 'Set latitude and longitude above for this rule to work.';
  }
  function saveSettings() {
    const f = $('alert-settings');
    for (const k of ['severe', 'near', 'war', 'space', 'ai', 'kessler', 'energy', 'energyWorld', 'sound', 'system'])
      { const c = f.querySelector(`[data-alert="${k}"]`); if (c) settings[k] = c.checked; }
    const r = Number($('alert-radius').value);
    settings.radiusKm = Number.isFinite(r) && r >= 10 ? Math.min(r, 5000) : DEFAULTS.radiusKm;
    const topic = $('alert-topic').value.trim();
    settings.phoneTopic = /^[A-Za-z0-9_-]{8,64}$/.test(topic) ? topic : '';
    $('alert-topic-status').textContent = topic && !settings.phoneTopic ? 'A topic is 8–64 letters, digits, - or _.' : '';
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* refused */ }
    if (settings.system && !window.desktop && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    check();
  }

  function init() {
    read();
    paintSettings();
    const f = $('alert-settings');
    if (f) {
      f.addEventListener('change', saveSettings);
      $('alert-test').addEventListener('click', async () => {
        saveSettings();
        const status = $('alert-topic-status');
        if (!settings.phoneTopic) { status.textContent = 'Enter a topic first.'; return; }
        status.textContent = 'Sending…';
        const r = await window.desktop.alertTest(settings.phoneTopic);
        status.textContent = r && r.ok ? 'Sent. It should arrive on your phone within seconds.' : `Not sent: ${(r && r.error) || 'no answer'}.`;
      });
      $('alert-sound-test').addEventListener('click', () => tone('red'));
    }
    const banner = $('alert-banner');
    if (banner) banner.addEventListener('click', e => {
      if (e.target.closest('[data-ack]')) acknowledge();
      else if (e.target.closest('[data-open-log]')) openLog();
    });
    const bell = $('alerts-button');
    if (bell) bell.addEventListener('click', openLog);
    const dlg = $('alerts-log');
    if (dlg) {
      $('alerts-close').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', e => {
        const b = e.target.closest('.al-open');
        if (b) {
          const a = log[Number(b.dataset.i)];
          if (!a) return;
          if (a.readable && typeof Reader !== 'undefined' && Reader.available()) { dlg.close(); Reader.open({ headline: a.title, link: a.link, place: RULE_LABEL[a.rule], time: a.time }); }
          else window.open(a.link, '_blank', 'noopener');
          return;
        }
        if (e.target === dlg) dlg.close();
      });
    }
    if (window.desktop && window.desktop.onShowAlerts) window.desktop.onShowAlerts(openLog);
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea') || document.querySelector('dialog[open]')) return;
      if (e.key === 'a' || e.key === 'A') openLog();
    });
    Feeds.onUpdate(check);
    Wire.onUpdate(check);
    if (typeof Kessler !== 'undefined') Kessler.onUpdate(check);
    if (typeof Watch !== 'undefined') Watch.onUpdate(check);
    setInterval(paintBanner, 60000);
    paintBell();
  }

  return { init, check, openLog, get log() { return log; }, ESCALATION, escalates };
})();
