const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface } = require('./addon');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 7000;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const FRENCH_POSTER_BASE = 'https://lambda666-french-poster.hf.space';

function escapeXml(value) {
    return String(value).replace(/[<>&\"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\"': '&quot;', "'": '&apos;' }[char]));
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

function frenchPosterUrl(imdbId, tag) {
    return `${FRENCH_POSTER_BASE}/poster/${encodeURIComponent(imdbId)}/${tag}.svg`;
}

function nativePosterUrl(imdbId) {
    return `https://images.metahub.space/poster/medium/${encodeURIComponent(imdbId)}/img`;
}

function rewriteBetterPosterUrls(body, publicBaseUrl) {
    const root = String(publicBaseUrl || '').replace(/\/$/, '');
    return body
        .replace(/https?:\/\/image\.tmdb\.org\/t\/p\/(w\d+|original)\/([A-Za-z0-9._-]+\.jpg)/gi, (_, size, file) => `${root}/tmdb-poster/${size}/${file}`)
        .replace(/https?:\/\/btttr\.cc\/[^\"'\s<>]*?\/((tt\d+))\.jpg(?:\?[^\"'\s<>]*)?/gi, (_, fullId, imdbId) => nativePosterUrl(imdbId))
        .replace(/https?:\/\/btttr\.cc\/[^\"'\s<>]*?((tt\d+))\.jpg(?:\?[^\"'\s<>]*)?/gi, (_, fullId, imdbId) => nativePosterUrl(imdbId));
}

async function validateTmdbKey(key) {
    if (!key) return { valid: false, error: 'missing_key' };
    try {
        const response = await fetch(`${TMDB_BASE}/configuration?api_key=${encodeURIComponent(key)}`, {
            headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1' }
        });
        if (response.ok) return { valid: true };
        let detail = '';
        try { detail = (await response.json())?.status_message || ''; } catch {}
        return { valid: false, error: 'tmdb_rejected', status: response.status, message: detail || `TMDB HTTP ${response.status}` };
    } catch (error) {
        return { valid: false, error: 'tmdb_unreachable', message: error?.message || 'TMDB unreachable' };
    }
}

const server = http.createServer((req, res) => {
    const parts = req.url.split('/').filter(Boolean);
    let configStr = null;
    if (parts.length >= 1 && !['manifest.json', 'catalog', 'meta', 'poster', 'tmdb-poster', 'configure', 'test-tmdb'].includes(parts[0])) {
        configStr = parts[0];
        req.url = req.url.replace('/' + configStr, '') || '/';
    }

    const posterMatch = req.url.match(/^\/poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i);
    if (posterMatch) {
        const target = frenchPosterUrl(posterMatch[1], posterMatch[2].toLowerCase());
        res.writeHead(302, { Location: target, 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
        return res.end();
    }

    const tmdbPosterMatch = req.url.match(/^\/tmdb-poster\/(w\d+|original)\/([A-Za-z0-9._-]+\.jpg)$/i);
    if (tmdbPosterMatch) {
        const target = `https://image.tmdb.org/t/p/${tmdbPosterMatch[1]}/${tmdbPosterMatch[2]}`;
        fetch(target, { headers: { 'User-Agent': 'FrenchStreamEnhanced/0.1' } })
            .then(async response => {
                if (!response.ok) throw new Error(`TMDB image ${response.status}`);
                const buffer = Buffer.from(await response.arrayBuffer());
                res.writeHead(200, {
                    'Content-Type': response.headers.get('content-type') || 'image/jpeg',
                    'Content-Length': String(buffer.length),
                    'Cache-Control': 'public, max-age=2592000, s-maxage=2592000',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(buffer);
            })
            .catch(error => {
                if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Poster proxy error: ${error?.message || 'TMDB image unavailable'}`);
            });
        return;
    }

    if (req.url === '/' || req.url === '/configure') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public/configure.html')));
    }

    if (req.url.startsWith('/test-tmdb')) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + PORT}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        validateTmdbKey(url.searchParams.get('key'))
            .then(result => res.end(JSON.stringify(result)))
            .catch(error => res.end(JSON.stringify({ valid: false, error: 'test_failed', message: error?.message || 'TMDB test failed' })));
        return;
    }

    if (req.url.includes('/catalog/') || req.url.includes('/meta/')) {
        res.setHeader('Cache-Control', 'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public');
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${forwardedProto || (host.startsWith('localhost') ? 'http' : 'https')}://${host}`;
    const addonInterface = getAddonInterface(configStr, publicBaseUrl);
    const router = getRouter(addonInterface);

    if (req.url.includes('/catalog/') || req.url.includes('/meta/')) {
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        const chunks = [];
        res.write = (chunk, encoding, callback) => { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)); return true; };
        res.end = (chunk, encoding, callback) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            const body = rewriteBetterPosterUrls(Buffer.concat(chunks).toString('utf8'), publicBaseUrl);
            res.removeHeader('Content-Length');
            return originalEnd(body, 'utf8', callback);
        };
    }

    router(req, res, () => { res.writeHead(404); res.end(); });
});

server.listen(PORT, () => console.log(`Addon French Stream démarré sur le port ${PORT}`));
