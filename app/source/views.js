'use strict';
/* ── The views ─────────────────────────────────────────────────────────────
   The face is one reading of the field; these are the others. A tab moves
   between them, a list inside each one scrolls and selects, and a detail pane
   opens whatever is selected. Everything here reads the same Feeds state the
   face reads, so a view is a way of looking rather than a second copy of the
   data.                                                                     */

const Views = (() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* Past times read "12m ago"; a time still ahead — an upcoming launch —
     reads "in 3h" and counts down, then turns into "ago" once it passes. */
  const span = s => s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm'
    : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
  const ago = ms => {
    const d = Math.floor((Date.now() - ms) / 1000);
    return d < 0 ? 'in ' + span(-d) : span(d) + ' ago';
  };
  const clock = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const civil = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const civilUTC = ms => new Date(ms).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  /* Some sources date an event to the day and no finer — Wikipedia's current
     events are filed under a UTC date. Showing "20h ago" for those would invent
     an hour, so they carry the date they were filed under. */
  const dayOf = ms => Math.floor(ms / 86400000);
  const dayLabel = ms => {
    const d = dayOf(Date.now()) - dayOf(ms);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday'
      : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const when = e => e.dayOnly ? dayLabel(e.time) : ago(e.time);

  /* Where an event falls on the Matrix calendar and the daily wave. This is
     the one thing these views say that the sources do not: the instrument's
     own reading of when the thing happened. */
  function matrixStamp(ms) {
    const t = Matrix.cal360(new Date(ms));
    return {
      date: `${Matrix.CAL360.days[t.weekday].name} ${t.day} ${Matrix.CAL360.months[t.month]}`,
      time: `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`,
      regime: { race: 'The clock races', repay: 'The clock repays', true: 'The clock runs true' }[t.regime],
      v: t.v
    };
  }

  // The eight tabs, in the order the number keys reach them, and the Moon,
  // which has no tab: the small moon among the header tools opens it.
  // Keys 1–9 follow the sidebar's order, Overview to World; Discovery has no key and the Moon has M.
  const VIEWS = ['field', 'globe', 'seismic', 'disasters', 'solar', 'orbital', 'vitals', 'ai', 'world', 'discovery', 'moon', 'energy', 'matrix', 'society', 'war', 'economy'];
  let current = 'field';
  let selected = {};          // view -> selected row id
  const filters = {
    seismic: { min: 0, query: '' },
    disasters: { kinds: new Set(), levels: new Set(), query: '' },
    orbital: { query: '' },
    world: { curatedOnly: false, conflictOnly: false, query: '' },
    discovery: { kinds: new Set(), query: '' }
  };
  const sorts = { seismic: 'time', disasters: 'time', orbital: 'time', world: 'time', discovery: 'time' };

  /* ── Rows for each view ─────────────────────────────────────────────── */
  function seismicRows() {
    const f = filters.seismic;
    let rows = Feeds.state.events.filter(e => e.kind === 'EQ' && e.value >= f.min);
    if (f.query) { const q = f.query.toLowerCase(); rows = rows.filter(e => (e.place || '').toLowerCase().includes(q)); }
    return rows.sort(sorts.seismic === 'magnitude' ? (a, b) => b.value - a.value : (a, b) => b.time - a.time);
  }
  function disasterRows() {
    const f = filters.disasters;
    let rows = Feeds.state.events.filter(e => e.kind !== 'EQ');
    if (f.kinds.size) rows = rows.filter(e => f.kinds.has(e.kind));
    if (f.levels.size) rows = rows.filter(e => f.levels.has(e.level));
    if (f.query) { const q = f.query.toLowerCase(); rows = rows.filter(e => `${e.headline} ${e.place}`.toLowerCase().includes(q)); }
    return rows.sort(sorts.disasters === 'severity'
      ? (a, b) => (Feeds.LEVELS[b.level] - Feeds.LEVELS[a.level]) || ((b.value || 0) - (a.value || 0))
      : (a, b) => b.time - a.time);
  }
  function approachRows() {
    const f = filters.orbital;
    let rows = (Feeds.state.orbital.approaches || []).map(a => ({ ...a, id: 'neo:' + a.name + a.time }));
    if (f.query) { const q = f.query.toLowerCase(); rows = rows.filter(a => a.name.toLowerCase().includes(q)); }
    return rows.sort(sorts.orbital === 'distance' ? (a, b) => a.ld - b.ld : (a, b) => a.time - b.time);
  }
  function worldRows() {
    const f = filters.world;
    // Armed conflict has its own page (War); World is everything else.
    let rows = Wire.state.world.filter(e => e.topic !== 'CONFLICT');
    if (f.curatedOnly) rows = rows.filter(e => e.confirmed);
    if (f.query) { const q = f.query.toLowerCase(); rows = rows.filter(e => e.headline.toLowerCase().includes(q)); }
    return rows.sort((a, b) => b.time - a.time);
  }
  function discoveryRows() {
    const f = filters.discovery;
    const seen = new Set();
    let rows = Wire.state.discovery
      .concat(Wire.state.realization.filter(e => e.kind === 'LAUNCH'))
      .filter(e => seen.has(e.id) ? false : seen.add(e.id));
    if (f.kinds.size) rows = rows.filter(e => f.kinds.has(e.kind));
    if (f.query) { const q = f.query.toLowerCase(); rows = rows.filter(e => `${e.headline} ${e.detail}`.toLowerCase().includes(q)); }
    return rows.sort((a, b) => b.time - a.time);
  }
  const rowsFor = view => view === 'seismic' ? seismicRows() : view === 'disasters' ? disasterRows()
    : view === 'orbital' ? approachRows() : view === 'world' ? worldRows()
    : view === 'discovery' ? discoveryRows() : [];

  /* ── Painting the lists ─────────────────────────────────────────────── */
  const levelClass = level => level === 'red' ? 'lvl-red' : level === 'orange' ? 'lvl-orange' : level === 'none' ? 'lvl-none' : 'lvl-green';
  let signatures = {};

  function eventRow(e, isOn) {
    const kind = Feeds.EVENT_KINDS[e.kind] || { label: e.kind, glyph: '·' };
    const value = e.kind === 'EQ' ? 'M ' + e.value.toFixed(1)
      : e.kind === 'TC' && typeof Storms !== 'undefined' ? (Storms.short(e) || '—')
      : Number.isFinite(e.value) ? Math.round(e.value) + (e.unit ? ' ' + e.unit : '') : '—';
    return `<tr data-id="${esc(e.id)}" class="${levelClass(e.level)}${isOn ? ' on' : ''}" tabindex="-1">
      <td class="c-glyph">${kind.glyph}</td>
      <td class="c-value">${esc(value)}</td>
      <td class="c-name">${esc(e.kind === 'EQ' ? e.place : e.headline)}${e.kind === 'EQ' ? '' : `<span>${esc(e.place || kind.label)}</span>`}</td>
      <td class="c-kind">${esc(e.kind === 'EQ' ? (e.detail || '').replace('depth ', '') : kind.label)}</td>
      <td class="c-time">${ago(e.time)}</td>
    </tr>`;
  }
  function approachRow(a, isOn) {
    return `<tr data-id="${esc(a.id)}" class="${a.hazardous ? 'lvl-orange' : 'lvl-green'}${isOn ? ' on' : ''}" tabindex="-1">
      <td class="c-glyph">◦</td>
      <td class="c-value">${a.ld.toFixed(2)} LD</td>
      <td class="c-name">${esc(a.name)}<span>${Math.round(a.diameter)} m across · ${a.kps.toFixed(1)} km/s</span></td>
      <td class="c-kind">${a.hazardous ? 'FLAGGED' : 'ROUTINE'}</td>
      <td class="c-time">${civil(a.time)} ${clock(a.time)}</td>
    </tr>`;
  }

  const GLYPH = { LAUNCH: '\u2191', BUILT: '\u25c6', FOUND: '\u25c7', PREPRINT: '\u00a7', PAPER: '\u00b6', LEV: '\u271a', WORLD: '\u25cf', CONFLICT: '\u2715' };
  const TIER_LABEL = { curated: 'CURATED', reported: 'REPORTED', unconfirmed: 'UNCONFIRMED' };
  const tierOf = e => e.tier || (e.confirmed ? 'curated' : 'unconfirmed');

  function wireRow(e, isOn, view) {
    const tone = e.level === 'red' ? 'lvl-red' : e.level === 'amber' ? 'lvl-orange' : 'lvl-green';
    const left = view === 'world' ? TIER_LABEL[tierOf(e)] : e.kind;
    const glyph = view === 'world' && e.topic === 'CONFLICT' ? GLYPH.CONFLICT : GLYPH[e.kind] || '\u00b7';
    return `<tr data-id="${esc(e.id)}" class="${tone}${isOn ? ' on' : ''}" tabindex="-1">
      <td class="c-glyph">${glyph}</td>
      <td class="c-kind">${esc(left)}</td>
      <td class="c-name">${esc(e.headline)}${e.detail ? `<span>${esc(e.detail)}</span>` : ''}</td>
      <td class="c-kind">${esc(e.place || e.source)}</td>
      <td class="c-time">${when(e)}</td>
    </tr>`;
  }

  /* An empty list says why. "Nothing matches" is only true when there was
     something to match; a source that refused says so, in its own words. */
  function emptyNote(view) {
    if (view === 'orbital' && !(Feeds.state.orbital.approaches || []).length) {
      const h = Feeds.state.sources.approach;
      if (h && h.note) return `NASA's near-Earth service did not answer (${esc(h.note)}). It is asked again on its own schedule.`;
      return 'Waiting for the first reading\u2026';
    }
    return Feeds.state.events.length || (Feeds.state.orbital.approaches || []).length
      ? 'Nothing matches these filters.' : 'Waiting for the first reading\u2026';
  }

  function paintList(view) {
    const body = $(`${view}-rows`);
    if (!body) return;
    const rows = rowsFor(view);
    const on = selected[view];
    const signature = view + '|' + sorts[view] + '|' + on + '|' + rows.map(r => r.id + (r.kind === 'TC' ? ':' + Math.round(r.value || 0) : '')).join(',');
    if (signatures[view] === signature) {
      // Only the ages move; rewrite those in place so nothing scrolls or blinks.
      if (view !== 'orbital') {
        const cells = body.querySelectorAll('.c-time');
        rows.forEach((r, i) => { if (cells[i]) { const v = when(r); if (cells[i].textContent !== v) cells[i].textContent = v; } });
      }
      return;
    }
    signatures[view] = signature;
    body.innerHTML = rows.length
      ? rows.map(r => view === 'orbital' ? approachRow(r, r.id === on)
          : (view === 'world' || view === 'discovery') ? wireRow(r, r.id === on, view)
          : eventRow(r, r.id === on)).join('')
      : `<tr class="empty"><td colspan="5">${emptyNote(view)}</td></tr>`;
    const counter = $(view === 'seismic' ? 'seismic-shown' : `${view}-count`);
    if (counter) counter.textContent = rows.length ? `${rows.length} shown` : '—';
  }

  /* ── The detail pane ────────────────────────────────────────────────── */
  const readTarget = {};          // the item each detail pane shows, for its Read button
  function paintDetail(view) {
    const pane = $(`${view}-detail`);
    if (!pane) return;
    const rows = rowsFor(view);
    const item = rows.find(r => r.id === selected[view]);
    if (!item) { pane.innerHTML = summary(view, rows); return; }

    if (view === 'orbital') {
      const stamp = matrixStamp(item.time);
      pane.innerHTML = `
        <div class="detail-head"><span class="eyebrow">CLOSE APPROACH</span><strong>${esc(item.name)}</strong></div>
        <dl class="detail-list">
          <div><dt>Miss distance</dt><dd>${item.ld.toFixed(3)} lunar distances</dd></div>
          <div><dt>Relative speed</dt><dd>${item.kps.toFixed(2)} km/s</dd></div>
          <div><dt>Estimated size</dt><dd>up to ${Math.round(item.diameter)} m across</dd></div>
          <div><dt>Flagged</dt><dd>${item.hazardous ? 'Yes · potentially hazardous' : 'No'}</dd></div>
          <div><dt>Civil time</dt><dd>${civil(item.time)} ${clock(item.time)}</dd></div>
          <div><dt>Matrix date</dt><dd>${esc(stamp.date)} · ${stamp.time}</dd></div>
          <div><dt>Day regime</dt><dd>${esc(stamp.regime)} · v ${stamp.v.toFixed(6)}×</dd></div>
        </dl>
        <p class="detail-note">Source: NASA near-Earth object service. A lunar distance is the mean Earth–Moon separation, about 384,400 km.</p>`;
      return;
    }

    if (view === 'world' || view === 'discovery') {
      const st = matrixStamp(item.time);
      pane.innerHTML = `
        <div class="detail-head"><span class="eyebrow">${GLYPH[item.kind] || ''} ${esc(item.kind)}</span><strong>${esc(item.headline)}</strong></div>
        ${item.summary || item.detail ? `<p class="detail-note" style="margin-top:14px">${esc(item.summary || item.detail)}${item.summary && item.summary.length >= 900 ? '\u2026' : ''}</p>` : ''}
        <dl class="detail-list">
          <div><dt>Source</dt><dd>${esc(item.place || item.source)}</dd></div>
          ${item.topic === 'CONFLICT' ? '<div><dt>Topic</dt><dd>Armed conflict</dd></div>' : ''}
          ${item.kind === 'LEV' || item.kind === 'PAPER' ? `<div><dt>Peer review</dt><dd>${item.reviewed ? (item.review ? 'Reviewed · a review article, not new results' : 'Reviewed · published research') : 'Not yet · a news report'}</dd></div>` : ''}
          ${item.kind === 'LEV' && item.model ? `<div><dt>Shown in</dt><dd>${esc(item.model)}</dd></div>` : ''}
          ${item.kind === 'LEV' && item.breakthrough ? '<div><dt>Breakthrough</dt><dd class="lvl-orange">Yes · by its own title</dd></div>' : ''}
          ${item.dayOnly
            ? `<div><dt>Civil date</dt><dd>${civilUTC(item.time)} · filed by day, UTC</dd></div>
               <div><dt>Matrix date</dt><dd>${esc(st.date)}</dd></div>`
            : `<div><dt>Civil time</dt><dd>${civil(item.time)} ${clock(item.time)} · ${ago(item.time)}</dd></div>
               <div><dt>Matrix date</dt><dd>${esc(st.date)} · ${st.time}</dd></div>`}
        </dl>
        ${!item.link ? '' : Reader.available()
          ? '<button type="button" class="read-btn" data-read>Read it here</button>'
          // The website has no reader; the button opens the report instead.
          : `<a class="read-btn" href="${esc(item.link)}" target="_blank" rel="noreferrer noopener">Open the report ↗</a>`}`;
      readTarget[view] = item;
      return;
    }

    const kind = Feeds.EVENT_KINDS[item.kind] || { label: item.kind, glyph: '·' };
    const stamp = matrixStamp(item.time);
    const value = item.kind === 'EQ' ? 'Magnitude ' + item.value.toFixed(1)
      : Number.isFinite(item.value) ? `${Math.round(item.value)} ${esc(item.unit || '')}` : '—';
    pane.innerHTML = `
      <div class="detail-head"><span class="eyebrow">${kind.glyph} ${esc(kind.label)}</span><strong>${esc(item.kind === 'EQ' ? value : item.headline)}</strong></div>
      <dl class="detail-list">
        ${item.kind === 'TC' && typeof Storms !== 'undefined' ? Storms.rows(item, esc) : item.kind === 'EQ' ? '' : `<div><dt>Severity</dt><dd>${value}</dd></div>`}
        <div><dt>Where</dt><dd>${esc(item.place || '—')}</dd></div>
        ${item.detail && !(item.kind === 'TC' && typeof Storms !== 'undefined') ? `<div><dt>Reading</dt><dd>${esc(item.detail)}</dd></div>` : ''}
        <div><dt>Alert level</dt><dd class="${levelClass(item.level)}">${esc(item.level === 'none' ? 'NOT RATED' : item.level.toUpperCase())}</dd></div>
        ${item.rating ? `<div><dt>Meaning</dt><dd>${esc(item.rating)}</dd></div>` : ''}
        <div><dt>${item.ongoing ? 'Listed since' : 'Civil time'}</dt><dd>${civil(item.time)} ${clock(item.time)} · ${ago(item.time)}</dd></div>
        <div><dt>Matrix date</dt><dd>${esc(stamp.date)} · ${stamp.time}</dd></div>
        <div><dt>Day regime</dt><dd>${esc(stamp.regime)} · v ${stamp.v.toFixed(6)}×</dd></div>
      </dl>
      <p class="detail-note">${item.source === 'seismic' ? 'Source: United States Geological Survey.'
        : item.id.startsWith('eonet:') && item.kind === 'VO' ? 'Source: Smithsonian Global Volcanism Program, through NASA EONET.'
        : item.kind === 'DR' ? 'Source: GDACS, with the drought rated by the EU Global Drought Observatory.'
        : item.id.startsWith('reliefweb:') ? 'Source: ReliefWeb, the UN Office for the Coordination of Humanitarian Affairs. It lists disasters where people need assistance; it does not rate them green, orange or red.'
        : 'Source: GDACS (United Nations and European Commission), or NASA EONET when GDACS is unreachable. The colour is GDACS’s impact rating — consequence for people, not physical size.'}</p>
      ${!item.link ? '' : item.readable && Reader.available()
        ? '<button type="button" class="read-btn" data-read>Read the report here</button>'
        : `<a class="read-btn" href="${esc(item.link)}" target="_blank" rel="noreferrer noopener">Open the report ↗</a>`}
      ${item.at ? `<button type="button" class="read-btn" data-map="${esc(item.id)}">⌖ Show on the globe</button>` : ''}`;
    readTarget[view] = item;
  }

  /* With nothing selected the pane reads the list as a whole, rather than
     sitting empty and asking to be used. */
  function summary(view, rows) {
    if (!rows.length) return `<p class="detail-empty">Nothing to read yet.</p>`;
    let body = '';
    if (view === 'orbital') {
      const nearest = rows.slice().sort((a, b) => a.ld - b.ld)[0];
      const flagged = rows.filter(r => r.hazardous).length;
      body = `<div><dt>Approaches ahead</dt><dd>${rows.length}</dd></div>
        <div><dt>Nearest</dt><dd>${esc(nearest.name)} · ${nearest.ld.toFixed(2)} LD</dd></div>
        <div><dt>Flagged</dt><dd>${flagged || 'none'}</dd></div>
        <div><dt>Soonest</dt><dd>${civil(rows[0].time)} ${clock(rows[0].time)}</dd></div>`;
    } else if (view === 'seismic') {
      const largest = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0]);
      const strong = rows.filter(r => r.value >= 5).length;
      body = `<div><dt>Events shown</dt><dd>${rows.length}</dd></div>
        <div><dt>Largest</dt><dd>M ${largest.value.toFixed(1)} · ${esc(largest.place)}</dd></div>
        <div><dt>Magnitude 5 and above</dt><dd>${strong || 'none'}</dd></div>
        <div><dt>Most recent</dt><dd>${ago(rows[0].time)}</dd></div>`;
    } else {
      const counts = {};
      for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1;
      const byLevel = l => rows.filter(r => r.level === l).length;
      body = `<div><dt>Events shown</dt><dd>${rows.length}</dd></div>
        ${Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([k, n]) => `<div><dt>${esc((Feeds.EVENT_KINDS[k] || { label: k }).label)}</dt><dd>${n}</dd></div>`).join('')}
        <div><dt>Orange or red</dt><dd>${byLevel('orange') + byLevel('red') || 'none'}</dd></div>`;
    }
    return `<div class="detail-head"><span class="eyebrow">THE LIST</span><strong>Nothing selected</strong></div>
      <dl class="detail-list">${body}</dl>
      <p class="detail-note">Click a row, or move with \u2191 \u2193 and read it here.</p>`;
  }


  /* ── The Vitals page ──────────────────────────────────────────────────
     Three bands: the flows counting from page open, the levels as measured
     with the date they were taken, and the AI readings. A sparkline here is
     the real series, so a level that has gone stale shows it rather than
     being quietly smoothed over. */
  function sparkline(series, opts = {}) {
    if (!series || series.length < 2) return '';
    const w = opts.w || 200, h = opts.h || 34;
    let lo = Math.min(...series), hi = Math.max(...series);
    if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const range = (hi - lo) || 1;
    const y = v => h - (v - lo) / range * h;
    const pts = series.map((v, i) => `${(i / (series.length - 1) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const zeroLine = (opts.zero && lo < 0 && hi > 0)
      ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${w}" y2="${y(0).toFixed(1)}" class="zero"/>` : '';
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${zeroLine}` +
      `<polyline points="${pts}"${opts.colour ? ` style="stroke:${opts.colour}"` : ''}/>` +
      `<circle cx="${w}" cy="${y(series[series.length - 1]).toFixed(1)}" r="2.4"${opts.colour ? ` style="fill:${opts.colour}"` : ''}/></svg>`;
  }

  const staleDays = t => t ? Math.floor((Date.now() - t) / 86400000) : null;

  function levelCard(sign, name, unit, fmtv, note, opts = {}) {
    if (!sign) {
      const h = opts.key ? Vitals.state.sources[opts.key] : null;
      const why = h && h.note ? h.note : 'waiting for the reading';
      return `<div class="lvc"><div class="n">${name}</div><div class="v">—</div>
        <div class="d ${h && h.note ? 'stale' : ''}">${esc(why)}</div></div>`;
    }
    const d = staleDays(sign.time);
    const late = opts.staleAfter && d !== null && d > opts.staleAfter;
    return `<div class="lvc"><div class="n">${name}</div>
      <div class="v">${fmtv(sign.value)}<span class="u">${esc(unit)}</span></div>
      <div class="d">${esc(opts.source || '')}${sign.time ? ' · ' + civilUTC(sign.time) : ''}${
        late ? ` — <span class="stale">${d > 400 ? Math.round(d / 30) + ' months' : d + ' days'} stale</span>` : ''}</div>
      ${sparkline(sign.series, opts)}
      <p class="p">${note}</p></div>`;
  }

  /* Minutes of human expert work, said the way a person would say it. */
  function humanSpan(minutes) {
    if (minutes < 60) return minutes.toFixed(0) + '<span class="bu">min</span>';
    const h = Math.floor(minutes / 60), m = Math.round(minutes - h * 60);
    return h + '<span class="bu">h</span> ' + String(m).padStart(2, '0') + '<span class="bu">min</span>';
  }

  function horizonBlock(H) {
    if (!H) return `<div class="pend"><b>AUTONOMY TIME HORIZON · METR</b><br>${
      esc((Vitals.state.sources.horizon || {}).note || 'Waiting for the reading.')}</div>`;
    const dbl = H.doublingDays ? ` METR's fit since 2023 doubles this about every ${Math.round(H.doublingDays)} days.` : '';
    const p80 = H.p80 ? ` At the stricter 80% bar the same model reaches ${H.p80 < 60 ? H.p80.toFixed(0) + ' minutes' : (H.p80 / 60).toFixed(1) + ' hours'}.` : '';
    return `<div class="section-label" style="margin:16px 0 8px">AUTONOMY TIME HORIZON · METR</div>
      <div class="big">${humanSpan(H.minutes)}</div>
      <div class="d">${esc(H.model)} · ${civilUTC(H.time)}</div>
      ${sparkline(H.series, { w: 320, h: 46 })}
      <p class="p">The longest task a model finishes on its own half the time, in
      minutes of human expert work. Running maximum across ${H.models} models, log
      scale.${dbl}${p80} Model names are METR's own keys.</p>`;
  }

  /* Installed capacity, measured. Chip counts from Epoch's satellite and
     permit work, multiplied by the published per-chip rate — and nothing
     else. No utilisation, no run length, no inferred training run. */
  function installedBlock(I) {
    if (!I) return `<div class="pend"><b>INSTALLED AI COMPUTE</b><br>${
      esc((Vitals.state.sources.installed || {}).note || 'Waiting for the reading.')}</div>`;
    return `<div class="section-label" style="margin:16px 0 8px">INSTALLED AI COMPUTE · WHAT THE TICKER COUNTS</div>
      <div class="big">${(I.perSecond / 1e18).toLocaleString('en-GB', { maximumFractionDigits: 0 })}<span class="bu">EFLOP/s</span></div>
      <div class="d">${(I.totalH100e / 1e6).toFixed(1)} million H100-equivalents across ${I.sites} data centres</div>
      <div class="meta">
        <div><span>LARGEST SITE</span><strong>${esc(I.site)}</strong><em>${
          Math.round(I.h100e).toLocaleString('en-GB')} H100e${I.mw ? ' · ' + Math.round(I.mw) + ' MW' : ''}</em></div>
        <div><span>ITS SHARE</span><strong>${(100 * I.h100e / I.totalH100e).toFixed(1)}%</strong><em>of all tracked chips</em></div>
        <div><span>TRACKED POWER</span><strong>${(I.totalMW / 1000).toFixed(1)} GW</strong><em>across all sites</em></div>
      </div>
      <p class="p">Peak 16-bit throughput of every chip Epoch can find, read from
      satellite imagery and construction permits. No utilisation factor is applied
      and none is implied: this is capacity in the ground, not work done. It is the
      one compute number still being measured — what those chips were used to train
      stopped being published in July 2025.</p>`;
  }

  /* The incident feed is open-ended and the column beside it is not, so the
     list is given the height of that column and scrolls inside it. Measured
     rather than guessed at in viewport units, because the left column's height
     depends on how much the readings have to say. */
  function matchIncidentHeight() {
    const box = $('ai-list-box'), lead = $('ai-lead');
    if (!box || !lead) return;
    requestAnimationFrame(() => {
      const label = box.previousElementSibling;
      const h = lead.getBoundingClientRect().height - (label ? label.offsetHeight + 8 : 0);
      box.style.maxHeight = h > 220 ? Math.round(h) + 'px' : '';
    });
  }
  window.addEventListener('resize', () => { if (current === 'ai') matchIncidentHeight(); });

  function paintVitals() {
    const V = Vitals.state;

    /* One row, not two. Arctic ice and sea level tick on the face, and both
       appear below as measured levels with their dates; repeating them here as
       flows, beside an elapsed-seconds counter, said nothing the page did not
       already say twice. */
    const flows = Vitals.flows();
    // AI compute has moved to the AI page; the planet's own flows stay here.
    const shown = ['co2t', 'heat'].map(k => [k, flows[k]]).filter(([, x]) => x);
    const tickHost = $('vitals-ticks');
    if (tickHost && tickHost.childElementCount !== shown.length) {
      tickHost.innerHTML = shown.map(([k, x]) =>
        `<div class="tk"><div class="n">${esc(x.label)}</div>
           <div class="v"><span id="vt-${k}">0</span><span class="u" id="vt-${k}-u">${esc(x.unit)}</span></div>
           <div class="r">${esc(x.note)}</div></div>`).join('');
    }

    const levels = $('vitals-levels');
    if (levels) levels.innerHTML =
      levelCard(V.co2, 'CO₂ · GLOBAL', 'ppm', v => v.toFixed(2),
        V.co2 && V.co2.growth ? `Six years, weekly. The sawtooth is the northern hemisphere breathing — about 6.3 ppm of it, against a ${V.co2.growth.toFixed(2)} ppm annual rise.` : 'Daily, from the global network.',
        { source: 'NOAA GML', staleAfter: 14, key: 'co2' }) +
      levelCard(V.ch4, 'METHANE · GLOBAL', 'ppb', v => v.toFixed(1),
        'Eight years, monthly. Roughly 80 times the warming effect of CO₂ per tonne over twenty years. NOAA publishes this global series about four months in arrears.',
        { source: 'NOAA GML', staleAfter: 200, key: 'ch4' }) +
      levelCard(V.temp, 'TEMPERATURE ANOMALY', '°C', v => (v >= 0 ? '+' : '') + v.toFixed(2),
        'Forty years of monthly values against the 1951–80 baseline.',
        { source: 'NASA GISTEMP', colour: 'var(--amber)', staleAfter: 90, key: 'temp' }) +
      levelCard(V.ice, 'ARCTIC SEA ICE EXTENT', 'M km²', v => v.toFixed(3),
        V.ice ? `Each trough is a September minimum. The ice is ${V.ice.perDay >= 0 ? 'refreezing' : 'melting'} now at ${Math.abs(V.ice.perDay * 1000).toFixed(1)} thousand km² a day.` : '',
        { source: 'NSIDC', staleAfter: 10, key: 'ice' }) +
      levelCard(V.slr, 'MEAN SEA LEVEL', 'mm', v => v.toFixed(2),
        V.slr ? `Above the 1993 satellite baseline, rising ${V.slr.ratePerYear.toFixed(2)} mm a year over the last decade.` : '',
        { source: 'NOAA STAR', staleAfter: 120, key: 'slr' }) +
      levelCard(V.oni, 'EL NIÑO · ONI', 'index', v => (v >= 0 ? '+' : '') + v.toFixed(2),
        V.oni ? `Twenty years. Above +0.5 is El Niño, below −0.5 La Niña. Currently ${V.oni.phase}. An index, not a flow — so it cannot tick.` : '',
        { source: 'NOAA CPC', colour: 'var(--amber)', zero: true, staleAfter: 120, key: 'oni' });

    const node = $('vitals-sources');
    if (node) node.textContent = sourceLine(Object.entries(Vitals.state.sources).filter(([k]) => !AI_SOURCES.includes(k)).map(([, x]) => x));
  }
  const AI_SOURCES = ['installed', 'horizon'];
  const sourceLine = list => list.map(x => `${x.label} ${x.status === 'live' ? '·' : x.status === 'stale' ? '△' : '×'}`).join('   ');

  /* ── AI page ──────────────────────────────────────────────────────────
     Everything about artificial intelligence the instrument follows, in one
     place: the compute in the ground (Epoch), what it can do on its own
     (METR), what it has done (AI Incident Database and the newsrooms), and
     the containment alerts raised from those reports. A report is flagged
     when it describes a system acting outside its operators' control — the
     same test as the alert (Wire.AI_ESCAPE). */
  const WEEK = 7 * 86400000, MONTH = 30 * 86400000;
  function paintAI() {
    const V = Vitals.state, now = Date.now();
    const lead = $('ai-lead'), rows = $('ai-rows');
    if (lead) lead.innerHTML = installedBlock(V.installed) + horizonBlock(V.horizon);
    matchIncidentHeight();

    const list = Wire.state.incidents || [];
    const escapes = list.filter(e => e.escape && now - e.time < WEEK);
    const month = list.filter(e => now - e.time < MONTH);
    let ruleOn = true;
    try { ruleOn = (JSON.parse(localStorage.getItem('temporal-live:alert-settings:v1') || '{}').ai ?? true) !== false; } catch { /* default on */ }

    const note = $('ai-compute-note'), flows = Vitals.flows();
    if (note) note.textContent = flows.compute && flows.compute.known
      ? `at ${(V.installed.perSecond / 1e18).toLocaleString('en-GB', { maximumFractionDigits: 0 })} EFLOP/s installed · Epoch AI`
      : 'waiting for Epoch AI’s count';
    const watch = $('ai-watch');
    if (watch) {
      watch.classList.toggle('alarm', escapes.length > 0);
      watch.innerHTML = `<div class="n">CONTAINMENT WATCH · LAST 7 DAYS</div>
        <div class="v">${escapes.length ? escapes.length + '<span class="u">' + (escapes.length > 1 ? 'REPORTS' : 'REPORT') + '</span>' : 'CLEAR'}</div>
        <div class="r">${escapes.length ? esc(escapes[0].headline) : 'No report of a system acting outside its operators’ control'}${ruleOn ? '' : ' · alert rule is off'}</div>`;
    }
    const count = $('ai-count');
    if (count) count.innerHTML = `<div class="n">INCIDENTS REPORTED · LAST 30 DAYS</div>
      <div class="v">${list.length ? month.length : '—'}</div>
      <div class="r">${list.length ? `${list.filter(e => now - e.time < WEEK).length} this week · AI Incident Database and the newsrooms` : esc((Wire.state.sources.aiid || {}).note || 'Waiting for the reading…')}</div>`;

    const alerts = $('ai-alerts');
    if (alerts) {
      const log = typeof Alerts !== 'undefined' ? (Alerts.log || []).filter(a => a.rule === 'ai') : [];
      alerts.innerHTML = log.length
        ? log.slice(0, 8).map(a => `<li class="lvl-red"><span>${ago(a.time || a.fired)}</span>${a.link
            ? `<a href="${esc(a.link)}" target="_blank" rel="noreferrer noopener">${esc(a.title)}</a>` : esc(a.title)}</li>`).join('')
        : `<li class="empty">None in the last 30 days.${ruleOn ? '' : ' The AI containment rule is switched off in Settings.'}</li>`;
    }

    if (rows) {
      const wireNote = (Wire.state.sources.aiid || {}).note;
      rows.innerHTML = list.length
        ? list.slice(0, 60).map(e => `<tr class="${e.escape ? 'lvl-red' : 'lvl-orange'}">
            <td class="c-glyph">${e.escape ? '\u2715' : '!'}</td>
            <td class="c-name"><a class="c-link" href="${esc(e.link)}" target="_blank" rel="noreferrer noopener">${esc(e.headline)}</a>${
              e.detail ? `<span>${esc(e.detail)}</span>` : ''}</td>
            <td class="c-kind">${esc(e.place)}</td>
            <td class="c-time">${ago(e.time)}</td></tr>`).join('')
        : `<tr class="empty"><td colspan="4">${esc(wireNote || 'Waiting for the reading\u2026')}</td></tr>`;
    }

    const src = $('ai-sources');
    if (src) src.textContent = sourceLine([V.sources.installed, V.sources.horizon, Wire.state.sources.aiid,
      Wire.state.sources.newsroom && { ...Wire.state.sources.newsroom, label: 'NEWSROOMS' }].filter(Boolean));
  }

  /* The Vitals tickers run on their own frame while that page is open. */
  const VITALS_OPENED = performance.now();
  function vitalsTick() {
    if (current !== 'vitals' && current !== 'ai') return;
    const s = (performance.now() - VITALS_OPENED) / 1000;
    const flows = Vitals.flows();
    for (const [k, x] of Object.entries(flows)) {
      const n = $('vt-' + k), u = $('vt-' + k + '-u');
      const v = Vitals.scaled(x.rate * s, x.unit, x.dp);
      if (n) n.textContent = v.text;
      if (u && u.textContent !== v.unit) u.textContent = v.unit;
    }
    const e = $('vt-elapsed');
    if (e) e.textContent = s < 90 ? s.toFixed(1) : (s / 60).toFixed(2);
  }

  /* ── Solar view ─────────────────────────────────────────────────────── */
  function paintSolar() {
    const s = Feeds.state.space;
    const series = s.kpSeries || [];
    const svg = $('kp-chart');
    if (typeof Sun !== 'undefined') Sun.paint();
    else if (svg && series.length) {
      const w = 900, h = 150, max = 9;
      const step = series.length > 1 ? w / (series.length - 1) : w;
      svg.innerHTML = series.map((row, i) => {
        const bh = Math.max(1, row.kp / max * h);
        const colour = row.kp >= 5 ? 'var(--red)' : row.kp >= 4 ? 'var(--amber)' : 'var(--accent)';
        return `<rect x="${(i * step).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(2, step - 2.5).toFixed(1)}" height="${bh.toFixed(1)}" fill="${colour}" opacity="${i === series.length - 1 ? 1 : 0.62}"><title>Kp ${row.kp.toFixed(2)} · ${civil(row.time)} ${clock(row.time)}</title></rect>`;
      }).join('') + `<line x1="0" y1="${(h - 5 / max * h).toFixed(1)}" x2="${w}" y2="${(h - 5 / max * h).toFixed(1)}" class="kp-threshold"/>`;
      const first = series[0], last = series[series.length - 1];
      $('kp-range').textContent = `${civil(first.time)} → ${civil(last.time)} · three-hour intervals`;
      $('kp-peak').textContent = 'peak ' + Math.max(...series.map(r => r.kp)).toFixed(2);
    }
    const set = (id, value) => { const n = $(id); if (n && n.textContent !== String(value)) n.textContent = value; };
    const r = window.App && window.App.verdict ? window.App.verdict('s-') : null;
    set('s-kp', s.kp === null ? '—' : s.kp.toFixed(2));
    set('s-kp-note', r ? (s.kp === null ? r.kp.plain : `${r.kp.short}. ${r.kp.plain}${s.kpTime ? ' Measured ' + ago(s.kpTime) + '.' : ''}`) : '—');
    set('s-wind', s.wind === null ? '—' : Math.round(s.wind) + ' km/s');
    set('s-wind-note', r ? `${r.wind.short || ''}${r.wind.short ? '. ' : ''}${r.wind.plain}` : '—');
    set('s-xray', s.xray || '—');
    set('s-xray-note', r ? `${r.xray.plain}${s.xrayPeak ? ' Today\u2019s largest was ' + s.xrayPeak + '.' : ''}` : '—');
    set('s-flux', s.flux === null ? '—' : Math.round(s.flux) + ' sfu');
    set('s-flux-note', r ? r.flux.plain : '—');
  }

  /* ── Orbital view: the Moon's cycle, on Matrix time ─────────────────────
     The Moon is computed in sky.js; nothing here is fetched. Every date and
     time on this panel is Matrix time. A cell is one Matrix date — 24 h 20 min
     58.1 s, counted from the March-equinox anchor — laid out on the six-day
     Matrix week, so a lunation of 29.5 civil days is about 29.1 cells. Every
     clock reading is the Matrix clock at your longitude: the dilated solar day,
     12:00 at peak sun. The two are independent readings of the same Matrix,
     so a date can begin at any hour on the clock; that is the design, not a
     slip. Durations are in Matrix dates and Matrix hours, a Matrix second
     being one 86,400th of a date.

     Geocentric things — the phase, the constellation, the moment of full or
     new moon — are the same everywhere. Your place decides only the clock
     those moments read at and whether the Moon is above your horizon. */
  const PHASE_NAME = { new: 'New moon', first: 'First quarter', full: 'Full moon', last: 'Last quarter' };
  const PHASE_GLYPH = { new: '●', first: '◑', full: '○', last: '◐' };
  const M_CAL = Matrix.MS_CAL, M_EPOCH = Matrix.getMatrixEpoch(), M_SEC = M_CAL / 86400;
  const mIdx = ms => Math.floor((ms - M_EPOCH) / M_CAL);
  const mStart = k => M_EPOCH + k * M_CAL;
  const mDate = k => { const c = Matrix.matrixCalendar(k); return `${Matrix.CAL360.days[c.weekday].name} ${c.day} ${Matrix.CAL360.months[c.month]}`; };
  const mDateShort = k => { const c = Matrix.matrixCalendar(k); return { day: c.day, month: Matrix.CAL360.months[c.month], weekday: c.weekday }; };
  const mClock = (ms, secs) => { const t = Matrix.cal360(new Date(ms)); return `${pad(t.h)}:${pad(t.m)}${secs ? ':' + pad(t.s) : ''}`; };
  const mWhen = ms => `${mDate(mIdx(ms))} · ${mClock(ms, true)}`;
  const mSpan = ms => {
    const dates = Math.floor(ms / M_CAL), sec = Math.floor((ms - dates * M_CAL) / M_SEC);
    return `${dates}d ${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`;
  };
  const mDates = ms => (ms / M_CAL).toFixed(1);
  const place = () => ({ lat: Matrix.CAL360.latitude, lon: Matrix.CAL360.longitude });
  const hasPlace = () => Number.isFinite(Matrix.CAL360.latitude);
  const compass = az => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];

  /* The lit part of the disc, drawn the way it is seen from the northern
     hemisphere: the limb on the lit side, closed by the terminator — an
     ellipse whose half-width is |1 − 2k| of the radius, k the lit fraction. */
  function discSVG(k, waxing, r) {
    const rx = Math.abs(1 - 2 * k) * r;
    const sweep = k > 0.5 ? 1 : 0;
    const lit = k < 0.005 ? '' : k > 0.995
      ? `<circle r="${r}" class="moon-lit"/>`
      : `<path class="moon-lit" transform="${waxing ? '' : 'scale(-1,1)'}"
           d="M0 ${-r} A${r} ${r} 0 0 1 0 ${r} A${rx.toFixed(2)} ${r} 0 0 ${sweep} 0 ${-r}Z"/>`;
    return `<circle r="${r}" class="moon-dark"/>${lit}`;
  }
  const phaseLabel = (m, phases, at) => {
    const near = phases.find(p => Math.abs(p.time - at) < M_CAL / 2);
    return near ? PHASE_NAME[near.type]
      : m.elong < 90 ? 'Waxing crescent' : m.elong < 180 ? 'Waxing gibbous'
      : m.elong < 270 ? 'Waning gibbous' : 'Waning crescent';
  };

  let lunShift = 0;              // lunations away from the present one
  let lunSelected = null;        // a Matrix date number, or null for "now"
  let lunKey = null;

  function lunationAt(shift) {
    let L = Sky.lunation(Date.now());
    for (let i = 0; i < Math.abs(shift); i++)
      L = Sky.lunation(shift > 0 ? L.end + 86400000 : L.start - 86400000);
    return L;
  }
  // The phases either side of a moment, from the lunations around it.
  function phasesAround(ms) {
    return Sky.phasesBetween(ms - 32 * 86400000, ms + 32 * 86400000);
  }

  /* ── The countdowns: to the next full and new moon, from now ───────── */
  /* One countdown, to whichever comes first of full moon and new moon. The
     target and its note are worked out once a minute, and again the moment the
     target passes — so at a full moon it turns to the coming new moon by
     itself, with no reload. Each second only the remaining span is rewritten. */
  let countCache = { at: 0, key: null, items: [] };
  function paintCountdowns(now) {
    const key = [Matrix.CAL360.latitude, Matrix.CAL360.longitude].join('|');
    if (now - countCache.at > 60000 || countCache.key !== key || countCache.items.some(i => i.time <= now)) {
      countCache = { at: now, key, items: countTargets(now) };
    }
    for (const it of countCache.items) {
      const box = $(it.id), note = $(it.id + '-note'), label = $('mc-label');
      if (label && label.textContent !== it.label) label.textContent = it.label;
      if (box) box.textContent = mSpan(it.time - now);
      if (note && note.textContent !== it.note) note.textContent = it.note;
    }
  }
  function countTargets(now) {
    const p = Sky.phasesBetween(now, now + 20 * 86400000).find(x => x.type === 'full' || x.type === 'new');
    const items = [];
    if (p) {
      const id = 'mc-next', label = p.type === 'full' ? 'TO FULL MOON' : 'TO NEW MOON';
      let here = 'Set your latitude in Settings to see whether it is up where you are.';
      if (hasPlace()) {
        const { lat, lon } = place(), h = Sky.horizon(p.time, lat, lon);
        if (h.alt > h.h0) here = `Up where you are, ${Math.round(h.altTopo)}° high in the ${compass(h.az)}.`;
        else {
          const rise = Sky.riseSet(p.time, p.time + 1.2 * 86400000, lat, lon).find(e => e.type === 'rise');
          here = `Below your horizon then${rise ? `; it rises ${mWhen(rise.time)}` : ''}.`;
        }
      }
      items.push({ id, label, time: p.time, note: `${mWhen(p.time)} · ${here}` });
    }
    return items;
  }

  /* ── The focus: now, or a selected Matrix date ─────────────────────── */
  function paintFocus(now) {
    const sel = lunSelected;
    const from = sel === null ? now : mStart(sel), to = sel === null ? now : mStart(sel + 1);
    const at = sel === null ? now : (from + to) / 2;          // a date is read at its middle
    const m = Sky.moon(at), sunAt = Sky.sun(at);
    const phases = phasesAround(at);
    const L = Sky.lunation(at);
    const set = (id, v) => { const n = $(id); if (n) n.innerHTML = v; };

    const disc = $('moon-disc');
    if (disc) disc.innerHTML = discSVG(m.illum, m.waxing, 56);
    set('moon-eyebrow', sel === null ? 'THE MOON · NOW' : `THE MOON · ${esc(mDate(sel).toUpperCase())}`);
    set('moon-phase', `${phaseLabel(m, phases, at)} <span>${(m.illum * 100).toFixed(1)}% lit</span>`);

    const crossings = Sky.ingresses(from, sel === null ? now + 4 * 86400000 : to);
    const startIn = sel === null ? m : Sky.moon(from);
    if (sel === null) {
      const next = crossings[0];
      set('moon-in', `in <b>${esc(m.name)}</b>${next ? ` · enters ${esc(next.name)} ${esc(mWhen(next.time))}` : ''}`);
    } else {
      set('moon-in', `<b>${esc(startIn.name)}</b>` + crossings.map(c => ` → <b>${esc(c.name)}</b> ${mClock(c.time)}`).join(''));
    }

    // Where the moment stands between the principal phases.
    const before = phases.filter(p => p.time <= at).pop(), after = phases.find(p => p.time > at);
    const rel = [before && `${mDates(at - before.time)} dates after ${PHASE_NAME[before.type].toLowerCase()}`,
                 after && `${mDates(after.time - at)} before ${PHASE_NAME[after.type].toLowerCase()}`].filter(Boolean).join(' · ');
    const inLun = mDates(at - L.start), lunLen = mDates(L.end - L.start);
    const facts = [];
    facts.push(['Matrix', sel === null ? mWhen(now) : `${mDate(sel)} · opens ${mClock(from)}, closes ${mClock(to)}`]);
    facts.push(['In the lunation', `date ${inLun} of ${lunLen}`]);
    facts.push(['Between phases', rel]);
    if (sel !== null) {
      const ev = L.phases.concat(phases).find(p => p.time >= from && p.time < to);
      if (ev) facts.push(['This date', `${PHASE_NAME[ev.type]} at ${mClock(ev.time, true)}`]);
    }
    if (hasPlace()) {
      const { lat, lon } = place();
      if (sel === null) {
        const h = Sky.horizon(now, lat, lon);
        const next = Sky.riseSet(now, now + 1.5 * 86400000, lat, lon)[0];
        facts.push(['Where you are', `${h.alt > h.h0 ? `up, ${Math.round(h.altTopo)}° high in the ${compass(h.az)}` : 'below the horizon'}`
          + (next ? ` · ${next.type === 'rise' ? 'rises' : 'sets'} ${mWhen(next.time)}` : '')]);
      } else {
        const rs = Sky.riseSet(from, to, lat, lon);
        facts.push(['Where you are', rs.length ? rs.map(e => `${e.type === 'rise' ? 'rises' : 'sets'} ${mClock(e.time)}`).join(' · ')
          : (Sky.horizon(at, lat, lon).alt > 0 ? 'up the whole date' : 'below the horizon the whole date')]);
      }
    } else facts.push(['Where you are', 'set a latitude in Settings for rise, set and altitude']);
    facts.push(['Distance', `${fmt(m.dist)} km · ${m.diameter.toFixed(1)}′ across`]);
    facts.push(['The Sun', `in ${esc(sunAt.name)}`]);
    set('moon-facts', facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(''));
    const back = $('lun-back'); if (back) back.hidden = sel === null;
  }

  /* ── The calendar: one lunation of Matrix dates on the six-day week ── */
  function paintLunation(now) {
    const shown = lunationAt(lunShift);
    const first = mIdx(shown.start), last = mIdx(shown.end), today = mIdx(now);
    const key = [shown.start, today, lunSelected, Matrix.CAL360.longitude].join('|');
    if (lunKey === key) return;
    lunKey = key;

    const title = $('lunation-title');
    if (title) title.textContent = `${lunShift === 0 ? 'THIS LUNATION' : lunShift < 0 ? 'EARLIER LUNATION' : 'LATER LUNATION'} · `
      + `NEW MOON ${mDate(first).toUpperCase()} ${mClock(shown.start)} → ${mDate(last).toUpperCase()} ${mClock(shown.end)}`;

    const moves = Sky.ingresses(mStart(first), mStart(last + 1));
    const cells = Matrix.CAL360.days.map(d => `<div class="lun-dow">${d.name.toUpperCase()}</div>`);
    for (let i = 0; i < mDateShort(first).weekday; i++) cells.push('<div class="lun-day lun-pad"></div>');
    for (let k = first; k <= last; k++) {
      const a = mStart(k), b = mStart(k + 1);
      const mm = Sky.moon((a + b) / 2), dawnSky = Sky.moon(a);
      const phase = shown.phases.find(p => p.time >= a && p.time < b);
      const enter = moves.filter(v => v.time >= a && v.time < b);
      const d = mDateShort(k);
      const label = d.day === 1 || k === first ? `${d.day} ${d.month.slice(0, 3)}` : String(d.day);
      cells.push(`<button type="button" class="lun-day${k === today ? ' today' : ''}${phase ? ' principal' : ''}${k === lunSelected ? ' selected' : ''}" data-k="${k}" aria-pressed="${k === lunSelected}">
        <div class="lun-top"><span class="lun-date">${label}</span>
          <svg viewBox="-12 -12 24 24" class="lun-disc">${discSVG(mm.illum, mm.waxing, 10)}</svg></div>
        <div class="lun-con">${esc(dawnSky.name)}</div>
        ${phase ? `<div class="lun-event">${PHASE_GLYPH[phase.type]} ${PHASE_NAME[phase.type]} ${mClock(phase.time)}</div>` : ''}
        ${enter.map(v => `<div class="lun-move">→ ${esc(v.name)} ${mClock(v.time)}</div>`).join('')}
      </button>`);
    }
    const grid = $('lunation-grid');
    if (grid) grid.innerHTML = cells.join('');
  }

  function paintMoon() {
    const now = Date.now();
    paintCountdowns(now);
    paintFocus(now);
    paintLunation(now);
  }

  /* The header's moon: the phase as it is now, redrawn each minute. */
  function paintMoonIcon() {
    const icon = $('moon-icon');
    if (!icon) return;
    const m = Sky.moon(Date.now());
    icon.innerHTML = discSVG(m.illum, m.waxing, 6.5);
    const b = $('moon-button');
    if (b) b.title = `The Moon · ${Math.round(m.illum * 100)}% lit (M)`;
  }

  /* ── Kessler watch ──────────────────────────────────────────────────
     Population, pressure and breakups, from kessler.js. Times are Matrix
     time like the rest of the panel; a pass's countdown is in Matrix dates
     and hours. */
  const fmtN = n => Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
  const oneIn = p => p >= 0.5 ? '1 in 2' : '1 in ' + fmtN(Math.round(1 / p));
  function paintKessler(now) {
    const k = typeof Kessler !== "undefined" && Kessler.state;
    if (!k || !$('kw-stats')) return;
    const set = (id, v) => { const n = $(id); if (n) n.innerHTML = v; };
    const st = k.status;
    // How old each reading is, so "live" can be checked rather than taken on
    // trust: the age of the data itself where CelesTrak states it, and when it
    // will be read again.
    const age = ms => { const h = (now - ms) / 3600000; return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' d'; };
    const next = key => k.fresh[key] ? Math.max(0, Math.round((k.fresh[key] + Kessler.EVERY[key] - now) / 3600000)) : null;
    const line = (key, label, dataAt) => {
      if (st[key] === 'app only') return `${label} — app only`;
      if (st[key] === 'waiting' && !k.fresh[key]) return `${label} …`;
      const lamp = st[key] === 'live' ? '●' : '○';
      const parts = [dataAt ? `data ${age(dataAt)} old` : '', k.fresh[key] ? `read ${age(k.fresh[key])} ago` : '',
                     st[key] === 'live' && next(key) !== null ? (next(key) < 1 ? 'next within the hour' : `next in ${next(key)} h`) : esc(k.note[key] || st[key])].filter(Boolean);
      return `${label} ${lamp} ${parts.join(', ')}`;
    };
    set('kw-status', [line('conj', 'passes', k.summary && (k.summary.asOf || k.summary.published)),
                      line('box', 'population', k.box && k.box.asOf),
                      line('satcat', 'breakups', null)].join(' · '));

    const b = k.box;
    if (b) {
      const dead = b.payloads - b.active, parts = [['active', b.active, 'Active satellites'], ['dead', dead, 'Dead satellites'], ['debris', b.debris, 'Debris and rocket bodies']];
      $('kw-bar').innerHTML = parts.map(([cls, n]) => `<i class="kw-${cls}" style="flex:${n}"></i>`).join('');
      $('kw-legend').innerHTML = parts.map(([cls, n, label]) => `<span><i class="kw-${cls}"></i>${label} <b>${fmtN(n)}</b> · ${Math.round(100 * n / b.all)}%</span>`).join('');
    }
    const c = k.counts, sm = k.summary;
    $('kw-stats').innerHTML = `
      <div><dt>Tracked in orbit</dt><dd>${b ? fmtN(b.all) : '—'}</dd></div>
      <div><dt>Passes within 5 km, this run</dt><dd>${sm ? fmtN(sm.conjunctions) : '—'}</dd></div>
      <div><dt>High-speed, 1 in 1,000 or worse</dt><dd>${c ? (c.complete === false ? 'at least ' : '') + fmtN(c.fast) : '—'}</dd></div>
      <div><dt>…of them against debris or dead objects</dt><dd>${c ? fmtN(c.againstDebris) : '—'}</dd></div>`;

    const window7 = sm && sm.from && sm.to ? ` · ${mDate(mIdx(sm.from))} → ${mDate(mIdx(sm.to))}` : '';
    set('kw-passes-title', 'HIGH-SPEED PASSES AHEAD' + window7.toUpperCase());
    const ahead = (k.conj || []).filter(x => x.tca > now).sort((a, b) => b.p - a.p).slice(0, 8);
    $('kw-passes').innerHTML = ahead.length ? ahead.map(x => {
      const against = !Kessler.CAN_MOVE.has(x.s2), stuck = !Kessler.CAN_MOVE.has(x.s1);
      const tone = stuck && against && x.p >= Kessler.P_ALERT_STUCK ? 'lvl-red' : against && x.p >= Kessler.P_ALERT ? 'lvl-orange' : '';
      return `<li class="${tone}"><strong>${esc(x.name1)} <em>[${esc(x.s1 || '·')}]</em> × ${esc(x.name2)} <em>[${esc(x.s2 || '·')}]</em></strong>
        <span>${oneIn(x.p)} · ${x.rangeKm < 1 ? Math.round(x.rangeKm * 1000) + ' m' : x.rangeKm.toFixed(2) + ' km'} · ${x.speed.toFixed(1)} km/s${against ? ' · the other object cannot move' : ''}</span>
        <small>${esc(mWhen(x.tca))} · in ${mSpan(x.tca - now)}</small></li>`;
    }).join('') : `<li class="kw-empty">${st.conj === 'waiting' ? 'Reading SOCRATES…' : 'No pass at 1 km/s or more and 1 in 1,000 in this run.'}</li>`;

    const f = k.frag;
    $('kw-breakups').innerHTML = f.events.length ? f.events.map(e => `<li class="lvl-red"><strong>${esc(e.parent)}</strong>
        <span>${e.pieces} new debris pieces · launch ${esc(e.launch)}${Number.isFinite(e.launched) ? ' (' + new Date(e.launched).getUTCFullYear() + ')' : ''}</span><small>${e.firstLook ? 'among the newest 1,500 catalogue entries at the first reading, ' : ''}detected ${esc(mWhen(e.detected))}</small></li>`).join('')
      : `<li class="kw-empty">${st.satcat === 'app only' ? 'Watched in the desktop app, which reads the whole catalogue.'
        : !f.since ? 'Reading the catalogue…'
        : `None since ${esc(mWhen(f.since))}. Rule: ${Kessler.FRAG_PIECES}+ new pieces from one object older than 30 days.`}</li>`;
  }

  function stepLunation(by) {
    lunShift = Math.max(-12, Math.min(12, lunShift + by));
    lunSelected = null; lunKey = null;
    paintMoon();
  }
  function selectDate(k) {
    lunSelected = lunSelected === k ? null : k;
    lunKey = null;
    paintMoon();
  }
  // The countdowns move every second; the rest is repainted each minute.
  let moonMinute = 0;
  let iconMinute = 0;
  setInterval(() => {
    const now = Date.now();
    if (now - iconMinute > 60000) { iconMinute = now; paintMoonIcon(); }
    if (current !== 'moon') return;
    if (now - moonMinute > 60000) { moonMinute = now; paintMoon(); } else paintCountdowns(now);
  }, 1000);

  /* ── Switching ──────────────────────────────────────────────────────── */
  let lastView = 'field';           // where the moon button returns to
  function setView(view) {
    if (!VIEWS.includes(view)) return;
    current = view;
    for (const v of VIEWS) {
      const panel = $('view-' + v);
      if (panel) panel.hidden = v !== view;
      const tab = document.querySelector(`.tab[data-view="${v}"]`);
      if (tab) { tab.classList.toggle('on', v === view); tab.setAttribute('aria-selected', v === view); }
    }
    document.body.classList.toggle('in-field', view === 'field');
    const moonButton = $('moon-button');
    if (moonButton) moonButton.classList.toggle('on', view === 'moon');
    if (view !== 'moon') lastView = view;
    signatures = {};
    paint();
    if (typeof DisasterMap !== 'undefined' && DisasterMap.shown) DisasterMap.shown(view);
    if (typeof Sun !== 'undefined') Sun.shown(view);
    if (typeof Shell !== 'undefined') Shell.onView(view);
    const list = $(`${view}-rows`);
    if (list && list.parentElement) list.parentElement.parentElement.scrollTop = 0;
    if (window.App && window.App.fit) window.App.fit();
  }

  /* Keyboard: the number keys move between views, the arrows move the
     selection inside one, Enter opens it and Escape clears it. */
  function move(step) {
    const rows = rowsFor(current);
    if (!rows.length) return;
    const at = rows.findIndex(r => r.id === selected[current]);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + step))];
    if (!next) return;
    selected[current] = next.id;
    paint();
    const node = document.querySelector(`#${current}-rows tr[data-id="${CSS.escape(next.id)}"]`);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function paint() {
    if (current === 'seismic' || current === 'disasters' || current === 'orbital') { paintList(current); paintDetail(current); }
    if (current === 'orbital') paintKessler(Date.now());
    if (current === 'moon') paintMoon();
    if (current === 'matrix' && window.App && window.App.tick) window.App.tick();
    if (current === 'solar') paintSolar();
    if (current === 'vitals') paintVitals();
    if (current === 'ai') paintAI();
    if (current === 'ai' && typeof Energy !== 'undefined') Energy.paintDc();
    if (current === 'world' || current === 'discovery') { paintList(current); paintDetail(current); }
    if (current === 'discovery') paintLevLatest();
    if (current === 'energy' && typeof Energy !== 'undefined') Energy.paint();
    if (current === 'energy' && typeof Watch !== 'undefined') Watch.paint();
    if (current === 'society' && typeof Society !== 'undefined') Society.paint();
    if (current === 'war' && typeof War !== 'undefined') War.paint();
    if (current === 'economy' && typeof Economy !== 'undefined') Economy.paint();
    const badge = (id, n) => { const node = $(id); if (node) node.textContent = n || ''; };
    const quakes = Feeds.state.events.filter(e => e.kind === 'EQ').length;
    const hazards = Feeds.state.events.filter(e => e.kind !== 'EQ').length;
    badge('tab-count-seismic', quakes); badge('tab-count-disasters', hazards);
    const hint = (view, label) => { const n = document.querySelector(`.corner[data-view="${view}"]`); if (n && n.title !== label) n.title = label; };
    hint('seismic', `Seismic · ${quakes} quakes (2)`); hint('disasters', `Disasters · ${hazards} active (3)`);
    badge('tab-count-world', Wire.state.world.filter(e => e.topic !== 'CONFLICT').length);
    badge('tab-count-ai', (Wire.state.incidents || []).length);
    // The AI tab carries a red mark while a containment report is under a week old.
    const aiTab = document.querySelector('.tab[data-view="ai"]');
    if (aiTab) aiTab.classList.toggle('alarm', (Wire.state.incidents || []).some(e => e.escape && Date.now() - e.time < WEEK));
    badge('tab-count-discovery', Wire.state.discovery.length);
    if (typeof Energy !== 'undefined') {
      const down = Energy.state.refineries.filter(r => r.inc && Energy.levelOf(r.status) === 'red').length;
      badge('tab-count-energy', down);
      const tab = document.querySelector('.tab[data-view="energy"]');
      const home = typeof Watch !== 'undefined' && Watch.homeIso(), hl = home && Watch.state.level.get(home);
      if (tab) tab.classList.toggle('alarm', Energy.state.refineries.some(r => r.fresh) || !!(hl && hl.level === 'crisis'));
    }
  }

  /* The line across the top of Discovery: the newest LEV breakthrough (wire.js
     says how it is chosen). Clicking it opens it in the list. */
  let levLatestId = null;
  function paintLevLatest() {
    const node = $('lev-latest');
    if (!node || typeof Wire.levLatest !== 'function') return;
    const e = Wire.levLatest();
    node.hidden = !e;
    if (!e || e.id === levLatestId) return;
    levLatestId = e.id;
    $('lev-latest-title').textContent = e.headline;
    $('lev-latest-meta').textContent = [e.place, e.model ? 'shown in ' + e.model : '', dayLabel(e.time)].filter(Boolean).join(' · ');
  }

  function init() {
    const lev = $('lev-latest');
    if (lev) lev.addEventListener('click', () => {
      if (!levLatestId) return;
      const f = filters.discovery;
      if (f.kinds.size && !f.kinds.has('LEV')) { f.kinds.clear(); document.querySelectorAll('[data-dkind]').forEach(c => c.classList.remove('on')); }
      f.query = ''; const q = $('discovery-query'); if (q) q.value = '';
      selected.discovery = levLatestId; signatures.discovery = null; paint();
      const row = document.querySelector(`#discovery-rows tr[data-id="${CSS.escape(levLatestId)}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    });

    for (const tab of document.querySelectorAll('.tab, .corner')) tab.addEventListener('click', () => setView(tab.dataset.view));
    const toggleMoon = () => setView(current === 'moon' ? lastView : 'moon');
    const moonButton = $('moon-button');
    if (moonButton) moonButton.addEventListener('click', toggleMoon);
    paintMoonIcon();

    // The reader (desktop app only): a button in the detail pane, or a
    // double-click on the row, opens the article as text inside the app.
    Reader.init();
    for (const view of ['world', 'discovery', 'disasters', 'seismic']) {
      const pane = $(`${view}-detail`);
      if (pane) pane.addEventListener('click', e => {
        if (e.target.closest('[data-read]')) Reader.open(readTarget[view]);
        const m = e.target.closest('[data-map]');
        if (m) DisasterMap.open(m.dataset.map);
      });
      if (view === 'disasters' || view === 'seismic') continue;
      const rows = $(`${view}-rows`);
      if (rows) rows.addEventListener('dblclick', e => {
        const row = e.target.closest('tr[data-id]');
        const item = row && rowsFor(view).find(r => r.id === row.dataset.id);
        if (item && item.link && Reader.available()) Reader.open(item);
      });
    }
    const incidents = $('ai-rows');
    if (incidents) incidents.addEventListener('click', e => {
      const a = e.target.closest('a.c-link');
      if (!a || !Reader.available()) return;
      const item = Wire.state.incidents.find(x => x.link === a.getAttribute('href'));
      if (item) { e.preventDefault(); Reader.open(item); }
    });

    for (const view of ['seismic', 'disasters', 'orbital', 'world', 'discovery']) {
      const body = $(`${view}-rows`);
      if (!body) continue;
      body.addEventListener('click', e => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        selected[view] = selected[view] === row.dataset.id ? null : row.dataset.id;
        paint();
      });
      const head = $(`${view}-head`);
      if (head) head.addEventListener('click', e => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        sorts[view] = th.dataset.sort;
        for (const other of head.querySelectorAll('th[data-sort]')) other.classList.toggle('sorted', other === th);
        signatures[view] = null; paint();
      });
    }

    $('seismic-min').addEventListener('change', e => { filters.seismic.min = Number(e.target.value); signatures.seismic = null; paint(); });
    for (const [id, view, key] of [['seismic-query', 'seismic', 'query'], ['disasters-query', 'disasters', 'query'], ['orbital-query', 'orbital', 'query'], ['world-query', 'world', 'query'], ['discovery-query', 'discovery', 'query']]) {
      const input = $(id);
      if (input) input.addEventListener('input', e => { filters[view][key] = e.target.value.trim(); signatures[view] = null; paint(); });
    }
    for (const chip of document.querySelectorAll('.chip')) chip.addEventListener('click', () => {
      if (chip.dataset.topic) {                         // World: armed conflict only
        filters.world.conflictOnly = !filters.world.conflictOnly;
        chip.classList.toggle('on', filters.world.conflictOnly);
        signatures.world = null; paint(); return;
      }
      if (chip.dataset.confirm) {                       // World: curated only
        filters.world.curatedOnly = !filters.world.curatedOnly;
        chip.classList.toggle('on', filters.world.curatedOnly);
        signatures.world = null; paint(); return;
      }
      if (chip.dataset.dkind) {                          // Discovery: by kind
        const set = filters.discovery.kinds, v = chip.dataset.dkind;
        if (set.has(v)) set.delete(v); else set.add(v);
        chip.classList.toggle('on', set.has(v));
        signatures.discovery = null; paint(); return;
      }
      const set = chip.dataset.kind ? filters.disasters.kinds : filters.disasters.levels;
      const value = chip.dataset.kind || chip.dataset.level;
      if (set.has(value)) set.delete(value); else set.add(value);
      chip.classList.toggle('on', set.has(value));
      signatures.disasters = null; paint();
    });

    document.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]') || Reader.isOpen()) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!typing && e.key >= '1' && e.key <= '9') { setView(VIEWS[Number(e.key) - 1]); e.preventDefault(); return; }
      if (!typing && (e.key === 'm' || e.key === 'M')) { toggleMoon(); e.preventDefault(); return; }
      if (!typing && (e.key === 'e' || e.key === 'E')) { setView('energy'); e.preventDefault(); return; }
      if (!typing && (e.key === 'x' || e.key === 'X')) { setView('matrix'); e.preventDefault(); return; }
      if (!typing && (e.key === 's' || e.key === 'S')) { setView('society'); e.preventDefault(); return; }
      if (!typing && (e.key === 'r' || e.key === 'R')) { setView('war'); e.preventDefault(); return; }
      if (!typing && (e.key === 'c' || e.key === 'C')) { setView('economy'); e.preventDefault(); return; }
      if (!typing && (e.key === 'd' || e.key === 'D')) { setView('discovery'); e.preventDefault(); return; }
      // The globe page keeps its own keys (globe.js).
      if (DisasterMap.isOpen()) return;
      if (typing && e.key !== 'Escape') return;
      if (e.key === 'ArrowDown' || e.key === 'j') { move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { move(-1); e.preventDefault(); }
      else if (e.key === 'Escape') { if (selected[current]) { selected[current] = null; paint(); } document.activeElement.blur(); }
      else if (e.key === '/') { const input = $(`${current}-query`); if (input) { input.focus(); e.preventDefault(); } }
    });

    const prev = $('lun-prev'), next = $('lun-next');
    if (prev) prev.addEventListener('click', () => stepLunation(-1));
    if (next) next.addEventListener('click', () => stepLunation(1));
    const grid = $('lunation-grid');
    if (grid) grid.addEventListener('click', e => {
      const cell = e.target.closest('.lun-day[data-k]');
      if (cell) selectDate(Number(cell.dataset.k));
    });
    const back = $('lun-back');
    if (back) back.addEventListener('click', () => { lunSelected = null; lunKey = null; paintMoon(); });

    Feeds.onUpdate(paint);
    Vitals.onUpdate(paint);
    Wire.onUpdate(paint);
    Kessler.onUpdate(() => { if (current === 'orbital') paintKessler(Date.now()); });
    setInterval(paint, 2000);
    (function vitalsFrame(){ if (!document.hidden && (current === 'vitals' || current === 'ai')) vitalsTick(); requestAnimationFrame(vitalsFrame); })();
    setView('field');
  }

  return { init, setView, get current() { return current; }, VIEWS };
})();

// This file loads after the face, so everything it needs is already standing.
Views.init();
Alerts.init();
DisasterMap.init();
for (const b of document.querySelectorAll('.map-open')) b.addEventListener('click', () => DisasterMap.open());
