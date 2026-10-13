'use strict';
/* ── Theme ───────────────────────────────────────────────────────────────
   Light or dark, or follow Windows. Loaded in the head, before the
   stylesheet paints, so the window never shows the wrong one first. The
   choice is kept on this computer; in the desktop app it is also handed to
   the main process, so the Windows title bar matches.                   */
const Theme = (() => {
  const KEY = 'temporal-live:theme';
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  let pref = 'system';
  try { pref = localStorage.getItem(KEY) || 'system'; } catch { /* default */ }
  if (!/^(system|light|dark)$/.test(pref)) pref = 'system';
  const resolved = () => pref === 'system' ? (mql.matches ? 'dark' : 'light') : pref;
  function apply() {
    const t = resolved();
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  }
  function tell() { if (window.desktop && window.desktop.theme) window.desktop.theme(pref); }
  function set(p) {
    if (!/^(system|light|dark)$/.test(p)) return;
    pref = p;
    try { localStorage.setItem(KEY, p); } catch { /* refused */ }
    tell(); apply();
  }
  mql.addEventListener('change', () => { if (pref === 'system') apply(); });
  apply(); tell();
  return { get pref() { return pref; }, get current() { return resolved(); }, set,
           toggle: () => set(resolved() === 'dark' ? 'light' : 'dark') };
})();
