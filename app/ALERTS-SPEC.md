# Alerts, the war desks, floods and the Kessler watch

Defined 28 September 2026.

## Alerts

Nothing is fetched for alerts. Every alert is an item already on a page,
raised by a stated rule (`alerts.js`):

| Rule | Raises | Source |
|---|---|---|
| Severe | Earthquake M 6.5+ (red from 7.0), noting the USGS tsunami flag; GDACS red of any kind; GDACS orange for cyclone, flood, eruption, wildfire. Drought at red only. | USGS, GDACS |
| Near you | Earthquake M 4.5+ or any positioned disaster within your radius (500 km default). Off until latitude and longitude are set. | USGS, GDACS, EONET |
| War | A curated or newsroom conflict report that names an escalation — war declared, an invasion or offensive launched, a ceasefire broken, a missile test, martial law, troops crossing, a capital struck — or counts 30 or more dead. GDELT never raises one. | Wikipedia, Al Jazeera, BBC, UN News |
| Space weather | Geomagnetic storm G3+ (Kp ≥ 7); X-class flare. | NOAA SWPC |
| AI containment | A report of self-exfiltration, self-replication, escaping a sandbox, resisting shutdown or disabling oversight. | AI Incident Database, newsrooms |
| Kessler | A breakup only: new debris catalogued between two readings of the catalogue (desktop app). Predicted close passes are shown on Orbital and in the conditions strip, never alerted (changed 5 October 2026). | CelesTrak |

Each alert is raised once and remembered across restarts. An event older than
its rule's window when first seen (12 h; war 36 h; space 6 h; AI and Kessler
7 d) is logged without sound, and so is everything found in the first five
minutes of the app's first run: it was already underway.

Delivery: banner (every view), tone, the log (30 days).
Desktop app only: a Windows notification — the app adds a Start menu shortcut
once, which Windows requires — and a push through ntfy.sh to a topic you name.
Notifications and pushes are sent once per alert by the main process. Alerts arrive only while the app or the page is running.

## World: one story, one row, and war

The duplicate rows were GDELT: it indexes every syndicated copy of an article.
Rows with the same headline text are now one story — curated beats reported
beats unconfirmed, and the first report is kept.

War desks, every 15 minutes: Al Jazeera and BBC World filtered by conflict
words (`Wire.CONFLICT`), and UN News "Peace and Security" whole. Marked
REPORTED. Curated events under Wikipedia's "Armed conflicts and attacks" are
tagged too. The CONFLICT chip shows only armed conflict.

## Floods

GDACS's current list carries only the floods it is still modelling that day —
four, when the user saw many. The hazard stream now also asks GDACS for every
flood it rated in sixty days (current while reported, or ten days after), and
reads ReliefWeb's flood disasters: the humanitarian record, with the number of
people affected. A ReliefWeb flood in a country GDACS already rates is not
repeated; one GDACS has not rated is shown unrated. Measured: 39 floods, two of
them orange (China, India), two ReliefWeb-only (Niger: 34,372 people affected;
Liberia).

## Kessler watch (Orbital)

Three terms of the cascade, from CelesTrak:

- **Population** — SATCAT boxscore: 35,186 tracked objects in orbit; 17,147
  active satellites, 3,007 dead ones, 15,032 debris and rocket bodies (43 %).
- **Pressure** — SOCRATES Plus, next 7 days: 191,779 passes within 5 km. Its
  top entries are formation flyers at 0 km/s and probability 1, so only passes
  at ≥ 1 km/s count: 830 at 1 in 1,000 or worse, 115 of them against debris or
  dead objects. Only the first 3.2 MB of the 22 MB list is read (it is sorted
  by probability). SOCRATES's first object is always an active satellite; a
  debris-on-debris pass is not in it.
- **Breakups** — desktop app: the whole catalogue (6.7 MB) twice a day,
  compared with the last reading. Ten or more new debris pieces from one launch
  older than thirty days is a fragmentation. The first reading looks back over
  the newest 1,500 catalogue numbers; on 28 September that found two: 62
  pieces from launch 2026-051 (Yaogan-50 02) and 11 from Intelsat 805 (1998).

CelesTrak recomputes twice a day and asks for restraint: nothing is read again
before its interval, restarts included, and the website's proxy keeps its
answers six hours for every visitor.

## Checked

- Browser (Playwright, PHP proxy): World 69 items, 0 duplicate headlines;
  CONFLICT chip; floods as above; Kessler panel; banner, log, settings; all
  eight views at 1920, five resolutions; no page errors.
- Electron 44.3 under a virtual display: range read of SOCRATES and the full
  catalogue through the main process; breakup detection on real data; an alert
  delivered once and refused the second time; a push to a throwaway ntfy topic
  accepted.
- Live alerts fired from real data in the browser test: a war report (33 dead
  in a Myanmar air strike, Al Jazeera) and two Kessler passes (1 in 10 and
  1 in 5 against Soviet and Delta debris).
- Not checked: the Windows notification itself (Linux here), a push arriving on
  a phone, the tone being audible.
