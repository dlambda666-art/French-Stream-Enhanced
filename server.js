const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('./addon');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const sharp = require('sharp');

const PORT = process.env.PORT || 7860;
const FS23_BASE = 'https://fs23.lol';
const BETTERPOSTER_BASE = 'https://btttr.cc/poster/imdb/poster-default/';
const FS23_PAGES = 50;
const MAX_CANDIDATES = 36;
const MIN_TITLE_SCORE = 0.90;
const TAG_TTL = 30 * 60 * 1000;
const NEGATIVE_TTL = 5 * 60 * 1000;
const POSTER_TTL = 24 * 60 * 60 * 1000;
const FS23_TIMEOUT = 10000;
const ENRICH_CONCURRENCY = 6;
const TAG_CACHE = new Map();
const TAG_INFLIGHT = new Map();
const POSTER_CACHE = new Map();
const POSTER_INFLIGHT = new Map();
let FS23_INDEX = null;
let FS23_INDEX_TIME = 0;
let FS23_REFRESH = null;

const SOURCES = {
    movie: `${FS23_BASE}/index.php?category=films&do=cat`,
    series: `${FS23_BASE}/index.php?category=s-tv&do=cat`
};

const fsHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    Referer: `${FS23_BASE}/`,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
};

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const imdb = value => (String(value || '').match(/tt\d{7,10}/i) || [])[0]?.toLowerCase() || null;

