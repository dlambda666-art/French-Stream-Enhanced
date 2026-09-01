const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('../addon');
const path = require('path');
const fs = require('fs');

// ============================================================
// BETTERPOSTER
// ============================================================

const BETTERPOSTER_BASE =
    'https://btttr.cc/poster/imdb/poster-default/';

const POSTER_CACHE = new Map();
const POSTER_CACHE_TTL = 24 * 60 * 60 * 1000;

// ============================================================
// XML ESCAPE
// ============================================================

function escapeXml(value) {
    return String(value).replace(
        /[<>&"']/g,
        char => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&apos;'
        }[char])
    );
}

// ============================================================
// SVG POSTER AVEC BADGE
// ============================================================

function posterSvg(imageBase64, mime, language) {

    const badge = (
        x,
        width,
        label,
        color
    ) => `
        <rect
            x="${x}"
            y="18"
            width="${width}"
            height="54"
            rx="10"
            fill="${color}"
            opacity="0.96"
        />

        <text
            x="${x + width / 2}"
            y="54"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="Arial, Helvetica, sans-serif"
            font-size="27"
            font-weight="700"
            fill="#ffffff"
        >${escapeXml(label)}</text>
    `;

    let badges = '';

    if (language === 'DUB') {

        badges = badge(
            18,
            105,
            'DUB',
            '#1976d2'
        );

    } else if (language === 'SUB') {

        badges = badge(
            18,
            105,
            'SUB',
            '#d62828'
        );

    } else if (language === 'DUB_SUB') {

        badges =
            badge(
                18,
                105,
                'DUB',
                '#1976d2'
            ) +
            badge(
                133,
                105,
                'SUB',
                '#d62828'
            );
    }

    return `<?xml version="1.0" encoding="UTF-8"?>

<svg
    xmlns="http://www.w3.org/2000/svg"
    width="500"
    height="750"
    viewBox="0 0 500 750"
>

    <image
        href="data:${mime};base64,${imageBase64}"
        x="0"
        y="0"
        width="500"
        height="750"
        preserveAspectRatio="xMidYMid slice"
    />

    ${badges}

</svg>`;
}

// ============================================================
// SERVIR L'AFFICHE BETTERPOSTER + BADGE
// ============================================================

async function serveEnhancedPoster(
    req,
    res,
    imdbId,
    language
) {

    // --------------------------------------------------------
    // Sécurité
    // --------------------------------------------------------

    if (
        !/^tt\d+$/i.test(imdbId) ||
        !['DUB', 'SUB', 'DUB_SUB'].includes(language)
    ) {
        res.statusCode = 400;
        res.setHeader(
            'Content-Type',
            'text/plain; charset=utf-8'
        );
        return res.end('Invalid poster request');
    }

    // --------------------------------------------------------
    // CACHE
    // --------------------------------------------------------

    const cacheKey = `${imdbId}:${language}`;

    const cached = POSTER_CACHE.get(cacheKey);

    if (
        cached &&
        cached.expires > Date.now()
    ) {

        res.statusCode = 200;

        res.setHeader(
            'Content-Type',
            'image/svg+xml; charset=utf-8'
        );

        res.setHeader(
            'Access-Control-Allow-Origin',
            '*'
        );

        res.setHeader(
            'Cache-Control',
            'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600'
        );

        return res.end(cached.body);
    }

    // --------------------------------------------------------
    // BETTERPOSTER
    // --------------------------------------------------------

    try {

        const posterUrl =
            `${BETTERPOSTER_BASE}${encodeURIComponent(imdbId)}.jpg`;

        console.log(
            `French Stream POSTER ${imdbId} ${language} -> ${posterUrl}`
        );

        const upstream = await fetch(
            posterUrl,
            {
                headers: {
                    'User-Agent':
                        'FrenchStreamEnhanced/1.0'
                }
            }
        );

        if (!upstream.ok) {
            throw new Error(
                `BetterPoster HTTP ${upstream.status}`
            );
        }

        // ----------------------------------------------------
        // MIME
        // ----------------------------------------------------

        let mime =
            upstream.headers.get('content-type') ||
            'image/jpeg';

        // On ne laisse pas BetterPoster injecter
        // un type exotique dans le SVG.
        if (
            !mime.startsWith('image/')
        ) {
            mime = 'image/jpeg';
        }

        // ----------------------------------------------------
        // IMAGE -> BASE64
        // ----------------------------------------------------

        const buffer = Buffer.from(
            await upstream.arrayBuffer()
        );

        if (!buffer.length) {
            throw new Error(
                'BetterPoster returned an empty image'
            );
        }

        const imageBase64 =
            buffer.toString('base64');

        // ----------------------------------------------------
        // CREATION SVG
        // ----------------------------------------------------

        const body = posterSvg(
            imageBase64,
            mime,
            language
        );

        // ----------------------------------------------------
        // CACHE
        // ----------------------------------------------------

        POSTER_CACHE.set(
            cacheKey,
            {
                body,
                expires:
                    Date.now() +
                    POSTER_CACHE_TTL
            }
        );

        // ----------------------------------------------------
        // REPONSE
        // ----------------------------------------------------

        res.statusCode = 200;

        res.setHeader(
            'Content-Type',
            'image/svg+xml; charset=utf-8'
        );

        res.setHeader(
            'Access-Control-Allow-Origin',
            '*'
        );

        res.setHeader(
            'Cache-Control',
            'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600'
        );

        return res.end(body);

    } catch (error) {

        console.error(
            'French Stream BetterPoster error:',
            error.message
        );

        res.statusCode = 502;

        res.setHeader(
            'Content-Type',
            'text/plain; charset=utf-8'
        );

        res.setHeader(
            'Cache-Control',
            'no-store'
        );

        return res.end(
            'BetterPoster unavailable'
        );
    }
}

