'use strict';
/* ── The globe ─────────────────────────────────────────────────────────────
   Where things are, on a sphere. Every event the streams hold that comes with
   a position — cyclones, earthquakes of magnitude 4.5 and above, eruptions,
   floods, wildfires, droughts — drawn on an orthographic globe, coloured by
   the same GDACS level as everywhere else. Nothing is placed where a source
   gave no position.

   Cyclones carry their GDACS story: the observed track (solid) and the
   forecast (dashed), each segment coloured by the storm's class over it, the
   forecast cone, and the areas swept by winds of 60, 90 and 120 km/h. Night
   and the three twilights are shaded where the Sun is below the horizon.

   Two views share one renderer: the large globe on its own page, with the
   list, the story of each event and the webcams near it; and a smaller one
   on the Overview. Land and borders are Natural Earth (lib/atlas.js),
   projected with d3-geo; nothing is fetched to draw the Earth itself.

   Drag to turn the globe, wheel or pinch to zoom, double-click to zoom in on
   a point, click a mark for its story or anywhere else for webcams there.
   Keys on the globe page: + and − zoom, arrows turn, 0 is the whole Earth,
   [ and ] step through the events, / is search, Escape clears.            */

/* ── The renderer ────────────────────────────────────────────────────────── */
const GlobeKit = (() => {
  const DAY = 86400000;
  let atlas = null;
  function data() {
    if (atlas) return atlas;
    const A = WorldAtlas;
    atlas = {
      land50: topojson.feature(A.land50, A.land50.objects.land),
      land110: topojson.feature(A.land110, A.land110.objects.land),
      borders: topojson.mesh(A.countries50, A.countries50.objects.countries, (a, b) => a !== b),
      countries: topojson.feature(A.countries50, A.countries50.objects.countries).features
    };
    return atlas;
  }
  const graticule = d3.geoGraticule10();
  const equator = { type: 'LineString', coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] };

  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function palette() {
    const p = {};
    for (const k of ['ocean', 'land', 'border', 'grid', 'equator', 'limb', 'night', 'halo', 'text', 'textstroke', 'none', 'sun', 'pin', 'home'])
      p[k] = cssVar('--g-' + k);
    p.green = cssVar('--ok'); p.orange = cssVar('--warn'); p.red = cssVar('--crit'); p.accent = cssVar('--accent'); p.amber = cssVar('--warn');
    p.TD = cssVar('--trk-td'); p.TS = cssVar('--trk-ts'); p.HU = cssVar('--trk-hu');
    return p;
  }

  /* The Sun's position (NOAA's approximation, good to a fraction of a degree). */
  function subsolar(ms) {
    const d = new Date(ms), start = Date.UTC(d.getUTCFullYear(), 0, 1);
    const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const g = 2 * Math.PI / 365 * (Math.floor((ms - start) / DAY) + (hours - 12) / 24);
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    let lon = -(hours * 60 + eot - 720) / 4;
    while (lon > 180) lon -= 360; while (lon < -180) lon += 360;
    return { lat: decl * 180 / Math.PI, lon };
  }

  /* GDACS polygons come in either winding; d3 reads the winding as which side
     is inside, so one drawn the wrong way round would cover the whole Earth
     but the storm. Anything larger than a hemisphere is turned round. */
  function fixWinding(g) {
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return g;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const fixed = polys.map(rings => d3.geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map(r => r.slice().reverse()) : rings);
    return g.type === 'Polygon' ? { type: 'Polygon', coordinates: fixed[0] } : { type: 'MultiPolygon', coordinates: fixed };
  }

  function View(host, opts = {}) {
    const base = document.createElement('canvas'), over = document.createElement('canvas');
    base.className = 'globe-base'; over.className = 'globe-over';
    host.append(base, over);
    const proj = d3.geoOrthographic().clipAngle(90).precision(0.35);
    const bctx = base.getContext('2d'), octx = over.getContext('2d');
    const self = {
      host, rot: [-(opts.lon || 0), -(opts.lat || 15), 0], k: 1, w: 0, h: 0, R0: 100,
      marks: [], storms: [], fills: [], night: true, home: null, pin: null, selected: null, hot: null,
      labels: opts.labels !== false, palette: palette(), onView: opts.onView || null
    };
    let fastTimer = 0, anim = 0, loop = 0;

    function setProjection() {
      proj.scale(self.R0 * self.k).translate([self.w / 2, self.h / 2]).rotate(self.rot);
    }
    function resize() {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      self.w = Math.max(10, r.width); self.h = Math.max(10, r.height);
      for (const c of [base, over]) {
        c.width = Math.round(self.w * dpr); c.height = Math.round(self.h * dpr);
        c.style.width = self.w + 'px'; c.style.height = self.h + 'px';
      }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      self.R0 = Math.max(40, Math.min(self.w, self.h) / 2 - (opts.margin ?? 18));
      draw(false);
    }
    const center = () => [-self.rot[0], -self.rot[1]];
    const visibleAt = ll => d3.geoDistance(ll, center()) < Math.PI / 2 - 0.004;

    /* The Earth: ocean, graticule, land, borders, night, storms, limb. */
    function drawBase(fast) {
      const P = self.palette, A = data(), ctx = bctx;
      setProjection();
      const path = d3.geoPath(proj, ctx);
      ctx.clearRect(0, 0, self.w, self.h);
      const R = self.R0 * self.k, cx = self.w / 2, cy = self.h / 2;
      // A faint halo outside the limb.
      if (P.halo) {
        const g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.09);
        g.addColorStop(0, P.halo); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.09, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = P.ocean; ctx.fill();
      ctx.beginPath(); path(graticule); ctx.strokeStyle = P.grid; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.beginPath(); path(equator); ctx.strokeStyle = P.equator; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.beginPath(); path(fast ? A.land110 : A.land50); ctx.fillStyle = P.land; ctx.fill();
      // Countries shaded by a status (the energy watch), under the borders.
      for (const f of self.fills || []) {
        if (f.hatch) continue;
        ctx.beginPath(); path(f.g); ctx.globalAlpha = f.level === 'red' ? 0.45 : f.level === 'orange' ? 0.3 : 0.1;
        ctx.fillStyle = P[f.level] || P.orange; ctx.fill(); ctx.globalAlpha = 1;
      }
      // Countries at war (war.js): hatched, so they read apart from the energy shading.
      for (const f of self.fills || []) {
        if (!f.hatch) continue;
        const b = path.bounds(f.g);
        if (!Number.isFinite(b[0][0]) || b[1][0] - b[0][0] < 1) continue;
        ctx.save(); ctx.beginPath(); path(f.g); ctx.clip();
        ctx.globalAlpha = f.alpha || (f.level === 'red' ? 0.85 : f.level === 'orange' ? 0.7 : 0.5);
        ctx.strokeStyle = P[f.level] || P.red; ctx.lineWidth = f.level === 'red' ? 1.6 : 1.2;
        const step = 6, x0 = b[0][0], y0 = b[0][1], w = b[1][0] - x0, h = b[1][1] - y0;
        ctx.beginPath();
        for (let x = x0 - h; x < x0 + w; x += step) { ctx.moveTo(x, y0 + h); ctx.lineTo(x + h, y0); }
        ctx.stroke();
        ctx.restore(); ctx.globalAlpha = 1;
      }
      if (!fast || self.k > 3) { ctx.beginPath(); path(A.borders); ctx.strokeStyle = P.border; ctx.lineWidth = 0.6; ctx.stroke(); }
      if (self.night) {
        const sun = subsolar(Date.now()), anti = [sun.lon + 180 > 180 ? sun.lon - 180 : sun.lon + 180, -sun.lat];
        ctx.fillStyle = P.night;
        for (const r of [90, 84, 78, 72]) { ctx.beginPath(); path(d3.geoCircle().center(anti).radius(r).precision(2)()); ctx.fill(); }
      }
      // Storms: wind areas and cone first, then the tracks over them.
      for (const s of self.storms) {
        for (const w of s.swaths) {
          ctx.beginPath(); path(w.g);
          ctx.globalAlpha = w.level === 'red' ? 0.28 : w.level === 'orange' ? 0.22 : 0.16;
          ctx.fillStyle = P[w.level] || P.green; ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (s.cone) {
          ctx.beginPath(); path(s.cone); ctx.globalAlpha = 0.1; ctx.fillStyle = P.text; ctx.fill();
          ctx.globalAlpha = 0.45; ctx.strokeStyle = P.text; ctx.lineWidth = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
        }
        for (const sg of s.segments) {
          ctx.beginPath(); path({ type: 'LineString', coordinates: sg.coords });
          ctx.strokeStyle = P[sg.cls] || P.text; ctx.lineWidth = sg.forecast ? 1.6 : 2.6;
          ctx.setLineDash(sg.forecast ? [5, 4] : []); ctx.lineCap = 'round'; ctx.stroke();
        }
        ctx.setLineDash([]);
        const now = Date.now();
        for (const p of s.points) {
          const ll = [p.at[1], p.at[0]];
          if (!visibleAt(ll)) continue;
          const [x, y] = proj(ll);
          ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = p.t > now ? P.ocean : P.text; ctx.fill();
          ctx.strokeStyle = p.t > now ? P.text : P.ocean; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = P.limb; ctx.lineWidth = 1; ctx.stroke();
    }

    /* Marks, labels, rings and the Sun, in screen pixels. */
    let screen = [];
    function drawOver(t) {
      const P = self.palette, ctx = octx;
      ctx.clearRect(0, 0, self.w, self.h);
      setProjection();
      screen = [];
      let pulsing = false;
      const placedLabels = [];
      // The Sun, where it is overhead.
      if (self.night) {
        const s = subsolar(Date.now()), ll = [s.lon, s.lat];
        if (visibleAt(ll)) {
          const [x, y] = proj(ll);
          ctx.strokeStyle = P.sun; ctx.fillStyle = P.sun; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
          for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 6.5, y + Math.sin(a) * 6.5); ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); ctx.stroke(); }
          screen.push({ x, y, r: 9, tip: `The Sun is overhead here · ${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°` });
        }
      }
      for (const m of self.marks) {
        const ll = [m.lon, m.lat];
        if (!visibleAt(ll)) continue;
        const [x, y] = proj(ll);
        const colour = m.colour ? (P[m.colour] || m.colour) : (P[m.level] || P.green);
        const r = m.size;
        if ((m.pulse ?? m.level === 'red') && !reduced()) {
          pulsing = true;
          const ph = ((t || performance.now()) % 2400) / 2400;
          ctx.beginPath(); ctx.arc(x, y, r + 3 + ph * 14, 0, Math.PI * 2);
          ctx.strokeStyle = colour; ctx.globalAlpha = 0.85 * (1 - ph); ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
        } else if (m.level === 'orange' && !m.shape) {
          ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.strokeStyle = colour; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
        }
        if (m.shape === 'square' || m.shape === 'diamond') {
          // Infrastructure: refineries are squares, AI data centres diamonds.
          ctx.beginPath();
          if (m.shape === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
          else { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); }
          if (m.hollow) { ctx.strokeStyle = colour; ctx.lineWidth = 1.3; ctx.stroke(); }
          else {
            ctx.globalAlpha = m.fade || 1; ctx.fillStyle = colour; ctx.fill(); ctx.globalAlpha = 1;
            ctx.lineWidth = 1; ctx.strokeStyle = P.textstroke; ctx.stroke();
          }
          if (m.cross) {
            ctx.beginPath(); ctx.moveTo(x - r * 0.6, y - r * 0.6); ctx.lineTo(x + r * 0.6, y + r * 0.6); ctx.moveTo(x + r * 0.6, y - r * 0.6); ctx.lineTo(x - r * 0.6, y + r * 0.6);
            ctx.strokeStyle = P.textstroke; ctx.lineWidth = 1.4; ctx.stroke();
          }
        } else if (m.kind === 'EQ') {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.globalAlpha = m.fade || 1; ctx.fillStyle = colour; ctx.fill(); ctx.globalAlpha = 1;
          ctx.lineWidth = 1; ctx.strokeStyle = P.textstroke; ctx.stroke();
        } else {
          ctx.font = `${Math.round(r * 2)}px "IBM Plex Sans", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 2; ctx.strokeStyle = P.textstroke; ctx.strokeText(m.glyph, x, y);
          ctx.fillStyle = colour; ctx.fillText(m.glyph, x, y);
        }
        if (m.id === self.selected || m.id === self.hot) {
          ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2);
          ctx.setLineDash(m.id === self.selected ? [] : [3, 2]);
          ctx.strokeStyle = P.pin; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
        screen.push({ x, y, r: Math.max(8, r + 4), id: m.id });
        // Labels: storms, red events and the selection; never on top of another.
        if (self.labels && (m.labelled || m.id === self.selected || m.id === self.hot)) {
          ctx.font = '500 11px "IBM Plex Mono", monospace';
          const text = m.label, w = ctx.measureText(text).width;
          const flip = x + r + 6 + w > self.w - 8;
          const lx = flip ? x - r - 6 - w : x + r + 6, ly = y - r - 3;
          const box = { x: lx - 2, y: ly - 11, w: w + 4, h: 14 };
          if (m.id === self.selected || !placedLabels.some(o => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) {
            placedLabels.push(box);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.lineWidth = 3; ctx.strokeStyle = P.textstroke; ctx.strokeText(text, lx, ly);
            ctx.fillStyle = P.text; ctx.fillText(text, lx, ly);
          }
        }
      }
      for (const [spot, kind] of [[self.home, 'home'], [self.pin, 'pin']]) {
        if (!spot) continue;
        const ll = [spot[1], spot[0]];
        if (!visibleAt(ll)) continue;
        const [x, y] = proj(ll);
        ctx.strokeStyle = P[kind]; ctx.fillStyle = P[kind]; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
        if (kind === 'home') { ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 10); ctx.stroke(); }
        screen.push({ x, y, r: 8, tip: kind === 'home' ? 'Your location (Settings)' : `${Math.abs(spot[0]).toFixed(2)}° ${spot[0] < 0 ? 'S' : 'N'}, ${Math.abs(spot[1]).toFixed(2)}° ${spot[1] < 0 ? 'W' : 'E'}` });
      }
      // Red marks pulse; the overlay keeps drawing only while one is in view.
      if (pulsing && !loop) loop = requestAnimationFrame(function frame(ts) { loop = 0; if (document.hidden || !host.offsetParent) return; drawOver(ts); });
    }
    const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    function draw(fast) {
      if (!self.w) return;
      drawBase(fast);
      drawOver();
      if (fast) { clearTimeout(fastTimer); fastTimer = setTimeout(() => drawBase(false), 160); }
      if (self.onView) self.onView();
    }

    function pick(x, y) {
      let best = null, bd = Infinity;
      for (const s of screen) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d <= s.r && d < bd) { best = s; bd = d; }
      }
      return best;
    }
    function invert(x, y) {
      const R = self.R0 * self.k;
      if (Math.hypot(x - self.w / 2, y - self.h / 2) > R) return null;
      const ll = proj.invert([x, y]);
      return ll && Number.isFinite(ll[0]) ? [ll[1], ll[0]] : null;      // [lat, lon]
    }
    function rotateBy(dx, dy) {
      const deg = 180 / (Math.PI * self.R0 * self.k);
      self.rot[0] += dx * deg;
      self.rot[1] = Math.max(-89, Math.min(89, self.rot[1] - dy * deg));
      draw(true);
    }
    function zoomTo(k) { self.k = Math.max(0.85, Math.min(60, k)); draw(true); }
    // Turn and zoom to a point, along the great circle.
    function flyTo(lat, lon, k, ms = 750) {
      cancelAnimationFrame(anim);
      const from = center(), to = [lon, lat], k0 = self.k, k1 = k == null ? self.k : Math.max(0.85, Math.min(60, k));
      const interp = d3.geoInterpolate(from, to), t0 = performance.now();
      if (reduced()) { self.rot = [-lon, -lat, 0]; self.k = k1; draw(false); return; }
      const step = now => {
        const u = Math.min(1, (now - t0) / ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const c = interp(e);
        self.rot = [-c[0], -c[1], 0];
        self.k = k0 * Math.pow(k1 / k0, e);
        if (u < 1) { draw(true); anim = requestAnimationFrame(step); } else draw(false);
      };
      anim = requestAnimationFrame(step);
    }
    function stop() { cancelAnimationFrame(anim); }
    function setTheme() { self.palette = palette(); draw(false); }
    function countryAt(lat, lon) {
      const f = countryFeatureAt(lat, lon);
      return f ? f.properties.name : '';
    }
    return Object.assign(self, { resize, draw, drawOver, pick, invert, rotateBy, zoomTo, flyTo, stop, setTheme, center, countryAt, canvas: over, proj });
  }

  // Clicking a point on the globe asks for its country name (globe.js), its
  // energy level (watch.js), and its conflict status (war.js) at the exact
  // same coordinates. Memoizing the last lookup avoids scanning 241 polygons
  // three times per click.
  let lastLookup = { key: '', feature: null };
  function countryFeatureAt(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (lastLookup.key === key) return lastLookup.feature;
    const feature = data().countries.find(c => d3.geoContains(c, [lon, lat])) || null;
    lastLookup = { key, feature };
    return feature;
  }

  return { View, data, countryFeatureAt, subsolar, fixWinding, palette };
})();

/* ── The globe page and the Overview globe ─────────────────────────────────
   Kept under the name the rest of the app already calls (DisasterMap):
   open(id) shows the globe page with that event selected, isOpen() says
   whether it is the page on screen. */
const DisasterMap = (() => {
  const $ = id => document.getElementById(id);
  const hasStorms = () => typeof Storms !== 'undefined';
  // A cyclone's label: the wind now (or its peak, marked as such).
  const tcLabel = (e, sep) => { const t = hasStorms() ? Storms.short(e) : Number.isFinite(e.value) ? `${Math.round(e.value)} km/h` : ''; return t ? sep + t : ''; };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const MIN_QUAKE = 4.5;
  const KINDS = ['TC', 'EQ', 'VO', 'FL', 'WF', 'DR'];
  const KEY_STORE = 'temporal-live:windy-key';
  const WEBCAM_RADIUS_KM = 250;
  const RANK = { red: 3, orange: 2, green: 1, none: 0 };

  const shown = new Set(KINDS);
  // Infrastructure layers (energy.js): refineries in the incident register,
  // every refinery, and the AI data centres.
  const INFRA = [['WAR', '▨', 'AT WAR'], ['NRG', '▦', 'ENERGY CRISIS'], ['HIT', '▪', 'REFINERIES HIT'], ['REF', '▫', 'ALL REFINERIES'], ['DC', '◆', 'AI DATA CENTRES']];
  const infraShown = new Set(['WAR', 'NRG', 'HIT', 'DC']);
  const energyFills = () => (infraShown.has('NRG') && typeof Watch !== 'undefined' ? Watch.fills() : [])
    .concat(infraShown.has('WAR') && typeof War !== 'undefined' ? War.fills() : []);
  let night = true;
  let selected = null;                      // an event id, or a free point {lat, lon}
  let query = '';
  let page = null, mini = null;             // the two renderers
  const tracks = new Map();

  const pad = n => String(n).padStart(2, '0');
  const ago = ms => {
    const s = (Date.now() - ms) / 1000;
    if (s < 0) { const f = -s; return f < 3600 ? `in ${Math.round(f / 60)}m` : f < 172800 ? `in ${Math.round(f / 3600)}h` : `in ${Math.round(f / 86400)}d`; }
    return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
  };
  const when = e => Date.now() - e.time > 45 * DAY
    ? 'since ' + new Date(e.time).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : ago(e.time);
  const latLon = ([lat, lon]) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
  const levelVar = l => l === 'red' ? 'var(--crit)' : l === 'orange' ? 'var(--warn)' : l === 'none' ? 'var(--g-none)' : 'var(--ok)';

  const placed = () => (Feeds.state.events || []).filter(e => Array.isArray(e.at) && Number.isFinite(e.at[0]) && Number.isFinite(e.at[1])
    && (e.kind !== 'EQ' || e.value >= MIN_QUAKE) && (e.kind !== 'TC' || e.current !== false));
  const visible = () => placed().filter(e => e.id === selected || shown.has(e.kind));
  const findEvent = id => (Feeds.state.events || []).find(x => x.id === id);
  const hasEnergy = () => typeof Energy !== 'undefined';
  const isInfra = id => typeof id === 'string' && (id.startsWith('ref:') || id.startsWith('dc:'));
  const findAny = id => findEvent(id) || (hasEnergy() && isInfra(id) ? Energy.find(id) : null);
  const inRegister = r => !!((r.inc && r.status !== 'closed') || r.fresh);
  /* The infrastructure on the globe page: what the layers switch on, and the
     selection whatever the layers say. */
  function infraItems() {
    if (!hasEnergy()) return [];
    const out = [];
    if (infraShown.has('REF')) out.push(...Energy.state.refineries);
    else if (infraShown.has('HIT')) out.push(...Energy.state.refineries.filter(inRegister));
    if (infraShown.has('DC')) out.push(...Energy.state.dcs.filter(d => d.at));
    if (isInfra(selected) && !out.some(x => x.id === selected)) { const x = Energy.find(selected); if (x && x.at) out.push(x); }
    return out;
  }
  // The Overview's globe carries only the refineries hit and still down.
  const miniInfra = () => hasEnergy() ? Energy.state.refineries.filter(r => r.inc && /red|orange/.test(Energy.levelOf(r.status))) : [];
  const infraRank = x => x.kind === 'DC' ? -1 : (Energy.STATUS[x.status] || { rank: 0 }).rank + (x.fresh ? 10 : 0);
  const ordered = () => {
    const q = query.trim().toLowerCase();
    const events = visible()
      .filter(e => !q || `${e.headline} ${e.place || ''} ${(Feeds.EVENT_KINDS[e.kind] || {}).label || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (RANK[b.level] || 0) - (RANK[a.level] || 0) || b.time - a.time);
    if (!hasEnergy()) return events;
    // A search finds any refinery or data centre; without one, the list
    // carries what the layers show (the register, not every refinery).
    const pool = q ? [...Energy.state.refineries, ...Energy.state.dcs] : infraItems().filter(x => x.kind === 'DC' || inRegister(x) || x.id === selected);
    const infra = pool.filter(x => x.at && (!q || `${x.name} ${x.op || ''} ${x.owner || ''} ${x.users || ''} ${x.country || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => infraRank(b) - infraRank(a) || (b.kind === 'DC' ? (b.mw || 0) - (a.mw || 0) : (Date.parse(b.inc && b.inc.d) || 0) - (Date.parse(a.inc && a.inc.d) || 0)));
    return [...events, ...infra];
  };
  function home() {
    try {
      const s = JSON.parse(localStorage.getItem('matrix-settings')) || {};
      return Number.isFinite(s.latitude) && Number.isFinite(s.longitude) ? [s.latitude, s.longitude] : null;
    } catch { return null; }
  }

  /* ── Marks for the renderer ── */
  function marksFor(list) {
    const now = Date.now();
    return list.map(e => {
      const isQ = e.kind === 'EQ';
      return {
        id: e.id, lat: e.at[0], lon: e.at[1], kind: e.kind, level: e.level,
        glyph: (Feeds.EVENT_KINDS[e.kind] || {}).glyph || '•',
        size: isQ ? 3.2 + Math.max(0, e.value - MIN_QUAKE) * 2.3 : e.kind === 'TC' ? 9 : 6.5,
        fade: isQ ? Math.max(0.45, 1 - (now - e.time) / (7 * DAY) * 0.55) : 1,
        label: (isQ ? `M${e.value.toFixed(1)}` : String(e.headline).replace(/^Tropical Cyclone /, ''))
          + (e.kind === 'TC' ? tcLabel(e, ' · ') : ''),
        labelled: e.kind === 'TC' || e.level === 'red'
      };
    }).sort((a, b) => (a.kind === 'TC') - (b.kind === 'TC') || (RANK[a.level] || 0) - (RANK[b.level] || 0));
  }
  function stormsFor(list) {
    const out = [];
    for (const e of list.filter(x => x.kind === 'TC')) {
      const t = tracks.get(e.id);
      if (t && t.segments) out.push(t);
    }
    return out;
  }
  function infraMarks(list) {
    if (!hasEnergy()) return [];
    return list.filter(x => Array.isArray(x.at)).map(x => {
      if (x.kind === 'DC') return { id: x.id, lat: x.at[0], lon: x.at[1], kind: 'DC', shape: 'diamond', level: 'none', colour: 'accent', pulse: false,
        size: 2.4 + Math.sqrt((x.mw || 50) / 100) * 1.15, label: x.name + (x.mw ? ` · ${Math.round(x.mw)} MW` : ''), labelled: false };
      const lv = Energy.levelOf(x.status), big = inRegister(x);
      return { id: x.id, lat: x.at[0], lon: x.at[1], kind: 'REF', shape: 'square', level: lv === 'closed' ? 'none' : lv,
        colour: lv === 'closed' || lv === 'none' ? 'none' : null, hollow: lv === 'closed', cross: x.status === 'destroyed', pulse: !!x.fresh,
        size: (big ? 3.3 : 1.7) + Math.sqrt((x.cap || 50000) / 100000) * (big ? 1.2 : 0.7),
        label: `${x.name.replace(/ (Oil )?Refinery$/i, '')} · ${(Energy.STATUS[x.status] || { label: '' }).label.toLowerCase()}`,
        labelled: lv === 'red' || !!x.fresh };
    }).sort((a, b) => a.size - b.size);
  }
  function feed(view, list, infra) {
    if (!view) return;
    view.marks = [...infraMarks(infra || []), ...marksFor(list)];
    view.storms = shown.has('TC') ? stormsFor(list) : [];
    view.night = night;
    view.home = home();
  }

  /* ── Cyclone tracks from GDACS ── */
  function geometryUrl(e) {
    const m = /eventid=(\d+)&episodeid=(\d+)/.exec(e.link || '');
    return m ? `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${m[1]}&episodeid=${m[2]}` : null;
  }
  function pointTime(label, ref) {
    const m = /^(\d\d)\/(\d\d) (\d\d):(\d\d)/.exec(label || '');
    if (!m) return NaN;
    const y = new Date(ref).getUTCFullYear();
    let t = Date.UTC(y, +m[2] - 1, +m[1], +m[3], +m[4]);
    if (t - ref > 200 * DAY) t = Date.UTC(y - 1, +m[2] - 1, +m[1], +m[3], +m[4]);
    if (ref - t > 200 * DAY) t = Date.UTC(y + 1, +m[2] - 1, +m[1], +m[3], +m[4]);
    return t;
  }
  const centroid = ring => {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[1], 0) / n, ring.reduce((s, p) => s + p[0], 0) / n];
  };
  async function loadTrack(e, force) {
    const url = geometryUrl(e);
    if (!url) { tracks.set(e.id, { at: Date.now(), error: 'no GDACS report link' }); return; }
    const have = tracks.get(e.id);
    if (!force && have && !have.pending && Date.now() - have.at < HOUR) return;
    tracks.set(e.id, { ...(have || {}), pending: true });
    try {
      const d = await Net.json(url);
      const points = [], swaths = [], segments = [];
      let cone = null, ref = Date.now();
      for (const f of d.features || []) {
        const p = f.properties || {}, g = f.geometry || {};
        if (p.polygondate) ref = Date.parse(p.polygondate + 'Z') || ref;
        if (/^Line_Line/.test(p.Class || '') && g.type === 'LineString')
          segments.push({ cls: p.polygonlabel, forecast: p.forecast === true || p.forecast === 'true', coords: g.coordinates });
        else if (p.Class === 'Poly_Cones' && g.type) cone = GlobeKit.fixWinding(g);
        else if (/^Poly_(Green|Orange|Red)$/.test(p.Class || '') && /km\/h$/.test(p.polygonlabel || ''))
          swaths.push({ level: p.Class.slice(5).toLowerCase(), label: p.polygonlabel, g: GlobeKit.fixWinding(g) });
      }
      for (const f of d.features || []) {
        const p = f.properties || {}, g = f.geometry || {};
        if (/^Point_Polygon_Point/.test(p.Class || '') && g.type === 'Polygon') {
          const t = pointTime(p.polygonlabel, ref);
          if (Number.isFinite(t)) points.push({ t, at: centroid(g.coordinates[0]) });
        }
      }
      points.sort((a, b) => a.t - b.t);
      tracks.set(e.id, { at: Date.now(), points, segments, cone, swaths });
    } catch (error) {
      tracks.set(e.id, { at: Date.now(), error: String(error.message || error) });
    }
  }
  async function loadTracks(force) {
    const storms = placed().filter(x => x.kind === 'TC');
    const todo = storms.filter(s => force || !tracks.has(s.id) || (!tracks.get(s.id).pending && Date.now() - tracks.get(s.id).at > HOUR));
    if (!todo.length) return;
    const reading = todo.map(s => loadTrack(s, force));
    paintNote();
    await Promise.all(reading);
    redraw();
    if (typeof selected === 'string') paintTrackRow();
  }

  /* ── Drawing both globes ── */
  function redraw() {
    const list = visible();
    if (page && isOpen()) { feed(page, list, infraItems()); page.fills = energyFills(); page.selected = typeof selected === 'string' ? selected : null; page.pin = selected && typeof selected === 'object' ? [selected.lat, selected.lon] : null; page.draw(false); }
    if (mini && mini.host.offsetParent) { feed(mini, placed(), miniInfra()); mini.fills = energyFills(); mini.draw(false); }
    paintLayers(); paintNote(); paintSummary();
    if (!selected) paintList();
  }

  /* ── The side panel ── */
  function paintLayers() {
    const all = placed();
    const n = kind => all.filter(e => e.kind === kind).length;
    const layers = $('map-layers');
    if (!layers) return;
    const html = KINDS.map(kd => {
      const kind = Feeds.EVENT_KINDS[kd] || { label: kd, glyph: '·' };
      return `<button type="button" class="chip${shown.has(kd) ? ' on' : ''}" data-layer="${kd}" aria-pressed="${shown.has(kd)}">${kind.glyph} ${kd === 'EQ' ? 'QUAKES M4.5+' : kind.label} <b>${n(kd)}</b></button>`;
    }).join('') + (hasEnergy() ? INFRA.map(([kd, glyph, label]) => {
      const count = kd === 'WAR' ? (typeof War !== 'undefined' ? War.fills().length : 0) : kd === 'NRG' ? (typeof Watch !== 'undefined' ? [...Watch.state.level.values()].filter(v => v.level !== 'quiet').length : 0) : kd === 'HIT' ? Energy.state.refineries.filter(inRegister).length : kd === 'REF' ? Energy.state.refineries.length : Energy.state.dcs.filter(d => d.at).length;
      return `<button type="button" class="chip${infraShown.has(kd) ? ' on' : ''}" data-infra="${kd}" aria-pressed="${infraShown.has(kd)}">${glyph} ${label} <b>${count}</b></button>`;
    }).join('') : '') + `<button type="button" class="chip${night ? ' on' : ''}" data-night aria-pressed="${night}">☾ NIGHT</button>`;
    if (layers.innerHTML !== html) layers.innerHTML = html;
  }
  function paintNote() {
    const note = $('map-note');
    if (!note) return;
    const ts = [...tracks.values()];
    const loading = ts.some(t => t.pending), failed = ts.filter(t => t.error && !t.pending).length;
    note.textContent = !shown.has('TC') ? '' : loading ? 'Reading cyclone tracks from GDACS…'
      : failed ? `${failed} cyclone track${failed > 1 ? 's' : ''} could not be read from GDACS.` : '';
  }
  function paintSummary() {
    const sum = $('map-sum');
    if (!sum) return;
    const all = placed(), red = all.filter(e => e.level === 'red').length, orange = all.filter(e => e.level === 'orange').length;
    const html = `${all.length} placed · <span class="lvl-red">${red} red</span> · <span class="lvl-orange">${orange} orange</span>`;
    if (sum.innerHTML !== html) sum.innerHTML = html;
  }
  function paintList() {
    const pane = $('map-detail');
    if (!pane || selected) return;
    const rows = ordered();
    const signature = rows.map(r => r.id + (r.level || r.status) + (r.fresh ? '!' : '')).join(',') + '|' + query;
    if (pane.dataset.sig === signature && pane.querySelector('.map-list')) { refreshAges(pane); return; }
    pane.dataset.sig = signature;
    pane.innerHTML = rows.length ? `<ol class="map-list">${rows.slice(0, 250).map(e => {
      if (isInfra(e.id)) return infraRow(e);
      const kind = Feeds.EVENT_KINDS[e.kind] || { label: e.kind, glyph: '·' };
      const name = e.kind === 'EQ' ? `M ${e.value.toFixed(1)} · ${e.place}` : e.headline;
      const where = e.kind === 'EQ' ? kind.label : [kind.label, e.place && !String(e.place).includes(e.headline) ? e.place : ''].filter(Boolean).join(' · ');
      return `<li><button type="button" data-pick="${esc(e.id)}" class="lv-${esc(e.level)}">
        <i style="color:${levelVar(e.level)}">${kind.glyph}</i>
        <span><b>${esc(name)}</b><small>${esc(where)}</small></span>
        <time data-t="${e.time}">${when(e)}</time></button></li>`;
    }).join('')}</ol>${rows.length > 250 ? `<p class="map-hint">${rows.length - 250} more — narrow the search or the layers.</p>` : ''}`
      : `<p class="map-hint">${query ? 'Nothing matches that search.' : placed().length ? 'Every layer is switched off.' : 'Waiting for the first reading…'}</p>`;
    pane.insertAdjacentHTML('beforeend', `<p class="map-hint map-howto">Click a mark or a row for its story; anywhere else on the globe for the webcams there. Drag to turn · wheel to zoom · [ ] step · Esc back.</p>`);
  }
  function infraRow(x) {
    const dc = x.kind === 'DC', st = dc ? null : Energy.STATUS[x.status] || Energy.STATUS.operating;
    const colour = dc ? 'var(--accent)' : levelVar(st.level === 'closed' ? 'none' : st.level);
    const where = dc ? ['AI data centre', x.owner, x.country].filter(Boolean).join(' · ') : ['Refinery', st.label, x.country].filter(Boolean).join(' · ');
    const right = dc ? (x.mw ? `${Math.round(x.mw)} MW` : '') : x.fresh && x.news[0] ? 'new report' : x.inc ? x.inc.d.slice(0, 7) : '';
    return `<li><button type="button" data-pick="${esc(x.id)}"><i style="color:${colour}">${dc ? '◆' : st.level === 'closed' ? '□' : '▪'}</i>
      <span><b>${esc(x.name)}</b><small>${esc(where)}</small></span><time>${esc(right)}</time></button></li>`;
  }
  const refreshAges = root => { if (!root) return; for (const t of root.querySelectorAll('time[data-t]')) { const v = when({ time: +t.dataset.t }); if (t.textContent !== v) t.textContent = v; } };

  const CLASS = { TD: 'Tropical depression', TS: 'Tropical storm', HU: 'Hurricane or typhoon' };
  const wrapLon = lon => { let l = lon; while (l > 180) l -= 360; while (l < -180) l += 360; return l; };
  function paintTrackRow() {
    const row = $('map-track-row'), e = typeof selected === 'string' && findEvent(selected);
    if (!row || !e) return;
    const t = tracks.get(e.id);
    row.innerHTML = !t || t.pending ? '<dt>Track</dt><dd>reading…</dd>'
      : t.error ? `<dt>Track</dt><dd class="lvl-orange">${esc(t.error)}</dd>`
      : (() => {
        const past = t.points.filter(p => p.t <= Date.now()), ahead = t.points.filter(p => p.t > Date.now());
        const gap = (sg, pt) => Math.min(...sg.coords.map(([lon, lat]) => Math.hypot(lat - pt.at[0], wrapLon(lon - pt.at[1]))));
        const nearest = (list, pt) => pt && list.length ? list.reduce((a, b) => gap(b, pt) < gap(a, pt) ? b : a) : null;
        const lastPast = past[past.length - 1], lastAhead = ahead[ahead.length - 1];
        const now = nearest(t.segments.filter(sg => !sg.forecast), lastPast);
        const then = nearest(t.segments.filter(sg => sg.forecast), lastAhead);
        const word = sg => esc((CLASS[sg.cls] || sg.cls || 'unclassified').toLowerCase());
        return `<dt>Track</dt><dd>${past.length} positions${ahead.length ? `, ${ahead.length} forecast to ${new Date(lastAhead.t).toUTCString().slice(5, 16)}` : ''}${now ? `<br>now: ${word(now)}` : ''}${then && (!now || then.cls !== now.cls) ? ` · then: ${word(then)}` : ''}</dd>`;
      })();
  }

  function nightWord([lat, lon]) {
    const sun = GlobeKit.subsolar(Date.now()), r = Math.PI / 180;
    const alt = Math.asin(Math.sin(lat * r) * Math.sin(sun.lat * r) + Math.cos(lat * r) * Math.cos(sun.lat * r) * Math.cos((lon - sun.lon) * r)) / r;
    const word = alt > 0 ? 'daylight' : alt > -6 ? 'civil twilight' : alt > -12 ? 'nautical twilight' : alt > -18 ? 'astronomical twilight' : 'night';
    return `Now: ${word}, the Sun ${Math.abs(alt).toFixed(0)}° ${alt >= 0 ? 'above' : 'below'} the horizon.`;
  }

  function paintDetail() {
    const pane = $('map-detail');
    if (!pane) return;
    delete pane.dataset.sig;
    if (!selected) { paintList(); return; }
    let where, html;
    const nav = rows => {
      const i = typeof selected === 'string' ? rows.findIndex(r => r.id === selected) : -1;
      return `<div class="map-nav"><button type="button" data-back>← All events</button>${i >= 0 ? `<span>${i + 1} / ${rows.length}</span><button type="button" data-step="-1" aria-label="Previous event">‹</button><button type="button" data-step="1" aria-label="Next event">›</button>` : ''}</div>`;
    };
    if (typeof selected === 'object') {
      where = [selected.lat, selected.lon];
      const country = page ? page.countryAt(where[0], where[1]) : '';
      const en = typeof Watch !== 'undefined' ? Watch.statusAt(where[0], where[1]) : null;
      const wr = typeof War !== 'undefined' ? War.statusAt(where[0], where[1]) : null;
      html = `${nav([])}<span class="eyebrow">A POINT ON THE GLOBE</span><strong>${latLon(where)}</strong>
        <dl><div><dt>Country</dt><dd>${esc(country || 'open water')}</dd></div><div><dt>Sun</dt><dd>${esc(nightWord(where).replace(/^Now: /, ''))}</dd></div>
        ${wr ? `<div><dt>War</dt><dd class="lvl-${wr.tier === 'major' ? 'red' : wr.tier === 'minor' ? 'orange' : 'none'}">${esc(wr.label)} · ${esc(wr.theatre.name)}</dd></div>` : ''}
        ${en ? `<div><dt>Energy</dt><dd class="lvl-${Watch.tone(en.L.level) === 'crit' ? 'red' : Watch.tone(en.L.level) === 'ok' ? 'none' : 'orange'}">${esc(Watch.LEVEL_SAY[en.L.level])}${en.L.n ? ` · ${en.L.n} reports in 72 h` : ''}</dd></div>` : ''}</dl>
        ${en ? `<div class="map-actions"><button type="button" class="btn ghost sm" data-energy-country="${en.c.iso2}">${esc(en.c.name)} on the Energy page →</button></div>` : ''}`;
    } else if (isInfra(selected)) {
      const x = hasEnergy() && Energy.find(selected);
      if (!x) { selected = null; paintDetail(); return; }
      where = x.at;
      html = nav(ordered()) + Energy.detailHTML(x);
    } else {
      const e = findEvent(selected);
      if (!e) { selected = null; paintDetail(); return; }
      where = e.at;
      const kind = Feeds.EVENT_KINDS[e.kind] || { label: e.kind, glyph: '·' };
      const t = Matrix.cal360(new Date(e.time));
      const value = e.kind === 'EQ' ? 'M ' + e.value.toFixed(1) : Number.isFinite(e.value) ? `${Math.round(e.value)} ${e.unit || ''}` : '';
      const local = new Date(e.time);
      html = `${nav(ordered())}<span class="eyebrow" style="color:${levelVar(e.level)}">${kind.glyph} ${esc(kind.label)} · ${esc(e.level === 'none' ? 'NOT RATED' : String(e.level).toUpperCase())}</span>
        <strong>${esc(e.kind === 'EQ' ? value + ' · ' + e.place : e.headline)}</strong>
        <div class="map-desc" id="map-desc"><p class="map-hint">Reading…</p></div>
        <dl>
          ${e.kind !== 'EQ' && e.place && !String(e.place).includes(e.headline) ? `<div><dt>Where</dt><dd>${esc(e.place)}</dd></div>` : ''}
          ${e.kind === 'TC' && hasStorms() ? Storms.rows(e, esc) : ''}
          ${e.kind !== 'EQ' && value && !(e.kind === 'TC' && hasStorms()) ? `<div><dt>Strength</dt><dd>${esc(value)}</dd></div>` : ''}
          ${e.kind !== 'EQ' && e.detail && e.detail !== value && !(e.kind === 'TC' && hasStorms()) ? `<div><dt>Reading</dt><dd>${esc(e.detail)}</dd></div>` : ''}
          <div><dt>Position</dt><dd>${latLon(e.at)}</dd></div>
          <div><dt>${e.ongoing ? 'Listed since' : 'Civil time'}</dt><dd>${local.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${Date.now() - e.time > 45 * DAY ? local.getFullYear() : `${pad(local.getHours())}:${pad(local.getMinutes())}`} · ${when(e)}</dd></div>
          <div><dt>Matrix date</dt><dd>${esc(Matrix.CAL360.days[t.weekday].name)} ${t.day} ${esc(Matrix.CAL360.months[t.month])} · ${pad(t.h)}:${pad(t.m)}</dd></div>
          ${e.kind === 'TC' ? '<div id="map-track-row"></div>' : ''}
        </dl>
        <div class="map-actions">
          <button type="button" class="btn ghost" data-zoom>⌖ Zoom to it</button>
          ${e.link ? `<a class="btn primary" href="${esc(e.link)}" target="_blank" rel="noreferrer noopener">${e.source === 'seismic' ? 'USGS event page' : e.id.startsWith('eonet:') ? 'Source page' : e.source === 'storms' ? 'Agency advisory' : 'GDACS report'} ↗</a>` : ''}
        </div>`;
    }
    pane.innerHTML = html + `<div class="map-cams"><span class="eyebrow">WEBCAMS WITHIN ${WEBCAM_RADIUS_KM} KM</span><ol id="map-cams"><li class="map-hint">Looking…</li></ol></div>`;
    pane.scrollTop = 0;
    paintTrackRow();
    webcams(where);
    if (typeof selected === 'string' && !isInfra(selected)) describe(selected);
  }

  /* ── What happened, in words ── (from the sources' own fields) */
  const described = new Map();
  const MMI = ['', 'not felt', 'weak', 'weak', 'light', 'moderate', 'strong', 'very strong', 'severe', 'violent', 'extreme', 'extreme', 'extreme'];
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const PAGER = { green: 'little or no damage and no fatalities expected', yellow: 'some damage and possible fatalities',
                  orange: 'significant damage and fatalities likely', red: 'extensive damage and many fatalities likely' };
  const SOURCES = { NOAA: 'NOAA', JTWC: 'the Joint Typhoon Warning Center', GLOFAS: 'the Global Flood Awareness System (GloFAS)',
                    GWIS: 'the Global Wildfire Information System (GWIS)', GDO: 'the Global Drought Observatory', DFO: 'the Dartmouth Flood Observatory' };
  const LEVEL_SAY = { green: 'green — minor', orange: 'orange — moderate', red: 'red — severe' };
  const mDate = ms => { const t = Matrix.cal360(new Date(ms)); return `${Matrix.CAL360.days[t.weekday].name} ${t.day} ${Matrix.CAL360.months[t.month]}`; };
  const daysBetween = (a, b) => Math.max(1, Math.round((b - a) / DAY));
  const list = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  const fmtN = n => Number(n).toLocaleString('en-US');

  function quakeText(e) {
    const s = [`A magnitude ${e.value.toFixed(1)} earthquake, ${e.place}${Number.isFinite(e.depth) ? `, ${Math.round(e.depth)} km deep` : ''}.`];
    if (e.felt) s.push(`${fmtN(e.felt)} ${e.felt === 1 ? 'person' : 'people'} reported feeling it to USGS.`);
    if (e.mmi) s.push(`Strongest shaking estimated: intensity ${ROMAN[Math.min(12, Math.round(e.mmi))]}, ${MMI[Math.min(12, Math.round(e.mmi))]}.`);
    if (e.pager) s.push(`USGS PAGER alert ${e.pager}: ${PAGER[e.pager] || ''}.`);
    if (e.tsunami) s.push('It lies in a region where tsunami information is issued; check the tsunami warning centres for any warning.');
    s.push(e.reviewed ? 'Location and magnitude reviewed by a seismologist.' : 'Automatic solution; location and magnitude may still be revised.');
    return `<p>${esc(s.join(' '))}</p>`;
  }
  function gdacsText(e, d) {
    const p = d.properties || d, sev = p.severitydata || {};
    const from = Date.parse(p.fromdate + 'Z'), to = Math.min(Date.parse(p.todate + 'Z') || Date.now(), Date.now());
    const countries = (p.affectedcountries || []).map(c => c.countryname).filter(Boolean);
    const where = countries.length ? list(countries) : (p.country || '');
    const by = SOURCES[String(p.source || '').toUpperCase()] || p.source || 'GDACS';
    const days = Number.isFinite(from) ? daysBetween(from, to) : null;
    const start = Number.isFinite(from) ? mDate(from) : '';
    const span = days ? ` (${days} day${days > 1 ? 's' : ''})` : '';
    const since = start ? `since ${start}${span}` : '';
    let lead;
    if (e.kind === 'TC') {
      const what = /hurricane|typhoon/i.test(sev.severitytext) ? 'a hurricane or typhoon' : /storm/i.test(sev.severitytext) ? 'a tropical storm'
        : /depression/i.test(sev.severitytext) ? 'a tropical depression' : 'a tropical cyclone';
      lead = `${p.eventname || e.headline}, ${what} with peak winds of ${Math.round(sev.severity || e.peak || e.value || 0)} km/h${where ? `, near ${where}` : ', out at sea'}, tracked ${since} by ${by}.`;
    } else if (e.kind === 'FL') {
      lead = `Flooding in ${where || 'an unnamed area'}, detected ${start ? 'on ' + start + ' ' : ''}by ${by}${String(p.iscurrent) === 'true' ? ' and still ongoing' : ', last reported ' + mDate(to)}${span}.`;
    } else if (e.kind === 'WF') {
      const ha = Number(sev.severity);
      lead = `Forest fires in ${where || 'an unnamed area'}${Number.isFinite(ha) && ha > 0 ? ` covering about ${fmtN(Math.round(ha))} hectares (${fmtN(Math.round(ha / 100))} km²)` : ''}, burning ${since}, mapped by ${by}.`;
    } else if (e.kind === 'DR') {
      lead = `Drought in ${where || 'an unnamed area'}, assessed by ${by}${start ? ' since ' + start + span : ''}.${sev.severitytext ? ' ' + sev.severitytext + '.' : ''}`;
    } else if (e.kind === 'VO') {
      lead = `${p.eventname || e.headline}: eruption reported${where ? ' in ' + where : ''} ${since}.${sev.severitytext ? ' ' + sev.severitytext + '.' : ''}`;
    } else lead = String(p.htmldescription || e.headline).replace(/<[^>]+>/g, '');
    const level = String(p.alertlevel || e.level || '').toLowerCase();
    const rate = LEVEL_SAY[level] ? ` GDACS rates its expected impact on people ${LEVEL_SAY[level]}.` : '';
    const NAME = { death: 'dead', injured: 'injured', missing: 'missing', affected: 'affected', evacuated: 'evacuated',
                   displaced: 'displaced', homeless: 'homeless', rescued: 'rescued' };
    const newest = new Map();
    for (const r of p.sendai || []) {
      if (!Number.isFinite(Number(r.sendaivalue)) || !r.sendainame) continue;
      const kk = r.sendainame + '|' + (r.region || r.country || '');
      const b = newest.get(kk);
      if (!b || String(r.dateinsert) > String(b.dateinsert)) newest.set(kk, r);
    }
    const impacts = [...newest.values()].sort((a, b) => String(b.dateinsert).localeCompare(String(a.dateinsert))).slice(0, 8)
      .map(r => `${fmtN(r.sendaivalue)} ${NAME[r.sendainame] || String(r.sendainame).replace(/_/g, ' ')}${r.region ? ' in ' + r.region : r.country ? ' in ' + r.country : ''}`);
    return `<p>${esc(lead + rate)}</p>` + (impacts.length ? `<p class="map-impacts"><b>Reported impacts</b> ${esc(impacts.join(' · '))}</p>` : '');
  }
  async function describe(id) {
    const e = findEvent(id);
    const slot = () => $('map-desc');
    if (!e || !slot()) return;
    if (described.has(id)) { slot().innerHTML = described.get(id); return; }
    let html;
    if (e.kind === 'EQ') html = quakeText(e);
    else if (id.startsWith('eonet:') && e.kind === 'VO')
      html = `<p>${esc(`${e.headline} is listed as erupting by the Smithsonian Global Volcanism Program, ${Number.isFinite(e.time) ? 'since ' + mDate(e.time) : 'as an ongoing eruption'}. GDACS has issued no impact alert for it, which in its scheme is green.`)}</p>`;
    else if (id.startsWith('eonet:'))
      html = `<p>${esc(`${e.headline}, from NASA's Earth Observatory Natural Event Tracker. It carries no impact rating.`)}</p>`;
    else {
      const m = /^gdacs:([A-Z]{2})(\d+)$/.exec(id);
      if (!m) { slot().innerHTML = ''; return; }
      try {
        const d = await Net.json(`https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=${m[1]}&eventid=${m[2]}`);
        html = gdacsText(e, d);
      } catch (error) {
        html = `<p class="map-hint warn">GDACS did not answer for the description (${esc(error.message || error)}).</p>`;
        if (selected === id && slot()) slot().innerHTML = html;
        return;
      }
    }
    described.set(id, html);
    if (selected === id && slot()) slot().innerHTML = html;
  }

  /* ── Webcams (Windy) ── */
  const key = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
  const windyMap = ([lat, lon]) => `https://www.windy.com/?${lat.toFixed(3)},${lon.toFixed(3)},8`;
  let camTicket = 0;
  async function webcams(where) {
    const ol = $('map-cams');
    if (!ol) return;
    if (!Array.isArray(where)) { ol.innerHTML = '<li class="map-hint">This event came without a position.</li>'; return; }
    const ticket = ++camTicket;
    if (!key()) {
      ol.innerHTML = `<li class="map-hint">Add a free Windy webcams key in Settings to list them here.</li>
        <li><a href="${windyMap(where)}" target="_blank" rel="noreferrer noopener">Open Windy here ↗ (Webcams is in its menu)</a></li>`;
      return;
    }
    let data;
    try {
      data = window.desktop && window.desktop.webcams
        ? await window.desktop.webcams(where[0], where[1], WEBCAM_RADIUS_KM, key())
        : await (await fetch(`https://api.windy.com/webcams/api/v3/webcams?nearby=${where[0].toFixed(4)},${where[1].toFixed(4)},${WEBCAM_RADIUS_KM}&limit=12&include=location,urls`,
            { headers: { 'x-windy-api-key': key() } })).json();
      if (data && data.error && !data.webcams) throw new Error(data.error);
      if (data && data.message && !data.webcams) throw new Error(data.message);
    } catch (error) {
      if (ticket !== camTicket) return;
      ol.innerHTML = `<li class="map-hint warn">Windy did not answer: ${esc(error.message || error)}.</li>
        <li><a href="${windyMap(where)}" target="_blank" rel="noreferrer noopener">Open Windy here ↗ (Webcams is in its menu)</a></li>`;
      return;
    }
    if (ticket !== camTicket || !$('map-cams')) return;
    const km = (a, b) => { const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(h)); };
    const cams = (data.webcams || []).map(c => {
      const loc = c.location || {};
      return { title: c.title, status: c.status, place: [loc.city, loc.country].filter(Boolean).join(', '),
        d: Number.isFinite(loc.latitude) ? km(where, [loc.latitude, loc.longitude]) : null,
        url: (c.urls && c.urls.detail) || `https://www.windy.com/webcams/${c.webcamId}` };
    }).filter(c => /^https:\/\//.test(c.url)).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
    $('map-cams').innerHTML = cams.length
      ? cams.map(c => `<li><a href="${esc(c.url)}" target="_blank" rel="noreferrer noopener">${esc(c.title || 'Webcam')} ↗</a>
          <small>${esc(c.place)}${c.d !== null ? ' · ' + Math.round(c.d) + ' km' : ''}${c.status && c.status !== 'active' ? ' · ' + esc(c.status) : ''}</small></li>`).join('')
      : `<li class="map-hint">Windy lists no public webcam within ${WEBCAM_RADIUS_KM} km.</li>`;
  }

  /* ── Selecting ── */
  function select(target, fly) {
    selected = target || null;
    redraw();
    paintDetail();
    if (fly && page && typeof selected === 'string') {
      const e = findAny(selected);
      if (e && e.at) page.flyTo(e.at[0], e.at[1], Math.max(page.k, isInfra(selected) ? 4 : e.kind === 'TC' ? 2.2 : 3));
    }
  }
  function step(dir) {
    const rows = ordered();
    if (!rows.length) return;
    const i = rows.findIndex(r => r.id === selected);
    const next = rows[(i < 0 ? (dir > 0 ? 0 : rows.length - 1) : (i + dir + rows.length) % rows.length)];
    select(next.id, true);
  }

  /* ── Opening ── */
  const isOpen = () => typeof Views !== 'undefined' && Views.current === 'globe';
  function open(id) {
    if (typeof Views !== 'undefined' && Views.current !== 'globe') Views.setView('globe');
    const e = id && findAny(id);
    if (e) select(id, true);
  }
  // Called by Views whenever the page changes.
  function shown_(view) {
    if (view === 'globe') {
      if (!page) page = makePage();
      requestAnimationFrame(() => { page.resize(); redraw(); loadTracks(); });
    } else if (view === 'field' && mini) {
      requestAnimationFrame(() => { mini.resize(); redraw(); });
    }
  }

  /* ── The tooltip ── */
  function tipFor(hit) {
    if (!hit) return '';
    if (hit.tip) return `<span>${esc(hit.tip)}</span>`;
    if (isInfra(hit.id)) { const x = hasEnergy() && Energy.find(hit.id); return x ? Energy.tipHTML(x) : ''; }
    const e = findEvent(hit.id);
    if (!e) return '';
    const kind = Feeds.EVENT_KINDS[e.kind] || { label: e.kind, glyph: '·' };
    const name = e.kind === 'EQ' ? `M ${e.value.toFixed(1)} · ${e.place}` : e.headline;
    const value = e.kind === 'TC' && Number.isFinite(e.value) ? ' · ' + (hasStorms() ? Storms.line(e) : `${Math.round(e.value)} km/h`) : e.kind !== 'EQ' && e.place && !String(e.place).includes(e.headline) ? ` · ${e.place}` : '';
    return `<b style="color:${levelVar(e.level)}">${kind.glyph} ${esc(kind.label)} · ${esc(e.level === 'none' ? 'not rated' : e.level)}</b><span>${esc(name)}</span><small>${esc(when(e) + value)}</small>`;
  }

  /* Pointer handling, shared: drag turns, wheel and pinch zoom, a click picks. */
  function wire(view, tipNode, coordNode, onPick) {
    const cv = view.canvas;
    const pointers = new Map();
    let drag = null, pinch = null, clickTimer = 0;
    const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('wheel', e => {
      e.preventDefault(); view.stop();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      view.zoomTo(view.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      view.stop();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cv.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k }; drag = null; return;
      }
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    });
    cv.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        view.zoomTo(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d); return;
      }
      if (drag) {
        if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) { drag.moved = true; cv.classList.add('dragging'); if (tipNode) tipNode.hidden = true; }
        if (drag.moved) { view.rotateBy(e.clientX - drag.lx, e.clientY - drag.ly); drag.lx = e.clientX; drag.ly = e.clientY; return; }
      }
      const [x, y] = local(e);
      if (coordNode) { const ll = view.invert(x, y); coordNode.textContent = ll ? latLon(ll) : '—'; }
      if (tipNode) {
        const hit = view.pick(x, y), html = tipFor(hit);
        cv.style.cursor = hit ? 'pointer' : '';
        if (!html) tipNode.hidden = true;
        else {
          if (tipNode.innerHTML !== html) tipNode.innerHTML = html;
          tipNode.hidden = false;
          const fr = cv.getBoundingClientRect();
          const w = tipNode.offsetWidth, h = tipNode.offsetHeight;
          tipNode.style.left = `${Math.min(fr.width - w - 8, x + 14)}px`;
          tipNode.style.top = `${y + 16 + h > fr.height ? y - h - 12 : y + 16}px`;
        }
      }
    });
    const end = e => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) { pinch = null; view.draw(false); } return; }
      const was = drag; drag = null; cv.classList.remove('dragging');
      if (!was || e.type === 'pointercancel') return;
      if (was.moved) { view.draw(false); return; }
      const [x, y] = local(e);
      const hit = view.pick(x, y);
      clearTimeout(clickTimer);
      if (hit && hit.id) { onPick(hit.id); return; }
      const ll = view.invert(x, y);
      if (ll) clickTimer = setTimeout(() => onPick({ lat: ll[0], lon: ll[1] }), 260);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (tipNode) tipNode.hidden = true; if (coordNode) coordNode.textContent = '—'; });
    cv.addEventListener('dblclick', e => {
      clearTimeout(clickTimer);
      const [x, y] = local(e), ll = view.invert(x, y);
      if (ll) view.flyTo(ll[0], ll[1], view.k * 2.2, 450);
    });
  }

  function startLon() {
    const h = home();
    return h ? h[1] : (Matrix.CAL360 && Number.isFinite(Matrix.CAL360.longitude) ? Matrix.CAL360.longitude : 0);
  }
  function makePage() {
    const host = $('globe-host');
    const v = GlobeKit.View(host, { lon: startLon(), lat: 12, onView: paintScale });
    wire(v, $('map-tip'), $('map-coord'), target => select(target, false));
    new ResizeObserver(() => { if (isOpen()) v.resize(); }).observe(host);
    return v;
  }
  function paintScale() {
    const label = $('map-scale-label');
    if (!label || !page) return;
    label.textContent = `×${page.k.toFixed(page.k < 10 ? 1 : 0)} · centre ${latLon([page.center()[1], page.center()[0]])}`;
  }

  /* The Overview's globe: no panel, clicks open the globe page; it turns
     slowly on its own until someone touches it. */
  function makeMini() {
    const host = $('ov-globe');
    if (!host) return null;
    const v = GlobeKit.View(host, { lon: startLon(), lat: 14, margin: 12 });
    wire(v, $('ov-globe-tip'), null, target => { if (typeof target === 'string') open(target); else { open(); select(target, false); } });
    new ResizeObserver(() => { if (host.offsetParent) v.resize(); }).observe(host);
    let idleSince = performance.now(), last = 0;
    v.canvas.addEventListener('pointerdown', () => { idleSince = Infinity; });
    v.canvas.addEventListener('pointerup', () => { idleSince = performance.now(); });
    const spin = ts => {
      requestAnimationFrame(spin);
      if (document.hidden || !host.offsetParent || ts - last < 66) return;
      last = ts;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || ts - idleSince < 6000) return;
      v.rot[0] += 0.4;
      v.draw(true);
    };
    requestAnimationFrame(spin);
    return v;
  }

  function init() {
    // The side panel and the controls of the globe page.
    const side = $('map-detail');
    if (side) {
      side.addEventListener('click', e => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { select(pick.dataset.pick, true); return; }
        if (e.target.closest('[data-back]')) { select(null); return; }
        const ec = e.target.closest('[data-energy-country]');
        if (ec && typeof Watch !== 'undefined') { Views.setView('energy'); Watch.view(ec.dataset.energyCountry); const m = document.querySelector('.cw-main'); if (m) m.scrollIntoView({ block: 'start' }); return; }
        const st = e.target.closest('[data-step]');
        if (st) { step(Number(st.dataset.step)); return; }
        if (e.target.closest('[data-zoom]') && typeof selected === 'string' && page) {
          const ev = findAny(selected);
          if (ev && ev.at) page.flyTo(ev.at[0], ev.at[1], isInfra(selected) ? 14 : ev.kind === 'TC' ? 5 : 9);
        }
      });
      side.addEventListener('pointerover', e => { const p = e.target.closest('[data-pick]'); if (p && page) { page.hot = p.dataset.pick; page.drawOver(); } });
      side.addEventListener('pointerout', e => { const p = e.target.closest('[data-pick]'); if (p && page) { page.hot = null; page.drawOver(); } });
    }
    const on = (id, fn) => { const n = $(id); if (n) n.addEventListener('click', fn); };
    on('map-zoom-in', () => page && page.flyTo(page.center()[1], page.center()[0], page.k * 1.8, 350));
    on('map-zoom-out', () => page && page.flyTo(page.center()[1], page.center()[0], page.k / 1.8, 350));
    on('map-reset', () => page && page.flyTo(12, startLon(), 1));
    const layers = $('map-layers');
    if (layers) layers.addEventListener('click', e => {
      const b = e.target.closest('[data-layer],[data-night],[data-infra]');
      if (!b) return;
      if (b.hasAttribute('data-night')) night = !night;
      else if (b.dataset.infra) { const kd = b.dataset.infra; if (infraShown.has(kd)) infraShown.delete(kd); else infraShown.add(kd); }
      else { const kd = b.dataset.layer; if (shown.has(kd)) shown.delete(kd); else shown.add(kd); }
      redraw();
      if (b.dataset.layer === 'TC' && shown.has('TC')) loadTracks();
    });
    const search = $('map-search');
    if (search) {
      search.addEventListener('input', e => { query = e.target.value; if (selected) select(null); else paintList(); });
      search.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = ordered()[0]; if (first) select(first.id, true); } });
    }
    document.addEventListener('keydown', e => {
      if (!isOpen() || !page || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const typing = e.target.closest && e.target.closest('input, textarea, select');
      if (e.key === 'Escape') {
        if (selected) { select(null); e.preventDefault(); }
        else if (query) { query = ''; if (search) search.value = ''; paintList(); e.preventDefault(); }
        if (typing) e.target.blur();
        return;
      }
      if (typing) return;
      const c = page.center();
      const act = {
        '+': () => page.flyTo(c[1], c[0], page.k * 1.8, 300), '=': () => page.flyTo(c[1], c[0], page.k * 1.8, 300),
        '-': () => page.flyTo(c[1], c[0], page.k / 1.8, 300), '_': () => page.flyTo(c[1], c[0], page.k / 1.8, 300),
        '0': () => page.flyTo(12, startLon(), 1),
        ArrowLeft: () => page.rotateBy(60, 0), ArrowRight: () => page.rotateBy(-60, 0),
        ArrowUp: () => page.rotateBy(0, 60), ArrowDown: () => page.rotateBy(0, -60),
        '[': () => step(-1), ']': () => step(1), '/': () => search && search.focus()
      }[e.key];
      if (!act) return;
      e.preventDefault(); act();
      if (e.key.startsWith('Arrow')) setTimeout(() => page.draw(false), 180);
    });

    mini = makeMini();
    // Theme changes repaint both globes in the new palette.
    new MutationObserver(() => { if (page) page.setTheme(); if (mini) mini.setTheme(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    let stormSig = '';
    Feeds.onUpdate(() => {
      redraw(); loadTracks();
      if (typeof selected === 'string' && !findAny(selected)) { select(null); return; }
      // An open cyclone's pane follows each new advisory.
      const e = typeof selected === 'string' && hasStorms() ? findEvent(selected) : null;
      const sig = e && e.kind === 'TC' ? e.id + Storms.sig(e) : '';
      if (sig && stormSig && sig !== stormSig && page && isOpen()) { const d = $('map-detail'); if (d && !d.contains(document.activeElement)) paintDetail(); }
      stormSig = sig;
    });
    if (typeof Watch !== 'undefined') Watch.onUpdate(() => { if (page && isOpen()) redraw(); });
    if (typeof War !== 'undefined') War.onUpdate(() => redraw());
    if (hasEnergy()) Energy.onUpdate(() => { redraw(); if (isInfra(selected) && page && isOpen()) { const d = $('map-detail'); if (d && !d.contains(document.activeElement)) paintDetail(); } });
    // The night moves and the ages change: once a minute.
    setInterval(() => { if (page && isOpen()) { page.draw(false); refreshAges($('map-detail')); } if (mini && mini.host.offsetParent) mini.draw(false); loadTracks(); }, MIN);
    if (mini) requestAnimationFrame(() => { mini.resize(); feed(mini, placed()); mini.draw(false); });
    loadTracks();

    // The webcam key lives on this computer only, beside the other settings.
    const input = $('windy-key');
    if (input) {
      input.value = key();
      input.addEventListener('change', () => {
        const v = input.value.trim();
        try { if (/^[A-Za-z0-9]{8,80}$/.test(v)) localStorage.setItem(KEY_STORE, v); else if (!v) localStorage.removeItem(KEY_STORE); } catch { /* refused */ }
        $('windy-key-status').textContent = v && !/^[A-Za-z0-9]{8,80}$/.test(v) ? 'That does not look like a Windy key.' : v ? 'Saved.' : '';
      });
    }
  }

  return { init, open, isOpen, shown: shown_ };
})();
