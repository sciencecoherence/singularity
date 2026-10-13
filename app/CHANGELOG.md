# Changelog

Every change to the app gets a new version, recorded here, newest first.
The version is written in one place only: `source/package.json`. The app
shows it in the status bar; Build Runtime prints it.

Versions follow [Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH.

- **MAJOR** — a change that breaks what was there: a redesign, settings or
  saved data that no longer carry over, a page or feature removed.
- **MINOR** — something new that keeps everything else working: a page, a
  layer, a data source, an alert.
- **PATCH** — a fix or an adjustment to what exists: layout, wording, a bug.

## 2.13.0 · 2026-10-13
- Added: a shared record of AI incidents, kept by the website
  (`web/api/memory.js`). A feed holds only its newest stories — Al Jazeera's
  last 25 cover about four hours — so each copy of the monitor knew only what
  passed while it was open: the app, running for weeks, had a containment
  report and 158 incidents that a website opened today could not see. The
  record keeps 60 days. The website's server reads the AI Incident Database
  and the newsrooms on every visit (at most once a quarter hour), and the app,
  given the key in Settings → Shared record key, sends everything it has read.
  Every copy reads the record every ten minutes and merges it into its own.
- Changed: what makes a report an AI incident or a containment report now
  lives in one file, `lib/incidents.js`, read by the page and by the server.
- Changed: the AI page's containment alerts give the time the report came
  out, not the moment this copy happened to log it.
- Changed: up to 400 AI incidents are kept (was 220, shared with the other
  lists).

## 2.12.1 · 2026-10-13
- Fixed: Energy · refinery reports on the website. GDELT refuses requests
  from shared servers such as Vercel's, so the panel stayed empty there. Google
  News is now read alongside GDELT, in the app and on the website; the two are
  merged, one row per story, and the panel works when either answers.

## 2.12.0 · 2026-10-13
- Added: the web edition, built from this source and served on Vercel with
  one cached proxy function, `/api/feed`.
- Moved: the app now lives in the `singularity` repository, as `app/`, with
  the website beside it as `web/` (formerly cohera\temporal-live).
  `Build-Runtime.ps1` finds Temporal Matrix's Electron from either place. Run
  Build Runtime.cmd from the new folder once to build `app/runtime/`. The page reads where its
  proxy is from `<meta name="sm-proxy">` (proxy.php when absent, so a PHP
  host still works) and shows its version from `<meta name="sm-version">`.
- Changed: NASA's near-Earth objects are read through the proxy on the web, so
  one DEMO_KEY reading, cached three hours, serves every visitor. The
  desktop app is unchanged (it reads every source itself).

## 2.11.3 · 2026-10-13
- Fixed: every live source failed with "connection closed before response
  completed" (8 of 49 sources live, from cache). 2.11.2 treated the request's
  'close' event as a failure, but Electron's request is a writable stream
  that emits 'close' as soon as the request has been sent, before the
  response arrives. The handler is removed; a dead connection still reaches
  'error', and anything else the 60-second timeout. Checked: 47 of 49 sources
  live after 90 seconds (NASA's DEMO_KEY was rate-limited from the test
  machine; the energy news sweep was still queued).

## 2.11.2 · 2026-10-13
- Fixed: live-feed response errors such as `net::ERR_CONNECTION_CLOSED`
  are returned to the source-status handling instead of escaping into
  Electron's main process and opening an error dialog.
- Fixed: request errors, interrupted responses, premature connection closure,
  timeouts and intentional download cutoffs share one completion path.
  Timers are cleared and late events cannot replace a result or cache a
  partial response. Failed requests remain eligible for the next refresh.
- Added: feed failures log their timestamp, source hostname and error.

## 2.11.1 · 2026-10-13
- Fixed: Content-Security-Policy in `index.html` now includes
  `https://api.worldbank.org` in `connect-src`, restoring the World Bank
  population and demographic indicators on the Society page.
- Fixed: `web-proxy.php` now allowlists the 11 sources added in 2.1–2.11
  (`ir.eia.gov`, `www.eia.gov`, `query1.finance.yahoo.com`,
  `nominatim.openstreetmap.org`, `news.google.com`, `www.nhc.noaa.gov`,
  `www.metoc.navy.mil`, `unstats.un.org`, `stats.bis.org`, `api.imf.org`,
  `cdn.jsdelivr.net`) so browser and web deployments match the desktop app.
- Fixed: `Net.text()` in the desktop app now cuts `tail` responses at the
  first newline boundary (matching `web-proxy.php`), preventing partial first
  CSV/XML lines in NSIDC sea-ice and Epoch AI model tables.
- Fixed: `fetchFeed()` in `main.js` now trims `Range` (`head`) responses to
  the last newline on stream end, avoids caching transient error responses,
  and bounds `feedCache` size.
- Fixed: unchecking "Read the live planetary streams" in Settings now pauses
  transport fetches across all 10 background modules via `Net.setPaused()`,
  re-enabling streams starts all 10 modules (`startStreams()`), and
  `Feeds.start()` is now idempotent so saving Settings no longer spawns
  duplicate polling loops.
- Fixed: requests to `news.google.com` now pass through a shared 1.2-second
  spacing queue in `Net.text()` so concurrent sweeps across Energy, Society,
  War, and Economy do not collide and trigger HTTP 429 rate limits.
- Fixed: `article.js` validates each HTTP redirect hop against the private-IP
  and protocol policy before following, preventing redirect-based SSRF.
- Fixed: `--smoke-test` in `main.js` updated for the 2.7+ Overview and topbar
  DOM (`#mx-time`, `#mx-v`).
- Improved: `renderer.js` and `views.js` skip hidden Matrix clock DOM writes
  and off-page `requestAnimationFrame` ticker work; `GlobeKit.countryFeatureAt`
  memoizes point-in-polygon lookups across `globe.js`, `watch.js`, and
  `war.js`; added keyboard shortcut `D` for the Discovery page.

## 2.11.0 · 2026-10-13
- Added: an Economy page in the Intelligence section (key C).
  - Markets every five minutes (Yahoo Finance): S&P 500, Nasdaq, Euro Stoxx
    50, FTSE 100, Nikkei, Shanghai, Bovespa, the US 10-year yield, the VIX,
    the dollar index, gold and bitcoin, with the day's and month's change.
  - Central bank policy rates (BIS, 38 central banks, the euro area as one):
    the rate, the date and size of the last change, the change over a year
    and a step chart of the year. Sort by rate, latest decision or most cut.
  - Any country (yours by default): its policy rate (or, for a dollarized
    country like Ecuador, the Fed's), its currency against the dollar over a
    week, a month and a year, and the IMF World Economic Outlook for last
    year to next (growth, inflation, unemployment, public debt, fiscal
    balance, current account, GDP, GDP per person) beside the world.
  - Currencies against the dollar: every currency, the weakest and strongest
    this month and this year.
  - Economic stress: a news sweep in five languages every 20 minutes, tagged
    crisis (default, devaluation, hyperinflation, bank runs), IMF rescue,
    recession, rates, inflation or outlook; your country read on its own.
  - Every economy: a sortable table of GDP, growth, inflation,
    unemployment, debt, fiscal balance, policy rate, the currency's year and
    crisis reports.
- New hosts in `main.js`: stats.bis.org, api.imf.org, cdn.jsdelivr.net.
  Run Build Runtime.

## 2.10.0 · 2026-10-13
- Added: a War observatory page in the Intelligence section (key R).
  - Every ongoing armed conflict from Wikipedia's List of ongoing armed
    conflicts, in its four tiers (major wars, minor wars, conflicts,
    skirmishes), with where, since when, and deaths this year and last. A
    copy of the list is bundled so the page opens complete; the live list is
    read twice a day.
  - Reports filed under each conflict: Wikipedia's curated Current events,
    Al Jazeera, BBC World, UN News, GDELT, and a new news sweep in six
    languages (English, French, Spanish, Arabic, Russian, Portuguese) every
    20 minutes. Each report is tagged strike, ground fighting, casualties,
    ceasefire or talks, or humanitarian.
  - Click a conflict for its Wikipedia summary, its numbers and its latest
    reports.
- Added: an AT WAR layer on the globe (on by default): countries where a
  listed conflict is fought, hatched red, orange or amber by tier. A country
  the list names only as a neighbour shows only when the week's reports say
  the fighting reaches it.
- Changed: the World page no longer lists armed conflict; it is on the War
  page. World keeps politics, disasters, law, the economy and the rest.

## 2.9.0 · 2026-10-13
- Added: a Society page in the Intelligence section (key S).
  - World population now, born today, died today and net growth this year,
    ticking: the World Bank's latest mid-year count (UN World Population
    Prospects) carried forward at the latest birth and death rates.
  - Protest and unrest, 48 hours: a news sweep in five languages every 20
    minutes, each headline placed in the country it names, and your country
    read on its own. Levels: reports, protests, unrest (violence reported by
    three or more outlets, or a coup). Football, games and protest votes are
    left out. The sidebar counts countries with protests or unrest.
  - Elections: Wikipedia's national electoral calendars for this year and
    next; the next six months, the last two, and your country's. Click one
    for Wikipedia's summary.
  - People: any country (yours by default) against the world, with its
    population now, an age-and-sex pyramid, and 15 World Bank readings
    (fertility, life expectancy, poverty, inequality, unemployment, income,
    internet, homicide and more).
  - How people live: ten UN SDG indicators from the UN Statistics Division,
    with the change since 2015 and the trend.
  - Every country: a sortable table of population now, growth, fertility,
    life expectancy, urban and 65+ shares, the street level and the next
    national vote.
- New hosts in `main.js`: api.worldbank.org, unstats.un.org. Run Build
  Runtime.

## 2.8.0 · 2026-10-12
- Added: a Matrix page in the Time section (key X). The full Matrix clock —
  the day's ring with recent M5+ earthquakes on it, the time, the date and the
  dilation wave — drawn as large as the window allows, with the readings
  beside it: Matrix time and date, regime, dilation, civil time, and where the
  count stands.
- The setting "Mark recent earthquakes on the Matrix clock ring" is back.
- Removed: the caption under the Sun on the Overview; the Sun takes the space.

## 2.7.1 · 2026-10-12
- Fixed: the Matrix time moved from the foot of the threshold card to the
  status bar at the bottom of the window, after UTC and local time. The
  threshold card now ends with its progress bar, with no launch date.

## 2.7.0 · 2026-10-12
- Changed: the Overview's left panel is now the Sun's corona (SDO/AIA 193 Å,
  the Solar page's Corona layer) instead of the Matrix clock face. A new frame
  every quarter hour, NOAA's active regions numbered on it, GOES SUVI 195 Å if
  Helioviewer does not answer. Click the Sun to open the Solar page on the
  Corona layer.
- Changed: the foot of the Singularity Compression Threshold card shows the
  Matrix time and date instead of the protocol launch date. The Matrix time
  also stays in the top bar.
- Removed: the setting "Mark recent events on the clock ring", which had no
  ring left to mark.

## 2.6.0 · 2026-10-12
- Added: cyclones show the wind they have now, not their peak. GDACS rates a
  storm by its lifetime maximum, so a weakened hurricane kept reading at its
  strongest. A new stream, CYCLONES NOW, reads the agencies that warn on each
  storm every 10 minutes: NOAA's National Hurricane Center (Atlantic, eastern
  and central Pacific) and the Joint Typhoon Warning Center (every other
  basin). Labels on the globe and map, the Hazards list and the Overview
  stream show the wind now; the detail adds gusts, Saffir-Simpson category,
  pressure, heading and speed, the 24-hour forecast (strengthening,
  weakening, holding) and the advisory with its time, and keeps the peak
  beside it. An open cyclone refreshes when a new advisory arrives.
- A GDACS cyclone no agency still warns on is marked "peak"; a storm the
  agencies warn on that GDACS has not listed yet appears at once, unrated.
- New hosts in `main.js`: www.nhc.noaa.gov, www.metoc.navy.mil. Run Build
  Runtime.

## 2.5.3 · 2026-10-12
- Fixed: every country loads by itself. Three countries are read at once, a
  second apart, backing off if Google refuses: the first full round takes
  about three minutes. Countries with reports are read again every 10
  minutes, the rest every 90. What has been read is kept on this computer,
  so at the next launch every country shows its level at once.
- Fixed: the country panels keep one size (590 px) whatever the country and
  scroll inside.

## 2.5.2 · 2026-10-12
- Fixed: a country's level no longer jumps when you open it. Every country
  now gets its own search in the background (flagged countries first, then
  every half hour; the rest about every six hours), so all levels rest on the
  same evidence. Levels not yet read in full are marked "?".
- Fixed: levels reflect the supply, not the volume of news. Rationing, load
  shedding, scheduled cuts, shortages and nationwide blackouts make a
  country strained or in crisis; one-off outages (a storm, a fault) stay at
  watch however many; "energy crisis" in oil-market news counts for little.
- Fixed: reports go to the right country — a search's result must name the
  country in its headline unless it comes from that country's own press
  (its domain, or outlets seen naming it); "Russian" no longer claims a
  headline about Kyiv; cities and utilities (Kyiv, Karachi, Eskom, CENACE…)
  place a headline; Brazilian Salvador and Costa Rica are no longer the
  countries; metaphors ("apagão de dados", a team's 'apagão') and water
  rationing are not energy news; a headline naming several countries splits
  its weight.

## 2.5.1 · 2026-10-12
- Changed: the AI data centres moved from the Energy page to the AI page,
  with a summary (sites, power, compute, largest owners, where); a click
  still opens a site on the globe. On the Energy page, refinery reports now
  sit under the refinery list.

## 2.5.0 · 2026-10-12
- Added: the country energy watch. Every country gets a level (crisis,
  strained, watch, quiet) from the last 72 hours of press reports on power
  cuts, load shedding, rationing and fuel shortages — Google News in English,
  Spanish, Portuguese, French and Arabic every 20 minutes — plus its
  refineries in the incident register and GDACS disasters.
- Added: Home country (Settings, or on the Energy page; automatic from your
  location). A dedicated watch every 10 minutes in the country's own language
  and in English; an outlook (hydro share and low water, oil imports and the
  oil price, gas and electricity imports, refineries, disasters, cuts
  announced ahead) with the electricity mix (Our World in Data).
- Added: alerts — new reports in your country (at most one alert in six
  hours, red when the words are grave) and a rise in its level; optionally
  any country reaching crisis.
- Added: ENERGY CRISIS layer on the globe, countries shaded by level; a click
  on a country shows its level and opens it on the Energy page.

## 2.4.1 · 2026-10-12
- Fixed: the Sun card on the Solar page — the image column is exactly the
  image, so there is no empty space beside it; the region list takes the rest.

## 2.4.0 · 2026-10-12
- Added: the version, from package.json, in the status bar.
- Added: Build Runtime.cmd opens the app with one key when the build succeeds.
- Added: this changelog and the versioning rules.

## 2.3.2 · 2026-10-12
- Changed: the Sun on the Solar page fills its card.

## 2.3.1 · 2026-10-12
- Changed: Solar page — the K index moved to the top; the Sun is a small card
  with a full-screen view (every layer, labels, region detail; Esc closes).

## 2.3.0 · 2026-10-12
- Added: Solar page — the Sun (SDO, SUVI, LASCO, WSA-Enlil) with NOAA's active
  regions; the forecast (watches, warnings, three-day outlook, L1 wind and
  lead time, Enlil arrivals); storm watches and warnings in the alert log
  hours to days ahead; the K index bar by bar, with a local record of the L1
  wind.

## 2.2.0 · 2026-10-11
- Changed: renamed Singularity Monitor.
- Changed: Overview — two tiles removed, Realized renamed Space Launch, space
  weather reduced to one band, more room for the clock, globe and launches.

## 2.1.0 · 2026-10-11
- Added: Energy page and globe layers — 712 refineries with a dated incident
  register and live news matching, US oil reserves (EIA weekly, SPR history),
  Brent and WTI, the IEA's world stocks, Epoch AI's frontier data centres.

## 2.0.0 · 2026-10-11
- Changed: the desktop app rebuilt as an operations console — sidebar and
  workspace, light and dark themes, a 3D vector globe, IBM Plex. The 1.x app
  is kept in `archive/app-2026-10-11`.

## 1.0.0
- The first desktop app and screensaver.
