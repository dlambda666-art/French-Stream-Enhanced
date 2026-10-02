// ============================================================================
// PRECHAUFFAGE DES BADGES VF (en arriere-plan, sans ouvrir Nuvio)
// ----------------------------------------------------------------------------
// Toutes les quelques heures, Frank parcourt lui-meme les catalogues des
// manifests listes dans la variable FRANK_WARMUP_MANIFESTS (une ou plusieurs
// adresses .../manifest.json, separees par des virgules, espaces ou retours a
// la ligne) et met leurs titres dans la file du detecteur, derriere les
// affiches reellement affichees. Les titres deja connus ne coutent rien.
// Frequence : FRANK_WARMUP_HOURS (3 heures par defaut).
// Sans variable, rien ne se passe.
// ============================================================================

const fetch = require('node-fetch');

const MAX_ITEMS_PER_CATALOG = 50;
const GAP_MS = 1000;            // pause entre deux catalogues
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const TYPES = new Set(['movie', 'series']);

const status = { enabled: false, runs: 0, lastRun: null, catalogs: 0, titles: 0, lastError: null };

function manifestUrls() {
    return String(process.env.FRANK_WARMUP_MANIFESTS || '')
        .split(/[\s,]+/)
        .map(url => url.trim())
        .filter(url => /^https?:\/\/.+\/manifest\.json/i.test(url));
}

function intervalMs() {
    const hours = Number(process.env.FRANK_WARMUP_HOURS);
    return (hours > 0 ? hours : 3) * 60 * 60 * 1000;
}

function detectionIdOf(meta) {
    const id = String(meta.imdb_id || meta.id || '');
    const imdb = id.match(/^tt\d+/i);
    if (imdb) return imdb[0];
    const tmdb = id.match(/^tmdb:(\d+)/i);
    return tmdb ? tmdb[1] : null;
}

async function getJson(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FrenchStreamEnhanced' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`);
    return response.json();
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Un passage : parcourt les catalogues et met les titres inconnus en file.
// detect(id, type) est celui du detecteur (sans priorite).
async function runOnce(detect, { gapMs = GAP_MS } = {}) {
    const urls = manifestUrls();
    status.enabled = urls.length > 0;
    if (!status.enabled) return status;

    let catalogs = 0;
    let titles = 0;
    for (const url of urls) {
        let manifest;
        try {
            manifest = await getJson(url);
        } catch (error) {
            status.lastError = error.message;
            continue;
        }
        const base = url.replace(/\/manifest\.json.*$/i, '');
        const list = (manifest.catalogs || []).filter(catalog =>
            TYPES.has(catalog.type) && !(catalog.extra || []).some(extra => extra.isRequired));
        for (const catalog of list) {
            try {
                const data = await getJson(`${base}/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}.json`);
                catalogs++;
                for (const meta of (data.metas || []).slice(0, MAX_ITEMS_PER_CATALOG)) {
                    const id = detectionIdOf(meta);
                    if (!id) continue;
                    titles++;
                    // Deja connu : rien a faire ; sinon il part en file.
                    detect(id, catalog.type);
                }
            } catch (error) {
                status.lastError = error.message;
            }
            if (gapMs) await pause(gapMs);
        }
    }
    status.runs++;
    status.lastRun = new Date().toISOString();
    status.catalogs = catalogs;
    status.titles = titles;
    return status;
}

function start(detect) {
    if (!manifestUrls().length) return;
    const run = () => runOnce(detect).catch(error => { status.lastError = error.message; });
    setTimeout(run, FIRST_RUN_DELAY_MS);
    setInterval(run, intervalMs());
}

module.exports = { start, runOnce, status, detectionIdOf };
