const { getRouter } = require('stremio-addon-sdk');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 8080;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const FRENCH_POSTER_BASE = 'https://lambda666-french-poster.hf.space';
const ADDON_CACHE_RESET_MS = 15 * 60 * 1000;

let addonModule = require('./addon');
let addonModuleLoadedAt = Date.now();

function getCurrentAddonInterface(configStr, publicBaseUrl) {
    if (Date.now() - addonModuleLoadedAt >= ADDON_CACHE_RESET_MS) {
        delete require.cache[require.resolve('./addon')];
        addonModule = require('./addon');
        addonModuleLoadedAt = Date.now();
        console.log('Addon catalog cache reset.');
    }
    return addonModule.getAddonInterface(configStr, publicBaseUrl);
}

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

function getConfigTmdbKey(configStr) {
    if (!configStr) return process.env.TMDB_API_KEY || null;
    try {
        const decoded = Buffer.from(configStr, 'base64').toString('utf8');
        const config = JSON.parse(decoded);
        return config.t || process.env.TMDB_API_KEY || null;
    } catch (_) {
        return process.env.TMDB_API_KEY || null;
    }
}

async function fetchTmdbMeta(type, imdbId, tmdbKey) {
    if (!tmdbKey || !/^tt\d+$/.test(imdbId)) return null;
    try {
        const response = await fetch(
            `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(tmdbKey)}&external_source=imdb_id&language=fr-FR`
        );
        if (!response.ok) return null;
        const data = await response.json();
        const item = type === 'series' ? data.tv_results?.[0] : data.movie_results?.[0];
        if (!item) return null;

        return {
            id: imdbId,
            type,
            name: item.title || item.name || imdbId,
            poster: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
            description: item.overview || '',
            releaseInfo: item.release_date || item.first_air_date || '',
            imdbRating: item.vote_average,
            genres: []
        };
    } catch (error) {
        console.error('TMDB meta error:', error?.message || error);
        return null;
    }
}

async function fetchTmdbIdMeta(type, tmdbId, tmdbKey) {
    if (!tmdbKey || !/^\d+$/.test(String(tmdbId))) return null;
    try {
        const endpoint = type === 'series' ? 'tv' : 'movie';
        const response = await fetch(
            `${TMDB_BASE}/${endpoint}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(tmdbKey)}&language=fr-FR`
        );
        if (!response.ok) return null;
        const item = await response.json();
        if (!item?.id) return null;

        return {
            id: `tmdb:${item.id}`,
            type,
            name: item.title || item.name || `tmdb:${item.id}`,
            poster: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
            description: item.overview || '',
            releaseInfo: item.release_date || item.first_air_date || '',
            imdbRating: item.vote_average,
            genres: Array.isArray(item.genres) ? item.genres.map(g => g.name).filter(Boolean) : []
        };
    } catch (error) {
        console.error('TMDB id meta error:', error?.message || error);
        return null;
    }
}

async function fetchCinemetaMeta(type, imdbId) {
    if (!/^tt\d+$/.test(imdbId)) return null;
    try {
        const response = await fetch(`${CINEMETA_BASE}/meta/${type}/${encodeURIComponent(imdbId)}.json`, {
            headers: { 'User-Agent': 'FrenchStreamEnhanced/1.0' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data?.meta || null;
    } catch (error) {
        console.error('Cinemeta meta error:', error?.message || error);
        return null;
    }
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
    if (req.url === '/logo.png') {
        const logoPath = path.join(__dirname, 'file_000000005400820a9793431655245097.png');
        fs.readFile(logoPath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                return res.end('Logo not found');
            }
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': data.length,
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(data);
        });
        return;
    }

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

    // Resolve both IMDb and TMDB IDs directly. This is required when AIO Metadata
    // calls Frankenstream independently of a prior catalog request.
    if (requestUrl.pathname.includes('/meta/')) {
        const imdbMatch = requestUrl.pathname.match(/^\/meta\/(movie|series)\/(tt\d+)(?:\.json)?$/i);
        const tmdbMatch = requestUrl.pathname.match(/^\/meta\/(movie|series)\/tmdb:(\d+)(?:\.json)?$/i);
        if (imdbMatch || tmdbMatch) {
            const type = (imdbMatch || tmdbMatch)[1].toLowerCase();
            const tmdbKey = getConfigTmdbKey(configStr);
            let meta = null;

            if (imdbMatch) {
                meta = await fetchTmdbMeta(type, imdbMatch[2], tmdbKey) || await fetchCinemetaMeta(type, imdbMatch[2]);
            } else {
                meta = await fetchTmdbIdMeta(type, tmdbMatch[2], tmdbKey);
            }

            if (meta) return sendJson(res, 200, { meta });
        }
    }

    const addonInterface = getCurrentAddonInterface(configStr, publicBaseUrl);
    const router = getRouter(addonInterface);

    if (requestUrl.pathname.includes('/catalog/') || requestUrl.pathname.includes('/meta/')) {
        res.setHeader('Cache-Control', 'max-age=900, s-maxage=900, stale-while-revalidate=300, public');

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