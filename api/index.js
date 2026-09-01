const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('../addon');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const BETTERPOSTER_BASE =
    'https://btttr.cc/poster/imdb/poster-default/';

const POSTER_CACHE = new Map();
const POSTER_CACHE_TTL = 24 * 60 * 60 * 1000;

// ============================================================
// POLICE PULSAR
// ============================================================

let FONT_BASE64 = '';

try {
    const fontPath = path.join(
        __dirname,
        '../PulsarDejaVuSans-Bold.ttf'
    );

    if (fs.existsSync(fontPath)) {
        FONT_BASE64 = fs
            .readFileSync(fontPath)
            .toString('base64');

        console.log('TTF chargé : PulsarDejaVuSans-Bold.ttf');
    } else {
        console.error('TTF introuvable :', fontPath);
    }
} catch (error) {
    console.error('Erreur chargement TTF:', error.message);
}

// ============================================================
// XML
// ============================================================

function escapeXml(value) {
    return String(value).replace(
        /[<>&"']/g,
        char =>
            ({
                '<': '&lt;',
                '>': '&gt;',
                '&': '&amp;',
                '"': '&quot;',
                "'": '&apos;'
            }[char])
    );
}

// ============================================================
// BADGES
// ============================================================

function badge(x, width, label, color) {
    return `
        <rect
            x="${x}"
            y="18"
            width="${width}"
            height="54"
            rx="10"
            fill="${color}"
            opacity="0.97"
        />
        <text
            x="${x + width / 2}"
            y="46"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="PulsarDejaVuSans, DejaVu Sans, sans-serif"
            font-size="25"
            font-weight="700"
            fill="#ffffff"
        >${escapeXml(label)}</text>
    `;
}

// ============================================================
// POSTER SVG
// ============================================================

function posterSvg(imageBase64, mime, tag) {
    let badges = '';

    if (tag === 'dub') {
        badges = badge(18, 112, 'DUB', '#1976d2');
    } else if (tag === 'sub') {
        badges = badge(18, 112, 'SUB', '#d62828');
    } else if (tag === 'dub_sub') {
        badges =
            badge(18, 112, 'DUB', '#1976d2') +
            badge(140, 150, 'SUB', '#d62828');
    }

    const fontStyle = FONT_BASE64
        ? `
        @font-face {
            font-family: 'PulsarDejaVuSans';
            src: url(data:font/ttf;base64,${FONT_BASE64})
                 format('truetype');
            font-weight: 700;
        }
        `
        : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg
    xmlns="http://www.w3.org/2000/svg"
    width="500"
    height="750"
    viewBox="0 0 500 750"
>
    <style>
        ${fontStyle}
    </style>

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
// BETTERPOSTER
// ============================================================

async function serveEnhancedPoster(req, res, imdbId, tag) {
    if (
        !/^tt\d+$/i.test(imdbId) ||
        !['dub', 'sub', 'dub_sub'].includes(tag)
    ) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        return res.end('Invalid poster request');
    }

    const cacheKey = `${imdbId}:${tag}`;

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
            'Cache-Control',
            'public, max-age=86400, s-maxage=86400'
        );
        return res.end(cached.body);
    }

    try {
        const upstream = await fetch(
            `${BETTERPOSTER_BASE}${encodeURIComponent(imdbId)}.jpg`,
            {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 FrenchStreamEnhanced'
                }
            }
        );

        if (!upstream.ok) {
            throw new Error(
                `BetterPoster HTTP ${upstream.status}`
            );
        }

        const mime =
            upstream.headers.get('content-type') ||
            'image/jpeg';

        const buffer = await upstream.buffer();

        const base64 = buffer.toString('base64');

        const body = posterSvg(
            base64,
            mime,
            tag
        );

        POSTER_CACHE.set(cacheKey, {
            body,
            expires:
                Date.now() +
                POSTER_CACHE_TTL
        });

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
            'BetterPoster error:',
            error.message
        );

        res.statusCode = 502;

        res.setHeader(
            'Content-Type',
            'text/plain'
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

    const parts = req.url
        .split('?')[0]
        .split('/')
        .filter(Boolean);

    // ========================================================
    // POSTER
    // ========================================================

    if (
        parts.length === 3 &&
        parts[0] === 'poster' &&
        /^tt\d+$/i.test(parts[1]) &&
        parts[2].toLowerCase().endsWith('.svg')
    ) {
        const imdbId = parts[1];

        const tag = parts[2]
            .replace(/\.svg$/i, '')
            .toLowerCase();

        if (
            !['dub', 'sub', 'dub_sub'].includes(tag)
        ) {
            res.statusCode = 404;
            return res.end('Not Found');
        }

        return serveEnhancedPoster(
            req,
            res,
            imdbId,
            tag
        );
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
    // CONFIGURATION ADDON
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

        req.url = req.url.replace(
            '/' + configStr,
            ''
        );

        if (!req.url) {
            req.url = '/';
        }
    }

    // ========================================================
    // CACHE
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
    // STREMIO
    // ========================================================

    const publicBaseUrl =
        process.env.PUBLIC_BASE_URL ||
        `https://${req.headers.host}`;

    const addonInterface =
        getAddonInterface(
            configStr,
            publicBaseUrl
        );

    const router =
        getRouter(addonInterface);

    return router(
        req,
        res,
        () => {
            res.statusCode = 404;
            res.end('Not Found');
        }
    );
};
