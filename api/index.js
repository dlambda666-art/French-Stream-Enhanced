const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('../addon');
const path = require('path');
const fs = require('fs');

module.exports = (req, res) => {
    const parts = req.url.split('/').filter(Boolean);

    // ============================================================
    // POSTER LANGUAGE BADGE
    // /poster/:imdbId/:language.svg
    // ============================================================
    if (
        parts.length === 3 &&
        parts[0] === 'poster' &&
        parts[1] &&
        parts[2].endsWith('.svg')
    ) {
        const imdbId = parts[1];
        const language = parts[2]
            .replace(/\.svg$/i, '')
            .toUpperCase();

        // Sécurité : uniquement les valeurs attendues
        if (
            !/^tt\d+$/i.test(imdbId) ||
            !['DUB', 'SUB', 'DUB_SUB'].includes(language)
        ) {
            res.statusCode = 404;
            return res.end('Not Found');
        }

        const labels = {
            DUB: 'DUB',
            SUB: 'SUB',
            DUB_SUB: 'DUB + SUB'
        };

        const label = labels[language];

        // SVG autonome : aucune ressource externe nécessaire
        const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="180"
     height="54"
     viewBox="0 0 180 54">
    <rect
        x="1"
        y="1"
        width="178"
        height="52"
        rx="12"
        fill="#111827"
        stroke="#6366f1"
        stroke-width="2"/>
    <text
        x="90"
        y="35"
        text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="20"
        font-weight="700"
        fill="#ffffff">${label}</text>
</svg>`.trim();

        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader(
            'Cache-Control',
            'public, max-age=86400, s-maxage=86400'
        );
        return res.end(svg);
    }

    // ============================================================
    // CONFIGURATION
    // ============================================================

    // Servir la page de configuration si demandé ou à la racine
    if (req.url === '/' || req.url === '/configure') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(
            fs.readFileSync(
                path.join(__dirname, '../public/configure.html')
            )
        );
    }

    // ============================================================
    // TEST TMDB
    // ============================================================

    if (req.url.startsWith('/test-tmdb')) {
        const url = new URL(
            req.url,
            `http://${req.headers.host || 'localhost'}`
        );

        res.setHeader(
            'Content-Type',
            'application/json; charset=utf-8'
        );
        res.setHeader('Access-Control-Allow-Origin', '*');

        testTMDBKey(url.searchParams.get('key'))
            .then(result => res.end(JSON.stringify(result)))
            .catch(() => {
                res.statusCode = 500;
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: 'TMDB test failed'
                    })
                );
            });

        return;
    }

    // ============================================================
    // ADDON AVEC OU SANS CONFIGURATION
    // ============================================================

    let configStr = null;

    if (
        parts.length >= 1 &&
        !['manifest.json', 'catalog', 'meta'].includes(parts[0])
    ) {
        configStr = parts[0];

        // Retirer le hash du chemin pour que le router
        // du SDK puisse matcher les routes
        // (/manifest.json, /catalog/... etc.)
        req.url = req.url.replace('/' + configStr, '');

        if (req.url === '') {
            req.url = '/';
        }
    }

    // ============================================================
    // CACHE VERCEL
    // ============================================================

    if (
        req.url.includes('/catalog/') ||
        req.url.includes('/meta/')
    ) {
        res.setHeader(
            'Cache-Control',
            'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public'
        );
    }

    // ============================================================
    // STREMIO ADDON ROUTER
    // ============================================================

    const addonInterface = getAddonInterface(configStr);
    const router = getRouter(addonInterface);

    router(req, res, () => {
        res.status(404).end();
    });
};
