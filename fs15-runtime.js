const { ALL_CATALOGS } = require('./addon');

const MANIFEST = {
  id: 'community.fs15-catalog',
  version: '1.0.0',
  name: 'FS15 Catalog',
  description: 'FS15 catalog with source-side language detection.',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  idPrefixes: ['fs15:'],
  catalogs: Object.entries(ALL_CATALOGS).map(([id, c]) => ({
    type: c.type,
    id: `fs15-${id}`,
    name: c.name
  }))
};

const cache = new Map();
const metaCache = new Map();

async function parser() {
  return import('./src/fs15-parser.mjs');
}

async function fetchHtml(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FS15-Catalog/1.0' } });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

async function catalogItems(catalogId) {
  const catalog = ALL_CATALOGS[catalogId];
  if (!catalog) return [];
  const key = catalogId;
  if (cache.has(key)) return cache.get(key);

  const { parseFs15Listing } = await parser();
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    const url = page === 1 ? catalog.baseUrl : catalog.pageUrl.replace('{page}', String(page));
    const html = await fetchHtml(url);
    if (!html) continue;
    pages.push(...parseFs15Listing(html, catalog.type, 'https://french-stream.pink'));
  }

  const seen = new Set();
  const metas = [];
  for (const item of pages) {
    const keyName = `${item.type}:${item.name.toLowerCase()}`;
    if (seen.has(keyName)) continue;
    seen.add(keyName);
    const id = `fs15:${Buffer.from(item.href).toString('base64url')}`;
    metas.push({
      id,
      type: item.type,
      name: item.name,
      poster: item.poster || undefined,
      posterShape: 'poster',
      description: item.sourceText || undefined,
      releaseInfo: item.year || undefined,
      behaviorHints: { defaultVideoId: id },
      _fs15: { languageTag: item.languageTag, quality: item.quality, sourceUrl: item.href }
    });
    metaCache.set(`${item.type}:${id}`, metas[metas.length - 1]);
  }

  cache.set(key, metas);
  return metas;
}

function getAddonInterface() {
  return {
    manifest: MANIFEST,
    getCatalog: async ({ id }) => ({ metas: await catalogItems(id.replace(/^fs15-/, '')) }),
    getMeta: async ({ type, id }) => ({ meta: metaCache.get(`${type}:${id}`) || null })
  };
}

module.exports = { getAddonInterface };
