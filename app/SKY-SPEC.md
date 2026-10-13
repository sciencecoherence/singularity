# The Moon's cycle

Its own page since 29 September 2026: the small moon among the header tools
(or **M**) opens it, and again returns to the view you came from. The icon is
the Moon's phase as it is now, redrawn each minute. It was a section of
Orbital; Orbital now carries the Kessler watch and the near-Earth approaches.

Defined 24 September 2026. Replaces the space-station ground track, which drew
only the path seen since the page opened, on a bare grid with no map — a short
line in an empty box — and asked a server for the station's position every
twelve seconds to do it.

## What it shows

- **The Moon now** — its phase drawn from the computed lit fraction, the phase
  name and percentage lit, the constellation it stands in and when it enters
  the next, its day in the lunation, its distance and apparent size, and the
  constellation the Sun is in.
- **One lunation** — new moon to new moon, the unit the Moon itself keeps,
  laid on the six-day Matrix week. Each Matrix date has its phase at the
  date's middle, the constellation it begins in, and the Matrix clock time of
  every principal phase and constellation crossing that falls in it. Every
  date can be selected. ‹ › step a lunation back or forward, up to twelve
  each way. (First built on the civil week; moved to Matrix time the next day
  — see below.)

## On Matrix time (25 September 2026)

Every date and time on the panel is Matrix time; nothing civil is shown.

- **A cell is a Matrix date** — 24 h 20 min 58.1 s, counted from the March
  equinox anchor — on the six-day Matrix week, Differa to Stilla. A lunation
  of 29.53 civil days is about 29.1 cells.
- **Every clock reading is the Matrix clock at your longitude** — the dilated
  solar day, 12:00 at peak sun. Date and clock are independent readings of the
  same Matrix, so a date can open at any hour: the panel says when each one
  opens and closes (on 8 September, 03:10 and 03:32).
- **Durations are Matrix dates and Matrix hours**, one Matrix second being a
  86,400th of a date (1.0146 s). The countdown drops three Matrix seconds in
  3.1 real ones.

**Selecting a date** shows the Moon at the middle of that date: phase and lit
fraction, the constellations it passes through with their times, where it
stands between the principal phases ("0.1 dates after full moon · 6.6 before
last quarter"), its place in the lunation, any principal phase in the date,
moonrise and moonset where you are, distance and size, and the Sun's
constellation. Selecting it again, or *Back to now*, returns to the present.

**The countdowns** run to the next full and new moon. That instant is the same
everywhere on Earth; what your place changes is the Matrix clock it reads at
and whether the Moon is above your horizon then — and if not, when it rises.
Checked against the engine: the full moon of 26 September 2026, 16:48:50 UT,
reads Selecta 8 September · 11:41:28 at 79.22° W, twenty minutes before the
Sun's peak there, as it should.

**Location.** Longitude sets the Matrix clock, as before. Latitude is new and
has no default: without it, rise, set and altitude are not stated rather than
guessed. *Use my location* asks the device; inside the desktop app Chromium's
network locator may not answer, so both fields stay editable by hand.

Moonrise and moonset (Meeus 12.4 sidereal time; h₀ = 0.7275·π − 0.5667°,
Meeus 15): 29 events over fifteen days at Vilcabamba, all within 23 s of
PyEphem.

## Constellations, not signs

The constellation is the region of sky the Moon is actually in, by the IAU
boundaries (Delporte 1930), located with Roman's 1987 method and table — the
same 357-segment table astropy uses. That gives thirteen constellations along
the Moon's path, Ophiuchus among them, and brief passages through Sextans,
Orion or Cetus at the edges. The astrological sign is a 30° slice counted
from the equinox; precession has carried it about one constellation away from
the sky it was named for, so the two differ most days. This page shows the sky.

## Nothing is fetched

It is arithmetic, in `sky.js`:

| | |
|---|---|
| Moon | Meeus, *Astronomical Algorithms* ch. 47 — the 60-term longitude/distance and 60-term latitude series of ELP-2000/82 |
| Sun | Meeus ch. 25 |
| Lit fraction | Meeus ch. 48, from the geocentric elongation |
| Precession to 1875 (for the boundary lookup) | Meeus ch. 21, rigorous |
| Phase and crossing times | found, not tabulated: the elongation is bracketed in six-hour steps and bisected; crossings in hourly steps, bisected to 30 s |
| ΔT | 69.2 s (IERS, 2026) — without it every phase would be a minute late |

## Checked against an independent ephemeris

PyEphem, 2025–2027:

| | |
|---|---|
| Moon longitude | max 24″, mean 10″ |
| Moon latitude | max 10″ |
| Distance | max 10 km |
| Lit fraction | max 0.24 percentage points |
| 148 principal phases | max 80 s, mean 28 s |
| Constellation, hourly for three months | 2,207 of 2,208 hours agree — the one miss is a boundary crossing within a minute of the sample |

A 66-minute passage through a corner of Sextans on 10 September 2026 was
confirmed the same way; the calendar lists every crossing in a day for that
reason.

Three misspellings in the names table astropy ships were corrected:
Ophiuchus, Chamaeleon, Piscis Austrinus.

The phase disc is drawn as seen from the northern hemisphere, lit side right
while waxing. Nearer the equator the same Moon appears rotated — a crescent
lies on its back — but the lit fraction is the same.
