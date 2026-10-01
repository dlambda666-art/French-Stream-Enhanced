// ============================================================================
// DETECTEUR DE LANGUE (VF / VOSTFR) POUR N'IMPORTE QUEL TITRE
// ----------------------------------------------------------------------------
// A partir d'un id IMDb (ou TMDB), retrouve le titre francais via TMDB, le
// cherche sur French Stream et en deduit DUB / SUB / DUB_SUB / NONE.
// Les resultats sont gardes en memoire, et les recherches passent par une
// petite file (quelques-unes a la fois) pour ne pas surcharger French Stream.
// ============================================================================

const fetch = require('node-fetch');

const persistence = require('./language-store');

// Une fois trouvee, une VF reste dispo : on la garde 30 jours.
// Sans VF (rien, ou VOSTFR seul), on reverifie apres 3 jours : la VF peut
// arriver plus tard.
const FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
const NONE_TTL = 3 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 1;
const REQUEST_GAP_MS = 1000; // pause entre deux requetes vers French Stream
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
    const hasVf = tag === 'DUB' || tag === 'DUB_SUB';
    const entry = { tag, poster, imdbId, expires: Date.now() + (hasVf ? FOUND_TTL : NONE_TTL) };
    results.set(key, entry);
    persistence.save(key, entry);
}

// Au demarrage : recharge les resultats enregistres dans Neon.
async function loadPersisted() {
    const rows = await persistence.loadAll();
    for (const row of rows) {
        if (!results.has(row.key)) {
            results.set(row.key, { tag: row.tag, poster: row.poster, imdbId: row.imdbId, expires: row.expires });
        }
    }
    if (rows.length) console.log(`Detecteur de langue : ${rows.length} resultats recharges depuis Neon`);
    return rows.length;
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
        imdbId: item.imdb_id || item.external_ids?.imdb_id || null,
        tmdbId: item.id || null,
        mediaType: mediaType === 'tv' ? 'tv' : 'movie'
    };
}

// Dispo en abonnement ou gratuitement sur une plateforme en France ou en
// Belgique (Netflix, Prime, Disney+, Canal+...) : presque toujours en VF.
// Une seule requete TMDB, rapide, qui evite une recherche French Stream.
// La location et l'achat ne comptent pas (VO seule possible).
const PROVIDER_REGIONS = ['FR', 'BE'];
const PROVIDER_KINDS = ['flatrate', 'free', 'ads'];

async function onFrenchPlatform(info) {
    if (!info.tmdbId) return false;
    try {
        const data = await tmdbJson(`/${info.mediaType}/${info.tmdbId}/watch/providers`);
        return PROVIDER_REGIONS.some(region =>
            PROVIDER_KINDS.some(kind => (data.results?.[region]?.[kind] || []).length > 0));
    } catch (error) {
        return false; // pas grave : on passe par French Stream
    }
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

// Affiche et IMDb d'un titre via TMDB seulement (rapide, sans French Stream),
// pour les ids TMDB dont la verification n'est pas encore faite.
const posterInfoCache = new Map();

async function lookupPosterInfo(id, type) {
    if (!isEnabled()) return null;
    const key = `${type}:${id}`;
    if (posterInfoCache.has(key)) return posterInfoCache.get(key);
    try {
        const info = await lookupTitle(id, type);
        const value = info ? { poster: info.poster, imdbId: info.imdbId } : null;
        if (posterInfoCache.size >= MAX_ENTRIES) posterInfoCache.delete(posterInfoCache.keys().next().value);
        posterInfoCache.set(key, value);
        return value;
    } catch (error) {
        console.error('Affiche TMDB:', id, error.message);
        return null;
    }
}

// ----------------------------------------------------------------------------
// French Stream : titre -> langue
// ----------------------------------------------------------------------------

// French Stream numerote parfois le premier film d'une saga
// ("Conjuring 1 : Les Dossiers Warren") : un "1" isole est ignore.
// Les autres numeros comptent ("Scream" n'est pas "Scream 2").
function canonicalTitle(value, normalize) {
    return normalize(value).split(' ').filter(word => word && word !== '1').join(' ');
}

function sameTitle(a, b, normalize) {
    return Boolean(a) && Boolean(b) && canonicalTitle(a, normalize) === canonicalTitle(b, normalize);
}

// Films : l'annee affichee par French Stream ("Titre (2014)") doit coller a
// TMDB, a un an pres, pour ne pas confondre un film et son remake.
function sameYear(item, info) {
    if (info.type !== 'movie' || !info.year) return true;
    const found = String(item.rawText || item.title || '').match(/\((19|20)\d{2}\)/);
    if (!found) return true;
    return Math.abs(Number(found[0].slice(1, 5)) - info.year) <= 1;
}

let nextRequestAt = 0;

// Espace les requetes vers French Stream pour ne pas se faire bloquer.
async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextRequestAt - now);
    nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_GAP_MS;
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
}

