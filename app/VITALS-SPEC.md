# The left column — planetary vital signs

Defined 19 September 2026. The right rail carries discrete events that cross a
threshold. This column carries continuous state: numbers that move slowly and
mean something at every moment, rather than things that happen. Value plus a
sparkline of recent history, so level and direction read at once.

Two tiers, the same pattern as seismic: the face carries the headline sign, its
own view carries the full picture.

## On the face — five signs

| Sign | Source | Verified value | Cadence | Access |
|---|---|---|---|---|
| CO₂, global | NOAA GML `co2_trend_gl.txt` | **424.63 ppm** (18 Sep 2026) | daily | direct, CORS ✓ |
| Temperature anomaly | NASA GISTEMP `GLB.Ts+dSST.csv` | **+1.40 °C** (Aug 2026) | monthly | proxy |
| Arctic sea-ice extent | NSIDC `N_seaice_extent_daily_v4.0.csv` | **4.666 M km²** (18 Sep 2026) | daily | proxy |
| El Niño · ONI | NOAA CPC `oni.ascii.txt` | **+1.80** (JJA 2026, strong) | monthly, weekly available | proxy |
| Frontier training compute | Epoch AI `large_scale_ai_models.csv` | **5.0 × 10²⁶ FLOP** · Grok 4 · 9 Jul 2025 | on publication | proxy |

## In its own view — the full picture

Everything above at full size with longer history, plus what does not earn
face space:

| Sign | Source | Verified value | Status |
|---|---|---|---|
| Methane, global | NOAA GML `ch4_mm_gl.txt` | **1939.4 ppb** (May 2026) | direct, CORS ✓ |
| Mean sea level | NOAA STAR `slr_sla_gbl_free_all_66.csv` | **85.02 mm** above baseline | proxy |
| Weekly Niño-3.4 | NOAA CPC `wksst8110.for` | weekly SST anomaly | proxy |
| Compute growth rate | derived from Epoch AI | **×1.7 per year** since 2021 | fitted, not measured — label it so |
| Runs above 10²⁵ FLOP | derived from Epoch AI | running count | monotonic, moves a few times a year |
| Full model history | Epoch AI | 323 models, 2019–2026 | model-by-model, sortable |
| Autonomy time horizon | METR `eval-analysis-public` | — | **source pending**: repo not reachable from this session |
| Recorded AI incidents | AI Incident Database GraphQL | — | needs a POST query, not a plain GET |

## The compute sign was frozen, and that is why it was removed

The running maximum, which is what the face sparkline plots:

| | | |
|---|---|---|
| 2019 | 1.1 × 10²³ | AlphaStar |
| 2020 | 3.1 × 10²³ | GPT-3 175B |
| 2021 | 1.7 × 10²⁴ | EXAONE 1.0 |
| 2022 | 2.7 × 10²⁴ | Minerva 540B |
| 2023 | 5.0 × 10²⁵ | Gemini 1.0 Ultra |
| 2025 | 5.0 × 10²⁶ | Grok 4 |

It has not moved since July 2025 — and not because scaling stopped. Every 2026
frontier model in the dataset carries no compute figure at all: GPT-5.5, Claude
Opus 4.7, Gemini 3.1 Pro, Grok 4.3 Beta, all blank. The 2026 entries that do
carry figures are small efficient models around 10²⁴. The labs stopped
disclosing and Epoch has not published estimates for the closed frontier.

So this is a measurement gap, not a plateau, and the face must say so: the value
carries its date, and a line states that no larger run has been publicly
estimated since. A flat sparkline beside CO₂ climbing daily would otherwise
imply exactly the wrong thing.

## The compute ticker counts installed hardware, not training runs

The disclosed record froze in July 2025 and no arithmetic recovers a number
nobody released. Estimating what was trained — chips × utilisation × run
length — was built, measured, and removed: every factor past the chip count is
a guess, and a guess dressed as a reading is exactly what this column exists
to avoid.

What remains measured is the hardware. Epoch tracks the world's AI data
centres from satellite imagery and construction permits and publishes each
site's current chip count:

    https://epoch.ai/data/data_centers/data_centers.csv

    installed rate = Σ H100-equivalents × 9.894 × 10¹⁴ FLOP/s

Two published factors, no assumptions. 13.7 million H100-equivalents across 70
sites, 13.2 GW, largest single site 1,111,673 H100e at 946 MW — giving
13,530 EFLOP/s, which is what the AI COMPUTE ticker integrates. Ticked in
ZFLOP (10²¹) so the running total stays legible through a night of running.

**Peak, not effective.** No utilisation factor is applied because none is
published for these sites. The face reads "installed peak", so the number is
capacity in the ground, not work done.

The frozen disclosed maximum stays in the view above it, with its date and its
explanation. It is still a measurement — the last one the labs published — and
the two sit together on purpose: what was last disclosed, and what has been
built since.

## The autonomy horizon answers what compute can no longer say

