# Temporal Live

An application built on the Temporal Matrix clock. It keeps the two elements
that carry the model — the central Matrix clock and the daily dilation wave —
and reads the planet while the clock runs, counting down to the two dates the
model already fixes.

Nothing here refreshes by hand. Every stream states its own cadence and the
instrument honours it.

It is an application: eight views, each with its own list, filters, sorting and
detail pane. (It began as a screensaver as well; that was removed on
28 September 2026.)

**On the reduction ladder.** `AGENTS.md` requires the Temporal Matrix to retain
the full derived ladder. It does: the ladder, the nineteen reductions, the live
integrated fraction and the approach to the next threshold are all in
`temporal-matrix`, unchanged and still installed. Julien's direction for *this*
application, on 19 September 2026, was to leave the ladder out and keep the
face to the clock, the wave and the live field. That is what this is.

## Temporal Live 2 · the console (11 October 2026)

The desktop app was rebuilt as an operations console; the website is left as
it was. The previous app is kept, untouched, in `archive/app-2026-10-11`.

- **Frame.** A dark top bar (page, the Matrix time, date and dilation, stream
  status, alerts, music, theme, fullscreen, settings), a sidebar of sections
  (Operations: Overview, Globe, Seismic, Hazards, Solar, Orbital, Energy ·
  Intelligence: Vitals, AI, World, Discovery · Time: Moon) that folds to its
  icons, and a status bar (UTC, local time, the count to launch, sources live).
- **Themes.** Light and dark, or follow Windows (Settings, the ◐ button or T).
  The Windows title bar follows. Every colour is a token in `style.css`.
- **Type.** IBM Plex Sans and Plex Mono (SIL Open Font License, `fonts/`).
- **Overview.** A row of readings (events, quakes, cyclones, realized,
  launches, CO₂ and AI compute since opening, the threshold), then the Sun's corona (SDO/AIA 193 Å, active regions
  numbered; click for the Solar page), a live globe that turns slowly until touched, the event
  stream, space weather and orbit, and what became real.
- **War.** `war.js`, Intelligence section (key R): every ongoing armed
  conflict (Wikipedia's list, four tiers, deaths this year and last; a copy in
  `lib/war-data.js` until the live list answers), the reports filed under each
  (Wikipedia Current events, Al Jazeera, BBC, UN News, GDELT and a six-language
  news sweep), and an AT WAR layer on the globe. World no longer carries war.
- **Economy.** `economy.js`, Intelligence section (key C): markets (Yahoo
  Finance), central bank policy rates (BIS), the IMF World Economic Outlook for
  every country (its SDMX API), currencies against the dollar (daily reference
  rates), an economic-stress news sweep, and every economy in one table.
- **Society.** `society.js`, Intelligence section (key S): the world's
  population now (World Bank / UN WPP, carried forward), protest and unrest
  by country from a five-language news sweep, elections from Wikipedia's
  national electoral calendars, a country's demography against the world
  (with an age pyramid), ten UN SDG indicators (UN Statistics Division), and
  every country in one sortable table.
- **Matrix.** In the Time section (key X): the full Matrix clock with its
  dilation wave, as large as the window allows, and its readings beside it.
- **Globe.** `globe.js`: an orthographic globe drawn with d3-geo on Natural
  Earth 1:50m (`lib/`, bundled, nothing fetched to draw the Earth). Every
  placed event, cyclone tracks coloured by class with cone and wind areas,
  night and twilight, the Sun's position. Drag to turn, wheel or pinch to
  zoom, double-click to zoom in, click for the story and webcams. The page has
  the list, search and the description of each event.
- **Keys.** 1–9 follow the sidebar from Overview to World; M the Moon; E
  Energy; T the theme; on the globe + − 0, arrows, [ ] and /.

`map.js` and `worldmap.js` are no longer loaded by the app (the website still
uses its own copies).

## Versions

The app follows Semantic Versioning (MAJOR.MINOR.PATCH), and every change to
it gets a new version — no update ships under the old number.

