'use strict';
/* ── The plain reading ─────────────────────────────────────────────────────
   The field conditions are real instrument readings, and an instrument should
   show them. But a number is not an answer. Kp 1.67 does not tell you whether
   anything is happening; B2.8 does not tell you whether the sun is throwing
   something at us. So this layer sits between the readings and the face and
   says, in ordinary words, what they amount to.

   Two rules hold it honest. It never invents a reading it does not have — a
   missing source says so rather than defaulting to calm. And it does not
   dramatise: a geomagnetic storm is a real thing that happens several times a
   year, mostly noticed by aurora watchers and satellite operators, and saying
   so plainly is more useful than either alarm or dismissal.

   Thresholds come from NOAA's own G-scale for geomagnetic storms and R-scale
   for radio blackouts, which is what the numbers are graded against anywhere
   else they are published.                                                   */

const Reading = (() => {

  /* 0 calm · 1 stirring · 2 active · 3 storm · 4 severe · 5 extreme.
     NOAA's G-scale stops at G5, but G5 covers everything from a storm that
     puts aurora over Rome for a night to a Carrington-class event that takes
     transformers with it. The top of one scale is not the top of the physics,
     so the reading carries a sixth state for the far tail: Kp already pinned
     at 9, and a flare or a wind speed to match. */
  const WORDS = ['calm', 'stirring', 'active', 'storm', 'severe', 'extreme'];

  /* ── Planetary K index · how hard the Earth's magnetic field is shaking ── */
  function kp(value) {
    if (value === null || value === undefined) return { level: null, plain: 'Waiting for the first reading from NOAA.' };
    if (value < 3) return { level: 0, short: 'Calm', plain: 'The Earth’s magnetic field is barely moving.' };
    if (value < 4) return { level: 1, short: 'Unsettled', plain: 'A light push from the solar wind. Nothing you would notice.' };
    if (value < 5) return { level: 1, short: 'Active', plain: 'The field is being nudged. Aurora watchers near the poles get interested here.' };
    if (value < 6) return { level: 2, short: 'Minor storm', plain: 'A minor geomagnetic storm, NOAA level G1. Happens most months.' };
    if (value < 7) return { level: 3, short: 'Moderate storm', plain: 'A moderate storm, G2. The field is being pushed hard.' };
    if (value < 8) return { level: 3, short: 'Strong storm', plain: 'A strong storm, G3. Satellite operators are watching this one.' };
    if (value < 9) return { level: 4, short: 'Severe storm', plain: 'A severe storm, G4. Rare — a handful of days per solar cycle.' };
    return { level: 5, short: 'Extreme storm', plain: 'An extreme storm, G5. The top of NOAA’s scale, and the scale has no room above it.' };
  }

  /* ── Solar wind · how fast the sun's outflow is arriving ───────────────── */
  function wind(value) {
    if (value === null || value === undefined) return { level: null, plain: 'Waiting for the first reading from the L1 spacecraft.' };
    if (value < 350) return { level: 0, short: 'Slow', plain: 'A light breeze from the sun. Typical is 300 to 500 km/s.' };
    if (value < 500) return { level: 0, short: 'Ordinary', plain: 'An ordinary breeze from the sun. Typical is 300 to 500 km/s.' };
    if (value < 650) return { level: 1, short: 'Fast', plain: 'A high-speed stream is arriving. This is what stirs the magnetic field.' };
    if (value < 800) return { level: 2, short: 'Very fast', plain: 'Very fast. Streams like this usually bring a geomagnetic storm within a day.' };
    if (value < 1500) return { level: 3, short: 'Extreme', plain: 'Extreme. This is blast-wave territory — something large left the sun.' };
    return { level: 4, short: 'Off the ordinary scale', plain: 'Faster than almost anything on record. A coronal mass ejection at this speed crosses from the sun to us in well under a day instead of the usual three.' };
  }

  /* ── X-ray class · what the sun is doing right now ─────────────────────
     The letter is a power of ten: each step is ten times the last. A and B
     are the background hum; X is the loud end.                              */
  function xray(cls) {
    if (!cls) return { level: null, plain: 'Waiting for the first reading from the GOES satellite.' };
    const letter = String(cls)[0].toUpperCase();
    if (letter === 'A' || letter === 'B') return { level: 0, short: 'Quiet', plain: 'The sun is quiet. No flares worth noticing.' };
    if (letter === 'C') return { level: 1, short: 'Small flares', plain: 'Small flares. Nothing of this size reaches the ground.' };
    if (letter === 'M') return { level: 2, short: 'Medium flare', plain: 'A medium flare. Shortwave radio fades briefly on the sunlit side of Earth.' };
    if (letter === 'X') {
      const size = parseFloat(String(cls).slice(1)) || 1;
      if (size >= 10) return { level: 5, short: 'Extreme flare', plain: 'An extreme flare, X' + size + '. Radio blackouts across the whole sunlit side of the planet, and a serious radiation storm behind it.' };
      return { level: 4, short: 'Large flare', plain: 'A large flare. Radio blackouts on the sunlit side, and a radiation storm can follow.' };
    }
    return { level: 0, short: 'Quiet', plain: 'The sun is quiet.' };
  }

  /* ── F10.7 · the background loudness of the 11-year cycle ─────────────── */
  function flux(value) {
    if (value === null || value === undefined) return { level: null, plain: 'Waiting for the daily measurement.' };
    if (value < 90)  return { level: 0, short: 'Very low', plain: 'The sun is near the quiet end of its eleven-year cycle.' };
    if (value < 120) return { level: 0, short: 'Low', plain: 'A quiet stretch of the eleven-year solar cycle.' };
    if (value < 170) return { level: 1, short: 'Moderate', plain: 'The cycle is picking up. More flares than in a quiet year.' };
    if (value < 250) return { level: 2, short: 'High', plain: 'An active stretch of the cycle. Flares are common.' };
    return { level: 3, short: 'Very high', plain: 'Near the loud end of the cycle. The upper atmosphere is puffed up and warm.' };
  }

  /* ── Satellite drag ────────────────────────────────────────────────────
     The honest version of "are the satellites going to fall down". A storm
     heats the upper atmosphere, which swells, which means a satellite in a
     low orbit ploughs through thicker air and loses height faster. It is a
     real effect and operators plan around it. What it is not is satellites
     dropping out of the sky: the one famous loss, in February 2022, was a
     batch that had been released into an unusually low orbit and had not yet
     climbed out of it. Anything at a settled altitude just sinks a little
     faster and gets pushed back up later.                                   */
  function drag(kpValue, fluxValue) {
    const k = kpValue ?? 0, f = fluxValue ?? 0;
    if (kpValue === null && fluxValue === null) return { level: null, short: 'Unknown', plain: 'Waiting for the readings this depends on.' };
    if (k >= 9) return { level: 5, short: 'Severe drag', plain: 'The upper atmosphere has swollen enormously. Low satellites are losing height fast, tracking of the whole catalogue goes uncertain for days, and some spacecraft in the lowest orbits will not be recoverable. This is the scenario operators plan for and hope not to see.' };
    if (k >= 7 || f >= 250) return { level: 3, short: 'High', plain: 'The upper atmosphere is swollen and warm. Low satellites are losing height noticeably faster than usual and operators will be re-boosting. Newly launched ones, still low, are the ones that matter.' };
    if (k >= 5 || f >= 170) return { level: 2, short: 'Raised', plain: 'The upper atmosphere has puffed up a little, so satellites in low orbit feel more friction than usual. They sink slightly faster and get pushed back up later. Nothing falls out of the sky from this.' };
    if (k >= 4 || f >= 120) return { level: 1, short: 'Slightly raised', plain: 'A touch more friction than usual in low orbit. Operators would not change anything.' };
    return { level: 0, short: 'Normal', plain: 'Satellites in low orbit are sinking at their usual slow rate, the same as any quiet day.' };
  }

  /* ── Aurora and radio, the two things people actually ask about ───────── */
  function aurora(kpValue) {
    if (kpValue === null || kpValue === undefined) return { level: null, short: 'Unknown', plain: 'Waiting for the reading.' };
    if (kpValue < 3) return { level: 0, short: 'Not tonight', plain: 'Only the far north and far south, and only faintly.' };
    if (kpValue < 5) return { level: 1, short: 'Near the poles', plain: 'Worth looking if you are at high latitude — Iceland, northern Scandinavia, Alaska, Tasmania.' };
    if (kpValue < 6) return { level: 2, short: 'Further south than usual', plain: 'Reaching into northern Britain, the northern United States and southern New Zealand.' };
    if (kpValue < 8) return { level: 3, short: 'Well away from the poles', plain: 'Possible across much of Britain, the northern half of the United States, and southern Australia.' };
    if (kpValue < 9) return { level: 4, short: 'Mid-latitudes', plain: 'Can reach as far as southern Europe and the southern United States. Go outside and look.' };
    return { level: 5, short: 'Almost anywhere', plain: 'At this level aurora has been seen from the tropics. In 1859 it was seen from Cuba, Hawaii and Colombia. Go outside and look, whatever your latitude.' };
  }
  function radio(kpValue, xrayLevel) {
    const level = Math.max(kp(kpValue).level ?? 0, xrayLevel ?? 0);
    if (kpValue === null && xrayLevel === null) return { level: null, short: 'Unknown', plain: 'Waiting for the readings.' };
    if (level <= 0) return { level: 0, short: 'Normal', plain: 'Shortwave radio and GPS are behaving exactly as usual.' };
    if (level === 1) return { level: 1, short: 'Normal', plain: 'No practical effect. Perhaps a little fading on polar radio routes.' };
    if (level === 2) return { level: 2, short: 'Brief fades', plain: 'Shortwave radio fades near the poles and on the sunlit side. Your phone and car GPS are unaffected.' };
    if (level === 3) return { level: 3, short: 'Fading and drift', plain: 'Shortwave is unreliable at high latitudes and precision GPS can drift by a few metres. Ordinary navigation still works.' };
    if (level === 4) return { level: 4, short: 'Degraded', plain: 'Radio blackouts on the sunlit side and real GPS error. Aviation and surveying feel this; everyday use mostly does not.' };
    return { level: 5, short: 'Out', plain: 'Shortwave is gone for hours to days, satellite navigation is unusable for precision work and unreliable for everything else, and aircraft on polar routes are being diverted.' };
  }

  /* ── The one-line answer ───────────────────────────────────────────────
     What someone actually wants on walking past the screen: is anything
     happening, and does it matter.                                          */
  const HEADLINES = [
    { state: 'All quiet',        plain: 'The sun is calm and the Earth’s magnetic field is undisturbed. Nothing up there is affecting anything down here.' },
    { state: 'Stirring',         plain: 'A little solar wind is stirring the Earth’s magnetic field. Aurora watchers near the poles may get something. Everything else is ordinary.' },
    { state: 'Active',           plain: 'A minor geomagnetic storm is under way. Aurora is reaching further from the poles than usual and polar radio fades. Nothing on the ground is at risk.' },
    { state: 'Geomagnetic storm',plain: 'The Earth’s magnetic field is being pushed around hard. Aurora may be visible well away from the poles, precision GPS drifts, and satellite operators are paying attention. Power grids are being watched, not failing.' },
    { state: 'Severe storm',     plain: 'A severe geomagnetic storm. Aurora can reach mid-latitudes, radio and GPS are degraded, low satellites feel real extra drag, and grid operators are actively managing voltage. This is rare — go and look at the sky.' },
    { state: 'Extreme storm',    plain: 'The top of the scale, and the kind of event that gets a name when it happens. Aurora far into the tropics. Shortwave radio out and satellite navigation unreliable for days. Currents induced in long conductors — power lines, pipelines, undersea cables — strong enough to damage grid transformers, which take months to replace. The last one this size, in 1859, set telegraph offices on fire; there was no grid to lose. Go and look at the sky, and expect the lights to be uncertain.' }
  ];

  function verdict(space) {
    const parts = {
      kp: kp(space.kp), wind: wind(space.wind), xray: xray(space.xray), flux: flux(space.flux)
    };
    parts.drag = drag(space.kp, space.flux);
    parts.aurora = aurora(space.kp);
    parts.radio = radio(space.kp, parts.xray.level);

    const known = [parts.kp.level, parts.wind.level, parts.xray.level].filter(v => v !== null && v !== undefined);
    if (!known.length) {
      return { ...parts, level: null, state: 'Reading the field', plain: 'The space-weather streams have not answered yet. The clock and the rest of the field are unaffected.', word: 'waiting' };
    }
    // The magnetic field and the flares lead. Background flux and wind speed
    // shade the answer but never set it on their own: a fast wind with a quiet
    // field has not done anything yet.
    const level = Math.max(parts.kp.level ?? 0, parts.xray.level ?? 0,
                           Math.min(parts.wind.level ?? 0, 2));
    return { ...parts, level, state: HEADLINES[level].state, plain: HEADLINES[level].plain, word: WORDS[level] };
  }

  /* Level to the three colours the instrument already uses. */
  const tone = level => level === null || level === undefined ? '' : level >= 3 ? 'lit-red' : level >= 2 ? 'lit-amber' : '';

  return { verdict, kp, wind, xray, flux, drag, aurora, radio, tone, WORDS };
})();
