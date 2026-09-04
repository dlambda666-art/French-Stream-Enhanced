const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('./addon');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 7000;

const BETTERPOSTER_BASE = 'https://btttr.cc/poster/imdb/poster-default/';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const POSTER_CACHE = new Map();
const POSTER_CACHE_TTL = 24 * 60 * 60 * 1000;

function escapeXml(value) {
    return String(value).replace(/[<>&\"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\"': '&quot;', "'": '&apos;' }[char]));
}

function posterSvg(imageBase64, mime, tag) {
    const badge = (x, width, label, color) => `<rect x="${x}" y="18" width="${width}" height="54" rx="10" fill="${color}" opacity="0.96"/><text x="${x + width / 2}" y="54" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(label)}</text>`;
    let badges = '';
    if (tag === 'dub') badges = badge(18, 105, 'DUB', '#1976d2');
    else if (tag === 'sub') badges = badge(18, 105, 'SUB', '#d62828');
    else badges = badge(18, 105, 'DUB', '#1976d2') + badge(133, 105, 'SUB', '#d62828');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">\n  <image href="data:${mime};base64,${imageBase64}" x="0" y="0" width="500" height="750" preserveAspectRatio="xMidYMid slice"/>\n  ${badges}\n</svg>`;
}

function getConfigTmdbKey(configStr) {
    if (!configStr) return process.env.TMDB_API_KEY || null;
    try {
        const decoded = Buffer.from(configStr, 'base64').toString('utf8');
        const config = JSON.parse(decoded);
        return config.t || process.env.TMDB_API_KEY || null;
    } catch {
        return process.env.TMDB_API_KEY || null;
    }
}

async function getTmdbPoster(imdbId, tmdbKey) {
    if (!tmdbKey) return null;
    const url = `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id`;
    const response = await fetch(url, { headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1' } });
    if (!response.ok) throw new Error(`TMDB find ${response.status}`);
    const data = await response.json();
    const item = [...(data.movie_results || []), ...(data.tv_results || [])].find(entry => entry.poster_path);
    return item?.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : null;
}

async function fetchPosterImage(imdbId, tmdbKey) {
    // Fast path: one direct artwork request by IMDb ID through MetaHub.
    // This avoids the slower BetterPoster hop while keeping the poster pipeline intact.
    try {
        const upstream = await fetch(`https://images.metahub.space/poster/medium/${encodeURIComponent(imdbId)}/img`, {
            headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1', 'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*,*/*;q=0.8' }
        });
        if (upstream.ok) {
            return {
                buffer: Buffer.from(await upstream.arrayBuffer()),
                mime: upstream.headers.get('content-type') || 'image/jpeg',
                source: 'TMDB/MetaHub'
            };
        }
        console.warn(`TMDB/MetaHub ${imdbId} returned ${upstream.status}; trying TMDB fallback`);
    } catch (error) {
        console.warn(`TMDB/MetaHub ${imdbId} failed: ${error.message}; trying TMDB fallback`);
    }

    const tmdbPosterUrl = await getTmdbPoster(imdbId, tmdbKey);
    if (!tmdbPosterUrl) return null;
    const fallback = await fetch(tmdbPosterUrl, { headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1' } });
    if (!fallback.ok) throw new Error(`TMDB image ${fallback.status}`);
    return {
        buffer: Buffer.from(await fallback.arrayBuffer()),
        mime: fallback.headers.get('content-type') || 'image/jpeg',
        source: 'TMDB'
    };
}

async function serveEnhancedPoster(req, res, imdbId, tag, tmdbKey) {
    if (!/^tt\d+$/i.test(imdbId) || !['dub', 'sub', 'dub_sub'].includes(tag)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid poster request');
    }
    const cacheKey = `${imdbId}:${tag}`;
    const cached = POSTER_CACHE.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' });
        return res.end(cached.body);
    }

    try {
        const image = await fetchPosterImage(imdbId, tmdbKey);
        if (!image) {
            console.error(`No poster source found for ${imdbId}`);
            res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
            return res.end('Poster unavailable');
        }
        console.log(`Poster ${imdbId}/${tag}: ${image.source}`);
        const body = posterSvg(image.buffer.toString('base64'), image.mime, tag);
        POSTER_CACHE.set(cacheKey, { body, mime: 'image/svg+xml', expires: Date.now() + POSTER_CACHE_TTL });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600' });
        return res.end(body);
    } catch (error) {
        console.error(`Poster error ${imdbId}:`, error.message);
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        return res.end('Poster unavailable');
    }
}

function rewriteDirectBetterPoster(body) {
    return body.replace(/https:\/\/btttr\.cc\/poster\/imdb\/poster-default\/(tt\d+)\.jpg/gi, (_, imdbId) =>
        `https://images.metahub.space/poster/medium/${encodeURIComponent(imdbId)}/img`
    );
}

const server = http.createServer((req, res) => {
    const parts = req.url.split('/').filter(Boolean);

    let configStr = null;
    if (parts.length >= 1 && !['manifest.json', 'catalog', 'meta', 'poster', 'configure', 'test-tmdb'].includes(parts[0])) {
        configStr = parts[0];
        req.url = req.url.replace('/' + configStr, '') || '/';
    }

    const posterMatch = req.url.match(/^\/poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i);
    if (posterMatch) {
        return serveEnhancedPoster(req, res, posterMatch[1], posterMatch[2].toLowerCase(), getConfigTmdbKey(configStr));
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

    if (req.url.includes('/catalog/') || req.url.includes('/meta/')) {
        res.setHeader('Cache-Control', 'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public');
    }

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || 'localhost:' + PORT}`;
    const addonInterface = getAddonInterface(configStr, publicBaseUrl);
    const router = getRouter(addonInterface);

    if (req.url.includes('/catalog/') || req.url.includes('/meta/')) {
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        const chunks = [];
        res.write = (chunk, encoding, callback) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            return true;
        };
        res.end = (chunk, encoding, callback) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            const body = rewriteDirectBetterPoster(Buffer.concat(chunks).toString('utf8'));
            res.removeHeader('Content-Length');
            return originalEnd(body, 'utf8', callback);
        };
    }

    router(req, res, () => {
        res.writeHead(404);
        res.end();
    });
});

server.listen(PORT, () => {
    console.log(`Addon French Stream démarré sur le port ${PORT}`);
});