function normalizeTitle(value) {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/\b(?:19|20)\d{2}\b/g, ' ')
        .replace(/[._:/\\'’!?\-()[\]{}]+/g, ' ')
        .replace(/\b(the|le|la|les|a|an|un|une|l)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function titleWords(value) {
    return [...new Set(normalizeTitle(value).split(' ').filter(w => w.length >= 2))];
}

function scoreTitle(a, b) {
    const x = normalizeTitle(a), y = normalizeTitle(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.94;
    const aw = new Set(titleWords(x)), bw = new Set(titleWords(y));
    let common = 0;
    for (const w of aw) if (bw.has(w)) common++;
    return common / Math.max(aw.size, bw.size);
}

function safeTitleMatch(expected, actual) {
    const score = scoreTitle(expected, actual);
    if (score >= MIN_TITLE_SCORE) return true;
    const a = titleWords(expected);
    const b = new Set(titleWords(actual));
    if (a.length >= 2 && a.length === b.size && a.every(w => b.has(w))) return true;
    return false;
}

/* FS23 Version is the ONLY language evidence. */
function detectLanguage(value) {
    const text = clean(value).toUpperCase();
    if (/VF\s*\+\s*VOSTFR|VOSTFR\s*\+\s*VF/.test(text)) return 'vf_vostfr';
    if (/VOST[- ]?FR|SUBFRENCH|FRENCH\s+SUB(?:TITLE)?S?/.test(text)) return 'vostfr';
    if (/\bVF\b|TRUE\s*-?\s*FRENCH|TRUEFRENCH|\bVFF\b|\bVF2\b|\bFRENCH\s+(?:DUB|AUDIO)\b/.test(text)) return 'vf';
    return null;
}

function absoluteUrl(value) {
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return 'https:' + value;
    if (value.startsWith('/')) return FS23_BASE + value;
    return `${FS23_BASE}/${value}`;
}

async function fs23(url) {
    let last = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const r = await fetch(url, { headers: fsHeaders, signal: AbortSignal.timeout(FS23_TIMEOUT) });
            last = r.status;
            if (r.ok) return r.text();
            if (![403, 429].includes(r.status)) throw new Error(`FS23 HTTP ${r.status}`);
        } catch (e) {
            if (attempt === 2) throw e;
        }
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
    throw new Error(`FS23 HTTP ${last || 503}`);
}

function extractVersion(text) {
    const value = clean(text);
    const match = value.match(/\bVersion\s*[:\-]?\s*((?:VF\s*\+\s*VOSTFR|VOSTFR\s*\+\s*VF|VOST[- ]?FR|VF|VFF|VF2|TRUE\s*-?\s*FRENCH|TRUEFRENCH|FRENCH\s+(?:DUB|AUDIO)))\b/i);
    return match ? clean(match[1]) : null;
}

function extractCard($, element, type) {
    const href = $(element).attr('href') || '';
    if (!href.includes('newsid=')) return null;
    const url = absoluteUrl(href);
    let node = $(element);
    for (let i = 0; i < 8; i++) {
        if (node.find('img').length && clean(node.text()).length > 8) break;
        const parent = node.parent();
        if (!parent.length) break;
        node = parent;
    }
    const img = node.find('img').first();
    const title = stripSiteSuffix(clean($(element).text()) || clean(img.attr('alt')) || clean(node.find('h1,h2,h3,h4,.title').first().text()));
    if (!title) return null;
    let id = '';
    try { id = new URL(url).searchParams.get('newsid') || ''; } catch { return null; }
    const version = extractVersion(node.text());
    return { id, title, type, url, language: version ? detectLanguage(version) : null, version, normalizedTitle: normalizeTitle(title), enriched: false, detailTitle: null };
}

function parseListing(html, type) {
    const $ = cheerio.load(html), out = [], seen = new Set();
    $("a[href*='newsid=']").each((_i, el) => {
        const item = extractCard($, el, type);
        if (!item || seen.has(item.id)) return;
        seen.add(item.id); out.push(item);
    });
    return out;
}

function stripSiteSuffix(value) {
    return clean(value)
        .replace(/\s+streaming(?:\s+complet)?(?:\s+gratuit|\s+202\d)?(?:\s+en\s+vf.*)?$/i, '')
        .replace(/\s+streaming(?:\s+complet)?(?:\s+\d{4})?.*$/i, '')
        .trim();
}

function extractDetailTitle($) {
    const candidates = [
        clean($('meta[property="og:title"]').attr('content')),
        clean($('meta[name="twitter:title"]').attr('content')),
        clean($('h1').first().text()),
        clean($('title').first().text())
    ].filter(Boolean);
    for (const value of candidates) {
        const cleaned = stripSiteSuffix(value);
        if (cleaned) return cleaned;
    }
    return '';
}

function extractVersionFromDocument($) {
    const selectors = ['body','main','article','.full-text','.fullstory','.news-content','.article-content'];
    for (const selector of selectors) {
        const nodes = $(selector);
        for (let i = 0; i < nodes.length; i++) {
            const text = clean($(nodes[i]).text());
            const version = extractVersion(text);
            if (version) return version;
        }
    }
    const html = $.html();
    const htmlMatch = html.match(/\bVersion\s*(?::|\s|<[^>]+>)*((?:VF\s*\+\s*VOSTFR|VOSTFR\s*\+\s*VF|VOST[- ]?FR|VF|VFF|VF2|TRUE\s*-?\s*FRENCH|TRUEFRENCH|FRENCH\s+(?:DUB|AUDIO)))(?=\b|<)/i);
    return htmlMatch ? clean(htmlMatch[1]) : null;
}

async function enrich(item, expectedTitle) {
    if (!item || item.enriched || item.language) return item;
    try {
        const $ = cheerio.load(await fs23(item.url));
        const detailTitle = extractDetailTitle($);
        item.detailTitle = detailTitle || null;
        if (detailTitle && !safeTitleMatch(expectedTitle, detailTitle)) {
            item.language = null;
            item.enriched = true;
            console.log(`[FS23] REJET titre: "${expectedTitle}" != "${detailTitle}"`);
            return item;
        }
        const version = extractVersionFromDocument($);
        item.version = version;
        if (version) item.language = detectLanguage(version);
    } catch (e) {
        console.log(`[FS23] fiche ${item.id}: ${e.message}`);
    }
    item.enriched = true;
    return item;
}

function buildIndex(items) {
    const byTitle = new Map();
    for (const item of items) {
        if (!item.normalizedTitle) continue;
        for (const key of [`${item.type}:${item.normalizedTitle}`, `any:${item.normalizedTitle}`]) {
            if (!byTitle.has(key)) byTitle.set(key, []);
            byTitle.get(key).push(item);
        }
    }
    return { items, byTitle };
}

function findCandidates(title, type) {
    if (!FS23_INDEX || !title) return [];
    const normalized = normalizeTitle(title), result = [], seen = new Set();
    for (const x of [...(FS23_INDEX.byTitle.get(`${type}:${normalized}`) || []), ...(FS23_INDEX.byTitle.get(`any:${normalized}`) || [])]) {
        if (!seen.has(x.id) && (!type || x.type === type)) { seen.add(x.id); result.push(x); }
    }
    FS23_INDEX.items.map(x => ({ x, score: scoreTitle(title, x.title) }))
        .filter(o => (!type || o.x.type === type) && o.score >= MIN_TITLE_SCORE)
        .sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES)
        .forEach(o => { if (!seen.has(o.x.id)) { seen.add(o.x.id); result.push(o.x); } });
    return result.slice(0, MAX_CANDIDATES);
}

async function searchFs23(title, type) {
    const q = clean(title); if (!q) return [];
    const urls = [
        `${FS23_BASE}/index.php?do=search&subaction=search&story=${encodeURIComponent(q)}`,
        `${FS23_BASE}/index.php?do=search&story=${encodeURIComponent(q)}`
    ];
    const pages = await Promise.all(urls.map(async url => {
        try { return parseListing(await fs23(url), type); }
        catch (e) { console.log(`[FS23] recherche "${q}": ${e.message}`); return []; }
    }));
    const seen = new Set();
    return pages.flat().filter(x => {
        if (seen.has(x.id)) return false;
        seen.add(x.id);
        return (!type || x.type === type) && scoreTitle(q, x.title) >= MIN_TITLE_SCORE;
    }).sort((a, b) => scoreTitle(q, b.title) - scoreTitle(q, a.title)).slice(0, MAX_CANDIDATES);
}

async function loadType(type) {
    const all = [], seen = new Set();
    for (let page = 1; page <= FS23_PAGES; page++) {
        try {
            const url = page === 1 ? SOURCES[type] : `${SOURCES[type]}&cstart=${page}`;
            const items = parseListing(await fs23(url), type);
            if (!items.length) break;
            for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); all.push(item); }
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
            console.log(`[FS23] ${type} page ${page}: ${e.message}`);
            if (/403|429/.test(e.message)) break;
        }
    }
    return all;
}