- The version is written in one place: `source/package.json`. The app shows
  it in the status bar (bottom right); Build Runtime prints it.
- MAJOR for a change that breaks what was there (a redesign, settings or saved
  data that no longer carry over, something removed); MINOR for something new
  that keeps the rest working; PATCH for a fix or an adjustment.
- Each version has its entry in `CHANGELOG.md`, newest first, with its date.

## Solar · the Sun, the forecast, the K index bar by bar (12 October 2026)

`sun.js`. The Solar page now has:

- **The Sun now.** Full-disc images: SDO/HMI sunspots and magnetogram, SDO/AIA
  corona (193 Å, coronal holes) and chromosphere (304 Å, filaments) through
  Helioviewer; GOES-19 SUVI 195 Å, the SOHO LASCO C3 coronagraph and the
  WSA-Enlil model from NOAA (the last two play the last day). NOAA's numbered
  active regions are drawn on the SDO layers, turned from their measurement
  time to the image time with the Sun's differential rotation and the B0 tilt.
  Click a region for its magnetic class, flare odds, when it rotates off the
  limb, and its day-by-day history.
- **Forecast.** The soonest thing coming, in hours (a storm watch, a Kp
  warning, a forecast storm bar, a shock at L1); NOAA's watches, warnings and
  alerts in effect, cancellations honoured; the three-day table (storms,
  radio blackouts, radiation) with NOAA's reasons; the solar wind at L1 now,
  with its lead time to Earth (about 40–90 minutes); the WSA-Enlil run's
  predicted wind at Earth, with fast-stream and CME arrival times.
- **Alerts ahead of time.** A NOAA storm watch of G2 or more, a warning of Kp
  6 or more, or a shock at L1 now reach the alert log and Windows
  notifications (when space alerts are on in Settings).
- **The K index.** Seven days observed and three forecast. Click a bar: the
  storm level and what it does, how far the aurora reached (and what Kp your
  location needs), the wind at L1 in that window (speed, density, Bz, Bt, and
  the curves when the one-minute record covers it), the model wind, the
  flares, and NOAA's messages in that window. NOAA serves only about a day of
  the L1 record, so the app keeps three-hour summaries on this computer
  (twelve days): bars older than the app's first run say so.
