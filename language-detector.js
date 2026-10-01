// ============================================================================
// DETECTEUR DE LANGUE (VF / VOSTFR) POUR N'IMPORTE QUEL TITRE
// ----------------------------------------------------------------------------
// A partir d'un id IMDb (ou TMDB), retrouve le titre francais via TMDB, le
// cherche sur French Stream et en deduit DUB / SUB / DUB_SUB / NONE.
// Les resultats sont gardes en memoire, et les recherches passent par une
// petite file (quelques-unes a la fois) pour ne pas surcharger French Stream.
// ============================================================================

const fetch = require('node-fetch');

const FOUND_TTL = 3 * 24 * 60 * 60 * 1000; // VF / VOSTFR trouve : 3 jours
const NONE_TTL = 24 * 60 * 60 * 1000;      // rien trouve : on reverifie apres 1 jour
const MAX_CONCURRENT = 2;
const MAX_QUEUE = 500;
const MAX_ENTRIES = 20000;

const results = new Map();  // cle -> { tag, poster, expires }
const inFlight = new Map(); // cle -> Promise
const queue = [];
let running = 0;

let configTmdbKey = '';

function tmdbKey() {
    return process.env.TMDB_API_KEY || configTmdbKey;
}

// Sans variable TMDB_API_KEY, on reprend la cle TMDB de la config de Frank.
function useTmdbKey(key) {
    if (key) configTmdbKey = key;
}

function isEnabled() {
    return Boolean(tmdbKey());
}

function store(key, tag, poster, imdbId) {
    if (results.size >= MAX_ENTRIES) results.delete(results.keys().next().value);
    results.set(key, { tag, poster, imdbId, expires: Date.now() + (tag === 'NONE' ? NONE_TTL : FOUND_TTL) });
}

function getKnown(key) {
    const entry = results.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
        results.delete(key);
        return null;
    }
    return entry;
}

// Appele par les catalogues Frank : ils connaissent deja la langue.
function remember(imdbId, tag) {
    if (!imdbId || !/^tt\d+$/i.test(imdbId) || !tag || tag === 'NONE') return;
    const known = getKnown(imdbId);
    store(imdbId, mergeTags([known?.tag, tag]), known?.poster || null, imdbId);
}

function mergeTags(tags) {
    let dub = false;
    let sub = false;
    for (const tag of tags) {
        if (tag === 'DUB' || tag === 'DUB_SUB') dub = true;
        if (tag === 'SUB' || tag === 'DUB_SUB') sub = true;
    }
    if (dub && sub) return 'DUB_SUB';
    if (dub) return 'DUB';
    if (sub) return 'SUB';
    return 'NONE';
}

// ----------------------------------------------------------------------------
// TMDB : id -> titre francais, titre original, type, affiche
// ----------------------------------------------------------------------------

