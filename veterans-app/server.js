'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { api, RANKING_PAGES, COMPETITION_ID } = require('./lib/scraper');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const sendJson = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

async function handleApi(req, res, pathname) {
  try {
    const parts = pathname.split('/').filter(Boolean).slice(1); // quita "api"
    let data;
    if (parts[0] === 'standings') data = await api.standings();
    else if (parts[0] === 'calendar') data = await api.calendar();
    else if (parts[0] === 'teams' && parts.length === 1) data = await api.teams();
    else if (parts[0] === 'teams') data = await api.team(parts[1]);
    else if (parts[0] === 'committee') data = await api.committee();
    else if (parts[0] === 'rankings' && parts[1]) data = await api.ranking(parts[1]);
    else if (parts[0] === 'health') data = { ok: true, competition: COMPETITION_ID, rankings: Object.keys(RANKING_PAGES) };
    else return sendJson(res, 404, { error: 'No encontrado' });
    sendJson(res, 200, data);
  } catch (err) {
    console.error('[api]', pathname, err.message);
    sendJson(res, err.status || 502, { error: 'No se pudo obtener la información de la liga', detail: String(err.message || err) });
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Prohibido');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'No encontrado');
    const ext = path.extname(file);
    send(res, 200, buf, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // la app (html/js/css) siempre se revalida; sólo los iconos se guardan un día
      'Cache-Control': ext === '.png' ? 'public, max-age=86400' : 'no-cache',
    });
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  serveStatic(req, res, pathname);
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Veterans 1ª Divisió -> http://localhost:${PORT}`));
}
module.exports = server;