async function refreshIndex() {
    if (FS23_REFRESH) return FS23_REFRESH;
    FS23_REFRESH = (async () => {
        const [movies, series] = await Promise.all([loadType('movie'), loadType('series')]);
        FS23_INDEX = buildIndex([...movies, ...series]);
        FS23_INDEX_TIME = Date.now();
        console.log(`[FS23] index prêt: ${FS23_INDEX.items.length} éléments`);
        return FS23_INDEX;
    })().catch(e => {
        console.log(`[FS23] refresh: ${e.message}`);
        return FS23_INDEX;
    }).finally(() => { FS23_REFRESH = null; });
    return FS23_REFRESH;
}

async function getTitleFromIMDb(id) {
    for (const type of ['movie', 'series']) {
        try {
            const r = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(id)}.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
            if (!r.ok) continue;
            const data = await r.json(), meta = data?.meta;
            if (meta?.name || meta?.title) return { type, title: meta.name || meta.title };
        } catch {}
    }
    return null;
}

async function enrichCandidates(candidates, expectedTitle) {
    let cursor = 0;
    const found = [];
    async function worker() {
        while (cursor < candidates.length) {
            const candidate = candidates[cursor++];
            const score = scoreTitle(expectedTitle, candidate.title);
            if (score < MIN_TITLE_SCORE) continue;
            await enrich(candidate, expectedTitle);
            if (candidate.language && candidate.detailTitle && safeTitleMatch(expectedTitle, candidate.detailTitle)) found.push({ tag: candidate.language, score, id: candidate.id, title: candidate.detailTitle, version: candidate.version });
        }
    }
    await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, candidates.length) }, worker));
    if (!found.length) return null;
    const priority = { vf_vostfr: 4, vf: 3, vostfr: 2 };
    found.sort((a, b) => priority[b.tag] - priority[a.tag] || b.score - a.score);
    return found[0] || null;
}

async function getFs23Tag(id) {
    const key = id.toLowerCase();
    const cached = TAG_CACHE.get(key);
    if (cached && Date.now() - cached.time < (cached.tag ? TAG_TTL : NEGATIVE_TTL)) return cached;
    if (TAG_INFLIGHT.has(key)) return TAG_INFLIGHT.get(key);
    const promise = (async () => {
        const info = await getTitleFromIMDb(id);
        if (!info) {
            const result = { tag: null, source: null, reason: 'IMDb title unavailable' };
            TAG_CACHE.set(key, { ...result, time: Date.now() });
            return result;
        }
        let candidates = FS23_INDEX ? findCandidates(info.title, info.type) : [];
        const direct = await searchFs23(info.title, info.type);
        const seen = new Set(candidates.map(x => x.id));
        for (const x of direct) if (!seen.has(x.id)) { seen.add(x.id); candidates.push(x); }
        let result = await enrichCandidates(candidates.slice(0, MAX_CANDIDATES), info.title);
        if (!result) {
            await refreshIndex();
            candidates = findCandidates(info.title, info.type);
            result = await enrichCandidates(candidates, info.title);
        }
        const finalResult = result ? { tag: result.tag, source: 'FS23', score: result.score, fs23Title: result.title, version: result.version, imdbTitle: info.title } : { tag: null, source: null, reason: 'No safe FS23 Version match', imdbTitle: info.title };
        TAG_CACHE.set(key, { ...finalResult, time: Date.now() });
        console.log(`[FS23] ${id} "${info.title}" -> ${finalResult.tag || 'AUCUNE PREUVE'}${finalResult.version ? ` [Version: ${finalResult.version}]` : ''}`);
        return finalResult;
    })().finally(() => TAG_INFLIGHT.delete(key));
    TAG_INFLIGHT.set(key, promise);
    return promise;
}

