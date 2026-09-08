import http from 'node:http';
import { parseFs15Listing } from './fs15-parser.mjs';

const PORT = Number(process.env.PORT || 7000);
const ORIGIN = process.env.FS15_BASE_URL || 'https://example.invalid';
const CACHE_TTL = Number(process.env.FS15_CACHE_TTL || 300000);
const cache = new Map();

async function fetchHtml(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_TTL) return hit.html;
  const response = await fetch(url, { headers: { 'User-Agent': 'FS15-Catalog/1.0' } });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const html = await response.text();
  cache.set(url, { time: Date.now(), html });
  return html;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

const manifest = {
  id: 'community.fs15.catalog', version: '1.0.0', name: 'FS15 Catalog', description: 'Dynamic catalogue',
  resources: ['catalog', 'meta'], types: ['movie', 'series'], idPrefixes: ['tt']
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/manifest.json') return send(res, 200, JSON.stringify(manifest));
    if (url.pathname.startsWith('/catalog/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const type = parts[1] || 'movie';
      const page = Math.max(1, Number(url.searchParams.get('skip') || 0) / 100 + 1);
      const template = process.env[`FS15_${type.toUpperCase()}_URL`] || `${ORIGIN}/${type}/page/${Math.floor(page)}/`;
      const html = await fetchHtml(template);
      const items = parseFs15Listing(html, type, ORIGIN);
      return send(res, 200, JSON.stringify({ metas: items.map(x => ({ id: x.id, type, name: x.name, poster: x.poster, releaseInfo: x.year, description: x.sourceText, extra: [{ name: 'language', value: x.languageTag }, ...(x.quality ? [{ name: 'quality', value: x.quality }] : [])] })) }));
    }
    return send(res, 404, JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    return send(res, 502, JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`FS15 Catalog listening on ${PORT}`));
