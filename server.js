const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const http = require('http');

const PORT = Number(process.env.PORT || 7000);
const ORIGIN = process.env.FS15_BASE_URL || 'https://example.invalid';

const manifest = {
  id: 'community.fs15.catalog',
  version: '1.0.0',
  name: 'FS15 Catalog',
  description: 'Dynamic catalogue',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  idPrefixes: ['tt']
};

let parseFs15Listing;
import('./src/fs15-parser.mjs').then(mod => { parseFs15Listing = mod.parseFs15Listing; });

const builder = new addonBuilder(manifest);
builder.defineCatalogHandler(async ({ type }) => {
  if (!parseFs15Listing) throw new Error('FS15 parser not ready');
  const configured = process.env[`FS15_${type.toUpperCase()}_URL`];
  if (!configured) return { metas: [] };
  const response = await fetch(configured, { headers: { 'User-Agent': 'FS15-Catalog/1.0' } });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const html = await response.text();
  const items = parseFs15Listing(html, type, ORIGIN);
  return { metas: items.map(item => ({
    id: item.id, type, name: item.name, poster: item.poster,
    releaseInfo: item.year || undefined,
    description: item.sourceText || undefined,
    genres: item.languageTag !== 'NONE' ? [item.languageTag] : []
  })) };
});

const router = getRouter(builder.getInterface());
const server = http.createServer((req, res) => {
  if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(manifest));
  }
  router(req, res, () => { res.writeHead(404); res.end(); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`FS15 Catalog listening on ${PORT}`));
