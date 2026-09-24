const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface } = require('./addon');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 7000;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const FRENCH_POSTER_BASE = 'https://lambda666-french-poster.hf.space';

function getConfigTmdbKey(key) {
    if (!key) return process.env.TMDB_API_KEY || null;
    try {
        const decoded = Buffer.from(key, 'base64').toString('utf8');
        const config = JSON.parse(decoded);
        return config.t || process.env.TMDB_API_KEY || null;
    } catch {
        return process.env.TMDB_API_KEY || null;
    }
}

function frenchPosterUrl(imdbId, tag) {
    return `${FRENCH_POSTER_BASE}/poster/${encodeURIComponent(imdbId)}/${tag}.svg`;
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
    // Keep query strings intact while extracting an optional encoded config path.
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    const parts = pathname.split('/').filter(Boolean);
    let configStr = null;
    if (parts.length >= 1 && !['manifest.json', 'catalog', 'meta', 'poster', 'configure', 'test-tmdb'].includes(parts[0])) {
        configStr = parts[0];
        req.url = req.url.replace('/' + configStr, '') || '/';
    }

    const posterMatch = req.url.match(/^\/poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i);
    if (posterMatch) {
        const target = frenchPosterUrl(posterMatch[1], posterMatch[2].toLowerCase());
        res.writeHead(302, { Location: target, 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
        return res.end();
    }

    if (req.url === '/' || req.url === '/configure') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public/configure.html')));
    }

    if (req.url.startsWith('/test-tmdb')) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || 'localhost:' + PORT}`;
    const addonInterface = getAddonInterface(configStr, publicBaseUrl);
    const router = getRouter(addonInterface);

    // BetterPoster URLs are intentionally returned unchanged by the addon.
    router(req, res, () => { res.writeHead(404); res.end(); });
});

server.listen(PORT, () => console.log(`Addon French Stream démarré sur le port ${PORT}`));
