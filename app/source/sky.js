'use strict';
/* ── The sky, computed ─────────────────────────────────────────────────────
   The Moon's phase and the constellation it stands in are not fetched from
   anyone. They follow from the Moon's and Sun's positions, and those follow
   from published series: Meeus, Astronomical Algorithms (2nd ed.), chapter 47
   for the Moon — the sixty-term longitude and distance series and the
   sixty-term latitude series of ELP-2000/82, good to about ten arcseconds —
   and chapter 25 for the Sun. Nothing here can be refused, rate-limited or go
   stale; it is arithmetic, and it was checked against an independent
   ephemeris before it went in.

   The constellation is the astronomical one: the region of sky the Moon is
   actually in, by the boundaries the IAU fixed in 1930 (Delporte), located
   with Roman's 1987 method and table. That is thirteen constellations along
   the Moon's path, Ophiuchus among them, and occasionally Orion, Cetus or
   Sextans at the edges. It is not the astrological sign, which is a
   30-degree slice counted from the equinox and has drifted about one
   constellation away from the sky it was named for.                         */

const Sky = (() => {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const DAY = 86400000;
  const norm = a => ((a % 360) + 360) % 360;
  const sin = d => Math.sin(d * RAD), cos = d => Math.cos(d * RAD);

  /* The series run on terrestrial time, which leads civil time by ΔT. For
     2026 the IERS value is about 69.2 s; left out, every phase time would be
     a minute late. */
  const DELTA_T_S = 69.2;
  const jdTT = ms => ms / DAY + 2440587.5 + DELTA_T_S / 86400;
  const centuries = ms => (jdTT(ms) - 2451545.0) / 36525;

  /* ── Meeus 47.A · longitude (1e-6 °) and distance (1e-3 km) ──
     columns: D, M, M′, F, Σl, Σr */
  const LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
    [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
    [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
    [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
    [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
    [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
    [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
    [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
    [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
    [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
    [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
    [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
    [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
    [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
    [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
    [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
    [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
    [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
    [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752]
  ];
  /* ── Meeus 47.B · latitude (1e-6 °) · columns: D, M, M′, F, Σb */
  const B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
    [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
    [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
    [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
    [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
    [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
    [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
    [4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],
    [2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
    [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],
    [2,1,0,1,-351],[4,0,0,1,331],[2,-1,1,1,315],[2,-2,0,-1,302],
    [0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],
    [0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],
    [0,1,2,1,-177],[4,0,-2,-1,176],[4,-1,-1,-1,166],[1,0,1,-1,-164],
    [4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107]
  ];

  /* Geocentric ecliptic longitude and latitude (°, mean equinox of date) and
     distance (km). */
  function moonEcliptic(ms) {
    const T = centuries(ms), T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    const Lp = norm(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
    const D  = norm(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
    const M  = norm(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
    const Mp = norm(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
    const F  = norm(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
    const A1 = norm(119.75 + 131.849 * T), A2 = norm(53.09 + 479264.290 * T), A3 = norm(313.45 + 481266.484 * T);
    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const ecc = m => m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    let sl = 0, sr = 0, sb = 0;
    for (const [d, m, mp, f, l, r] of LR) {
      const arg = d * D + m * M + mp * Mp + f * F, k = ecc(m);
      sl += l * k * sin(arg); sr += r * k * cos(arg);
    }
    for (const [d, m, mp, f, b] of B) sb += b * ecc(m) * sin(d * D + m * M + mp * Mp + f * F);
    sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
    sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
        + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
    return { lon: norm(Lp + sl / 1e6), lat: sb / 1e6, dist: 385000.56 + sr / 1000 };
  }

  /* The Sun, Meeus chapter 25 (about 0.01°), with the aberration that makes
     it the Sun we see; the Moon's own aberration is under an arcsecond. */
  function sunEcliptic(ms) {
    const T = centuries(ms);
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
      + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
    const e = 0.016708634 - 0.000042037 * T;
    const nu = M + C;
    const R = 1.000001018 * (1 - e * e) / (1 + e * cos(nu)) * 149597870.7;
    return { lon: norm(L0 + C - 0.00569), lat: 0, dist: R };
  }

  const obliquity = ms => 23.439291 - 0.0130042 * centuries(ms);

  function toEquatorial({ lon, lat }, ms) {
    const e = obliquity(ms);
    const ra = norm(Math.atan2(sin(lon) * cos(e) - Math.tan(lat * RAD) * sin(e), cos(lon)) * DEG);
    const dec = Math.asin(sin(lat) * cos(e) + cos(lat) * sin(e) * sin(lon)) * DEG;
    return { ra, dec };
  }

  /* ── Which constellation ─────────────────────────────────────────────
     Roman (1987): the IAU boundaries run along lines of right ascension and
     declination of the equinox of 1875, so the position is carried back to
     1875 (Meeus 21, rigorous) and the first boundary segment whose band holds
     it names the constellation. */
  const B1875 = 2405889.258550475;
  function precessTo1875({ ra, dec }, ms) {
    const jd0 = jdTT(ms), T = (jd0 - 2451545) / 36525, t = (B1875 - jd0) / 36525;
    const as = x => x / 3600;
    const zeta = as((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (0.30188 - 0.000344 * T) * t * t + 0.017998 * t ** 3);
    const z = as((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (1.09468 + 0.000066 * T) * t * t + 0.018203 * t ** 3);
    const th = as((2004.3109 - 0.85330 * T - 0.000217 * T * T) * t - (0.42665 + 0.000217 * T) * t * t - 0.041833 * t ** 3);
    const A = cos(dec) * sin(ra + zeta);
    const Bv = cos(th) * cos(dec) * cos(ra + zeta) - sin(th) * sin(dec);
    const C = sin(th) * cos(dec) * cos(ra + zeta) + cos(th) * sin(dec);
    return { ra: norm(Math.atan2(A, Bv) * DEG + z), dec: Math.asin(C) * DEG };
  }

  const ROMAN = '0 24 88 UMi|8 14.5 86.5 UMi|21 23 86.1667 UMi|18 21 86 UMi|0 8 85 Cep|9.1667 10.6667 82 Cam|0 5 80 Cep|10.6667 14.5 80 Cam|17.5 18 80 UMi|20.1667 21 80 Dra|0 3.5083 77 Cep|11.5 13.5833 77 Cam|16.5333 17.5 75 UMi|20.1667 20.6667 75 Cep|7.9667 9.1667 73.5 Cam|9.1667 11.3333 73.5 Dra|13 16.5333 70 UMi|3.1 3.4167 68 Cas|20.4167 20.6667 67 Dra|11.3333 12 66.5 Dra|0 0.3333 66 Cep|14 15.6667 66 UMi|23.5833 24 66 Cep|12 13.5 64 Dra|13.5 14.4167 63 Dra|23.1667 23.5833 63 Cep|6.1 7 62 Cam|20 20.4167 61.5 Dra|20.5367 20.6 60.9167 Cep|7 7.9667 60 Cam|7.9667 8.4167 60 UMa|19.7667 20 59.5 Dra|20 20.5367 59.5 Cep|22.8667 23.1667 59.0833 Cep|0 2.4333 58.5 Cas|19.4167 19.7667 58 Dra|1.7 1.9083 57.5 Cas|2.4333 3.1 57 Cas|3.1 3.1667 57 Cam|22.3167 22.8667 56.25 Cep|5 6.1 56 Cam|14.0333 14.4167 55.5 UMa|14.4167 19.4167 55.5 Dra|3.1667 3.3333 55 Cam|22.1333 22.3167 55 Cep|20.6 21.9667 54.8333 Cep|0 1.7 54 Cas|6.1 6.5 54 Lyn|12.0833 13.5 53 UMa|15.25 15.75 53 Dra|21.9667 22.1333 52.75 Cep|3.3333 5 52.5 Cam|22.8667 23.3333 52.5 Cas|15.75 17 51.5 Dra|2.0417 2.5167 50.5 Per|17 18.2333 50.5 Dra|0 1.3667 50 Cas|1.3667 1.6667 50 Per|6.5 6.8 50 Lyn|23.3333 24 50 Cas|13.5 14.0333 48.5 UMa|0 1.1167 48 Cas|23.5833 24 48 Cas|18.175 18.2333 47.5 Her|18.2333 19.0833 47.5 Dra|19.0833 19.1667 47.5 Cyg|1.6667 2.0417 47 Per|8.4167 9.1667 47 UMa|0.1667 0.8667 46 Cas|12 12.0833 45 UMa|6.8 7.3667 44.5 Lyn|21.9083 21.9667 44 Cyg|21.875 21.9083 43.75 Cyg|19.1667 19.4 43.5 Cyg|9.1667 10.1667 42 UMa|10.1667 10.7833 40 UMa|15.4333 15.75 40 Boo|15.75 16.3333 40 Her|9.25 9.5833 39.75 Lyn|0 2.5167 36.75 And|2.5167 2.5667 36.75 Per|19.3583 19.4 36.5 Lyr|4.5 4.6917 36 Per|21.7333 21.875 36 Cyg|21.875 22 36 Lac|6.5333 7.3667 35.5 Aur|7.3667 7.75 35.5 Lyn|0 2 35 And|22 22.8167 35 Lac|22.8167 22.8667 34.5 Lac|22.8667 23.5 34.5 And|2.5667 2.7167 34 Per|10.7833 11 34 UMa|12 12.3333 34 CVn|7.75 9.25 33.5 Lyn|9.25 9.8833 33.5 LMi|0.7167 1.4083 33 And|15.1833 15.4333 33 Boo|23.5 23.75 32.0833 And|12.3333 13.25 32 CVn|23.75 24 31.3333 And|13.9583 14.0333 30.75 CVn|2.4167 2.7167 30.6667 Tri|2.7167 4.5 30.6667 Per|4.5 4.75 30 Aur|18.175 19.3583 30 Lyr|11 12 29 UMa|19.6667 20.9167 29 Cyg|4.75 5.8833 28.5 Aur|9.8833 10.5 28.5 LMi|13.25 13.9583 28.5 CVn|0 0.0667 28 And|1.4083 1.6667 28 Tri|5.8833 6.5333 28 Aur|7.8833 8 28 Gem|20.9167 21.7333 28 Cyg|19.2583 19.6667 27.5 Cyg|1.9167 2.4167 27.25 Tri|16.1667 16.3333 27 CrB|15.0833 15.1833 26 Boo|15.1833 16.1667 26 CrB|18.3667 18.8667 26 Lyr|10.75 11 25.5 LMi|18.8667 19.2583 25.5 Lyr|1.6667 1.9167 25 Tri|0.7167 0.85 23.75 Psc|10.5 10.75 23.5 LMi|21.25 21.4167 23.5 Vul|5.7 5.8833 22.8333 Tau|0.0667 0.1417 22 And|15.9167 16.0333 22 Ser|5.8833 6.2167 21.5 Gem|19.8333 20.25 21.25 Vul|18.8667 19.25 21.0833 Vul|0.1417 0.85 21 And|20.25 20.5667 20.5 Vul|7.8083 7.8833 20 Gem|20.5667 21.25 19.5 Vul|19.25 19.8333 19.1667 Vul|3.2833 3.3667 19 Ari|18.8667 19 18.5 Sge|5.7 5.7667 18 Ori|6.2167 6.3083 17.5 Gem|19 19.8333 16.1667 Sge|4.9667 5.3333 16 Tau|15.9167 16.0833 16 Her|19.8333 20.25 15.75 Sge|4.6167 4.9667 15.5 Tau|5.3333 5.6 15.5 Tau|12.8333 13.5 15 Com|17.25 18.25 14.3333 Her|11.8667 12.8333 14 Com|7.5 7.8083 13.5 Gem|16.75 17.25 12.8333 Her|0 0.1417 12.5 Peg|5.6 5.7667 12.5 Tau|7 7.5 12.5 Gem|21.1167 21.3333 12.5 Peg|6.3083 6.9333 12 Gem|18.25 18.8667 12 Her|20.875 21.05 11.8333 Del|21.05 21.1167 11.8333 Peg|11.5167 11.8667 11 Leo|6.2417 6.3083 10 Ori|6.9333 7 10 Gem|7.8083 7.925 10 Cnc|23.8333 24 10 Peg|1.6667 3.2833 9.9167 Ari|20.1417 20.3 8.5 Del|13.5 15.0833 8 Boo|22.75 23.8333 7.5 Peg|7.925 9.25 7 Cnc|9.25 10.75 7 Leo|18.25 18.6622 6.25 Oph|18.6622 18.8667 6.25 Aql|20.8333 20.875 6 Del|7 7.0167 5.5 CMi|18.25 18.425 4.5 Ser|16.0833 16.75 4 Her|18.25 18.425 3 Oph|21.4667 21.6667 2.75 Peg|0 2 2 Psc|18.5833 18.8667 2 Ser|20.3 20.8333 2 Del|20.8333 21.3333 2 Equ|21.3333 21.4667 2 Peg|22 22.75 2 Peg|21.6667 22 1.75 Peg|7.0167 7.2 1.5 CMi|3.5833 4.6167 0 Tau|4.6167 4.6667 0 Ori|7.2 8.0833 0 CMi|14.6667 15.0833 0 Vir|17.8333 18.25 0 Oph|2.65 3.2833 -1.75 Cet|3.2833 3.5833 -1.75 Tau|15.0833 16.2667 -3.25 Ser|4.6667 5.0833 -4 Ori|5.8333 6.2417 -4 Ori|17.8333 17.9667 -4 Ser|18.25 18.5833 -4 Ser|18.5833 18.8667 -4 Aql|22.75 23.8333 -4 Psc|10.75 11.5167 -6 Leo|11.5167 11.8333 -6 Vir|0 0.3333 -7 Psc|23.8333 24 -7 Psc|14.25 14.6667 -8 Vir|15.9167 16.2667 -8 Oph|20 20.5333 -9 Aql|21.3333 21.8667 -9 Aqr|17.1667 17.9667 -10 Oph|5.8333 8.0833 -11 Mon|4.9167 5.0833 -11 Eri|5.0833 5.8333 -11 Ori|8.0833 8.3667 -11 Hya|9.5833 10.75 -11 Sex|11.8333 12.8333 -11 Vir|17.5833 17.6667 -11.6667 Oph|18.8667 20 -12.0333 Aql|4.8333 4.9167 -14.5 Eri|20.5333 21.3333 -15 Aqr|17.1667 18.25 -16 Ser|18.25 18.8667 -16 Sct|8.3667 8.5833 -17 Hya|16.2667 16.375 -18.25 Oph|8.5833 9.0833 -19 Hya|10.75 10.8333 -19 Crt|16.2667 16.375 -19.25 Sco|15.6667 15.9167 -20 Lib|12.5833 12.8333 -22 Crv|12.8333 14.25 -22 Vir|9.0833 9.75 -24 Hya|1.6667 2.65 -24.3833 Cet|2.65 3.75 -24.3833 Eri|10.8333 11.8333 -24.5 Crt|11.8333 12.5833 -24.5 Crv|14.25 14.9167 -24.5 Lib|16.2667 16.75 -24.5833 Oph|0 1.6667 -25.5 Cet|21.3333 21.8667 -25.5 Cap|21.8667 23.8333 -25.5 Aqr|23.8333 24 -25.5 Cet|9.75 10.25 -26.5 Hya|4.7 4.8333 -27.25 Eri|4.8333 6.1167 -27.25 Lep|20 21.3333 -28 Cap|10.25 10.5833 -29.1667 Hya|12.5833 14.9167 -29.5 Hya|14.9167 15.6667 -29.5 Lib|15.6667 16 -29.5 Sco|4.5833 4.7 -30 Eri|16.75 17.6 -30 Oph|17.6 17.8333 -30 Sgr|10.5833 10.8333 -31.1667 Hya|6.1167 7.3667 -33 CMa|12.25 12.5833 -33 Hya|10.8333 12.25 -35 Hya|3.5 3.75 -36 For|8.3667 9.3667 -36.75 Pyx|4.2667 4.5833 -37 Eri|17.8333 19.1667 -37 Sgr|21.3333 23 -37 PsA|23 23.3333 -37 Scl|3 3.5 -39.5833 For|9.3667 11 -39.75 Ant|0 1.6667 -40 Scl|1.6667 3 -40 For|3.8667 4.2667 -40 Eri|23.3333 24 -40 Scl|14.1667 14.9167 -42 Cen|15.6667 16 -42 Lup|16 16.4208 -42 Sco|4.8333 5 -43 Cae|5 6.5833 -43 Col|8 8.3667 -43 Pup|3.4167 3.8667 -44 Eri|16.4208 17.8333 -45.5 Sco|17.8333 19.1667 -45.5 CrA|19.1667 20.3333 -45.5 Sgr|20.3333 21.3333 -45.5 Mic|3 3.4167 -46 Eri|4.5 4.8333 -46.5 Cae|15.3333 15.6667 -48 Lup|0 2.3333 -48.1667 Phe|2.6667 3 -49 Eri|4.0833 4.2667 -49 Hor|4.2667 4.5 -49 Cae|21.3333 22 -50 Gru|6 8 -50.75 Pup|8 8.1667 -50.75 Vel|2.4167 2.6667 -51 Eri|3.8333 4.0833 -51 Hor|0 1.8333 -51.5 Phe|6 6.1667 -52.5 Car|8.1667 8.45 -53 Vel|3.5 3.8333 -53.1667 Hor|3.8333 4 -53.1667 Dor|0 1.5833 -53.5 Phe|2.1667 2.4167 -54 Eri|4.5 5 -54 Pic|15.05 15.3333 -54 Lup|8.45 8.8333 -54.5 Vel|6.1667 6.5 -55 Car|11.8333 12.8333 -55 Cen|14.1667 15.05 -55 Lup|15.05 15.3333 -55 Nor|4 4.3333 -56.5 Dor|8.8333 11 -56.5 Vel|11 11.25 -56.5 Cen|17.5 18 -57 Ara|18 20.3333 -57 Tel|22 23.3333 -57 Gru|3.2 3.5 -57.5 Hor|5 5.5 -57.5 Pic|6.5 6.8333 -58 Car|0 1.3333 -58.5 Phe|1.3333 2.1667 -58.5 Eri|23.3333 24 -58.5 Phe|4.3333 4.5833 -59 Dor|15.3333 16.4208 -60 Nor|20.3333 21.3333 -60 Ind|5.5 6 -61 Pic|15.1667 15.3333 -61 Cir|16.4208 16.5833 -61 Ara|14.9167 15.1667 -63.5833 Cir|16.5833 16.75 -63.5833 Ara|6 6.8333 -64 Pic|6.8333 9.0333 -64 Car|11.25 11.8333 -64 Cen|11.8333 12.8333 -64 Cru|12.8333 14.5333 -64 Cen|13.5 13.6667 -65 Cir|16.75 16.8333 -65 Ara|2.1667 3.2 -67.5 Hor|3.2 4.5833 -67.5 Ret|14.75 14.9167 -67.5 Cir|16.8333 17.5 -67.5 Ara|17.5 18 -67.5 Pav|22 23.3333 -67.5 Tuc|4.5833 6.5833 -70 Dor|13.6667 14.75 -70 Cir|14.75 17 -70 TrA|0 1.3333 -75 Tuc|3.5 4.5833 -75 Hyi|6.5833 9.0333 -75 Vol|9.0333 11.25 -75 Car|11.25 13.6667 -75 Mus|18 21.3333 -75 Pav|21.3333 23.3333 -75 Ind|23.3333 24 -75 Tuc|0.75 1.3333 -76 Tuc|0 3.5 -82.5 Hyi|7.6667 13.6667 -82.5 Cha|13.6667 18 -82.5 Aps|3.5 7.6667 -85 Men|0 24 -90 Oct'.split('|').map(r => { const [a, b, c, d] = r.split(' '); return [+a, +b, +c, d]; });
  const NAMES = Object.fromEntries('And:Andromeda;Ant:Antlia;Aps:Apus;Aqr:Aquarius;Aql:Aquila;Ara:Ara;Ari:Aries;Aur:Auriga;Boo:Boötes;Cae:Caelum;Cam:Camelopardalis;Cnc:Cancer;CVn:Canes Venatici;CMa:Canis Major;CMi:Canis Minor;Cap:Capricornus;Car:Carina;Cas:Cassiopeia;Cen:Centaurus;Cep:Cepheus;Cet:Cetus;Cha:Chamaeleon;Cir:Circinus;Col:Columba;Com:Coma Berenices;CrA:Corona Australis;CrB:Corona Borealis;Crv:Corvus;Crt:Crater;Cru:Crux;Cyg:Cygnus;Del:Delphinus;Dor:Dorado;Dra:Draco;Equ:Equuleus;Eri:Eridanus;For:Fornax;Gem:Gemini;Gru:Grus;Her:Hercules;Hor:Horologium;Hya:Hydra;Hyi:Hydrus;Ind:Indus;Lac:Lacerta;Leo:Leo;LMi:Leo Minor;Lep:Lepus;Lib:Libra;Lup:Lupus;Lyn:Lynx;Lyr:Lyra;Men:Mensa;Mic:Microscopium;Mon:Monoceros;Mus:Musca;Nor:Norma;Oct:Octans;Oph:Ophiuchus;Ori:Orion;Pav:Pavo;Peg:Pegasus;Per:Perseus;Phe:Phoenix;Pic:Pictor;Psc:Pisces;PsA:Piscis Austrinus;Pup:Puppis;Pyx:Pyxis;Ret:Reticulum;Sge:Sagitta;Sgr:Sagittarius;Sco:Scorpius;Scl:Sculptor;Sct:Scutum;Ser:Serpens;Sex:Sextans;Tau:Taurus;Tel:Telescopium;Tri:Triangulum;TrA:Triangulum Australe;Tuc:Tucana;UMa:Ursa Major;UMi:Ursa Minor;Vel:Vela;Vir:Virgo;Vol:Volans;Vul:Vulpecula'.split(';').map(p => p.split(':')));

  function constellationOf(eq, ms) {
    const p = precessTo1875(eq, ms);
    const raH = p.ra / 15;
    for (const [lo, hi, decLo, abbr] of ROMAN)
      if (p.dec >= decLo && raH >= lo && raH < hi) return abbr;
    return 'Oct';
  }
  const nameOf = abbr => NAMES[abbr] || abbr;

  /* ── The Moon, whole ───────────────────────────────────────────────── */
  function moon(ms) {
    const m = moonEcliptic(ms), s = sunEcliptic(ms);
    const elong = norm(m.lon - s.lon);                       // 0 new · 90 first quarter · 180 full
    // Meeus 48.2–48.3: the phase angle from the geocentric elongation.
    const psi = Math.acos(cos(m.lat) * cos(m.lon - s.lon)) * DEG;
    const i = Math.atan2(s.dist * sin(psi), m.dist - s.dist * cos(psi)) * DEG;
    const illum = (1 + cos(i)) / 2;
    const eq = toEquatorial(m, ms);
    const abbr = constellationOf(eq, ms);
    return {
      lon: m.lon, lat: m.lat, dist: m.dist, ra: eq.ra, dec: eq.dec, elong, illum,
      waxing: elong < 180, age: elong / 360,              // fraction of the lunation, by elongation
      constellation: abbr, name: nameOf(abbr),
      diameter: 2 * Math.atan(1737.4 / m.dist) * DEG * 60   // arcminutes
    };
  }
  function sun(ms) {
    const s = sunEcliptic(ms), eq = toEquatorial(s, ms), abbr = constellationOf(eq, ms);
    return { lon: s.lon, constellation: abbr, name: nameOf(abbr) };
  }

  /* ── Moments, found rather than tabulated ─────────────────────────────
     A principal phase is the moment the elongation reaches 0, 90, 180 or 270
     degrees. It advances about 12.2° a day and never runs backwards, so a
     step of six hours brackets each crossing and bisection closes it to
     under a second. */
  const PHASES = [['new', 0], ['first', 90], ['full', 180], ['last', 270]];
  const elongAt = ms => norm(moonEcliptic(ms).lon - sunEcliptic(ms).lon);
  function crossing(t0, t1, target) {
    const f = t => { const d = norm(elongAt(t) - target); return d > 180 ? d - 360 : d; };
    let a = t0, b = t1, fa = f(a);
    for (let k = 0; k < 40 && b - a > 1000; k++) {
      const c = (a + b) / 2, fc = f(c);
      if ((fa < 0) === (fc < 0)) { a = c; fa = fc; } else b = c;
    }
    return Math.round((a + b) / 2);
  }
  function phasesBetween(from, to) {
    const out = [], STEP = 6 * 3600000;
    let t = from, e0 = elongAt(t);
    while (t < to) {
      const t1 = Math.min(t + STEP, to), e1 = elongAt(t1);
      for (const [type, target] of PHASES) {
        const a = norm(target - e0), span = norm(e1 - e0);
        if (a > 0 && a <= span) out.push({ type, time: crossing(t, t1, target) });
      }
      t = t1; e0 = e1;
    }
    return out;
  }

  /* The lunation holding a moment: the new moon before it to the new moon
     after it. This is the Moon's own calendar — the unit it keeps, rather
     than a civil month cut across it. */
  function lunation(ms) {
    const start = phasesBetween(ms - 31 * DAY, ms).filter(p => p.type === 'new').pop();
    const end = phasesBetween(ms, ms + 31 * DAY).find(p => p.type === 'new');
    return {
      start: start.time, end: end.time,
      phases: phasesBetween(start.time - 1000, end.time + 1000)
    };
  }

  /* When the Moon crosses from one constellation into the next: hourly
     samples locate the change, bisection places it to the minute. */
  function ingresses(from, to) {
    const out = [], STEP = 3600000;
    let t = from, c0 = moon(t).constellation;
    while (t < to) {
      const t1 = Math.min(t + STEP, to), c1 = moon(t1).constellation;
      if (c1 !== c0) {
        let a = t, b = t1;
        while (b - a > 30000) { const c = (a + b) / 2; if (moon(c).constellation === c0) a = c; else b = c; }
        out.push({ time: Math.round(b), from: c0, to: c1, name: nameOf(c1) });
      }
      t = t1; c0 = c1;
    }
    return out;
  }

  /* ── Seen from a place ────────────────────────────────────────────────
     Everything above is geocentric: the phase and the constellation are the
     same for every observer. Where you stand decides only whether the Moon is
     above your horizon, and when it rises and sets. Sidereal time from Meeus
     12.4; the Moon's horizon altitude h0 = 0.7275·π − 0.5667° (Meeus 15), which
     folds in its parallax, its radius and refraction at the horizon. */
  function siderealDeg(ms) {
    const jd = ms / DAY + 2440587.5, T = (jd - 2451545) / 36525;
    return norm(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - T * T * T / 38710000);
  }
  function horizon(ms, lat, lon) {
    const m = moonEcliptic(ms), eq = toEquatorial(m, ms);
    const H = siderealDeg(ms) + lon - eq.ra;
    const alt = Math.asin(sin(lat) * sin(eq.dec) + cos(lat) * cos(eq.dec) * cos(H)) * DEG;
    const az = norm(Math.atan2(sin(H), cos(H) * sin(lat) - Math.tan(eq.dec * RAD) * cos(lat)) * DEG + 180);
    const parallax = Math.asin(6378.14 / m.dist) * DEG;
    // alt is geocentric (what the rise/set test uses); altTopo is as seen from
    // the ground, lower by the parallax — up to a degree for the Moon.
    return { alt, altTopo: alt - parallax * cos(alt), az, h0: 0.7275 * parallax - 0.5667 };
  }
  const isUp = (ms, lat, lon) => { const h = horizon(ms, lat, lon); return h.alt > h.h0; };

  /* Rise and set between two moments: ten-minute samples find each change,
     bisection places it to within half a minute. */
  function riseSet(from, to, lat, lon) {
    const out = [], STEP = 600000;
    let t = from, up0 = isUp(t, lat, lon);
    while (t < to) {
      const t1 = Math.min(t + STEP, to), up1 = isUp(t1, lat, lon);
      if (up1 !== up0) {
        let a = t, b = t1;
        while (b - a > 20000) { const c = (a + b) / 2; if (isUp(c, lat, lon) === up0) a = c; else b = c; }
        out.push({ type: up1 ? 'rise' : 'set', time: Math.round((a + b) / 2) });
      }
      t = t1; up0 = up1;
    }
    return out;
  }

  return { moon, sun, phasesBetween, lunation, ingresses, nameOf, horizon, riseSet, DELTA_T_S };
})();
if (typeof module !== 'undefined') module.exports = Sky;
