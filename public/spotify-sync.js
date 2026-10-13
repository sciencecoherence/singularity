'use strict';
/* ── Music: the playlist, kept to the clock ────────────────────────────────
   Three readings the instrument already makes decide what the music does.

   · The dilation wave sets the volume. The wave's lowest point is the quiet
     of the day's burn, its highest the crest of repayment; the volume runs
     between two limits you choose, so the day's own shape is audible.
   · An alert ducks the music for long enough to hear it, then lets it return.
   · The countdown's phase picks the playlist. Before launch is the approach;
     from launch until τ* the process is retained; after τ* it is absorbed.
     Each phase may have its own playlist, or share the main one.

   Sign-in and every Spotify request happen in the main process (spotify.js).
   This file only asks it, and never sees a token. It does nothing in a plain
   browser, where there is no desktop bridge.

   The playlist everyone starts with is DEFAULT_PLAYLIST below. Anyone can also
   press the music button in the header to play it in Spotify's own embedded
   player, with no account connected and, in the website build, no bridge at
   all; the embed is the one part of this file that runs in a plain browser.

   It does not fight you. It starts a playlist when you switch sync on and when
   the phase changes, and otherwise leaves what is playing alone. If you turn
   the volume yourself, the wave steps aside for ten minutes. */
const Music = (() => {
  const $ = id => document.getElementById(id);
  const api = window.desktop && window.desktop.spotify;
  const KEY = 'matrix-spotify';
  // The playlist this instrument is meant to be heard with. It must stay public on
  // Spotify for other people's accounts, and the embedded player, to play it.
  const DEFAULT_PLAYLIST = 'spotify:playlist:77r1XuoChH2IhO1jnBTuUV';
  const DEFAULTS = { sync: false, playlist: DEFAULT_PLAYLIST, phases: { approach: '', retention: '', absorbed: '' }, volMin: 30, volMax: 80, duck: true };
  const PHASES = ['approach', 'retention', 'absorbed'];
  const PHASE_LABEL = { approach: 'APPROACH', retention: 'RETENTION', absorbed: 'ABSORBED' };
  const DUCK = { red: { level: 12, holdMs: 90000 }, orange: { level: 25, holdMs: 30000 } };
  const POLL_MS = 5000, VOLUME_GAP_MS = 15000, MANUAL_PAUSE_MS = 10 * 60000;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function read() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY)) || {};
      const merged = { ...DEFAULTS, ...s, phases: { ...DEFAULTS.phases, ...(s.phases || {}) } };
      if (!merged.playlist) merged.playlist = DEFAULT_PLAYLIST;   // a cleared choice means the default
      return merged;
    } catch { return { ...DEFAULTS, phases: { ...DEFAULTS.phases } }; }
  }
  function write() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* refused */ } }
  let prefs = read();

  /* ── The signals ── */
  // The wave's own range, found by walking one day of it.
  let vLo = Infinity, vHi = -Infinity;
  for (let i = 0; i < 2880; i++) { const v = Matrix.velocityM(i / 2880); if (v < vLo) vLo = v; if (v > vHi) vHi = v; }
  const intensity = v => vHi > vLo ? Math.min(1, Math.max(0, (v - vLo) / (vHi - vLo))) : 0.5;
  const LAUNCH = Matrix.getMatrixEpoch();
  const ABSORPTION = LAUNCH + Matrix.TAU_STAR * Matrix.MS_CAL;
  const phaseAt = ms => ms < LAUNCH ? 'approach' : ms < ABSORPTION ? 'retention' : 'absorbed';
  function waveAt(ms) { const t = Matrix.cal360(new Date(ms)); return { v: t.v, k: intensity(t.v) }; }
  function targetVolume(ms) {
    const lo = Math.min(prefs.volMin, prefs.volMax), hi = Math.max(prefs.volMin, prefs.volMax);
    return Math.round(lo + waveAt(ms).k * (hi - lo));
  }
  const wanted = phase => prefs.phases[phase] || prefs.playlist;

  /* ── State ── */
  let connected = false, now = null, pollAt = 0, busy = false, notice = '';
  let lastSetVol = null, lastSetAt = 0, manualUntil = 0, duckUntil = 0, backoffUntil = 0;
  let volumeBlockedOn = null, lastPhase = null, wasSync = prefs.sync, playlists = [];

  function fail(r) {
    if (!r || !r.error) return false;
    if (r.signedOut) { connected = false; now = null; notice = 'Spotify access ended. Connect again.'; }
    else if (r.status === 429) backoffUntil = Date.now() + (r.retryAfter || 10) * 1000;
    else if (r.status === 403 && /premium/i.test(r.error + (r.reason || ''))) notice = 'Playback control needs Spotify Premium.';
    else notice = r.error;
    return true;
  }

  /* ── The loop ── */
  async function step() {
    if (!api || busy || !connected) return;
    const t = Date.now();
    if (t < backoffUntil) return;
    busy = true;
    try {
      const s = await api.state();
      if (fail(s)) { paintAll(); return; }
      now = s; pollAt = Date.now();
      notice = now.device && volumeBlockedOn === now.device.id ? 'This device does not let Spotify change its volume.' : '';
      await conduct(Date.now());
      paintAll();
    } catch { /* the next beat tries again */ }
    finally { busy = false; }
  }

  async function conduct(t) {
    const phase = phaseAt(t);
    if (!prefs.sync) { lastPhase = phase; wasSync = false; return; }
    // The phase turning over switches the playlist, once.
    if (lastPhase !== null && lastPhase !== phase) await startWanted(phase, true);
    lastPhase = phase; wasSync = true;
    if (!now || !now.active || !now.playing) return;

    // The volume: the wave, unless a duck is holding it down or you moved it yourself.
    if (now.device && now.device.id && volumeBlockedOn === now.device.id) return;
    if (!now.device || !now.device.canVolume || now.volume == null) return;
    if (t < duckUntil) return;
    if (lastSetVol != null && Math.abs(now.volume - lastSetVol) >= 6 && t - lastSetAt > 6000) { manualUntil = t + MANUAL_PAUSE_MS; lastSetVol = null; }
    if (t < manualUntil) return;
    const target = targetVolume(t);
    if (Math.abs(now.volume - target) < 3 || t - lastSetAt < VOLUME_GAP_MS) return;
    const r = await api.volume(target);
    if (r.error) {
      if (r.reason === 'VOLUME_CONTROL_DISALLOW') { volumeBlockedOn = now.device.id; notice = 'This device does not let Spotify change its volume.'; }
      else fail(r);
      return;
    }
    lastSetVol = target; lastSetAt = t; now.volume = target;
  }

  async function startWanted(phase, onlyIfDifferent) {
    const uri = wanted(phase);
    if (!uri) { notice = 'Choose a playlist in Settings.'; return; }
    if (onlyIfDifferent && now && now.playing && now.context && now.context.uri === uri) return;
    const r = await api.play(uri);
    if (fail(r)) return;
    notice = ''; lastSetVol = null; manualUntil = 0;
    setTimeout(step, 1500);
  }

  // An alert was raised. Duck the music so it can be heard, and hold it there.
  function duck(level) {
    if (!api || !connected || !prefs.sync || !prefs.duck) return;
    if (!now || !now.playing || !now.device || !now.device.canVolume) return;
    if (volumeBlockedOn && now.device.id === volumeBlockedOn) return;
    const d = DUCK[level] || DUCK.orange, t = Date.now();
    duckUntil = Math.max(duckUntil, t + d.holdMs);
    if (now.volume != null && now.volume <= d.level) return;
    api.volume(d.level).then(r => { if (!fail(r)) { lastSetVol = d.level; lastSetAt = Date.now(); if (now) now.volume = d.level; paintAll(); } });
  }
  window.addEventListener('matrix:alert-fired', e => duck(e.detail && e.detail.level));

  /* ── The card beside the countdown ── */
  function paintCard() {
    const card = $('card-music');
    if (!card) return;
    const show = !!api && connected;
    card.hidden = !show;
    const row = $('countdowns'); if (row) row.classList.toggle('has-music', show);
    if (!show) return;
    const t = Date.now(), w = waveAt(t), phase = phaseAt(t);
    const text = (id, v) => { const n = $(id); if (n && n.textContent !== String(v)) n.textContent = v; };
    const ducked = t < duckUntil;
    text('music-top', prefs.sync ? 'MUSIC · KEPT TO THE CLOCK' : 'MUSIC · NOT SYNCED');
    text('music-state', !now ? '…' : !now.active ? 'IDLE' : ducked ? 'DUCKED' : now.playing ? 'PLAYING' : 'PAUSED');
    text('music-track', now && now.track ? now.track.name : now && now.active === false ? 'Nothing playing' : '—');
    text('music-sub', notice || (now && now.track ? now.track.artists : (now && now.active === false ? 'Open Spotify, or press Start in Settings.' : '')));
    const vol = now && now.volume != null ? `VOL ${now.volume}` : 'VOL —';
    text('music-meta', `${vol}${prefs.sync ? ' → ' + targetVolume(t) : ''} · WAVE ${Math.round(w.k * 100)}% · ${PHASE_LABEL[phase]}`);
    paintBar();
  }
  function paintBar() {
    const bar = $('music-bar');
    if (!bar || !now || !now.track || !now.track.durationMs) { if (bar) bar.style.width = '0%'; return; }
    const at = now.progressMs + (now.playing ? Date.now() - pollAt : 0);
    bar.style.width = `${Math.min(100, Math.max(0, at / now.track.durationMs * 100))}%`;
    const track = bar.parentElement; if (track) track.setAttribute('aria-valuenow', String(Math.round(at / now.track.durationMs * 100)));
  }

  /* ── Settings ── */
  function options(selected, blank) {
    const known = playlists.some(p => p.uri === selected);
    // The default is always on offer, even when it is not in this person's library.
    const shown = playlists.some(p => p.uri === DEFAULT_PLAYLIST) ? playlists : [{ uri: DEFAULT_PLAYLIST, name: 'Temporal Live default', total: null }, ...playlists];
    return `<option value="">${esc(blank)}</option>` +
      (selected && !known && selected !== DEFAULT_PLAYLIST ? `<option value="${esc(selected)}" selected>(saved playlist)</option>` : '') +
      shown.map(p => `<option value="${esc(p.uri)}"${p.uri === selected ? ' selected' : ''}>${esc(p.name)}${p.total != null ? ` · ${p.total}` : ''}</option>`).join('');
  }
  function paintSettings() {
    const f = $('music-settings');
    if (!f) return;
    f.hidden = !api;
    if (!api) return;
    $('music-status').textContent = notice && !connected ? notice : connected ? (notice || 'Connected to Spotify.') : 'Not connected.';
    $('music-connect').textContent = connected ? 'Disconnect' : 'Connect Spotify';
    $('music-sync').checked = prefs.sync; $('music-sync').disabled = !connected;
    $('music-start').disabled = !connected;
    $('music-playlist').innerHTML = options(prefs.playlist, 'The default playlist');
    for (const p of PHASES) $(`music-phase-${p}`).innerHTML = options(prefs.phases[p], 'Same as the main playlist');
    $('music-playlist').disabled = !connected;
    for (const p of PHASES) $(`music-phase-${p}`).disabled = !connected;
    $('music-vol-min').value = prefs.volMin; $('music-vol-max').value = prefs.volMax;
    $('music-duck').checked = prefs.duck;
  }
  function paintAll() {
    paintCard(); paintSettings(); paintMusicButton(); paintDockNote();
    const dock = $('music-dock');
    if (dock && !dock.hidden && dockMode !== remoteMode()) setDock(true);
    paintRemote();
  }

  async function loadPlaylists() {
    const r = await api.playlists();
    if (fail(r)) { paintAll(); return; }
    playlists = r.playlists || [];
    // First time through, offer the one the instrument was built for.
    if (!prefs.playlist) {
      const hit = playlists.find(p => /end of (the )?world|apocalyp|doomsday|armageddon/i.test(p.name));
      if (hit) { prefs.playlist = hit.uri; write(); notice = `Picked “${hit.name}”. Change it below if that is not the one.`; }
    }
    paintAll();
  }

  function save() {
    const num = (id, fallback) => { const n = Math.round(Number($(id).value)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback; };
    prefs.playlist = $('music-playlist').value || DEFAULT_PLAYLIST;
    for (const p of PHASES) prefs.phases[p] = $(`music-phase-${p}`).value;
    prefs.volMin = num('music-vol-min', DEFAULTS.volMin); prefs.volMax = num('music-vol-max', DEFAULTS.volMax);
    prefs.duck = $('music-duck').checked;
    write(); paintCard();
  }

  /* ── The embedded player: no account, no bridge ──
     Spotify's own player in a frame, docked at the corner. It plays whatever the
     phase would have playing, so it answers to the same choice as the sync does.
     Hiding it leaves it playing; the frame is only made the first time it opens
     and again if the playlist it should show has changed. */
  const EMBED = /^spotify:(playlist|album|artist):([A-Za-z0-9]{22})$/;
  let dockKey = '';
  function embedFor(uri) {
    const m = EMBED.exec(uri || '') || EMBED.exec(DEFAULT_PLAYLIST);
    return { key: m[0], src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`, page: `https://open.spotify.com/${m[1]}/${m[2]}` };
  }
  /* The dock has two faces. Connected, it is a remote for the account that is
     connected: it drives whichever Spotify that account is playing on. Not
     connected, it is the embedded player, which needs no account. */
  const remoteMode = () => !!api && connected;
  let dockMode = null;
  function applyDockMode() {
    const remote = remoteMode();
    const hide = (id, hidden) => { const n = $(id); if (n) n.hidden = hidden; };
    hide('music-remote', !remote); hide('music-dock-frame', remote); hide('music-dock-foot', remote);
    const title = $('music-dock-title'); if (title) title.textContent = remote ? 'YOUR SPOTIFY · CONNECTED' : 'THE PLAYLIST · NO SIGN-IN NEEDED';
    $('music-dock').classList.toggle('remote', remote);
    dockMode = remote;
  }
  function setDock(open) {
    const dock = $('music-dock'), btn = $('music-button');
    if (!dock) return;
    if (open && !remoteMode()) {
      const e = embedFor(wanted(phaseAt(Date.now())));
      if (e.key !== dockKey) {
        const host = $('music-dock-frame'), frame = document.createElement('iframe');
        host.textContent = '';
        frame.src = e.src; frame.title = 'Spotify player'; frame.width = '100%'; frame.height = '352'; frame.loading = 'lazy';
        frame.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
        host.appendChild(frame); dockKey = e.key;
        $('music-dock-open').href = e.page;
      }
    }
    dock.hidden = !open;
    if (btn) { btn.classList.toggle('on', open); btn.setAttribute('aria-expanded', String(open)); }
    applyDockMode(); paintDockNote();
    if (open && remoteMode()) { paintRemote(); step(); }
  }
  /* What the player can honestly promise depends on where it is. The app has its
     own browser session and no DRM module, so its player gives previews however
     you are signed in; full tracks come from connecting Spotify, which makes the
     Spotify you already run do the playing. A browser signed in to Spotify gets
     full tracks from the embed itself. */
  function paintDockNote() {
    const note = $('music-dock-note'), btn = $('music-dock-connect');
    if (!note) return;
    note.textContent = api ? 'Previews only in this app.' : 'Signed in to Spotify in this browser? It plays full tracks.';
    if (btn) btn.hidden = !api || connected;
  }
  // The header button: the player, or, once Spotify is connected, the controls.
  function paintMusicButton() {
    const btn = $('music-button');
    if (!btn) return;
    const controls = !!api && connected;
    const label = controls ? 'Music controls' : 'Play the playlist';
    btn.title = label; btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-controls', 'music-dock');
  }
  function openMusicSettings() {
    setDock(false);
    const open = $('settings-button'); if (open) open.click();
    setTimeout(() => { const f = $('music-settings'); if (f) f.scrollIntoView({ block: 'start' }); }, 60);
  }
  /* ── The remote ── */
  const mmss = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  let volDrag = false, volTimer = 0;
  function paintRemote() {
    const dock = $('music-dock');
    if (!remoteMode() || !dock || dock.hidden) return;
    const text = (id, v) => { const n = $(id); if (n && n.textContent !== String(v)) n.textContent = v; };
    const t = Date.now(), live = !!(now && now.active);
    text('remote-track', live && now.track ? now.track.name : now && !now.active ? 'Nothing playing' : '—');
    text('remote-artist', notice || (live && now.track ? now.track.artists : 'Press play and Spotify will wake a device.'));
    const dur = live && now.track ? now.track.durationMs : 0;
    const pos = live ? Math.min(dur || Infinity, now.progressMs + (now.playing ? t - pollAt : 0)) : 0;
    text('remote-pos', mmss(pos)); text('remote-dur', mmss(dur));
    $('remote-fill').style.width = dur ? `${Math.min(100, pos / dur * 100)}%` : '0%';
    const playing = !!(live && now.playing), play = $('remote-play');
    play.classList.toggle('playing', playing); play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const vol = $('remote-volume'), can = !!(live && now.device && now.device.canVolume && now.volume != null);
    vol.disabled = !can;
    if (!volDrag && document.activeElement !== vol) { if (can) vol.value = now.volume; text('remote-volval', can ? `${now.volume}%` : '—'); }
    $('remote-sync').checked = prefs.sync;
    text('remote-device', live && now.device ? `${now.device.name}${now.device.type ? ' · ' + now.device.type : ''}${t < duckUntil ? ' · ducked' : ''}` : 'No active device');
  }
  async function remoteDo(call) {
    if (!remoteMode()) return;
    const r = await call();
    if (fail(r)) { paintAll(); return; }
    notice = ''; setTimeout(step, 700);
  }
  function initRemote() {
    if (!api || !$('music-remote')) return;
    $('remote-play').addEventListener('click', async () => {
      if (now && now.playing) {
        await remoteDo(() => api.pause());
        if (now) { now.progressMs += Date.now() - pollAt; pollAt = Date.now(); now.playing = false; }
      } else if (now && now.active && now.track) {
        await remoteDo(() => api.resume());
        if (now) { pollAt = Date.now(); now.playing = true; }
      } else await startWanted(phaseAt(Date.now()), false);
      paintRemote();
    });
    $('remote-prev').addEventListener('click', () => remoteDo(() => api.previous()));
    $('remote-next').addEventListener('click', () => remoteDo(() => api.next()));
    // Moving the volume yourself is a decision: the wave steps aside, as in step().
    const vol = $('remote-volume');
    vol.addEventListener('input', () => {
      volDrag = true; $('remote-volval').textContent = `${vol.value}%`;
      clearTimeout(volTimer);
      volTimer = setTimeout(async () => {
        const v = Number(vol.value), r = await api.volume(v);
        if (!fail(r)) { lastSetVol = null; lastSetAt = Date.now(); manualUntil = Date.now() + MANUAL_PAUSE_MS; if (now) now.volume = v; }
        volDrag = false; paintRemote();
      }, 250);
    });
    $('remote-sync').addEventListener('change', () => setSync($('remote-sync').checked));
    $('remote-start').addEventListener('click', async () => { await startWanted(phaseAt(Date.now()), false); paintRemote(); });
    $('remote-settings').addEventListener('click', openMusicSettings);
  }
  async function setSync(on) {
    prefs.sync = on; write();
    if (on && !wasSync) { wasSync = true; lastPhase = phaseAt(Date.now()); await startWanted(lastPhase, true); }
    else if (!on) wasSync = false;
    paintAll();
  }

  function initDock() {
    const btn = $('music-button');
    if (!btn) return;
    btn.addEventListener('click', () => setDock($('music-dock').hidden));
    $('music-dock-close').addEventListener('click', () => setDock(false));
    const connect = $('music-dock-connect'); if (connect) connect.addEventListener('click', openMusicSettings);
    paintMusicButton(); paintDockNote();
    initRemote();
  }

  // Settings → "Your own Spotify app". Empty means the app's own registration.
  function paintClient(st) {
    const input = $('music-client');
    if (!input || !st) return;
    input.value = st.isDefault ? '' : st.clientId;
    $('music-client-status').textContent = st.isDefault ? 'Using the app\u2019s own Spotify registration.' : 'Using your own Spotify registration.';
  }

  async function init() {
    initDock();
    if (!api) { paintSettings(); return; }
    const st = await api.status().catch(() => null);
    connected = !!(st && st.connected);
    paintClient(st);
    paintSettings(); paintMusicButton(); paintDockNote();
    $('music-client-save').addEventListener('click', async () => {
      const status = $('music-client-status');
      const r = await api.setClient($('music-client').value.trim());
      if (r && r.error) { status.textContent = r.error; return; }
      const now2 = await api.status().catch(() => null);
      connected = !!(now2 && now2.connected);
      if (!connected) { now = null; playlists = []; }
      notice = ''; paintClient(r); paintAll();
      status.textContent += connected ? '' : ' Connect Spotify to sign in with it.';
    });
    $('music-connect').addEventListener('click', async () => {
      if (connected) { await api.disconnect(); connected = false; now = null; playlists = []; notice = ''; paintAll(); return; }
      $('music-status').textContent = 'Waiting for Spotify in your browser…'; $('music-connect').disabled = true;
      const r = await api.connect();
      $('music-connect').disabled = false;
      if (r && r.ok) { connected = true; notice = ''; await loadPlaylists(); step(); } else { notice = (r && r.error) || 'Not connected.'; paintAll(); }
    });
    $('music-sync').addEventListener('change', () => setSync($('music-sync').checked));
    $('music-start').addEventListener('click', async () => { await startWanted(phaseAt(Date.now()), false); paintAll(); });
    $('music-refresh').addEventListener('click', loadPlaylists);
    for (const id of ['music-playlist', 'music-phase-approach', 'music-phase-retention', 'music-phase-absorbed', 'music-vol-min', 'music-vol-max', 'music-duck'])
      $(id).addEventListener('change', save);
    if (connected) { await loadPlaylists(); step(); }
    setInterval(step, POLL_MS);
    setInterval(() => { if (connected) { paintCard(); paintRemote(); } }, 1000);
  }
  init();
  return { duck, step, get prefs() { return prefs; } };
})();
