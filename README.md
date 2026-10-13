# Singularity Monitor

The planet, the Sun, war, the economy and society, live: a desktop app for
Windows, and the same pages as a website.

```
app/    the desktop app (Electron): source/, Build Runtime.cmd, CHANGELOG.md, READ ME.md
web/    the website (Vercel): api/feed.js, api/memory.js, vercel.json, scripts/
```

There is one implementation. `app/source` holds every page and stream; the
website is built from it at each deploy (`web/scripts/sync.mjs`), leaving out
the Electron-only files and adding two server functions: `web/api/feed.js`
for the sources a browser cannot read directly, and `web/api/memory.js`, the
shared record of AI incidents that the website and the app both read and add
to. A change to the app reaches the
website on the next push.

## The desktop app

Read `app/READ ME.md`. In short: `app/Build Runtime.cmd` builds it on the
Electron already installed for Temporal Matrix and opens it. The build
(`app/runtime/`) is not in git.

## The website

Vercel project settings: Root Directory `web`, with "Include files outside the
Root Directory" on (the build reads `app/source`). Everything else is in
`web/vercel.json`: no framework, build command `node scripts/sync.mjs
../app/source`, output `public`. A push that changes neither `app/source` nor
`web/` does not deploy. See `web/README.md`.

To run the website locally:

```
cd web
npm run dev          # http://localhost:3000
```

## Versions

One version number for both, in `app/source/package.json`, recorded in
`app/CHANGELOG.md`. The website shows it in its status bar, marked "web".