async function tmdbJson(path) {
    const sep = path.includes('?') ? '&' : '?';
    const response = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${tmdbKey()}&language=fr-FR`);
    if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
    return response.json();
}

function toTitleInfo(item, mediaType) {
    if (!item) return null;
    return {
        type: mediaType === 'tv' ? 'series' : 'movie',
        titles: [item.title || item.name, item.original_title || item.original_name].filter(Boolean),
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
        year: Number(String(item.release_date || item.first_air_date || '').slice(0, 4)) || null,
        imdbId: item.imdb_id || item.external_ids?.imdb_id || null
    };
}

async function lookupTitle(id, type) {
    if (/^tt\d+$/i.test(id)) {
        const data = await tmdbJson(`/find/${id}?external_source=imdb_id`);
        const movie = data.movie_results?.[0];
        const tv = data.tv_results?.[0];
        const info = type === 'series'
            ? toTitleInfo(tv, 'tv') || toTitleInfo(movie, 'movie')
            : toTitleInfo(movie, 'movie') || toTitleInfo(tv, 'tv');
        if (info) info.imdbId = id;
        return info;
    }
    const mediaType = type === 'series' ? 'tv' : 'movie';
    const details = await tmdbJson(`/${mediaType}/${id}?append_to_response=external_ids`);
    return toTitleInfo(details, mediaType);
}

// ----------------------------------------------------------------------------
// French Stream : titre -> langue
// ----------------------------------------------------------------------------

function sameTitle(a, b, normalize) {
    return Boolean(a) && Boolean(b) && normalize(a) === normalize(b);
}

// Films : l'annee affichee par French Stream ("Titre (2014)") doit coller a
// TMDB, a un an pres, pour ne pas confondre un film et son remake.
function sameYear(item, info) {
    if (info.type !== 'movie' || !info.year) return true;
    const found = String(item.rawText || item.title || '').match(/\((19|20)\d{2}\)/);
    if (!found) return true;
    return Math.abs(Number(found[0].slice(1, 5)) - info.year) <= 1;
}

async function detectOnFrenchStream(info) {
    const { searchFrenchStream, normalizeSearchValue } = require('./addon');
    for (const title of info.titles) {
        const items = await searchFrenchStream(title, info.type);
        const matches = items.filter(item => sameTitle(item.searchTitle, title, normalizeSearchValue) && sameYear(item, info));
        if (matches.length) return mergeTags(matches.map(item => item.languageTag));
    }
    return 'NONE';
}

async function runDetection(key, id, type) {
    const info = await lookupTitle(id, type);
    if (!info) {
        store(key, 'NONE', null, null);
        return getKnown(key);
    }
    const tag = await detectOnFrenchStream(info);
    store(key, tag, info.poster, info.imdbId);
    if (info.imdbId && info.imdbId !== key) store(info.imdbId, tag, info.poster, info.imdbId);
    return getKnown(key);
}

// ----------------------------------------------------------------------------
// File d'attente
// ----------------------------------------------------------------------------

function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
        const job = queue.shift();
        running++;
        runDetection(job.key, job.id, job.type)
            .then(job.resolve, error => {
                console.error('Detection langue:', error.message);
                job.resolve(null); // erreur : pas mis en cache, on reessaiera
            })
            .finally(() => {
                running--;
                inFlight.delete(job.key);
                pump();
            });
    }
}

// Renvoie { tag, poster, imdbId } (tag : DUB / SUB / DUB_SUB / NONE), ou null si inconnu.
function detect(id, type) {
    if (!isEnabled()) return Promise.resolve(null);
    const key = /^tt\d+$/i.test(id) ? id : `${type}:${id}`;
    const known = getKnown(key);
    if (known) return Promise.resolve(known);
    if (inFlight.has(key)) return inFlight.get(key);
    if (queue.length >= MAX_QUEUE) return Promise.resolve(null);

    const promise = new Promise(resolve => queue.push({ key, id, type, resolve }));
    inFlight.set(key, promise);
    pump();
    return promise;
}

// Attend au plus `ms` millisecondes ; la detection continue en arriere-plan.
function detectWithin(id, type, ms) {
    return Promise.race([
        detect(id, type),
        new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
}

// Diagnostic (lab) : montre ou la page French Stream ecrit VF / VOSTFR.
function contexts(text, max) {
    const found = [];
    const pattern = /VOSTFR|TRUEFRENCH|\bVFF?\b|\bVFQ\b|\bFRENCH\b|Version|Langue/gi;
    let match;
    while ((match = pattern.exec(text)) && found.length < max) {
        found.push(text.slice(Math.max(0, match.index - 60), match.index + 60).replace(/\s+/g, ' '));
    }
    return found;
}

async function describePage(item) {
    const href = /^https?:/i.test(item.href) ? item.href : `https://maj.french-stream.pink${item.href.startsWith('/') ? '' : '/'}${item.href}`;
    try {
        const response = await fetch(href, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await response.text();
        return { href, status: response.status, length: html.length, hits: contexts(html, 15) };
    } catch (error) {
        return { href, error: error.message };
    }
}

// Diagnostic (lab) : refait la detection pas a pas, sans cache.
async function explain(id, type) {
    const report = { id, type, tmdbKey: Boolean(tmdbKey()), steps: [] };
    try {
        const info = await lookupTitle(id, type);
        report.tmdb = info;
        if (!info) return report;
        const { searchFrenchStream, normalizeSearchValue } = require('./addon');
        for (const title of info.titles) {
            const items = await searchFrenchStream(title, info.type);
            const matched = items.find(item => sameTitle(item.searchTitle, title, normalizeSearchValue) && sameYear(item, info));
            if (matched && !report.page) report.page = await describePage(matched);
            report.steps.push({
                search: title,
                results: items.map(item => ({
                    title: item.searchTitle,
                    tag: item.languageTag,
                    text: item.rawText,
                    match: sameTitle(item.searchTitle, title, normalizeSearchValue) && sameYear(item, report.tmdb)
                }))
            });
        }
    } catch (error) {
        report.error = error.message;
    }
    report.cached = getKnown(/^tt\d+$/i.test(id) ? id : `${type}:${id}`);
    return report;
}

module.exports = { detect, explain, detectWithin, remember, mergeTags, isEnabled, useTmdbKey, _results: results };
