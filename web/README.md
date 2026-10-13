# Singularity Monitor — web edition

The planet, the Sun, war, the economy and society, live, in a browser. This is
the website of the Singularity Monitor desktop app: the same pages and the same
code, served by Vercel.

## How it is built

```
api/feed.js      an allowlisted, cached pass-through for sources without CORS
api/memory.js    the shared record of AI incidents (Upstash Redis)
api/_lib/        a copy of ../app/source/lib/incidents.js, for api/memory.js
scripts/sync.mjs builds public/ from ../app/source (Vercel runs it on every deploy)
scripts/dev.mjs  a local stand-in for Vercel (serves public/, runs both functions)
vercel.json      no framework; the build is the sync; public/ is served as is
public/          generated, not in git
```

There is no framework. The desktop app's source (`../app/source`) is the one
implementation; at each deploy `scripts/sync.mjs` copies it into `public/`, leaving out the Electron-only files (`main.js`,
`preload.js`, `article.js`, `spotify.js`), and tells the page where its proxy
is (`<meta name="sm-proxy" content="/api/feed">`).

**Sources with cross-origin headers** (USGS, GDACS, NOAA SWPC, Wikipedia, the
World Bank, Launch Library, Crossref…) are read by each visitor's browser
directly.

**Sources without** (Google News, the BIS, the IMF, NASA GISTEMP, NSIDC,
Yahoo Finance, GDELT, the EIA, CelesTrak…) go through `/api/feed`. Each answer
is cached by Vercel's CDN for a time set per source — a quarter hour for news,
two minutes for market quotes, six hours for the IMF and the BIS — and served
stale while it refreshes. However many people have the page open, each source
is asked at most once per window. No cron jobs are needed, so it runs on the
Hobby plan.

## The shared record (`/api/memory`)

A feed holds only its newest items — Al Jazeera's last 25 stories cover about
four hours — so a copy of the monitor that was not open while a story passed
through never saw it. Each copy keeps what it reads in its own browser storage,
so the desktop app, open for weeks, knew more than a website opened today.

`/api/memory` keeps one record of AI incidents for every copy, 60 days long:

- **GET** returns it. If it is more than a quarter hour old, the function first
  reads the AI Incident Database and the three newsrooms itself, with the
  page's own rules (`lib/incidents.js`), so every visit keeps it current.
- **POST** with `Authorization: Bearer <MEMORY_KEY>` adds incidents. The
  desktop app, given the key in Settings, sends everything it has read.
  Without the key nothing can be written.

Every copy, desktop or web, reads the record every ten minutes and merges it.

Setup, once, in the Vercel dashboard:

1. Storage → Create Database → **Upstash for Redis** (free plan), connected to
   this project. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. Settings → Environment Variables → `MEMORY_KEY`: any long random string
   (16 characters or more), for Production. Redeploy.
3. In the desktop app: Settings → Shared record key → the same string.

Until step 1 is done, `/api/memory` answers 503 and the "Shared record"
stream shows as unreachable; everything else works as before.

If `app/source/lib/incidents.js` changes, run `npm run build` in `web/` and
commit `api/_lib/incidents.cjs` with it: a deploy whose copy differs stops.

## Updating the website after a change to the app

Push. Vercel rebuilds from `app/source` on every push to `main` that touches
`app/source` or `web/`.

## Running it locally

```
npm run dev                 # builds public/, then http://localhost:3000
                            # (the shared record is kept in web/.memory.json)
```

## What the web edition does not do

The desktop app's Windows notifications become browser notifications (the
browser asks once). The in-page article reader, Spotify sync, the screensaver
and the full CelesTrak satellite catalogue are desktop-only. Webcams need a
free Windy key in Settings, as in the app.

## Licences

Code: the same as the desktop app. Data credits: `public/lib/LICENSES.txt`.