// ============================================================
// VERCEL HANDLER
// ============================================================

module.exports = async (req, res) => {

    const parts =
        req.url
            .split('?')[0]
            .split('/')
            .filter(Boolean);

    // ========================================================
    // POSTER LANGUAGE BADGE
    //
    // /poster/:imdbId/:language.svg
    //
    // Exemple :
    // /poster/tt0111161/dub.svg
    // /poster/tt0111161/sub.svg
    // /poster/tt0111161/dub_sub.svg
    // ========================================================

    if (
        parts.length === 3 &&
        parts[0].toLowerCase() === 'poster' &&
        parts[1] &&
        parts[2]
    ) {

        const imdbId = parts[1];

        const language =
            parts[2]
                .replace(/\.svg$/i, '')
                .toUpperCase();

        if (
            /^tt\d+$/i.test(imdbId) &&
            ['DUB', 'SUB', 'DUB_SUB'].includes(language)
        ) {

            return serveEnhancedPoster(
                req,
                res,
                imdbId,
                language
            );
        }

        res.statusCode = 404;
        return res.end('Not Found');
    }

    // ========================================================
    // CONFIGURATION
    // ========================================================

    if (
        req.url === '/' ||
        req.url === '/configure'
    ) {

        res.setHeader(
            'Content-Type',
            'text/html; charset=utf-8'
        );

        return res.end(
            fs.readFileSync(
                path.join(
                    __dirname,
                    '../public/configure.html'
                )
            )
        );
    }

    // ========================================================
    // TEST TMDB
    // ========================================================

    if (
        req.url.startsWith('/test-tmdb')
    ) {

        const url = new URL(
            req.url,
            `http://${req.headers.host || 'localhost'}`
        );

        res.setHeader(
            'Content-Type',
            'application/json; charset=utf-8'
        );

        res.setHeader(
            'Access-Control-Allow-Origin',
            '*'
        );

        try {

            const result =
                await testTMDBKey(
                    url.searchParams.get('key')
                );

            return res.end(
                JSON.stringify(result)
            );

        } catch (error) {

            res.statusCode = 500;

            return res.end(
                JSON.stringify({
                    ok: false,
                    error: 'TMDB test failed'
                })
            );
        }
    }

    // ========================================================
    // ADDON AVEC OU SANS CONFIGURATION
    // ========================================================

    let configStr = null;

    if (
        parts.length >= 1 &&
        ![
            'manifest.json',
            'catalog',
            'meta'
        ].includes(parts[0])
    ) {

        configStr = parts[0];

        req.url =
            req.url.replace(
                '/' + configStr,
                ''
            );

        if (req.url === '') {
            req.url = '/';
        }
    }

    // ========================================================
    // CACHE VERCEL
    // ========================================================

    if (
        req.url.includes('/catalog/') ||
        req.url.includes('/meta/')
    ) {

        res.setHeader(
            'Cache-Control',
            'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public'
        );
    }

    // ========================================================
    // STREMIO ADDON ROUTER
    // ========================================================

    const addonInterface =
        getAddonInterface(configStr);

    const router =
        getRouter(addonInterface);

    return router(
        req,
        res,
        () => {
            res.statusCode = 404;
            res.end();
        }
    );
};
