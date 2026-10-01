const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface, testTMDBKey, prepareExternalCatalogs } = require('./addon');
const { detectWithin, explain: explainDetection } = require('./language-detector');
const { addLanguageBadges } = require('./poster-badge');

const fetch = require('node-fetch');

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
// AFFICHE POUR N'IMPORTE QUEL TITRE (badges VF / VOSTFR)
// /poster/{type}/{imdb_id ou tmdb_id}.jpg  -> pour "Custom poster" d'aiometa
// ============================================================

const DETECT_WAIT_MS = 4000;
const BADGED_CACHE = new Map();
const BADGED_CACHE_MAX = 300;

async function fetchImage(url) {
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 FrenchStreamEnhanced' }
    });
    if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function redirect(res, url, cacheControl) {
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end();
}

async function serveLanguagePoster(res, type, id) {
    const result = await detectWithin(id, type, DETECT_WAIT_MS);
    const imdbId = /^tt\d+$/i.test(id) ? id : result?.imdbId;
    const candidates = [
        imdbId ? `${BETTERPOSTER_BASE}${encodeURIComponent(imdbId)}.jpg` : null,
        result?.poster
    ].filter(Boolean);

    if (!candidates.length) {
        res.statusCode = 404;
        return res.end('Poster not found');
    }

    // Langue inconnue pour l'instant (detection en cours) ou pas de VF/VOSTFR :
    // affiche normale. "no-store" tant qu'on ne sait pas, pour que le badge
    // puisse apparaitre au prochain affichage.
    const hasVf = result && (result.tag === 'DUB' || result.tag === 'DUB_SUB');
    if (!hasVf) {
        return redirect(
            res,
            candidates[0],
            result ? 'public, max-age=86400' : 'no-store'
        );
    }

    const cacheKey = `${imdbId || id}:${result.tag}`;
    let body = BADGED_CACHE.get(cacheKey);

    if (!body) {
        for (const url of candidates) {
            try {
                body = await addLanguageBadges(await fetchImage(url), result.tag);
                break;
            } catch (error) {
                console.error('Poster badge error:', url, error.message);
            }
        }
        if (!body) return redirect(res, candidates[0], 'no-store');
        if (BADGED_CACHE.size >= BADGED_CACHE_MAX) {
            BADGED_CACHE.delete(BADGED_CACHE.keys().next().value);
        }
        BADGED_CACHE.set(cacheKey, body);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=259200');
    return res.end(body);
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

        const languagePosterMatch =
            pathname.match(
                /^\/poster\/(movie|series)\/(tt\d+|\d+)\.jpg$/i
            );

        const debugMatch =
            pathname.match(
                /^\/poster-debug\/(movie|series)\/(tt\d+|\d+)$/i
            );

        if (debugMatch) {
            const report = await explainDetection(
                debugMatch[2],
                debugMatch[1].toLowerCase()
            );
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(JSON.stringify(report, null, 2));
        }

        if (languagePosterMatch) {
            return serveLanguagePoster(
                res,
                languagePosterMatch[1].toLowerCase(),
                languagePosterMatch[2]
            );
        }

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
            await prepareExternalCatalogs(configStr);

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
