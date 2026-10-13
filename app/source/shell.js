'use strict';
/* ── The window around the pages ─────────────────────────────────────────
   The top bar's page title, the sidebar (collapsible), the theme switch,
   the status bar at the foot, and the small buttons that jump between
   pages. The pages themselves are views.js; this only frames them.        */
const Shell = (() => {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const TITLES = { field: 'Overview', globe: 'Globe', seismic: 'Seismic', disasters: 'Hazards', solar: 'Solar', orbital: 'Orbital',
                   vitals: 'Vitals', ai: 'AI', world: 'World', discovery: 'Discovery', moon: 'Moon', energy: 'Energy', matrix: 'Matrix', society: 'Society', war: 'War', economy: 'Economy' };
  const GROUP = { field: 'Operations', globe: 'Operations', seismic: 'Operations', disasters: 'Operations', solar: 'Operations', orbital: 'Operations',
                  vitals: 'Intelligence', ai: 'Intelligence', world: 'Intelligence', discovery: 'Intelligence', moon: 'Time', energy: 'Operations', matrix: 'Time', society: 'Intelligence', war: 'Intelligence', economy: 'Intelligence' };
  const NAV_KEY = 'temporal-live:nav-collapsed';

  function onView(view) {
    const t = $('page-title'), root = document.querySelector('.crumb-root');
    if (t) t.textContent = TITLES[view] || view;
    if (root) root.textContent = GROUP[view] || '';
    document.body.dataset.view = view;
    document.title = `${TITLES[view] || view} · Singularity Monitor`;
  }

  // Buttons that jump to another page.
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g && typeof Views !== 'undefined') Views.setView(g.dataset.goto);
  });

  // The sidebar folds to its icons.
  const app = $('app');
  let collapsed = false;
  try { collapsed = localStorage.getItem(NAV_KEY) === '1'; } catch { /* default open */ }
  const applyNav = () => {
    app.classList.toggle('collapsed', collapsed);
    const b = $('nav-collapse');
    if (b) { b.title = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'; b.querySelector('span').textContent = collapsed ? 'Expand' : 'Collapse'; }
    window.dispatchEvent(new Event('resize'));
  };
  if ($('nav-collapse')) $('nav-collapse').addEventListener('click', () => {
    collapsed = !collapsed;
    try { localStorage.setItem(NAV_KEY, collapsed ? '1' : '0'); } catch { /* refused */ }
    applyNav();
  });
  applyNav();

  // The theme: the button flips light and dark; Settings also offers System.
  const select = $('theme-select');
  const syncSelect = () => { if (select) select.value = Theme.pref; };
  if ($('theme-button')) $('theme-button').addEventListener('click', () => { Theme.toggle(); syncSelect(); });
  if (select) select.addEventListener('change', () => Theme.set(select.value));
  if ($('settings-button')) $('settings-button').addEventListener('click', syncSelect);
  document.addEventListener('keydown', e => {
    if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
      Theme.toggle(); syncSelect(); e.preventDefault();
    }
  });

  // The status bar: civil time, where the count stands, how many sources answer.
  function statusbar() {
    const now = new Date();
    const set = (id, v) => { const n = $(id); if (n && n.textContent !== v) n.textContent = v; };
    set('sb-utc', `UTC ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`);
    set('sb-local', `LOCAL ${pad(now.getHours())}:${pad(now.getMinutes())}`);
    const t = Matrix.cal360(now);
    set('sb-matrix', `MATRIX ${pad(t.h)}:${pad(t.m)}:${pad(t.s)} · ${Matrix.CAL360.days[t.weekday].name} ${t.day} ${Matrix.CAL360.months[t.month]}`.toUpperCase());
    if (t.pending) set('sb-tau', `PROTOCOL LAUNCH IN ${Math.ceil(t.toLaunchMs / 86400000)} D · τ 0`);
    else set('sb-tau', `τ ${t.tau.toFixed(4)} · q ${Number.isFinite(t.q) ? t.q.toFixed(3) : '—'}`);
    const groups = [Feeds.state.sources, Wire.state.sources, Vitals.state.sources, typeof Energy !== 'undefined' ? Energy.state.sources : {}, typeof Sun !== 'undefined' ? Sun.state.sources : {}, typeof Watch !== 'undefined' ? Watch.state.sources : {}, typeof Society !== 'undefined' ? Society.state.sources : {}, typeof War !== 'undefined' ? War.state.sources : {}, typeof Economy !== 'undefined' ? Economy.state.sources : {}];
    let live = 0, total = 0;
    for (const g of groups) for (const s of Object.values(g || {})) { total++; if (s.status === 'live') live++; }
    set('sb-sources', `${live}/${total} SOURCES LIVE`);
    // The Overview globe's caption.
    const placed = (Feeds.state.events || []).filter(e => Array.isArray(e.at) && (e.kind !== 'EQ' || e.value >= 4.5));
    const red = placed.filter(e => e.level === 'red').length, orange = placed.filter(e => e.level === 'orange').length;
    set('ov-globe-sum', `${placed.length} placed · ${red} red · ${orange} orange`);
  }
  // The version, from package.json through the main process.
  const ver = $('sb-version');
  const webVer = document.querySelector('meta[name="sm-version"]');
  if (ver && window.desktop && window.desktop.version) ver.textContent = `SINGULARITY MONITOR ${window.desktop.version}`;
  else if (ver && webVer) ver.textContent = `SINGULARITY MONITOR ${webVer.content}`;
  statusbar(); setInterval(statusbar, 1000);

  if (typeof Views !== 'undefined') onView(Views.current);
  return { onView };
})();
