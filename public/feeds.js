'use strict';
/* ── The live field ────────────────────────────────────────────────────────
   The instrument reads the planet while the clock runs. Every stream here is
   an observation of informational organization already underway: energy
   released at a fault, a cyclone organizing over warm water, the field of the
   sun arriving at the magnetosphere, a body passing close. Nothing is
   simulated and nothing is invented. Each source states its own cadence; the
   scheduler honours it, backs off when a source fails, and marks a reading
   stale rather than silently showing an old number as current.

   Transport: inside the desktop app every request is made by the main process,
   so no origin restriction applies. In a browser the request is made directly,
   and the sources that do not publish cross-origin headers fall back to the
   ones that do. A stream never blocks another stream.                        */

const Feeds = (() => {

  const MINUTE = 60000, HOUR = 3600000;

  /* NASA's near-Earth service is the one source that wants a key. DEMO_KEY
     works without signing up but is rate-limited per visitor IP — 30 requests
     an hour, 50 a day. At this panel's three-hour cadence that is ample, and
     fine for a public page since each visitor spends their own allowance. A
     free key from api.nasa.gov lifts it to 1,000 an hour; drop it in here if
     the panel ever reports the approaches stream as unreachable. */
  const NASA_KEY = 'DEMO_KEY';

  /* ── Transport ────────────────────────────────────────────────────────
     Shared with vitals.js and wire.js; see net.js for how each host is
     reached and why. */
  const get = url => Net.json(url);

  /* ── Normalized event ───────────────────────────────────────────────────
     One shape for everything that happens on the surface of the planet, so
     the stream can be ordered by time without knowing what produced it.     */
  const EVENT_KINDS = {
    EQ: { label: 'SEISMIC',   glyph: '◈' },
    TC: { label: 'CYCLONE',   glyph: '◎' },
    FL: { label: 'FLOOD',     glyph: '≈' },
    VO: { label: 'VOLCANO',   glyph: '▲' },
    WF: { label: 'WILDFIRE',  glyph: '✶' },
    DR: { label: 'DROUGHT',   glyph: '◌' }
  };
  /* The colour of an event is GDACS's alert level — the United Nations and
     European Commission rating of its expected impact on people: green minor,
     orange moderate, red severe. It is a rating of consequence, not of size:
     a 17,000-hectare fire in empty bush is green, a small one at the edge of a
     city may not be. "none" is an event no one has rated (GDACS unreachable
     and the stand-in carrying no rating); it is shown uncoloured, not green. */
  const LEVELS = { none: -1, green: 0, orange: 1, red: 2 };

  const state = {
    events: [],            // merged, newest first
    seismic: { count24h: 0, largest: null },
    storms: [],            // active tropical cyclones only
    space: { kp: null, kpTime: null, kpSeries: [], wind: null, windTime: null, xray: null, xrayTime: null, xrayPeak: null, flux: null, fluxTime: null },
    orbital: { neo: null, approaches: [] },
    sources: {}            // per-source health
  };

  const listeners = new Set();
  /* Before every update, the cyclones are given their wind now (storms.js). */
  const emit = () => {
    if (typeof Storms !== 'undefined') {
      try { state.events = Storms.apply(state.events); } catch (error) { console.error(error); }
      state.storms = state.events.filter(e => e.kind === 'TC' && e.current !== false).sort((a, b) => (b.value || 0) - (a.value || 0));
    }
    for (const fn of listeners) { try { fn(state); } catch (error) { console.error(error); } } };
  const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  /* Merge a source's events into the stream, replacing that source's previous
     contribution. Identity is source + id, so a cyclone that advances keeps
     one row rather than accumulating one per advisory. */
  /* Where an event is, when the source says: [latitude, longitude] or null.
     Used only by the "near me" alert rule; nothing is placed where a source
     gave no position. */
  function pointOf(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let c = geometry.coordinates;
    while (Array.isArray(c[0])) c = c[0];                 // a polygon: its first vertex
    const [lon, lat] = c;
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  function merge(sourceKey, incoming) {
    const kept = state.events.filter(e => e.source !== sourceKey);
    const now = Date.now();
    // The cap is generous because the views filter this list rather than the
    // sources. Capping it tightly once meant the seismic view showed only the
    // earthquakes that had survived alongside the disasters, not all of them.
    // An ongoing eruption stays for as long as it is ongoing, however long ago
    // it began; everything else leaves after thirty days.
    const merged = kept.concat(incoming.filter(e => e.time && (e.ongoing || now - e.time < 30 * 24 * HOUR)))
      .sort((a, b) => b.time - a.time)
      // Two streams can carry the same GDACS event (its current list and a
      // search by type); one event is one row.
      .filter((seen => e => seen.has(e.id) ? false : seen.add(e.id))(new Set()))
      .slice(0, 300);
    const before = state.events.map(e => e.id).join('|');
    state.events = merged;
    return merged.map(e => e.id).join('|') !== before;
  }

  /* ── Seismic · United States Geological Survey ──────────────────────────
     Magnitude 2.5 and above, past day, published as GeoJSON and refreshed by
     USGS every minute. mag, place and depth come straight from the feed.    */
  async function readSeismic() {
    const data = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
    const features = (data.features || []).filter(f => f.properties && f.properties.time);
    const events = features.map(f => {
      const p = f.properties, depth = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[2] : null;
      return {
        id: 'usgs:' + f.id, source: 'seismic', kind: 'EQ',
        level: p.mag >= 6 ? 'red' : p.mag >= 5 ? 'orange' : 'green',
        value: p.mag, unit: 'M',
        headline: 'M ' + Number(p.mag).toFixed(1),
        place: p.place || 'Location under review',
        detail: depth === null ? '' : 'depth ' + Math.round(depth) + ' km',
        time: p.time, at: pointOf(f.geometry), link: p.url || '',
        // USGS sets this when the event falls in a region where tsunami
        // information is issued; it is a flag, not a warning in itself.
        tsunami: p.tsunami === 1,
        // For the map's description: how many people reported feeling it,
        // the strongest shaking estimated (Modified Mercalli), USGS's PAGER
        // alert, and whether a seismologist has reviewed the solution.
        depth, felt: p.felt || null, mmi: Number.isFinite(p.mmi) ? p.mmi : null,
        pager: p.alert || null, reviewed: p.status === 'reviewed'
      };
    });
    state.seismic.count24h = events.length;
    state.seismic.largest = events.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
    merge('seismic', events);
  }

  /* ── Disasters · GDACS ──────────────────────────────────────────────────
     The Global Disaster Alert and Coordination System, run jointly by the
     European Commission and the United Nations. It carries the alert level
     and the severity in physical units, which is what the panel shows.
     Seismic events are left to USGS so one earthquake is one row.           */
  async function readDisasters() {
    const data = await get('https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP');
    const features = (data.features || []).filter(f => f.properties && !['EQ', 'DR', 'VO'].includes(f.properties.eventtype));
    const events = features.map(f => {
      const p = f.properties, sev = p.severitydata || {};
      // For an event still running, GDACS's "to" date is where its model
      // ends — often tomorrow. The latest report cannot be later than now.
      const when = Math.min(Date.parse((p.todate || p.fromdate || '') + 'Z') || Date.parse(p.fromdate + 'Z') || Date.now(), Date.now());
      return {
        id: 'gdacs:' + p.eventtype + p.eventid, source: 'disasters', kind: p.eventtype,
        level: String(p.alertlevel || 'green').toLowerCase(),
        rating: `GDACS alert · ${{ red: 'severe', orange: 'moderate' }[String(p.alertlevel).toLowerCase()] || 'minor'} expected impact on people`,
        // A flood carries no physical severity in GDACS (it reports 0).
        value: p.eventtype === 'FL' && !sev.severity ? null : sev.severity, unit: sev.severityunit || '',
        headline: p.eventname || p.name || (EVENT_KINDS[p.eventtype] || {}).label || p.eventtype,
        place: p.country || p.name || '',
        detail: p.eventtype === 'FL' ? 'Flood · since ' + String(p.fromdate || '').slice(0, 10) : sev.severitytext || '',
        time: when, at: pointOf(f.geometry), link: (p.url && p.url.report) || '',
        current: String(p.iscurrent) === 'true'
      };
    });
    state.storms = events.filter(e => e.kind === 'TC' && e.current)
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    merge('disasters', events);
    return true;
  }

  /* ── Disasters · fallback ───────────────────────────────────────────────
     NASA's Earth Observatory Natural Event Tracker publishes cross-origin
     headers, so it reaches a plain browser where GDACS cannot. It carries no
     alert level, so every event reads green until a level is known.         */
  /* EONET's "severe storms" are the named tropical storms GDACS lists as
     cyclones, so they are filed as cyclones. Its "sea and lake ice" is
     icebergs, which are not disasters, and its volcanoes come in through the
     hazards stream below; both are left out here. */
  const EONET_KIND = { wildfires: 'WF', severeStorms: 'TC', floods: 'FL', drought: 'DR' };
  async function readDisastersFallback() {
    const data = await get('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60&days=20');
    const events = (data.events || []).map(e => {
      const category = (e.categories && e.categories[0]) || {};
      const kind = EONET_KIND[category.id];
      const last = e.geometry && e.geometry[e.geometry.length - 1];
      if (!kind || !last) return null;
      return {
        id: 'eonet:' + e.id, source: 'disasters', kind,
        level: 'none', rating: 'Not rated — GDACS was unreachable and NASA EONET gives no impact rating',
        value: last.magnitudeValue, unit: last.magnitudeUnit || '',
        headline: e.title,
        place: category.title || '',
        detail: last.magnitudeValue ? last.magnitudeValue + ' ' + (last.magnitudeUnit || '') : '',
        time: Date.parse(last.date), at: pointOf(last),
        current: true
      };
    }).filter(Boolean);
    state.storms = events.filter(e => e.kind === 'TC');
    merge('disasters', events);
  }

  /* ── Solar and geomagnetic · NOAA Space Weather Prediction Center ───────
     Four readings of one field: the planetary K index is the response of the
     magnetosphere, the solar wind speed is what arrives, the X-ray class is
     what the sun is doing now, and the 10.7 cm flux is the background state
     of the solar cycle. Each is published separately and read separately, so
     one failure does not blank the others.                                   */
  async function readSpace() {
    const results = await Promise.allSettled([
      get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
      get('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json'),
      get('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json'),
      get('https://services.swpc.noaa.gov/products/summary/10cm-flux.json')
    ]);
    const [kp, wind, xray, flux] = results;
    if (kp.status === 'fulfilled' && Array.isArray(kp.value) && kp.value.length) {
      const series = kp.value.map(row => ({ kp: Number(row.Kp ?? row[1]), time: Date.parse((row.time_tag || '') + 'Z') }))
        .filter(row => Number.isFinite(row.kp) && Number.isFinite(row.time));
      state.space.kpSeries = series.slice(-56);            // seven days at three-hour resolution
      const last = series[series.length - 1];
      if (last) { state.space.kp = last.kp; state.space.kpTime = last.time; }
    }
    if (wind.status === 'fulfilled' && wind.value && wind.value[0]) {
      state.space.wind = Number(wind.value[0].proton_speed);
      state.space.windTime = Date.parse(wind.value[0].time_tag);
    }
    if (xray.status === 'fulfilled' && xray.value && xray.value[0]) {
      const x = xray.value[0];
      state.space.xray = x.current_class;
      state.space.xrayPeak = x.max_class;
      state.space.xrayTime = Date.parse(x.time_tag);
      state.space.xrayPeakTime = Date.parse(x.max_time) || null;   // when the latest flare peaked
    }
    if (flux.status === 'fulfilled' && flux.value && flux.value[0]) { state.space.flux = Number(flux.value[0].flux); state.space.fluxTime = Date.parse(flux.value[0].time_tag + 'Z'); }
    if (results.every(r => r.status === 'rejected')) throw new Error('space weather unreachable');
  }

  /* ── Volcanoes and drought ─────────────────────────────────────────────
     GDACS's list of current events is capped at a hundred, and the hundred
     are mostly wildfires: droughts and eruptions, which change slowly, never
     reach it. So they are asked for by name, from the same service with the
     same rating, over the last sixty days:

       Drought — rated by the EU's Global Drought Observatory, reassessed
         every ten days. A drought is current while its assessment is less
         than thirty days old.
       Eruption — GDACS's volcano alerts, current for a week after the report.
       Flood — see below; the current list misses most of them too.

     And the Smithsonian's Global Volcanism Program, through NASA EONET, for
     the eruptions it counts as ongoing. GDACS has issued no impact alert for
     these — which in its scheme is green — and the page says that is why. A
     volcano already alerted by GDACS is not listed twice. */
  // ReliefWeb's disaster list, floods only (type 4611), newest first.
  const RELIEFWEB_FLOODS = 'https://reliefweb.int/disasters/rss.xml?advanced-search=%28TY4611%29';
  const RELIEFWEB_DAYS = 45;       // a listed flood older than this is no longer shown as current
  async function readHazards() {
    const day = x => new Date(x).toISOString().slice(0, 10);
    const search = type => get(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${type}`
      + `&fromDate=${day(Date.now() - 60 * 24 * HOUR)}&toDate=${day(Date.now())}&alertlevel=Green;Orange;Red`);
    const [dr, vo, fl, si, rw] = await Promise.allSettled([
      search('DR'), search('VO'), search('FL'),
      get('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=100'),
      Net.feed(RELIEFWEB_FLOODS)
    ]);
    if ([dr, vo, fl, si, rw].every(r => r.status === 'rejected')) throw dr.reason;
    const features = r => r.status === 'fulfilled' ? (r.value.features || []).filter(f => f && f.properties) : [];
    const gdacsTime = s => Math.min(Date.parse(String(s || '') + 'Z'), Date.now()) || NaN;
    const rated = level => `GDACS alert · ${level === 'red' ? 'severe' : level === 'orange' ? 'moderate' : 'minor'} expected impact on people`;
    const report = p => (p.url && p.url.report) || '';
    const events = [];

    for (const f of features(dr)) {
      const p = f.properties;
      const time = gdacsTime(p.todate) || gdacsTime(p.fromdate);
      const level = String(p.alertlevel || 'green').toLowerCase(), sev = p.severitydata || {};
      events.push({
        id: 'gdacs:DR' + p.eventid, source: 'hazards', kind: 'DR', level, rating: rated(level) + ' (Global Drought Observatory)',
        value: sev.severity, unit: sev.severityunit || '',
        headline: p.name || p.eventname || 'Drought', place: p.country || '',
        detail: sev.severitytext || '', time, at: pointOf(f.geometry), link: report(p),
        current: Date.now() - time < 30 * 24 * HOUR
      });
    }

    /* Floods. GDACS's current list carries only the floods still being
       modelled that day; the search returns every flood it rated in sixty
       days, with the same level. A flood is current while GDACS still reports
       it or for ten days after its last report. */
    const flooded = new Set();
    for (const f of features(fl)) {
      const p = f.properties;
      const time = gdacsTime(p.todate) || gdacsTime(p.fromdate);
      const level = String(p.alertlevel || 'green').toLowerCase();
      const current = String(p.iscurrent) === 'true' || Date.now() - time < 10 * 24 * HOUR;
      if (!current) continue;
      for (const c of String(p.country || '').split(/,\s*/)) if (c) flooded.add(c.toLowerCase());
      events.push({
        id: 'gdacs:FL' + p.eventid, source: 'hazards', kind: 'FL', level, rating: rated(level),
        value: null, unit: '', headline: p.name || p.eventname || 'Flood', place: p.country || '',
        detail: 'Flood · since ' + day(gdacsTime(p.fromdate)), time, at: pointOf(f.geometry), link: report(p),
        current
      });
    }
    for (const e of state.events) if (e.kind === 'FL' && e.source === 'disasters')
      for (const c of String(e.place || '').split(/,\s*/)) if (c) flooded.add(c.toLowerCase());

    /* ReliefWeb (UN OCHA) lists a flood as a disaster when people need help —
       the humanitarian record, written from the ground, with the number of
       people affected. Where GDACS already rates a flood in the same country
       the rated row stands and this one is not repeated. Where it does not,
       the flood is shown unrated: ReliefWeb says people are affected, but it
       gives no green, orange or red, and none is invented for it. */
    if (rw.status === 'fulfilled') for (const item of rw.value) {
      if (!item.time || Date.now() - item.time > RELIEFWEB_DAYS * 24 * HOUR) continue;
      const html = item.summary || '';
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
      const country = ((/Affected countr(?:y|ies):\s*([^<\n]+)/i.exec(doc.textContent) || [])[1] || String(item.title).split(':')[0]).trim();
      if (country.split(/,\s*/).some(c => flooded.has(c.toLowerCase()))) continue;
      const para = doc.querySelector('p');
      const summary = (para ? para.textContent : '').replace(/\s*\[\.\.\.\]\s*/g, ' ').replace(/\s*\([^)]*\d{4}\)\s*$/, '').replace(/\s+/g, ' ').trim();
      events.push({
        id: 'reliefweb:' + (item.link || item.title), source: 'hazards', kind: 'FL', level: 'none',
        rating: 'ReliefWeb (UN OCHA) lists it as a humanitarian disaster — people are affected. It gives no alert level, and GDACS has not rated it.',
        value: null, unit: '', headline: String(item.title).replace(/\s*-\s*\w{3} \d{4}$/, ''), place: country,
        detail: summary.slice(0, 260), time: item.time, at: null, link: item.link, readable: true,
        current: true, ongoing: true
      });
    }

    const alerted = [];
    for (const f of features(vo)) {
      const p = f.properties;
      const time = gdacsTime(p.todate) || gdacsTime(p.fromdate);
      const level = String(p.alertlevel || 'green').toLowerCase();
      const name = String(p.name || p.eventname || '').replace(/^eruption\s+/i, '').trim();
      alerted.push(name.toLowerCase());
      events.push({
        id: 'gdacs:VO' + p.eventid, source: 'hazards', kind: 'VO', level, rating: rated(level),
        value: null, unit: '', headline: name || 'Eruption', place: p.country || '',
        detail: 'Eruption reported', time, at: pointOf(f.geometry), link: report(p),
        current: String(p.iscurrent) === 'true' || Date.now() - time < 7 * 24 * HOUR
      });
    }

    if (si.status === 'fulfilled') for (const e of si.value.events || []) {
      const first = e.geometry && e.geometry[0];
      if (!first) continue;
      const [volcano, ...rest] = String(e.title || '').split(',');
      const name = volcano.replace(/\s+volcano$/i, '').trim();
      if (alerted.some(a => a && (a.includes(name.toLowerCase()) || name.toLowerCase().includes(a)))) continue;
      events.push({
        id: 'eonet:' + e.id, source: 'hazards', kind: 'VO', level: 'green',
        rating: 'No GDACS impact alert — green in its scheme; the Smithsonian lists it as erupting',
        value: null, unit: '', headline: name, place: rest.join(',').trim(),
        detail: 'Ongoing eruption · Smithsonian Global Volcanism Program', time: Date.parse(first.date),
        at: pointOf(first), current: true, ongoing: true
      });
    }
    merge('hazards', events);
    return true;
  }

  /* ── Orbital · near-Earth approaches ────────────────────────────────────
     The next bodies to pass close, from NASA's near-Earth object service.
     Distances are given in lunar distances, which is the scale at which the
     number means something. Polled slowly; the data changes daily.          */
  async function readApproaches() {
    const d = await get('https://api.nasa.gov/neo/rest/v1/feed?api_key=' + NASA_KEY);
    const all = [];
    for (const day of Object.keys(d.near_earth_objects || {}))
      for (const o of d.near_earth_objects[day]) {
        const approach = (o.close_approach_data || [])[0];
        if (!approach) continue;
        all.push({
          name: o.name.replace(/[()]/g, ''),
          ld: Number(approach.miss_distance.lunar),
          kps: Number(approach.relative_velocity.kilometers_per_second),
          diameter: o.estimated_diameter.meters.estimated_diameter_max,
          hazardous: o.is_potentially_hazardous_asteroid,
          time: approach.epoch_date_close_approach
        });
      }
    /* The weekly feed lists everything, most of it far away. What the panel
       wants is the next body that actually comes close: the soonest approach
       inside twenty lunar distances, and if the week holds none, the nearest
       one it does hold. */
    const upcoming = all.filter(a => a.time > Date.now()).sort((a, b) => a.time - b.time);
    const close = upcoming.filter(a => a.ld <= 20);
    state.orbital.approaches = upcoming;
    state.orbital.neo = close[0] || upcoming.slice().sort((a, b) => a.ld - b.ld)[0] || null;
    state.orbital.neoCount = upcoming.length;
  }

  /* ── The scheduler ──────────────────────────────────────────────────────
     Each stream states its own period. A failure doubles the wait, up to a
     ceiling, and the panel marks the reading stale; a success restores the
     stated period. Nothing polls faster than the source republishes.        */
  const STREAMS = [
    { key: 'seismic',   label: 'SEISMIC',      every: MINUTE,      read: readSeismic },
    { key: 'disasters', label: 'DISASTERS',    every: 5 * MINUTE,  read: readDisasters, fallback: readDisastersFallback },
    { key: 'hazards',   label: 'FLOODS · VOLCANOES · DROUGHT', every: HOUR, read: readHazards },
    { key: 'space',     label: 'SOLAR FIELD',  every: 2 * MINUTE,  read: readSpace },
    { key: 'approach',  label: 'APPROACHES',   every: 3 * HOUR,    read: readApproaches },
    // The wind each cyclone has now, from the agencies that warn on it.
    ...(typeof Storms !== 'undefined' ? [{ key: 'storms', label: 'CYCLONES NOW', every: 10 * MINUTE, read: () => Storms.read() }] : [])
  ];

  for (const s of STREAMS) state.sources[s.key] = { label: s.label, status: 'waiting', at: null, failures: 0, note: '' };

  async function runStream(stream) {
    if (typeof Net !== 'undefined' && Net.paused) return;
    const health = state.sources[stream.key];
    health.status = health.at ? health.status : 'opening';
    try {
      await stream.read();
      health.status = 'live'; health.at = Date.now(); health.failures = 0; health.note = '';
    } catch (error) {
      if (typeof Net !== 'undefined' && (Net.paused || (error && error.message === Net.PAUSED_ERR))) return;
      if (stream.fallback && !health.usingFallback) {
        try {
          await stream.fallback();
          health.usingFallback = true;
          health.status = 'live'; health.at = Date.now(); health.failures = 0;
          health.note = 'secondary source';
          emit();
          return;
        } catch (fallbackError) { /* fall through to the failure path */ }
      } else if (health.usingFallback && stream.fallback) {
        try {
          await stream.fallback();
          health.status = 'live'; health.at = Date.now(); health.failures = 0; health.note = 'secondary source';
          emit();
          return;
        } catch (fallbackError) { /* fall through */ }
      }
      health.failures += 1;
      health.status = health.at ? 'stale' : 'unreachable';
      health.note = String(error.message || error).slice(0, 60);
    }
    emit();
  }

  function schedule(stream) {
    const health = state.sources[stream.key];
    const wait = health.failures ? Math.min(stream.every * Math.pow(2, health.failures), 20 * MINUTE)
                                 : stream.every;
    setTimeout(async () => { await runStream(stream); schedule(stream); }, wait + Math.random() * 1500);
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    STREAMS.forEach((stream, i) => {
      setTimeout(async () => { await runStream(stream); schedule(stream); }, i * 400);
    });
    // The browser suspends timers on a hidden tab. Read again on return so the
    // panel is never showing a reading from before the tab was hidden.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      for (const stream of STREAMS) {
        const health = state.sources[stream.key];
        if (!health.at || Date.now() - health.at > stream.every) runStream(stream);
      }
    });
  }

  return { state, start, onUpdate, EVENT_KINDS, LEVELS };
})();
