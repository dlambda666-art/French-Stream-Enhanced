const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('./addon');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 7000;

const BETTERPOSTER_BASE = 'https://btttr.cc/poster/imdb/poster-default/';
const POSTER_CACHE = new Map();
const POSTER_CACHE_TTL = 24 * 60 * 60 * 1000;

function escapeXml(value) {
    return String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));
}

function posterSvg(imageBase64, mime, tag) {
    const badge = (x, width, label, color) => `<rect x="${x}" y="18" width="${width}" height="54" rx="10" fill="${color}" opacity="0.96"/><text x="${x + width / 2}" y="54" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>`;
    let badges = '';
    if (tag === 'dub') badges = badge(18, 105, 'DUB', '#1976d2');
    else if (tag === 'sub') badges = badge(18, 105, 'SUB', '#d62828');
    else badges = badge(18, 105, 'DUB', '#1976d2') + badge(133, 105, 'SUB', '#d62828');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">
  <image href="data:${mime};base64,${imageBase64}" x="0" y="0" width="500" height="750" preserveAspectRatio="xMidYMid slice"/>
  ${badges}
</svg>`;
}
async function serveEnhancedPoster(req, res, imdbId, tag) {
    if (!/^tt\d+$/i.test(imdbId) || !['dub', 'sub', 'dub_sub'].includes(tag)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid poster request');
    }
    const cacheKey = `${imdbId}:${tag}`;
    const cached = POSTER_CACHE.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        res.writeHead(200, { 'Content-Type': cached.mime === 'image/svg+xml' ? cached.mime : 'image/svg+xml', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' });
        return res.end(cached.body);
    }

    try {
        const upstream = await fetch(`${BETTERPOSTER_BASE}${encodeURIComponent(imdbId)}.jpg`, { headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1' } });
        if (!upstream.ok) throw new Error(`BetterPoster ${upstream.status}`);
        const mime = upstream.headers.get('content-type') || 'image/jpeg';
        const buffer = Buffer.from(await upstream.arrayBuffer());
        const base64 = buffer.toString('base64');
        const body = posterSvg(base64, mime, tag);
        POSTER_CACHE.set(cacheKey, { body, mime: 'image/svg+xml', expires: Date.now() + POSTER_CACHE_TTL });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600' });
        return res.end(body);
    } catch (error) {
        console.error('BetterPoster error:', error.message);
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        return res.end('BetterPoster unavailable');
    }
}

const server = http.createServer((req, res) => {
    const parts = req.url.split('/').filter(Boolean);


    const posterMatch = req.url.match(/^\/poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i);
    if (posterMatch) {
        return serveEnhancedPoster(req, res, posterMatch[1], posterMatch[2].toLowerCase());
    }

    if (req.url === '/' || req.url === '/configure') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public/configure.html')));
    }

    if (req.url.startsWith('/test-tmdb')) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        testTMDBKey(url.searchParams.get('key')).then(result => res.end(JSON.stringify(result)));
        return;
    }

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

    router(req, res, () => {
        res.writeHead(404);
        res.end();
    });
});

server.listen(PORT, () => {
    console.log(`Addon French Stream démarré sur le port ${PORT}`);
});