// Titres a chercher, sans doublon (titre francais = titre original).
function uniqueTitles(titles, normalize) {
    const seen = new Set();
    return titles.filter(title => {
        const key = canonicalTitle(title, normalize);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function pageUrl(href) {
    if (/^https?:/i.test(href)) return href;
    return `https://maj.french-stream.pink${String(href).startsWith('/') ? '' : '/'}${href}`;
}

// Quand l'adresse de la page ne donne pas la langue, on lit le champ
// "Version :" de la fiche (<span id="film_lang">VF+VOSTFR</span>).
async function fetchPageLanguage(href) {
    const { getLanguageTag } = require('./addon');
    await pace();
    const response = await fetch(pageUrl(href), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    // Erreur = on ne retient rien, on reessaiera plus tard.
    if (!response.ok) throw new Error(`Fiche French Stream HTTP ${response.status}`);
    const html = await response.text();
    const field = html.match(/id=["']film_lang["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!field) return 'NONE';
    const text = field[1].replace(/<[^>]+>/g, ' ');
    return getLanguageTag({ title: '', languageText: text });
}

async function detectOnFrenchStream(info) {
    const { searchFrenchStreamStrict, normalizeSearchValue } = require('./addon');
    for (const title of uniqueTitles(info.titles, normalizeSearchValue)) {
        await pace();
        const items = await searchFrenchStreamStrict(title, info.type);
        const matches = items.filter(item => sameTitle(item.searchTitle, title, normalizeSearchValue) && sameYear(item, info));
        if (!matches.length) continue;
        const tag = mergeTags(matches.map(item => item.languageTag));
        if (tag !== 'NONE') return tag;
        const withPage = matches.find(item => item.href);
        return withPage ? fetchPageLanguage(withPage.href) : 'NONE';
    }
    return 'NONE';
}

async function runDetection(key, id, type) {
    const info = await lookupTitle(id, type);
    if (!info) {
        store(key, 'NONE', null, null);
        return getKnown(key);
    }
    const tag = (await onFrenchPlatform(info)) ? 'DUB' : await detectOnFrenchStream(info);
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
// priority : affiche reellement affichee a l'ecran -> passe en tete de file,
// avant les titres des catalogues verifies en arriere-plan.
function detect(id, type, { priority = false } = {}) {
    if (!isEnabled()) return Promise.resolve(null);
    const key = /^tt\d+$/i.test(id) ? id : `${type}:${id}`;
    const known = getKnown(key);
    if (known) return Promise.resolve(known);

    if (inFlight.has(key)) {
        if (priority) {
            const index = queue.findIndex(job => job.key === key);
            if (index > 0) queue.unshift(...queue.splice(index, 1));
        }
        return inFlight.get(key);
    }

    if (queue.length >= MAX_QUEUE) {
        if (!priority) return Promise.resolve(null);
        const dropped = queue.pop(); // on lache le dernier titre d'arriere-plan
        inFlight.delete(dropped.key);
        dropped.resolve(null);
    }

    const promise = new Promise(resolve => {
        const job = { key, id, type, resolve };
        if (priority) queue.unshift(job);
        else queue.push(job);
    });
    inFlight.set(key, promise);
    pump();
    return promise;
}

// Attend au plus `ms` millisecondes ; la detection continue en arriere-plan.
function detectWithin(id, type, ms, options) {
    return Promise.race([
        detect(id, type, options),
        new Promise(resolve => setTimeout(() => resolve(null), ms))
    ]);
}

// Diagnostic (lab) : montre ou la page French Stream ecrit VF / VOSTFR.
function contexts(text, max) {
    const found = [];
    const pattern = /VOSTFR|TRUEFRENCH|\bVFF?\b|\bVFQ\b|\bFRENCH\b|Version|Langue|Qualit|lecteur|player/gi;
    let match;
    while ((match = pattern.exec(text)) && found.length < max) {
        found.push(text.slice(Math.max(0, match.index - 60), match.index + 60).replace(/\s+/g, ' '));
    }
    return found;
}

async function describePage(item) {
    const href = pageUrl(item.href);
    try {
        const response = await fetch(href, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await response.text();
        // On saute l'en-tete et le menu : on regarde a partir du titre du film.
        const start = Math.max(0, html.search(/<h1[\s>]/i));
        return { href, status: response.status, length: html.length, h1At: start, hits: contexts(html.slice(start), 25) };
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
        report.frenchPlatform = await onFrenchPlatform(info);
        const { searchFrenchStreamStrict, normalizeSearchValue } = require('./addon');
        for (const title of uniqueTitles(info.titles, normalizeSearchValue)) {
            const items = await searchFrenchStreamStrict(title, info.type);
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
    report.database = { ...persistence.status, inMemory: results.size };
    report.cached = getKnown(/^tt\d+$/i.test(id) ? id : `${type}:${id}`);
    return report;
}

module.exports = { detect, explain, lookupPosterInfo, loadPersisted, detectWithin, remember, mergeTags, isEnabled, useTmdbKey, _results: results };
