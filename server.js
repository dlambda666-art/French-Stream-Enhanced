const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface } = require('./addon');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 8080;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const FRENCH_POSTER_BASE = 'https://lambda666-french-poster.hf.space';

function nativePosterUrl(imdbId) {
    return `https://images.metahub.space/poster/medium/${encodeURIComponent(imdbId)}/img`;
}

function frenchPosterUrl(imdbId, tag) {
    return `${FRENCH_POSTER_BASE}/poster/${encodeURIComponent(imdbId)}/${tag}.svg`;
}

function rewriteBetterPosterUrls(body) {
    return body
        .replace(/https?:\/\/btttr\.cc\/[^\"'\s<>]*?\/((tt\d+))\.jpg(?:\?[^\"'\s<>]*)?/gi, (_, __, imdbId) => nativePosterUrl(imdbId))
        .replace(/https?:\/\/btttr\.cc\/[^\"'\s<>]*?((tt\d+))\.jpg(?:\?[^\"'\s<>]*)?/gi, (_, __, imdbId) => nativePosterUrl(imdbId));
}

async function validateTmdbKey(key) {
    if (!key) return { valid: false, error: 'missing_key' };

    try {
        const response = await fetch(
            `${TMDB_BASE}/configuration?api_key=${encodeURIComponent(key)}`,
            { headers: { 'User-Agent': 'FrenchStreamEnhanced/1.0' } }
        );

        if (response.ok) return { valid: true };

        let message = '';
        try {
            const data = await response.json();
            message = data?.status_message || '';
        } catch (_) {}

        return {
            valid: false,
            error: 'tmdb_rejected',
            status: response.status,
            message: message || `TMDB HTTP ${response.status}`
        };
    } catch (error) {
        return {
            valid: false,
            error: 'tmdb_unreachable',
            message: error?.message || 'TMDB unreachable'
        };
    }
}

function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    if (pathname === '/health') {
        return sendJson(res, 200, { ok: true, service: 'French Stream Enhanced' });
    }

    if (pathname === '/test-tmdb') {
        const key = requestUrl.searchParams.get('key');
        const result = await validateTmdbKey(key);
        return sendJson(res, 200, result);
    }

    const parts = pathname.split('/').filter(Boolean);
    let configStr = null;
    if (parts.length >= 1 && !['manifest.json', 'catalog', 'meta', 'poster', 'configure', 'health', 'test-tmdb'].includes(parts[0])) {
        configStr = parts[0];
        const stripped = '/' + parts.slice(1).join('/');
        requestUrl.pathname = stripped === '/' ? '/' : stripped;
    }

    if (requestUrl.pathname === '/' || requestUrl.pathname === '/configure') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public/configure.html')));
    }

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || `localhost:${PORT}`}`;
    const addonInterface = getAddonInterface(configStr, publicBaseUrl);
    const router = getRouter(addonInterface);

    if (requestUrl.pathname.includes('/catalog/') || requestUrl.pathname.includes('/meta/')) {
        res.setHeader('Cache-Control', 'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public');

        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        const chunks = [];

        res.write = (chunk, encoding, callback) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            return true;
        };

        res.end = (chunk, encoding, callback) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            const body = rewriteBetterPosterUrls(Buffer.concat(chunks).toString('utf8'));
            res.removeHeader('Content-Length');
            return originalEnd(body, 'utf8', callback);
        };
    }

    const originalUrl = req.url;
    req.url = requestUrl.pathname + (requestUrl.search || '');

    router(req, res, () => {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not_found', path: requestUrl.pathname }));
    });
    req.url = originalUrl;
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Addon French Stream démarré sur le port ${PORT}`);
});
