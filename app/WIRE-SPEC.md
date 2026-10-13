# The left wire, and the pages behind it

Defined 19 September 2026.

The face already carries what the Earth did, on the right. The left wire
carries what the species did — **realization**: things that became real. Not a
news feed, not "what's trending": a launch either happened or it did not, an
instrument either saw first light or it did not.

The tickers, which used to be destined for this column, move into the band
instead and take the footprint the τ* card had. Verified: five flows fit in
898 × 87 px at 1920 and 621 × 74 px on a laptop, nothing clipped, and the band
comes out 10px shorter than before.

## The face wire — realization

| | |
|---|---|
| Rule | It happened, and it is the kind of thing that only happens a few times a week: an orbital launch, an instrument switched on, a first light, a mission arrival, a record set, a result published that changes a number people quote. |
| Spine | **Launch Library 2** — every orbital launch with exact times. CORS ✓, verified. |
| Supplement | **NASA newsroom feed** — CORS ✓, verified. **ESA science feed** — via proxy. |
| Excluded | Politics, markets, conflict. Those are the World page. Papers as such are the Discovery page; only results that cross into "a thing now exists" reach the face. |

Same two-tier pattern as seismic: the face shows the top slice, the full list
lives on the Discovery page.

## The new pages

**Vitals** — planetary signs and the flows beneath them. Specified in
`VITALS-SPEC.md`, prototype approved.

**World** — threshold human events. A government falls, an election is
certified, a ceasefire is agreed or broken, a national emergency is declared, a
central bank moves in emergency session, a mass-casualty incident. Rule-based,
the human mirror of M5+.
Spine: **Wikipedia's curated current-events feed** — CORS ✓, verified, a handful
of items a day, every one of them real. Supplement: **GDELT** — CORS ✓, minute
latency, one request per five seconds per visitor, marked unconfirmed until a
curated source catches up.

**Discovery** — science, in full. Papers, detections, missions, milestones, and
the complete realization list the face is drawing its top slice from.
Sources: **arXiv** (via proxy, verified), **NASA** (direct), **ESA** (via proxy).

## Why World and Discovery flickered, and what holds them now

Three causes, each measured, none of them in the pages themselves.

- **World had one reliable source of four items.** Wikipedia's featured feed
  carries "in the news" for *today only* — the same request for any earlier
  date returns zero stories — so the three-day read was one read and two
  empty ones. Everything beyond those four came from GDELT, which refuses
  often. GDELT answering: about 24 items. GDELT refusing: 4. That was the
  flicker.
- **"When" reset on every refresh** because the feed gives no time for a story
  and the code stamped each one "now" on every read.
- **Launches vanished from Discovery** because Launch Library allows fifteen
  requests an hour (`/api-throttle/` reports it) and every refresh spent two.
  A handful of refreshes and it refused until the hour turned over.

What changed:

| | |
|---|---|
| Memory | The last good reading of every stream is kept in the browser (`localStorage`, key `temporal-live:wire:v1`). A refresh opens on it rather than on nothing. |
| No early re-reads | A stream whose reading is younger than its own interval is not asked again on restart. Refreshing costs Launch Library nothing. |
| Accumulate, don't replace | For news — curated events, GDELT, AI incidents — a read adds; nothing is removed by a refusal or an empty answer. Items leave by age: curated events after ten days, GDELT after three, incidents after sixty. |
| Launch cadence | Every twenty minutes, not ten: six of the fifteen hourly requests. |

**The curated spine was then replaced.** Remembering "In the news" did not
fix World: the box is four stories, today only, with no time on any of them,
so World still read four items stamped with the first time they were seen.
The spine is now Wikipedia's **Current events portal** — one page per UTC day,
the pool the box is drawn from. Parsed on two real days: 16 and 17 events,
every one with its category, the story it belongs to, the outlet it cites and
a link to the report. Three days are read, one page at a time 1.5 s apart,
because Wikimedia refused three at once. Each event is filed under a date, so
it is shown as a date ("today", "yesterday", "Sep 20") — never as an
invented "20h ago". Events stay ten days.

In the app, report links now open in the system browser. Before, the window's
security handler refused every new window, so no link in the app did anything.

Launches stay a *replacing* read, not an accumulating one: a launch's status
changes (scrubbed, succeeded, failed) and the newest answer is the only true
one. "AHEAD" is now decided at draw time from the launch's own time, so a
remembered upcoming launch cannot keep saying AHEAD after it has flown.

Storage can be refused or cleared; everything works without it and simply
starts cold.

## The reader — desktop app only (25 September 2026)

An article from World, Discovery or the AI incident feed opens inside the app
as text: title, source, Matrix date, byline, body. No navigation, ads,
scripts, images or trackers. *Read it here* in the detail pane, or a
double-click on the row; an AI incident headline opens it directly. Every
reader has *Open the original in your browser*.

| | |
|---|---|
| Fetch | `article.js`, in the main process, over the `matrix:article` channel. Any public web address — not the feed allowlist, since articles come from hundreds of outlets — but no local or private addresses, no credentials in the address, no cookies, 5 MB at most, 20 s, HTML only. Charset from the header or the page's meta tag. |
| Extraction | Mozilla Readability 0.6.0 (Firefox's reader view, Apache-2.0, `readability.js` + its licence), loaded only when the reader first opens. The page is parsed as an inert document: it runs no script and loads nothing. |
| Display | Readability's output is never inserted as markup. Paragraphs, headings, quotes and list items are rebuilt as plain text, one by one. Link boxes headed "Recommended", "Related", "Read more", "Most read" are dropped with their lists. |
| Short or refused | Under 120 words is shown with a note (usually a paywall or a script-built page). A refusal says what the site answered. Both point to the browser. |

Tested in Electron 44.3.0 — the version the app runs — on a virtual display,
through the real IPC channel:

- 6 of 8 real feed articles fetched (DW, Al Jazeera, NASA, ESA, arXiv, SF
  Chronicle). AP and The New York Times refused the test machine with 403;
  from a home connection AP may answer, the Times stays a paywall.
- `localhost`, `192.168.*`, `file://`, `javascript:` and an address with a
  password in it were all refused.
- World → select → *Read it here* opened Al Jazeera as 266 words of text;
  no image, link, script or frame reached the reader.
- A close followed at once by another opening used to let the first close
  cancel the second; each opening now carries its own ticket.

On the website there is no reader: `Reader.available()` is false without the
app's bridge, no button appears, links open as before, and the extraction
engine is never loaded. The website would need its host to fetch other sites'
pages for its visitors — an open relay, and a republisher of other people's
work.

## Two bugs found while fitting the tickers

- `meter()` is not null-guarded, so removing a progress bar from the page throws
  and kills the rest of the script at load. Fixed in the prototype; goes into
  the build.
- `fitSaver()` (now `fitInstrument()`) could measure mid-load, decide the page overflows, apply a scale,
  and never re-evaluate — the instrument then sits at 63% inside its own frame.
  It needs to re-run once layout settles.

## Still open

The τ* countdown is displaced by the tickers. Taken as **stacked under the
launch countdown in the left half** — both stay on the face, and the 10px the
tickers freed pays for it. Easy to change: the alternative was moving it to the
Vitals page.