- Images load straight from api.helioviewer.org and services.swpc.noaa.gov
  (allowed in the page's content policy). Everything else is SWPC JSON.

## Energy · your country and every country (12 October 2026, 2.5.0)

`watch.js`, with `lib/countries-data.js` (249 countries: names in nine
languages, demonyms, capitals; electricity mix and oil and gas
self-sufficiency from Our World in Data).

- **Every country** gets a level from the last 72 hours of press reports on
  power cuts, load shedding, rationing, fuel shortages and energy crises:
  CRISIS, STRAINED, WATCH, QUIET. Crisis and strained need reports of the
  supply failing (rationing, load shedding, scheduled cuts, shortages,
  nationwide blackouts); one-off outages stay at watch. Every country gets
  its own search in the background, three at a time: a full round in about
  three minutes, then countries with reports every 10 minutes and the rest
  every 90. Results are kept between runs, so levels show at launch; a level
  not yet read in full is marked "?". Read from Google
  News in English, Spanish, Portuguese, French and Arabic every 20 minutes;
  each headline is placed in the country it names. It is a reading of the
  press, not of the grid: a country whose cuts go unreported reads quiet.
- **Your country** (Settings → Home country, or the selector on the Energy
  page; Automatic uses your latitude and longitude): a dedicated search every
  10 minutes in its own language and in English, new reports marked NEW, the
  cuts announced ahead, and an outlook — hydro share and whether water is
  short, oil imports and the oil price, imported gas and electricity,
  refineries, disasters on the ground — with the electricity mix.
- **Any country**: click it in the table (or on the globe) for the same view,
  read on demand.
- **Alerts** (Settings): "Energy crisis in my country" (on by default) — new
  reports, at most one alert in six hours, red when the words are grave, and
  a rise in its level; "Energy crises worldwide" (off by default) — any
  country reaching crisis, once a day.
- **Globe**: the ENERGY CRISIS layer shades countries by level.
- New host in `main.js`: news.google.com. Run Build Runtime.cmd once.

## Energy · refineries, oil reserves, AI data centres (11 October 2026)

`energy.js`, with its data in `lib/energy-data.js`. A sidebar page (E) and
three layers on the globe.

- **Refineries.** 712 crude refineries from Wikipedia's *List of oil
  refineries* (CC BY-SA), placed with OpenStreetMap through Nominatim (ODbL).
  About 270 are placed at their town rather than the plant; the detail says
  so. A hand-kept register, dated 11 October 2026, gives the status of the
  ones hit: destroyed, offline, damaged, reduced, attack reported, restored,
  closed. Every entry carries its dates and a link to its source, and is only
  as current as its last report: Russia (the 2026 drone campaign: Volgograd,
  Moscow, Kirishi, Ryazan, Syzran, Saratov, Yaroslavl, Kstovo, Omsk, Tuapse,
  Salavat, TANECO, Perm, Ust-Luga), Ukraine (Kremenchuk), the war with Iran
  (Ras Tanura, SAMREF, SATORP, Riyadh, Bapco Sitra, Mina al-Ahmadi, Mina
  Abdullah, Ruwais, Lanaz/Erbil, Haifa, Lavan, Abadan), and two closures
  (Grangemouth, Lindsey). Claims not independently verified are marked so.
  The register is the `inc` field of each refinery in `lib/energy-data.js`
  (generated; the build inputs are not kept here): to update it, ask Claude.
- **Fresh reports.** GDELT (every 30 minutes, first read 95 s after start) and
  the World page's feeds are scanned for refinery attacks and outages; a
  report naming a refinery attaches to it, marks it NEW, and makes its square
  pulse on the globe. The register's status is not changed automatically.
- **Oil reserves.** The US Strategic Petroleum Reserve, commercial crude,
  gasoline, distillate and jet stocks and refinery utilisation from the EIA
  Weekly Petroleum Status Report (ir.eia.gov, keyless, weekly); the SPR's
  weekly history since 1982 from the EIA series page; Brent and WTI front-month
  futures from Yahoo Finance's chart service. No one publishes world stocks
  weekly: the global block is the IEA's monthly Oil Market Report, written in
  with its date (September 2026) — update it when the next report comes out.
- **AI data centres** (on the AI page since 2.5.1). Epoch AI's Frontier Data Centers hub (CC BY), read live
  (93 sites on 11 October 2026). Epoch gives addresses, not positions: the
  bundled positions were geocoded once; a site Epoch adds later is looked up on
  Nominatim and remembered on this computer. These are the largest frontier
  sites, not every data centre.
- **Globe layers.** REFINERIES HIT (on), ALL REFINERIES (off), AI DATA
  CENTRES (on). Squares are refineries coloured by status (× destroyed,
  hollow closed); diamonds are data centres sized by power. The Overview globe
  shows the refineries hit and still down. Search on the globe finds any
  refinery or data centre.
- New hosts in `main.js`: ir.eia.gov, www.eia.gov, query1.finance.yahoo.com,
  nominatim.openstreetmap.org. Run Build Runtime.cmd once.

## What is on the face

**The clock** — Matrix time and the Matrix date, and beneath them, inside the
ring, the daily dilation wave. The wave had its own rail beside the clock for a
while; it belongs to the clock, because it is the shape of the second the clock
is keeping. The plot carries a strip of empty chart above the curve so the one
reading kept from that old rail — the dilation vector, seconds of physical time
spent per second lived — sits inside the graph it describes without ever
crossing it.

On the outer ring, faint marks show where in the last twenty-four hours each
earthquake arrived. Size follows magnitude, brightness follows how recently. The
ring already carries the day; the marks say where in that day the planet moved.

**The live field** — not everything that happens, only what would make someone
look up: an earthquake at magnitude 5 or above, a cyclone actually spinning
right now, and a volcano erupting. Magnitude 5 is roughly where an earthquake
stops being an instrument reading and starts being an event with a place and
people in it. Everything below that threshold is in the Seismic and Disasters
views, which carry the full lists.

The panel shows the whole of that selection rather than a window onto it. If it
is longer than the rail it scrolls. A new event jumps to the top and marks its
row.

The three counts above the list are of everything under way, not of the rows on
show — every event held, every earthquake of the last day whatever its size,
every active cyclone. The list is deliberately selective; the numbers above it
are not.

**03 · Singularity countdown** — two cards, stacked in the order they occur.

- *March equinox launch* — 20 March 2027, 20:25 UT. The anchor the website
  and app already share. When it passes, this card turns into the
  elapsed time since launch and reports τ and the reductions retained.
- *Natural absorption · τ\** — τ\* = 715.531301 Matrix dates after launch,
  which resolves to **15 March 2029, 19:13:52 UT**. This is not a date the
  interface chose. It is the derived absorption endpoint, where the retained
  entropic energy J_ret reaches its endpoint and the reading stops changing.
  Before launch the card states the full duration and waits; it moves when τ
  does.

**The reading** — the plain answer, and nothing else on the face. The six raw
space-weather and orbital numbers moved to the Solar and Orbital views, where
there is room to explain them; what stays here is what they amount to.

A number is not an answer. Kp 1.67 does not tell you whether anything is
happening; B2.9 does not tell you whether the sun is throwing something at us.
So the band carries a plain reading: a state — *All quiet*, *Stirring*,
*Active*, *Geomagnetic storm*, *Severe storm*, *Extreme storm* — one sentence
of what that means, and the three things people actually want to know.

| | |
|---|---|
| **Aurora** | Whether it is worth going outside, and roughly how far from the poles it reaches. |
| **Radio & GPS** | Whether shortwave and satellite navigation are affected, and whether that affects *you* — mostly it does not. |
| **Satellites** | The honest version of "are they going to fall down". |

The numbers themselves live one tab away, in Solar and Orbital, each with its
own plain line. They are the evidence for the sentence; they are not the thing
someone walking past the screen needs.

There are six states, not five. NOAA's G-scale stops at G5, but G5 covers
everything from a storm that puts aurora over Rome for a night to a
Carrington-class event that takes transformers with it. The top of a chart is
not the top of the physics, so the reading carries a sixth state for the far
tail — Kp pinned at 9 with a flare or a wind speed to match — and says the
harder thing rather than repeating the G5 line.

On satellites specifically, because it is the question that gets the most
nonsense: a geomagnetic storm heats the upper atmosphere, which swells, which
means a satellite in a low orbit ploughs through thicker air and loses height
faster. It is a real effect and operators plan around it. What it is not is
satellites dropping out of the sky — the one famous loss, in February 2022,
was a batch released into an unusually low orbit that had not yet climbed out
of it. Anything at a settled altitude just sinks a little faster and gets
pushed back up later. The panel says that rather than implying either
catastrophe or nothing.

Thresholds are NOAA's own: the G-scale for geomagnetic storms, the R-scale for
radio blackouts. The reading never guesses — a source that has not answered
says so rather than defaulting to calm, because a false "all quiet" is the one
failure that matters here.

## The views

The tab strip in the header moves between them. Number keys **1**–**8** do the
same. **↑ ↓** or **j k** move the selection inside a list, **Esc** clears it,
**/** jumps to that view's filter.

| | |
|---|---|
| **Field** | The instrument face: the realization wire on the left, the clock, the live field on the right, the countdown and two flow tickers (CO₂ emitted, AI compute) beneath, and the conditions strip — aurora, radio and GPS, satellites, and the Kessler status in the same green, amber and red. |
| **Seismic** | Every earthquake the USGS feed carries, scrollable. Filter by minimum magnitude and by place; sort by magnitude or by time. |
| **Disasters** | Everything that is not an earthquake. Filter by kind — cyclone, flood, volcano, wildfire, drought — and by alert level; sort by severity or by time. Every item says what its colour means. |
| **Solar** | The plain reading at full size with the explanations uncut, the four space-weather numbers each with its own plain line, the planetary K index over seven days at three-hour resolution with the Kp 5 storm threshold marked, and a short piece on what each of the four numbers actually is. |
| **Orbital** | The Kessler watch — what is in orbit, the high-speed passes ahead, breakups detected (`ALERTS-SPEC.md`) — and every upcoming near-Earth approach. |
| **The Moon** | No tab: the small moon in the header, showing tonight's phase, opens it (**M**). The lunation on the Matrix week, every date selectable, and the countdown to the next full or new moon (`SKY-SPEC.md`). |
| **Vitals** | Planetary state and the flows beneath it — the five tickers at full size, six measured levels each with its real series as a sparkline and the date it was taken, and the AI readings. Specified in `VITALS-SPEC.md`. |
| **World** | Human events that crossed a threshold. Wikipedia's Current events portal is the spine (CURATED); Al Jazeera, BBC World and UN News's peace-and-security desk add armed conflict (REPORTED); GDELT adds the rest (UNCONFIRMED). One story is one row. Filter to armed conflict, or to curated only. |
| **Discovery** | Science and capability in full: launches, agency announcements, arXiv preprints, and the whole realization list the face draws its top slice from. Filter by kind. |

Selecting a row opens it in the pane beside the list. Alongside the source's own
fields, the pane gives the instrument's reading of when the event happened: its
Matrix date, its Matrix time, and which regime of the daily wave it fell in.
With nothing selected the pane reads the whole list instead of sitting empty.

## The streams

| Stream | Source | Cadence | What it gives |
|---|---|---|---|
| Seismic | USGS, magnitude 2.5+ past day | 60 s | Magnitude, place, depth |
| Disasters | GDACS (EC / UN), current events | 5 min | Cyclones, floods, wildfires, with alert level and severity in physical units |
| Floods · volcanoes · drought | GDACS search by hazard; ReliefWeb (UN OCHA) floods; Smithsonian Global Volcanism Program via NASA EONET | 1 h | Every flood GDACS rated in sixty days that is still current; floods ReliefWeb lists as humanitarian disasters with the people affected, shown unrated where GDACS has no rating; droughts; eruptions |
| Kessler watch | CelesTrak: SATCAT boxscore, SOCRATES Plus, the full catalogue (app only) | 6–12 h | Objects in orbit, high-speed conjunctions ahead, breakups |
| Disasters, secondary | NASA EONET | 5 min | Used automatically when GDACS is unreachable; its events are shown unrated |
| Solar field | NOAA Space Weather Prediction Center | 2 min | Planetary K index, solar wind speed at L1, X-ray flare class, F10.7 flux |
| Approaches | NASA near-Earth object service | 3 h | Next body inside twenty lunar distances, or the nearest the week holds |
| Cyclones now | NOAA National Hurricane Center (CurrentStorms.json and each forecast/advisory); Joint Typhoon Warning Center warnings | 10 min | Each cyclone's wind now, gusts, pressure, movement and 24-hour forecast, matched to the GDACS event; GDACS's own figure is the lifetime peak |

Earthquakes come from USGS rather than GDACS so one earthquake is one row.

**The colours in Disasters** are GDACS's alert levels — the UN / European
Commission rating of expected impact on *people*: green minor, orange
moderate, red severe. They rate consequence, not size, which is why nearly
every wildfire is green: most burn where few people live. Droughts carry the
EU Global Drought Observatory's rating. Eruptions the Smithsonian lists as
ongoing but GDACS has not alerted are green by GDACS's own scheme, and say so.
Anything from the backup source, which rates nothing, is shown uncoloured — and
so are floods only ReliefWeb lists: people are affected, but no one has rated
them green, orange or red, and none is invented.

GDACS's current-events list stops at a hundred and is mostly wildfires, so
droughts and eruptions — slow, and never among the hundred — are asked for by
hazard. "Storm" and "Ice" were removed: NASA's severe storms are the same named
tropical storms GDACS lists as cyclones, and its sea-and-lake ice is icebergs.
On the face, only eruptions GDACS reported in the last week appear; the
long-running ones stay on the Disasters page.

A stream that fails doubles its own wait, up to twenty minutes, and its
reading is marked stale rather than shown as current. One stream failing never
stops another. The header states how many are live; the strip above the field
conditions names each one.

## The map

**⌖ MAP** in Disasters, **cyclones active** on the face, or **Show on the map**
on any selected event opens a world map of everything the streams hold that
comes with a position: cyclones, earthquakes of M 4.5 and above, eruptions,
floods, wildfires, droughts, coloured by GDACS level. Red events pulse; orange
ones carry a still halo. Each cyclone carries its GDACS track, every segment
coloured by the storm's class over it (depression, storm, hurricane or
typhoon), observed solid and forecast dashed, with its cone of uncertainty and
the areas of winds of 60, 90 and 120 km/h; tracks are re-read hourly while the
map is open, and storms that appear meanwhile get theirs too. Night and the
three twilights are shaded where the Sun is down, with the Sun's own position
marked.

The side panel lists every placed event, worst first, with a search box; a
row or a mark opens its story (USGS or GDACS, in words), its position, civil
and Matrix time, a cyclone's track status, and webcams nearby.

Drag to pan, wheel or pinch to zoom, double-click to zoom in. Keys: + and −
zoom, arrows pan, 0 is the whole world, [ and ] step through the events, / is
search, Escape clears the selection and then closes. The view always has the
frame's own proportions, so a click lands where it looks, and the world
repeats east and west across the date line. Land and borders are Natural
Earth, bundled (`worldmap.js`, regenerated by `worldmap-gen.mjs`); nothing is
fetched for the map itself.

**Webcams.** Selecting any point lists public webcams within 250 km, from
Windy's webcam service, each linked to its live page — once a free key from
api.windy.com/keys is entered in Settings. Without a key, a link opens Windy's
map at that point.

## Music

The desktop app can keep a Spotify playlist to the clock. It is off until you
connect it in Settings → Music, and it does nothing in the website build.

- **The dilation wave sets the volume.** The wave's low is the quiet of the
  day's burn, its crest the top of repayment; the volume runs between two
  limits you choose (30 % and 80 % to begin with). If you turn the volume
  yourself, the wave steps aside for ten minutes.
- **Alerts duck the music.** Red drops it to 12 % for 90 seconds, orange to
  25 % for 30, then the wave takes it back.
- **The countdown phase picks the playlist.** Approach (until launch),
  Retention (launch until τ\*), Absorbed (after τ\*). Each can have its own
  playlist or share the main one. The playlist starts when you switch sync on
  and when the phase turns over; otherwise what is playing is left alone.

**The default playlist.** Everyone starts on `DEFAULT_PLAYLIST`, the first
constant in `spotify-sync.js`. The playlist must stay public on Spotify, or
other people's accounts and the embedded player cannot play it. Change the
constant to change what ships.

**Without signing in.** The music button in the header opens Spotify's own
embedded player at the corner of the screen, with no account connected. It
plays the playlist the phase would have playing, and keeps playing when
closed. In the desktop app it plays previews only, however you are signed in:
the app keeps its own browser session, and Electron ships without the Widevine
module Spotify's web player needs for full tracks. Full tracks, the volume,
ducking and phase switching all come from connecting Spotify, which has the
Spotify you already run do the playing. Once connected, the header button opens a remote for the connected account instead of
the player: the track and its position, previous, play or pause and next, a volume
slider, the keep-to-the-clock switch, a button to start the playlist, and a way
through to the settings. It drives whichever device that account is playing on. The website build has the button and
the embedded player too (`web/spotify-sync.js`), and nothing else of this
section; in a browser already signed in to Spotify the embed plays full tracks.

**Anyone's own Spotify app.** An app in Spotify's development mode lets in only
the accounts named under User Management on its dashboard. So Settings → Music
has a Client ID field: paste the Client ID of a registration of your own (Redirect
URI as given below, Web API ticked, your account added) and it is used in place of the
app's own. Empty goes back to the app's own. Changing it signs you out, because
a sign-in belongs to the registration that made it. It is stored in
`spotify-config.json` beside the token, in the app's data folder.

A third card beside the countdown shows what is playing, the volume, the
wave's level and the phase, while Spotify is connected.

Sign-in is Spotify's PKCE flow for desktop apps, so there is no client secret.
`spotify.js` runs in the main process; the page never sees a token, and the
refresh token is kept encrypted in the app's data folder. The app registration's
redirect URI must read exactly `http://127.0.0.1:8888/callback`. Controlling
playback needs Spotify Premium, and an app still in Spotify's development mode
only works for accounts listed under User Management on its dashboard.
Files: `spotify.js` (main process), `spotify-sync.js` (the conductor and card).

## Alerts

A banner on every view, a tone, a log (**A**, or the bell), and in the desktop
app a Windows notification and an optional push to your phone through ntfy.
Rules: severe disasters worldwide, anything near you, war escalation, space
weather, AI escaping containment, and the Kessler watch. Each can be switched
off in Settings. Thresholds and sources are in `ALERTS-SPEC.md`.

## How the network is reached

Inside the desktop app, no request is made by the page. The page asks the main
process, which holds an explicit allowlist of six hosts and refuses anything
else, caches each answer for ten seconds, and collapses simultaneous requests
from several displays into one. The page keeps its strict content policy and
needs no origin exception.

In a plain browser the page requests directly. The sources that publish
cross-origin headers work as they are; GDACS does not, which is why NASA EONET
is there as the secondary.

## The wire, the tickers, and the vitals

Three specifications sit beside this file. `VITALS-SPEC.md` defines the
planetary signs, where each number comes from and why the levels do not tick.
`WIRE-SPEC.md` defines what the left wire admits and what the two new pages
carry. Both record a live value pulled from every source at the time they were
written, so a source that quietly dies is detectable by comparison.

The short version: the right of the face is what the Earth did, the left is
what the species did, and the tickers beneath are the flows underlying both.
Nothing on the face is a level extrapolated forward — that was tested against
the record and came out 3.92 ppm wrong, so the tickers integrate measured rates
from zero instead, which is arithmetic rather than prediction.

## If a sign says it is unread

Four sources publish no cross-origin header — NASA GISTEMP, NSIDC, NOAA CPC and
Epoch AI — so the browser cannot read them without help. The page now says which
help is missing rather than failing silently:

- **"needs proxy.php"** — the page was opened from a file path, or is on a host
  that is not running PHP. Everything with a cross-origin header still works;
  those four do not. Open the app, or serve the folder over http.
- **"app runtime is older than this source"** — the packaged Electron runtime
  predates `source/`, so it has no text channel to fetch through. Run
  `Build Runtime.cmd` to copy the current source into it.

A flow whose source has not been read shows an em dash and the word *unread*,
not a counter sitting at zero. Zero would say the world had stopped.

## The frame

The instrument fills the window exactly. The window is the height; the header
and the countdown band take what they need; the clock layout takes the rest and
the clock grows with it. Nothing is scaled to fit, and no height is guessed per
screen size — which is what an accumulated stack of media queries used to do
here, badly, leaving the instrument sitting slightly small inside its own frame
with dead space under it. Lists scroll inside their own box; the page never
scrolls.

The four controls — the Moon, fullscreen, alerts, settings — are
small icons beside the mark in the top left, where the eye
already is when it wants to change something. They were a row of text links in a
footer; the footer is gone.

## Putting it on a website

`web/` is the upload folder: the page, the stylesheet, the five scripts, the
three fonts and an `.htaccess`. 396 KB, no build step, no server-side code.
Drag its contents into `public_html` on Hostinger — or any static host — and
it runs.

It works because nothing on the page needs a server. The clock is computed in
the visitor's browser, and every stream is fetched by that browser directly from
USGS, GDACS, NOAA and NASA. All six hosts send `Access-Control-Allow-Origin: *`,
verified against a real browser origin rather than assumed — the desktop app
routes its requests through the Electron main process precisely because that is
*not* guaranteed, and it turns out not to be needed here.

Three things to know:

- **It must be served over https.** The feeds are all https, so a page served
  over plain http would have every one of them blocked as mixed content. The
  `.htaccess` redirects http to https; Hostinger's free SSL covers the rest.
- **`proxy.php` must be uploaded with the rest.** Six sources publish no
  cross-origin header — NASA GISTEMP, NSIDC, NOAA CPC and STAR, Epoch AI, arXiv,
  ESA, and GDELT — and the page reaches them through it. It is an allowlisted
  pass-through, not a parser: all parsing stays in the page so the website and
  the desktop app share one implementation. It caches for fifteen minutes, which
  is also what keeps GDELT inside its one-request-per-five-seconds limit however
  many visitors arrive.
- **Swap the NASA key.** `feeds.js` opens with `const NASA_KEY = 'DEMO_KEY'`.
  DEMO_KEY needs no signup but allows 30 requests an hour per visitor IP. At the
  panel's three-hour cadence that is ample, and each visitor spends their own
  allowance rather than a shared one — but a free key from api.nasa.gov raises
  it to 1,000 an hour and removes the question. It is the only line to change.
- **Fullscreen** in a browser is the browser's own, which needs a click and
  exits on Escape.

Everything else is identical: the five views, the filters, the keyboard
shortcuts, the saved settings. Checked on a phone as well — the layout stacks
to a single column with no horizontal scrolling.

## Running it

- **Browser** — `Open Browser Preview.cmd`. It serves the `web` folder with
  PHP on `127.0.0.1:8097` and opens it. PHP is required, and the file must be
  served rather than opened from disk: four sources — NASA GISTEMP, NSIDC sea
  ice, NOAA CPC, Epoch AI — publish no cross-origin header, so the page reaches
  them through `proxy.php`. Opening `source/index.html` straight from disk
  leaves those four dark and says so in each slot. The app has no such
  restriction, and neither does the site once it is on Hostinger.
- **App** — `Build Runtime.cmd`. It builds `runtime` on the Electron already
  installed in `../temporal-matrix/runtime`, sharing its files by hard link —
  one copy on disk for both apps, so Temporal Live's runtime costs about 1 MB,
  not 370 — and places this source in `runtime/resources/app`, producing
  `Temporal Live.exe`. No download, no build toolchain. Then `Open App.cmd`.
  Explorer still shows each folder at full size; the drive's free space is the
  true measure.

`temporal-matrix` is untouched.

## Settings

Solar longitude, latitude and brightness, the alert rules and where alerts
go, and two switches: read the live streams, and mark recent earthquakes on
the Matrix clock ring.
Turning the streams off leaves the clock and the countdowns running and makes
no network requests at all.

## Files

```
source/engine.js     the model, from Temporal Matrix; dilation wave per sciencecoherence.com
source/feeds.js      stream definitions, transport, normalization, scheduler
source/renderer.js   the face: clock, wave, countdowns, field
source/net.js        transport: which hosts answer a browser, which need the proxy
source/reading.js    the plain reading: what the numbers amount to, in words
source/vitals.js     the seven planetary parsers and the derived flow rates
source/wire.js       realization, world and discovery streams
web/proxy.php        the one server-side file: an allowlisted pass-through
source/views.js      the application: tabs, lists, filters, sorting, detail
source/index.html    structure and content policy
source/style.css     the instrument
source/main.js       Electron: the window, the feed allowlist, alerts, the reader's fetch
source/preload.js    the bridge the page is given
source/spotify.js    Spotify sign-in, token and playback control (main process)
source/spotify-sync.js  the conductor: wave to volume, alerts to ducking, phase to playlist
```

`engine.js` is the Temporal Matrix engine with one update: its velocity field —
the daily dilation wave — follows sciencecoherence.com's `matrix-engine.js` as of
5 October 2026 (the afternoon runs true; the evening ripple is gone). Nothing
else in it was changed. A change to the recursion, the ladder or the calendar
is made there and copied here.
