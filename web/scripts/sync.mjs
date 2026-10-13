// Builds public/ — the website — from the desktop app's source folder, so the
// two never drift apart: one implementation, two ways to run it.
//
//   node scripts/sync.mjs ../app/source      (run in web/; Vercel runs it on every deploy)
//
// What changes on the way: the Electron-only files are left out (the main
// process, its preload bridge, the article fetcher and the Spotify sign-in),
// and index.html learns where the feed proxy is (/api/feed), which version it
// is, and that webcam thumbnails may come from any https host.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.argv[2] || '../app/source');
const out = resolve('public');
if (!existsSync(join(src, 'index.html'))) { console.error('No index.html in ' + src); process.exit(1); }

const DESKTOP_ONLY = new Set(['main.js', 'preload.js', 'article.js', 'spotify.js', 'package.json', 'package-lock.json', 'node_modules']);

// A clean slate where the filesystem allows it (Vercel always does); where it
// does not, files are overwritten in place.
try { rmSync(out, { recursive: true, force: true }); } catch (e) { console.warn('public/ not cleared (' + e.code + '); overwriting in place'); }
mkdirSync(out, { recursive: true });
// Copied by reading and writing each file, which overwrites in place: no
// file is ever deleted, so it also works where deleting is not allowed.
let n = 0;
function copy(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) copy(join(from, name), join(to, name));
  } else { writeFileSync(to, readFileSync(from)); n++; }
}
for (const name of readdirSync(src)) {
  if (DESKTOP_ONLY.has(name) || name.startsWith('.')) continue;
  copy(join(src, name), join(out, name));
}

const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
let html = readFileSync(join(out, 'index.html'), 'utf8');
const meta = `<meta name="sm-proxy" content="/api/feed">\n<meta name="sm-version" content="${version} web">\n`;
if (!html.includes('name="sm-proxy"')) html = html.replace(/(<meta charset="[^"]*">\s*)/i, `$1${meta}`);
// Webcam thumbnails come from the webcam providers' own image hosts.
html = html.replace(/img-src 'self' data:/, "img-src 'self' data: https:");
writeFileSync(join(out, 'index.html'), html);

console.log(`public/ built from ${src}: ${n} files, version ${version}`);
