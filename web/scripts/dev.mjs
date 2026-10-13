// A local stand-in for Vercel: serves public/ and runs api/feed.js and api/memory.js.
//   node scripts/dev.mjs   →   http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
// The shared record is kept in a local file unless Upstash's variables are set.
if (!process.env.KV_REST_API_URL && !process.env.SM_MEMORY_FILE) process.env.SM_MEMORY_FILE = resolve('.memory.json');
if (!process.env.MEMORY_KEY) process.env.MEMORY_KEY = 'local-development-key';
const { default: feed } = await import('../api/feed.js');
const { default: memory } = await import('../api/memory.js');

const root = resolve('public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/api/feed') return feed(req, res);
  if (path === '/api/memory') return memory(req, res);
  const file = normalize(join(root, path === '/' ? 'index.html' : decodeURIComponent(path)));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
