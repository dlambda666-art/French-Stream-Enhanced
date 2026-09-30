const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey } = require('./addon');

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 7000;

const BETTERPOSTER_BASE =
    'https://btttr.cc/poster/imdb/poster-default/';

const POSTER_CACHE = new Map();
const POSTER_CACHE_TTL = 24 * 60 * 60 * 1000;

// ============================================================
// XML
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
// BADGE
// ============================================================

function makeBadge(x, width, label, color) {
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
            font-family="Arial, Helvetica, sans-serif"
            font-size="25"
            font-weight="700"
            fill="#ffffff"
        >${escapeXml(label)}</text>
    `;
}

// ============================================================
// POSTER SVG
// ============================================================

function makePosterSvg(imageBase64, mime, tag) {
    let badges = '';

    if (tag === 'dub') {
        badges =
            makeBadge(
                18,
                112,
                'DUB',
                '#1976d2'
            );
    }

    if (tag === 'sub') {
        badges =
            makeBadge(
                18,
                112,
                'SUB',
                '#d62828'
            );
    }

    if (tag === 'dub_sub') {
        badges =
            makeBadge(
                18,
                112,
                'DUB',
                '#1976d2'
            ) +
            makeBadge(
                140,
                150,
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
// BETTERPOSTER + BADGE
// ============================================================

async function serveEnhancedPoster(
    req,
    res,
    imdbId,
    tag
) {
    if (
        !/^tt\d+$/i.test(imdbId) ||
        !['dub', 'sub', 'dub_sub'].includes(tag)
    ) {
        res.statusCode = 400;
        res.setHeader(
            'Content-Type',
            'text/plain; charset=utf-8'
        );
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
            'Access-Control-Allow-Origin',
            '*'
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
            upstream.headers.get(
                'content-type'
            ) || 'image/jpeg';

        const buffer =
            Buffer.from(
                await upstream.arrayBuffer()
            );

        const imageBase64 =
            buffer.toString('base64');

        const body =
            makePosterSvg(
                imageBase64,
                mime,
                tag
            );

        POSTER_CACHE.set(
            cacheKey,
            {
                body,
                expires:
                    Date.now() +
                    POSTER_CACHE_TTL
            }
        );

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
            'text/plain; charset=utf-8'
        );

        return res.end(
            'BetterPoster unavailable'
        );
    }
}

// ============================================================
// SERVER
// ============================================================

const server = http.createServer(
    async (req, res) => {

        const parsedUrl =
            new URL(
                req.url,
                `http://${req.headers.host || 'localhost'}`
            );

        const pathname =
            parsedUrl.pathname;

        const parts =
            pathname
                .split('/')
                .filter(Boolean);

        // ====================================================
        // CONFIGURATION ENCODEE
        // ====================================================

        let configStr = null;

        if (
            parts.length >= 1 &&
            ![
                'manifest.json',
                'catalog',
                'meta',
                'poster',
                'configure',
                'test-tmdb'
            ].includes(parts[0])
        ) {
            configStr = parts[0];

            req.url =
                req.url.replace(
                    '/' + configStr,
                    ''
                ) || '/';
        }

        // ====================================================
        // POSTER AVEC BADGE
        // ====================================================

        const posterMatch =
            pathname.match(
                /^\/poster\/(tt\d+)\/(dub|sub|dub_sub)\.svg$/i
            );

        if (posterMatch) {
            const imdbId =
                posterMatch[1];

            const tag =
                posterMatch[2].toLowerCase();

            return serveEnhancedPoster(
                req,
                res,
                imdbId,
                tag
            );
        }

        // ====================================================
        // CONFIGURATION
        // ====================================================

        if (
            pathname === '/' ||
            pathname === '/configure'
        ) {
            res.statusCode = 200;

            res.setHeader(
                'Content-Type',
                'text/html; charset=utf-8'
            );

            return res.end(
                fs.readFileSync(
                    path.join(
                        __dirname,
                        'public/configure.html'
                    )
                )
            );
        }

        // ====================================================
        // TEST TMDB
        // ====================================================

        if (
            pathname.startsWith(
                '/test-tmdb'
            )
        ) {
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
                        parsedUrl.searchParams.get(
                            'key'
                        )
                    );

                return res.end(
                    JSON.stringify(result)
                );

            } catch (error) {
                res.statusCode = 500;

                return res.end(
                    JSON.stringify({
                        valid: false,
                        error:
                            'test_failed',
                        message:
                            error?.message ||
                            'TMDB test failed'
                    })
                );
            }
        }

        // ====================================================
        // CACHE CATALOGUES / META
        // ====================================================

        if (
            req.url.includes('/catalog/') ||
            req.url.includes('/meta/')
        ) {
            res.setHeader(
                'Cache-Control',
                'max-age=3600, s-maxage=7200, stale-while-revalidate=3600, public'
            );
        }

        // ====================================================
        // PUBLIC BASE URL
        // ====================================================

        const publicBaseUrl =
            process.env.PUBLIC_BASE_URL ||
            `https://${req.headers.host}`;

        // ====================================================
        // STREMIO
        // ====================================================

        try {
            const addonInterface =
                getAddonInterface(
                    configStr,
                    publicBaseUrl
                );

            const router =
                getRouter(
                    addonInterface
                );

            return router(
                req,
                res,
                () => {
                    res.statusCode = 404;
                    res.end('Not Found');
                }
            );

        } catch (error) {
            console.error(
                'Addon router error:',
                error
            );

            res.statusCode = 500;

            res.end(
                'Internal Server Error'
            );
        }
    }
);

// ============================================================
// START
// ============================================================

server.listen(
    PORT,
    () => {
        console.log(
            `Addon French Stream démarré sur le port ${PORT}`
        );
    }
);
