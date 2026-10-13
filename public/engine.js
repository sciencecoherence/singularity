'use strict';
// Extracted from Science Coherence app.js on 2026-09-13.
// One equinox anchor; signed calendar placement, retained process from launch.
const Matrix = (() => {
  const CAL360 = {
    // Shared app/website launch: USNO March equinox prediction, minute resolution.
    // https://aa.usno.navy.mil/calculated/seasons?year=2027&tz=0&tz_sign=1&tz_label=true&dst=false&submit=Get+Data
    epochLive: Date.parse('2027-03-20T20:25:00Z'),
    tropical: 365.2421896698,          // frozen reference year Y
    months: ['March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February'],
    days: [
      { name: 'Differa', short: 'Dif', accent: 'teal' },
      { name: 'Selecta', short: 'Sel', accent: 'amber' },
      { name: 'Realis', short: 'Rea', accent: 'blue' },
      { name: 'Integra', short: 'Int', accent: 'violet' },
      { name: 'Resona', short: 'Res', accent: 'rose' },
      { name: 'Stilla', short: 'Sti', accent: 'green' }
    ],
    // Degrees east. Defaults to the observer's own timezone meridian, so that
    // 12:00:00 is peak sun for the timezone. Set a true longitude for local noon.
    longitude: null
  };



  /* ── Foundational constants ────────────────────────────────────────────────
     Hoisted above their first use. The full model, its semantics and its
     derivations are in THE MATRIX block below. */
  const YEAR_REF = 365.2421896698;
  const J0n = 8736982783n, Qn = 600000000000n;
  const J0  = Number(J0n),  Q  = Number(Qn);
  const FRACTION_DIRECT = J0 / Q;          // 0.014561637971666…
  const FRACTION_12FOLD = 12 * J0 / Q;     // 0.17473965566

  const MS_DAY  = 86400000;
  const MS_CAL  = YEAR_REF * MS_DAY / 360; // 87,658,125.520752 ms
  const LEAD_MS = MS_CAL - MS_DAY;         //  1,258,125.520752 ms = 20m 58.125520752s

  /* ── The velocity field ──────────────────────────────────────────────────
     v(φ) is physical seconds consumed per living second at position φ through
     the day. Three regimes, joined where v = 1 so the seams are invisible:

       00:00–04:00  v = 1 − b·sin⁴(6πφ)          the clock races
       04:00–12:00  v = 1 + a·sin²(3π(φ − 1/6))  the clock repays
       12:00–24:00  v = 1                         the clock runs true

     b is set to the daily surplus, so by 04:00 the clock leads solar time by
     exactly 20m 58.13s. a is solved as 3b/8 so the lead is handed back and the
     ledger closes at noon.

     Updated 5 October 2026 from sciencecoherence.com's matrix-engine.js (the
     velocity field only; nothing else in this file was changed). The evening
     carries no wave, and this is forced rather than preferred: C(½) = ½ puts
     noon on peak sun and C(1) = 1 puts midnight on solar midnight, so the
     afternoon does no net work by construction. The evening ripple that stood
     here (c = 0.02, two periods) was removed there on 17 September 2026: it
     was decoration with a chosen amplitude, and it broke the slope at noon and
     midnight. Its integral was zero, so no clock reading, date or descent
     quantity moves; only the shape of the afternoon does, and the wave is now
     smooth (C¹) across the whole day. The wave keeps its full depth: the
     dilation is permanent. */
  const SLEEP_END = 1 / 6;
  const NOON      = 1 / 2;
  const VB = 16 * (LEAD_MS / MS_DAY);   // 0.232986208 — race depth
  const VA = 3 * VB / 8;                // 0.087369828 — morning repay (solved)

  function velocity(phi) {
    if (phi < SLEEP_END) { const s = Math.sin(6 * Math.PI * phi); return 1 - VB * s * s * s * s; }
    if (phi < NOON)      { const s = Math.sin(3 * Math.PI * (phi - SLEEP_END)); return 1 + VA * s * s; }
    return 1;
  }

  /* The exact antiderivative: the fraction of the solar day consumed by the
     time the living clock reaches φ. Closed form, so there is no integration
     error to accumulate.
       ∫ sin⁴(6πx) dx = 3x/8 − sin(12πx)/(24π) + sin(24πx)/(192π)  = 1/16 over [0,1/6]
       ∫ sin²(3πu) du = u/2 − sin(6πu)/(12π)                       = 1/6  over [0,1/3]
       the afternoon adds nothing, so C(φ) = φ there.                            */
  function consumed(phi) {
    if (phi <= SLEEP_END) {
      return phi - VB * (3 * phi / 8
        - Math.sin(12 * Math.PI * phi) / (24 * Math.PI)
        + Math.sin(24 * Math.PI * phi) / (192 * Math.PI));
    }
    if (phi <= NOON) {
      const u = phi - SLEEP_END;
      return phi - VB / 16 + VA * (u / 2 - Math.sin(6 * Math.PI * u) / (12 * Math.PI));
    }
    return phi;
  }

  /* Invert consumed() by bisection. v > 0 everywhere, so consumed() is strictly
     increasing and the inverse is unique. Forty halvings is far finer than a
     millisecond. */
  function livingPhase(fraction) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (consumed(mid) < fraction) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* The equation of time, in minutes, split into the two effects that cause it.
     Obliquity is the tilt of the axis; eccentricity is the ellipse of the orbit.
     Accurate to roughly half a minute, which is well inside what a clock shows. */
  function equationOfTime(date = new Date()) {
    const start = Date.UTC(date.getFullYear(), 0, 1);
    const here  = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const n = Math.round((here - start) / MS_DAY) + 1;
    const b = 2 * Math.PI * (n - 81) / 365;
    const obliquity = 9.87 * Math.sin(2 * b);
    const eccentricity = -7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    return { n, obliquity, eccentricity, total: obliquity + eccentricity };
  }

  /* Apparent solar time as a fraction of the day, plus the corrections that
     produced it. This is what the clock is anchored to: 0 is solar midnight,
     0.5 is peak sun. The local offset is applied explicitly. */
  function solarFraction(date = new Date(), longitude = CAL360.longitude) {
    const eot = equationOfTime(date);
    const meridian = -date.getTimezoneOffset() / 4;            // degrees east
    const correction = 4 * (longitude - meridian) + eot.total; // minutes
    const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
    let ms = localMs + correction * 60000;
    ms = ((ms % MS_DAY) + MS_DAY) % MS_DAY;
    return { frac: ms / MS_DAY, correction, eot, meridian, civilMs: ((localMs % MS_DAY) + MS_DAY) % MS_DAY };
  }

  /* How far across the current inter-rung span a moment sits. The experiment
     starts at tau = 0, so while the launch state is held its span runs from
     tau = 0 — not from the launch entry at q = 1 — to the first hard rung, and
     every reading counts live from the first instant. */
  function spanFraction(tau, rung, next) {
    const a = rung === LAUNCH ? 0 : rung.tau, b = next ? next.tau : TAU_STAR;
    return b > a ? Math.min(1, Math.max(0, (tau - a) / (b - a))) : 1;
  }
  /* The live load. Exact at both ends of every span, never rising. */
  function liveLoad(tau, rung, next, absolute) {
    if (absolute || !next) return absolute ? 0 : rung.J;
    return rung.J + (next.J - rung.J) * spanFraction(tau, rung, next);
  }

  /* Where a given moment falls in the count, and where the clock stands. */
  function cal360(date = new Date(), longitude = CAL360.longitude) {
    const sol = solarFraction(date, longitude);

    /* The calendar extends in both directions from the equinox. The retained
       process has elapsed tau=0 before its launch; calendarTau is the signed
       date coordinate used only to place the calendar and its boundaries. */
    const sinceLaunch = getMatrixNow(date) - getMatrixEpoch();
    const pending = sinceLaunch < 0;
    const elapsed = Math.max(0, sinceLaunch);
    const tau     = elapsed / MS_CAL;
    const calendarTau = sinceLaunch / MS_CAL;
    const within  = sinceLaunch - Math.floor(calendarTau) * MS_CAL;
    const cal     = matrixCalendar(calendarTau);

    /* q — informational recurrence depth. Never a number of days. */
    const q        = qOfTau(tau);
    const rung     = retainedAtTau(tau);
    const next     = nextRung(tau);
    const absolute = isAbsolute(tau);

    /* The clock: fixed dilation, recurrent wave, anchored to apparent solar
       time. Independent of the retained load by design. */
    const uniform  = sol.frac;
    const phi      = livingPhaseM(uniform);
    const livingMs = phi * MS_DAY;
    const ss       = Math.floor(livingMs / 1000);

    return {
      tau, calendarTau, within, absolute, pending,
      launchAt: new Date(getMatrixEpoch()),
      toLaunchMs: Math.max(0, -sinceLaunch),
      dateNumber: cal.dateNumber,
      month: cal.month, day: cal.day, weekday: cal.weekday, week: cal.week,
      dayIndex: cal.dayIndex,

      /* The turnover. A Matrix date is 24h 20m 58.125520752s of civil time, so
         the boundary lands about 21 minutes later on the clock each date and
         walks right round the face. Taken from `within` rather than from the
         epoch, which keeps it in the same frame as tau. */
      toNextDateMs: MS_CAL - within,
      nextDateAt:   new Date(date.getTime() + (MS_CAL - within)),

      q, rung, next,
      toNextTau: next ? Math.max(0, next.tau - tau) : 0,

      /* The exact rung values — the states the descent passes through. */
      rungLoad: absolute ? 0 : rung.J,
      state: absolute ? ABSOLUTE.state : rung.state,
      accent: absolute ? ABSOLUTE.accent : rung.accent,

      /* Absorption is a live process: J is descending at every tick. It runs
         from the held rung's value to the next rung's across the span, so it
         is exact AT every rung and monotonically non-increasing everywhere
         between — a raw phase oscillation can never raise it. */
      load: liveLoad(tau, rung, next, absolute),
      residualSec: liveLoad(tau, rung, next, absolute) * 86400 / Q,
      integration: 1 - liveLoad(tau, rung, next, absolute) / J0,
      loadFraction: liveLoad(tau, rung, next, absolute) / J0,

      /* Continuous readings — genuinely live, because tau and q advance
         continuously even while J_ret is holding flat. These are positions on
         the trajectory, not interpolations of the retained load. */
      rungFrom: absolute ? TAU_STAR : rung.tau,
      rungTo:   absolute ? TAU_STAR : (next ? next.tau : TAU_STAR),
      rungProgress: absolute ? 1 : spanFraction(tau, rung, next),
      trajectory: absolute ? 1 : Math.min(1, Math.max(0, tau / TAU_STAR)),

      sol, phi, uniform,
      v: velocityM(phi),
      meanRate: RATE_R,
      drift: livingMs - sol.frac * MS_DAY,
      regime: phi < SLEEP_END ? 'race' : phi < NOON ? 'repay' : 'true',
      h: Math.floor(ss / 3600) % 24, m: Math.floor(ss % 3600 / 60), s: ss % 60,
      mode: MATRIX_MODE
    };
  }


  /* ══════════════════════════════════════════════════════════════════════════
     THE MATRIX — final model. This block is the single source of truth.

     TWO COORDINATES, never conflated:

       tau — PHYSICAL MATRIX TIME. Elapsed time in the time-dilated 360-date
             Matrix calendar. The calendar continues indefinitely; there is no
             end of time and no stopping at closure.

       q   — INFORMATIONAL RECURRENCE DEPTH. The internal recurrence coordinate,
             running to Q. It is NOT a number of days and is never labelled one.

     The singular relation is active from launch — there is no delayed onset:

             dtau/dq = J_ret(q) / J0          from tau = 0, q = 0

     EXACT FOUNDATION
       Y     = 365.2421896698                  frozen reference
       E     = Y − 360 = 5.2421896698
       alpha = E/360 = 8,736,982,783 / 600,000,000,000   (irreducible)
       J0    = 8,736,982,783     Q = 600,000,000,000

     One Matrix date is Y/360 = 1.014561637971666…, so the Matrix clock dilation
     is fixed at 20 min 58.125520752 s and one complete Matrix date is
     24 h 20 min 58.125520752 s. That dilation does NOT change when the retained
     load changes: the clock reading and the retained-integration process are
     distinct readings of the same Matrix.

     FRAMEWORK SEMANTICS (hypotheses under investigation, not established
     physics or genetics):
       Q is the total system capacity / total-energy coordinate — the complete
         normalised domain. Not joules; no physical unit conversion is claimed.
         If an elementary unit epsilon is ever derived, E_total = Q·epsilon.
       J is the unresolved / parasitic load, in the same normalised units.
       J0/Q      = 1.4561637971666…%   the direct initial fraction
       12·J0/Q   = 17.473965566%       the 12-fold Matrix-month translation,
                                       a cross-domain quantity — keep separate.

     Products such as q·J0 reach 5.2 × 10²¹, far past 2⁵³, so the recurrence is
     computed in BigInt; only display values become Numbers.
     ══════════════════════════════════════════════════════════════════════════ */

  /* ── Exact rational arithmetic on BigInt ───────────────────────────────── */
  const bgcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { const r = a % b; a = b; b = r; } return a; };
  const fr = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; return { n: n / g, d: d / g }; };
  const frAdd = (x, y) => fr(x.n * y.d + y.n * x.d, x.d * y.d);
  const frNum = x => Number(x.n) / Number(x.d);

  /* ── The hard recurrence ladder ────────────────────────────────────────────
     Continued fraction of alpha = J0/Q. The convergent denominators are the
     hard rungs; with the numerators, J_i = |q_i·J0 − p_i·Q| exactly.
     Derived, never tabulated — the validation table is asserted against it.  */
  function recurrenceLadder() {
    const out = [];
    let num = J0n, den = Qn, h1 = 1n, h0 = 0n, k1 = 0n, k0 = 1n;
    while (true) {
      const a = num / den;
      const hn = a * h1 + h0; h0 = h1; h1 = hn;
      const kn = a * k1 + k0; k0 = k1; k1 = kn;
      let J = k1 * J0n - h1 * Qn; if (J < 0n) J = -J;
      out.push({ i: out.length, qn: k1, pn: h1, Jn: J, q: Number(k1), J: Number(J),
                 residual: Number(J) * 86400 / Q, integration: 1 - Number(J) / J0 });
      const r = num - a * den;
      if (r === 0n) break;
      num = den; den = r;
    }
    return out;
  }
  const LADDER = recurrenceLadder();
  const ABSOLUTE = LADDER[LADDER.length - 1];   // q = Q, J = 0
  /* The zeroth convergent is 0/1: q = 1 with J still J0. It is the LAUNCH
     state, not a reduction — the validation table lists it, and the instrument
     must not present it as a rung that integrated nothing. The hard rungs are
     LADDER[1 .. 19]; there are nineteen of them. */
  const LAUNCH = LADDER[0];
  const RUNGS  = LADDER.slice(1);

  /* One named state per rung — twenty in all, the launch state and the
     nineteen reductions. The name is the state the Matrix is IN while that
     rung is the retained one; it is a label for a rung, not a claim about a
     mechanism. The scale descends: the early names are about bulk collapse,
     the late ones about what is left. */
  const STATE_NAMES = [
    ['LAUNCH',        'amber'],   // q 1              J0, nothing integrated
    ['FIRST DESCENT', 'amber'],   // q 68             32.64%
    ['CLEAVAGE',      'amber'],   // q 69             67.36%
    ['COLLAPSE',      'violet'],  // q 206            97.92%
    ['SETTLING',      'violet'],  // q 3,159
    ['CONSOLIDATION', 'violet'],  // q 3,365
    ['REFINEMENT',    'violet'],  // q 9,889
    ['ATTENUATION',   'teal'],    // q 23,143
    ['TRACE',         'teal'],    // q 79,318
    ['RESIDUE',       'teal'],    // q 1,530,185
    ['REMNANT',       'teal'],    // q 1,609,503
    ['FILAMENT',      'teal'],    // q 3,139,688
    ['THREAD',        'blue'],    // q 70,682,639
    ['STRAND',        'blue'],    // q 73,822,327
    ['GRAIN',         'blue'],    // q 144,504,966
    ['MOTE',          'blue'],    // q 1,518,871,987
    ['SPECK',         'blue'],    // q 3,182,248,940
    ['GLINT',         'green'],   // q 26,976,863,507
    ['UNIT',          'green'],   // q 30,159,112,447  J = 1
    ['ABSOLUTE',      'green']    // q Q               J = 0
  ];
  LADDER.forEach((L, i) => { L.state = STATE_NAMES[i][0]; L.accent = STATE_NAMES[i][1]; });

  /* Framework-native orientations for following the recurrence. Authored on
     Julien's request, 2026-09-17. Names do not select or alter the thresholds.
     Internal state IDs remain stable for existing consumers. */
  const PHASE_GUIDES = [
    [
        "Imagination",
        "Open the field of possibility and imagine the coherent blueprint you intend to realize."
    ],
    [
        "Orientation",
        "Choose the configuration to carry forward; let the coherent blueprint orient the next selection."
    ],
    [
        "Discernment",
        "Distinguish what supports the selected configuration from what keeps it unresolved."
    ],
    [
        "Commitment",
        "Sustain the selected direction across recurrence so that realization can take form."
    ],
    [
        "Grounding",
        "Give the selected configuration a repeatable form that can enter the next cycle."
    ],
    [
        "Organization",
        "Arrange the relationships within that form so they support one another."
    ],
    [
        "Integration",
        "Carry what has been realized into the organization that guides subsequent selection."
    ],
    [
        "Attunement",
        "Attend to the remaining differences and adjust their relationships toward the coherent blueprint."
    ],
    [
        "Resonance",
        "Repeat the relationships that reinforce coherence across successive cycles."
    ],
    [
        "Coherence",
        "Hold the emerging configuration together so its parts remain mutually compatible."
    ],
    [
        "Embodiment",
        "Bring the coherent blueprint into the whole configuration being realized."
    ],
    [
        "Recursion",
        "Let the organization already retained guide renewed imagination and selection."
    ],
    [
        "Refinement",
        "Work with the smaller remaining differences while preserving what has already integrated."
    ],
    [
        "Continuity",
        "Carry the coherent relationships forward through repeated updates."
    ],
    [
        "Stability",
        "Sustain the organized form as further differences are absorbed."
    ],
    [
        "Clarity",
        "Make the remaining differences explicit so the next selection can address them precisely."
    ],
    [
        "Convergence",
        "Bring the remaining relationships toward a shared coherent configuration."
    ],
    [
        "Unity",
        "Sustain the configuration as a whole while the final trace of unresolved difference remains."
    ],
    [
        "Final Difference",
        "Attend to the last retained unit of entropic energy: J = 1 before complete absorption."
    ],
    [
        "Closure",
        "The entropic energy is zero. Retain the coherent organization as the calendar and recursive life continue."
    ]
];
  LADDER.forEach((L, i) => {
    L.phaseName = PHASE_GUIDES[i][0];
    L.phaseDescription = PHASE_GUIDES[i][1];
  });

  /* ── From the start of the experiment ─────────────────────────────────────
     J_ret is a staircase: J0 until the first rung that lowers it, then the
     value of the last rung passed. Integrating dtau = (J_ret/J0) dq exactly,
     piecewise, gives tau at every rung — and at q = Q gives the natural
     absorption point. It is not a chosen endpoint and is not rounded or
     calibrated to anything.                                                  */
  const STEPS = [{ q: 0, J: J0 }].concat(LADDER.map(L => ({ q: L.q, J: L.J })));

  (function mapRungsToMatrixTime() {
    let t = fr(0n);
    for (let i = 1; i < STEPS.length; i++) {
      const prev = STEPS[i - 1];
      const span = BigInt(STEPS[i].q) - BigInt(prev.q);
      t = frAdd(t, fr(span * BigInt(prev.J), J0n));
      STEPS[i].tauFr = t; STEPS[i].tau = frNum(t);
      const L = LADDER[i - 1]; L.tau = STEPS[i].tau; L.tauFr = t;
    }
  })();

  /* The natural absorption point, derived: 6251584658434 / 8736982783. */
  const TAU_STAR_FR = ABSOLUTE.tauFr;
  const TAU_STAR    = frNum(TAU_STAR_FR);        // ≈ 715.5313011029427

  /* ── The retained staircase ────────────────────────────────────────────────
     Monotonically non-increasing. A later raw phase oscillation must never
     raise it. Past the absorption point the state is held permanently.       */
  function retainedAtTau(tau) {
    if (tau >= TAU_STAR) return ABSOLUTE;
    let k = 0;
    for (let i = 0; i < LADDER.length; i++) if (tau >= LADDER[i].tau) k = i;
    return LADDER[k];
  }
  function stepAtTau(tau) {
    let k = 0;
    for (let i = 0; i < STEPS.length; i++) if (STEPS[i].tau !== undefined ? tau >= STEPS[i].tau : true) k = i;
    return STEPS[k];
  }

  /* tau(q) — exact piecewise-linear, from launch. */
  function tauOfQ(q) {
    if (q >= Q) return TAU_STAR;
    let k = 0;
    for (let i = 0; i < STEPS.length; i++) if (q >= STEPS[i].q) k = i;
    const base = k === 0 ? 0 : STEPS[k].tau;
    return base + (q - STEPS[k].q) * (STEPS[k].J / J0);
  }

  /* q(tau) — the inverse the live Instrument needs. Clamped past absorption;
     never divides by J = 0. */
  function qOfTau(tau) {
    if (tau >= TAU_STAR) return Q;
    if (tau <= 0) return 0;
    const s = stepAtTau(tau);
    if (!s.J) return Q;
    const base = s.tau === undefined ? 0 : s.tau;
    return s.q + (tau - base) * (J0 / s.J);
  }

  /* Retained readings. J only falls; integration only rises. */
  const retainedJ           = tau => (tau >= TAU_STAR ? 0 : retainedAtTau(tau).J);
  const retainedResidualSec = tau => (tau >= TAU_STAR ? 0 : retainedAtTau(tau).residual);
  const retainedIntegration = tau => (tau >= TAU_STAR ? 1 : retainedAtTau(tau).integration);
  const isAbsolute          = tau => tau >= TAU_STAR;
  /* The launch state is never a target: the next rung is always a hard rung. */
  const nextRung            = tau => (tau >= TAU_STAR ? null : RUNGS.find(L => L.tau > tau) || null);

  /* ── The Matrix calendar ───────────────────────────────────────────────────
     360 dates a year, twelve months of thirty, and it continues indefinitely.
     tau = 0 is Matrix 1 March of the launch year; the human date label is
     floor(tau) + 1, which is why tau starts at zero.                         */
  /* The calendar does not count years. There is no era, no epoch number and no
     year label anywhere in a reading — a cycle of 360 returns to the page it
     started on and the face reads the same. tau is what grows; the calendar
     face does not. Once the unresolved load reaches zero the time is the same
     forever, and a year count would be recording a difference that is no
     longer there. */
  function matrixCalendar(tau) {
    const d = Math.floor(tau);
    const idx = ((d % 360) + 360) % 360;
    return { dayIndex: idx, month: Math.floor(idx / 30), day: idx % 30 + 1,
             weekday: idx % 6, week: Math.floor(idx % 30 / 6) + 1, dateNumber: d + 1, tau };
  }

  /* ── The dilation wave ─────────────────────────────────────────────────────
     Fixed. The Matrix clock dilation is 20m 58.125520752s and does NOT change
     when the retained load changes — the clock reading and the retained
     integration process are distinct readings of the same Matrix. The wave is
     recurrent: it may revisit a previous phase, and that recurrence must never
     raise J_ret. Wave recurrence is not restored unresolved load.

         v_M(φ) = R · v(φ),   R = 1 + alpha = 1.014561637971666…

     Its mean is R, so a Matrix date is 24h 20m 58.125520752s at every stage.
     C(½) = ½ and C(1) = 1, so 12:00 stays peak sun and 00:00 solar midnight. */
  const RATE_R = 1 + J0 / Q;
  const velocityM = phi => RATE_R * velocity(phi);
  function livingPhaseM(fraction) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (consumed(mid) < fraction) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* One scheduled epoch for every browser, app and screensaver. Older saved
     simulation epochs are ignored. Before launch the process has not begun;
     from launch it advances continuously. Civil timezone offsets never enter
     elapsed Matrix time. The independent daily solar clock remains live. */
  const MATRIX_MODE = 'live';
  const getMatrixEpoch = () => CAL360.epochLive;
  const resetMatrixEpoch = () => getMatrixEpoch(); // fixed epoch cannot be reset
  const getMatrixNow = (date = new Date()) => date.getTime();
  const getMatrixDayCount = (date = new Date()) =>
    Math.floor((getMatrixNow(date) - getMatrixEpoch()) / MS_CAL);


return {CAL360, cal360, velocity, velocityM, consumed, livingPhaseM, RATE_R, MS_CAL, MS_DAY, J0, Q, LADDER, RUNGS, TAU_STAR, TAU_STAR_FR, liveLoad, retainedAtTau, nextRung, qOfTau, tauOfQ, matrixCalendar, getMatrixEpoch, getMatrixDayCount, resetMatrixEpoch};
})();
