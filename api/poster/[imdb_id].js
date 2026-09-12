const cheerio = require('cheerio');
const fetch = require('node-fetch');
const sharp = require('sharp');

const FS23_BASE = 'https://fs23.lol';
const BETTERPOSTER_BASE = 'https://btttr.cc/poster/imdb/poster-default';
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io/meta';

const CACHE_TTL = 24 * 60 * 60 * 1000;
const TAG_TTL = 30 * 60 * 1000;
const NEGATIVE_TTL = 5 * 60 * 1000;
const cache = new Map();
const tagCache = new Map();
const inflight = new Map();

const fsHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  Referer: `${FS23_BASE}/`,
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
};

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[._:/\\'’!?\-()[\]{}]+/g, ' ')
    .replace(/\b(?:the|le|la|les|a|an|un|une|l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTitle(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.94;
  const aw = new Set(x.split(' ').filter(Boolean));
  const bw = new Set(y.split(' ').filter(Boolean));
  let common = 0;
  for (const word of aw) if (bw.has(word)) common++;
  return common / Math.max(aw.size, bw.size);
}

function detectFs23Tag(value) {
  const text = clean(value).toUpperCase();
  if (/VF\s*\+\s*VOSTFR|VOSTFR\s*\+\s*VF/.test(text)) return 'vf_vostfr';
  if (/VOST[- ]?FR|SUBFRENCH|FRENCH\s+SUB(?:TITLE)?S?/.test(text)) return 'vostfr';
  if (/\bVF\b|TRUE\s*-?\s*FRENCH|TRUEFRENCH|\bVFF\b|\bVF2\b|\bFRENCH\s+(?:DUB|AUDIO)\b/.test(text)) return 'vf';
  return null;
}

function imdb(value) {
  const match = String(value || '').match(/tt\d{7,10}/i);
  return match ? match[0].toLowerCase() : null;
}

async function fs23(url) {
  const response = await fetch(url, {
    headers: fsHeaders,
    timeout: 10000
  });
  if (!response.ok) throw new Error(`FS23 HTTP ${response.status}`);
  return response.text();
}

async function image(url) {
  const response = await fetch(url, {
    headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png,image/*,*/*;q=0.8' },
    timeout: 15000
  });
  if (!response.ok) throw new Error(`Poster HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function getTitleFromCinemeta(id, type) {
  const types = type === 'series' ? ['series', 'movie'] : type === 'movie' ? ['movie', 'series'] : ['movie', 'series'];
  for (const mediaType of types) {
    try {
      const response = await fetch(`${CINEMETA_BASE}/${mediaType}/${encodeURIComponent(id)}.json`, { timeout: 10000 });
      if (!response.ok) continue;
      const data = await response.json();
      const meta = data && data.meta;
      if (meta && (meta.name || meta.title)) {
        return { title: meta.name || meta.title, type: mediaType };
      }
    } catch (_) {}
  }
  return null;
}

function parseListing(html, type) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $('a[href*="newsid="]').each((_i, element) => {
    const href = $(element).attr('href') || '';
    let url;
    try {
      url = new URL(href, FS23_BASE).toString();
    } catch (_) {
      return;
    }

    const id = new URL(url).searchParams.get('newsid');
    if (!id || seen.has(id)) return;

    let node = $(element);
    for (let i = 0; i < 8; i++) {
      if (node.find('img').length && clean(node.text()).length > 8) break;
      const parent = node.parent();
      if (!parent.length) break;
      node = parent;
    }

    const img = node.find('img').first();
    const title = clean($(element).text()) || clean(img.attr('alt')) || clean(node.find('h1,h2,h3,h4,.title').first().text());
    if (!title) return;

    const text = clean(node.text());
    const version = text.match(/Version\s*:\s*([^]+?)(?=\s+Qualité\s*:|\s+Date de sortie\s*:|$)/i);
    const tag = version ? detectFs23Tag(version[1]) : detectFs23Tag(text);

    seen.add(id);
    out.push({ id, title, type, url, tag });
  });

  return out;
}

async function searchFs23(title, type) {
  const query = clean(title);
  if (!query) return [];

  const urls = [
    `${FS23_BASE}/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`,
    `${FS23_BASE}/index.php?do=search&story=${encodeURIComponent(query)}`
  ];

  const results = [];
  for (const url of urls) {
    try {
      const items = parseListing(await fs23(url), type);
      results.push(...items);
    } catch (_) {}
  }

  const unique = [];
  const seen = new Set();
  for (const item of results.sort((a, b) => scoreTitle(query, b.title) - scoreTitle(query, a.title))) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique.slice(0, 36);
}

async function enrichCandidate(candidate) {
  try {
    const html = await fs23(candidate.url);
    const $ = cheerio.load(html);
    const body = clean($('body').text());
    const version = body.match(/Version\s*:\s*([^]+?)(?=\s+Qualité\s*:|\s+Date de sortie\s*:|\s+Réalisateur\s*:|$)/i)
      || body.match(/Version\s*[:\-]\s*([^\n\r]+)/i);
    if (version) candidate.tag = detectFs23Tag(version[1]);
    return candidate;
  } catch (_) {
    return candidate;
  }
}

async function getFs23Tag(id, type) {
  const key = `${type || 'auto'}:${id}`;
  const cached = tagCache.get(key);
  const ttl = cached && cached.tag ? TAG_TTL : NEGATIVE_TTL;
  if (cached && Date.now() - cached.time < ttl) return cached.tag || null;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    const info = await getTitleFromCinemeta(id, type);
    if (!info) return null;

    const candidates = await searchFs23(info.title, info.type);
    const ordered = candidates.sort((a, b) => scoreTitle(info.title, b.title) - scoreTitle(info.title, a.title));

    for (const candidate of ordered.slice(0, 8)) {
      const enriched = await enrichCandidate(candidate);
      if (enriched.tag === 'vf_vostfr' || enriched.tag === 'vf' || enriched.tag === 'vostfr') {
        tagCache.set(key, { tag: enriched.tag, time: Date.now() });
        return enriched.tag;
      }
    }

    tagCache.set(key, { tag: null, time: Date.now() });
    return null;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

function badgeSvg(label) {
  const width = label === 'VF+VOSTFR' ? 310 : label === 'VOSTFR' ? 250 : 150;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="58"><rect x="0" y="0" width="${width}" height="58" rx="10" fill="#111" fill-opacity="0.88"/><text x="${width / 2}" y="39" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#fff">${label}</text></svg>`);
}

async function buildPoster(id, type) {
  const cacheKey = `${type || 'auto'}:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.buffer;

  const [poster, tag] = await Promise.all([
    image(`${BETTERPOSTER_BASE}/${encodeURIComponent(id)}.jpg?lang=fr`),
    getFs23Tag(id, type)
  ]);

  let output = poster;
  if (tag) {
    const label = tag === 'vf_vostfr' ? 'VF+VOSTFR' : tag === 'vostfr' ? 'VOSTFR' : 'VF';
    output = await sharp(poster)
      .composite([{ input: badgeSvg(label), left: 24, top: 24 }])
      .jpeg({ quality: 94 })
      .toBuffer();
  } else {
    output = await sharp(poster).jpeg({ quality: 94 }).toBuffer();
  }

  cache.set(cacheKey, { buffer: output, expires: Date.now() + CACHE_TTL });
  return output;
}

module.exports = async (req, res) => {
  const id = imdb(req.query?.imdb_id || req.params?.imdb_id);
  const type = req.query?.type || null;

  if (!id) {
    res.statusCode = 400;
    return res.end('Invalid IMDb id');
  }

  try {
    if (req.query?.debug === '1') {
      const tag = await getFs23Tag(id, type);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ id, type, tag, source: tag ? 'FS23' : null }));
    }

    const output = await buildPoster(id, type);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end(output);
  } catch (error) {
    console.error(`[CUSTOM-POSTER] ${id}:`, error.message);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Poster unavailable');
  }
};