Because the compute sign froze in July 2025, the view needed a capability
measure the labs have not stopped publishing. METR fits, per model, the length
of task it completes on its own half the time — in minutes of human expert
work — and publishes the fit as the YAML its own chart reads:

    https://metr.org/assets/benchmark_results_1_1.yaml

Read as the running maximum across the 26 models in the file, on the same log
scale as compute. As of the April 2026 entry it stands at 17 h 25 min, against
3.1 hours at the stricter 80% bar, and METR's own fit since 2023 doubles it
about every 129 days.

Two things are deliberate. The model names are METR's keys, uncleaned, because
inventing display names invites mismatches with the source. And the horizon is
a level, not a flow, so it does not tick — the same rule that keeps CO₂ out of
the ticker row.

The file is YAML, and the reader in `vitals.js` handles only the shape this
file has: plain keys, plain scalars, two-space indent. That is narrower than a
library on purpose — if METR changes the shape, it fails loudly and the slot
says so, rather than half-parsing into a wrong number.

## Why there is no "AI risk level"

Nobody publishes a live, measured AI risk number. What exists is either an
annual judgement by a committee or an index somebody invented. A fabricated
score standing next to CO₂ at 424.79 ppm would quietly poison the column: the
reason the space-weather panel can be trusted is that it says "waiting for the
reading" rather than guessing.

So the section holds three things, each of them a record of something that
happened rather than a forecast:

- **installed compute** — chips in the ground, counted
- **autonomy time horizon** — a fitted capability measure, published
- **AI incidents** — reports of AI systems causing harm, from the AI Incident
  Database's feed, newest first with the outlet named and the report one click
  away

The incident feed replaced a table of the largest training runs on record.
That table, and the frozen 5 × 10²⁶ FLOP headline above it, were a measurement
of something that stopped being measured in July 2025 — a monument to a gap.
What is still live is the hardware and the harm.

## The column is tickers only

Every sign on the face is a flow, counting from zero the moment the page opens.
Nothing on the face sits still. Levels — concentrations, indices, the largest
training run — are not flows and cannot tick honestly, so they move to the view,
where they sit at measured precision with the date they were measured.

| Ticker | rate | after 1 min | after 1 hour |
|---|---|---|---|
| CO₂ emitted | 1,185 t/s · Global Carbon Budget 37.4 Gt/yr | +71,000 t | +4.27 M t |
| Heat into the Earth system | ~0.66 PW · energy imbalance ≈1.3 W/m² | +4.0 × 10¹⁶ J | +2.4 × 10¹⁸ J |
| AI training compute | ≥6.2 × 10¹⁸ FLOP/s · Epoch AI, trailing year | +3.7 × 10²⁰ FLOP | +2.2 × 10²² FLOP |
| Arctic sea ice | ±0.109 km²/s · NSIDC, trailing 7 days, signed | +6.5 km² | +392 km² |
| Sea level | +0.126 nm/s · NOAA STAR, +3.99 mm/yr | +7.6 nm | +455 nm |

Each ticker names its rate and where the rate came from, so the number is
visibly an integral of a measured quantity rather than a reading.

### What this costs

- **CO₂ concentration** stops being a face sign. At 0.052 parts per trillion per
  second a page-open counter gains 0.00003 ppm in ten minutes. Emitted tonnes is
  its ticking companion; 424.63 ppm keeps its place in the view.
- **Temperature anomaly** becomes heat into the system. The anomaly is a state,
  the imbalance is the flow producing it. +1.40 °C stays in the view.
- **Frontier training compute** becomes compute expended per second. The largest
  known run, 5.0 × 10²⁶ FLOP for Grok 4, is a step and stays in the view.
- **El Niño cannot tick at all.** ONI is an index, not a flow. It lives in the
  view as a value with its date, unless it is wanted on the face as the one
  still sign among five moving ones.

### The compute flow is a lower bound

6.2 × 10¹⁸ FLOP/s is the total training compute of the 44 models published in
the trailing year, spread over that year. Every 2026 frontier model — GPT-5.5,
Claude Opus 4.7, Gemini 3.1 Pro, Grok 4.3 — carries no published figure, so the
true flow is higher by an unknown amount. The face says "at least".

### Why the levels are not extrapolated instead

Tested against the record: take the CO₂ reading from 90 days ago, 428.14 ppm,
extrapolate forward at the measured trend, and it predicts 428.55 ppm for today.
The actual reading is 424.63 ppm — wrong by 3.92 ppm, 2.4 years of trend growth,
in the wrong direction, because the seasonal cycle has an amplitude of 6.27 ppm
against a 1.65 ppm annual trend. A flow counter cannot fail this way: it never
claims to know a present level.

## Transport

`proxy.php` on the host is a dumb allowlisted pass-through, not a parser: it
fetches an allowlisted URL and can return only the tail of a large file, since
the sea-ice and Epoch files run to megabytes and a browser should not pull
those whole on every visit. All parsing lives in `vitals.js`, so the website and
the desktop app share one implementation — the app routes through the Electron
main process exactly as it already does for the event streams, and never needs
the PHP.