async function downloadPoster(id) {
    const r = await fetch(`${BETTERPOSTER_BASE}${encodeURIComponent(id)}.jpg`, { headers: { 'User-Agent': 'FrenchStreamEnhanced/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`BetterPoster ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

function badgeSvg(label) {
    const width = label === 'VF+VOSTFR' ? 300 : label === 'VOSTFR' ? 230 : 135;
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="58"><rect x="0" y="0" width="${width}" height="58" rx="10" fill="#111" fill-opacity="0.90"/><text x="${width / 2}" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#fff">${label}</text></svg>`);
}

async function buildCustomPoster(id) {
    const cached = POSTER_CACHE.get(id);
    if (cached && cached.expires > Date.now()) return cached.buffer;
    if (POSTER_INFLIGHT.has(id)) return POSTER_INFLIGHT.get(id);
    const promise = (async () => {
        const [poster, result] = await Promise.all([downloadPoster(id), getFs23Tag(id)]);
        const tag = result?.tag || null;
        const output = tag ? await sharp(poster).composite([{ input: badgeSvg(tag === 'vf_vostfr' ? 'VF+VOSTFR' : tag === 'vostfr' ? 'VOSTFR' : 'VF'), left: 24, top: 24 }]).jpeg({ quality: 94 }).toBuffer() : await sharp(poster).jpeg({ quality: 94 }).toBuffer();
        POSTER_CACHE.set(id, { buffer: output, expires: Date.now() + POSTER_TTL });
        return output;
    })().finally(() => POSTER_INFLIGHT.delete(id));
    POSTER_INFLIGHT.set(id, promise);
    return promise;
}

function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
    const pathOnly = (req.url || '').split('?')[0];
    const debugMatch = pathOnly.match(/^\/debug\/poster\/(tt\d+)$/i);
    if (debugMatch) {
        try {
            const result = await getFs23Tag(debugMatch[1]);
            return json(res, 200, { ...result, index: !!FS23_INDEX, indexSize: FS23_INDEX?.items?.length || 0, indexAgeMs: FS23_INDEX ? Date.now() - FS23_INDEX_TIME : null });
        } catch (e) {
            return json(res, 500, { error: e.message });
        }
    }
    const posterMatch = pathOnly.match(/^\/poster\/(tt\d+)\.jpg$/i);
    if (posterMatch) {
        try {
            const buffer = await buildCustomPoster(posterMatch[1].toLowerCase());
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600', 'Access-Control-Allow-Origin': '*' });
            return res.end(buffer);
        } catch (e) {
            return json(res, 502, { error: e.message });
        }
    }
    const legacy = pathOnly.match(/^\/poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i);
    if (legacy) {
        res.writeHead(302, { Location: `https://lambda666-french-poster.hf.space/poster/${legacy[1].toLowerCase()}/${legacy[2].toLowerCase()}.svg` });
        return res.end();
    }
    if (req.url === '/' || req.url === '/configure') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public/configure.html')));
    }
    if (req.url.startsWith('/test-tmdb')) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try { const result = await testTMDBKey(url.searchParams.get('key')); res.end(JSON.stringify(result)); } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
        return;
    }
    const parts = req.url.split('/').filter(Boolean);
    let configStr = null;
    if (parts.length >= 1 && !['manifest.json', 'catalog', 'meta'].includes(parts[0])) {
        configStr = parts[0];
        req.url = req.url.replace('/' + configStr, '') || '/';
    }
    if (req.url.includes('/catalog/') || req.url.includes('/meta/')) {
        res.setHeader('Cache-Control', 'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public');
    }
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || 'localhost:' + PORT}`;
    const addonInterface = getAddonInterface(configStr, publicBaseUrl);
    const router = getRouter(addonInterface);
    router(req, res, () => { res.writeHead(404); res.end(); });
});

server.listen(PORT, () => console.log(`Addon French Stream démarré sur le port ${PORT}`));
