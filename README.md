# Singularity Monitor — web edition

The planet, the Sun, war, the economy and society, live, in a browser. This is
the website of the Singularity Monitor desktop app: the same pages and the same
code, served by Vercel.

## How it is built

```
public/          the website: generated from the desktop app's source, do not edit here
api/feed.js      the one server-side function: an allowlisted, cached pass-through
scripts/sync.mjs builds public/ from temporal-live/source
scripts/dev.mjs  a local stand-in for Vercel (serves public/ and runs api/feed.js)
vercel.json      no framework, no build: public/ is served as is
```

There is no framework and no build step. The desktop app's source
(`temporal-live/source`) is the one implementation; `scripts/sync.mjs` copies
it into `public/`, leaving out the Electron-only files (`main.js`,
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

## Updating the website after a change to the app

```
cd singularity
node scripts/sync.mjs ../temporal-live/source
git add -A && git commit -m "Sync with temporal-live <version>" && git push
```

Vercel deploys every push to `main`.

## Running it locally

```
node scripts/dev.mjs        # http://localhost:3000
```

## What the web edition does not do

The desktop app's Windows notifications become browser notifications (the
browser asks once). The in-page article reader, Spotify sync, the screensaver
and the full CelesTrak satellite catalogue are desktop-only. Webcams need a
free Windy key in Settings, as in the app.

## Licences

Code: the same as the desktop app. Data credits: `public/lib/LICENSES.txt`.
