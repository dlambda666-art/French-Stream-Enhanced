// Teste le detecteur de langue sans reseau : TMDB et French Stream sont simules.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const searches = [];
const fakeSearchResults = {
    'Le Comte de Monte-Cristo': [
        { searchTitle: 'Le Comte de Monte-Cristo', languageTag: 'DUB' },
        { searchTitle: 'Le Comte de Monte-Cristo', languageTag: 'SUB' }
    ],
    'Inconnu au bataillon': [{ searchTitle: 'Inconnu au bataillon 2', languageTag: 'DUB' }],
    'Shogun': [{ searchTitle: 'Shogun', languageTag: 'SUB' }],
    'Conjuring : Les Dossiers Warren': [{ searchTitle: 'Conjuring 1 : Les Dossiers Warren', languageTag: 'DUB', rawText: 'Conjuring 1 : Les Dossiers Warren (2013)' }],
    'Scream': [{ searchTitle: 'Scream 2', languageTag: 'DUB', rawText: 'Scream 2 (1997)' }],
    'Halloween': [{ searchTitle: 'Halloween', languageTag: 'DUB', rawText: 'Halloween (2018)' }]
};

const fakeTmdb = {
    '/find/tt0000001': { movie_results: [{ title: 'Le Comte de Monte-Cristo', original_title: 'Le Comte de Monte-Cristo', poster_path: '/a.jpg' }], tv_results: [] },
    '/find/tt0000002': { movie_results: [{ title: 'Inconnu au bataillon', original_title: 'Unknown', poster_path: null }], tv_results: [] },
    '/find/tt0077651': { movie_results: [{ title: 'Halloween', original_title: 'Halloween', release_date: '1978-10-25' }], tv_results: [] },
    '/find/tt1502407': { movie_results: [{ title: 'Halloween', original_title: 'Halloween', release_date: '2018-10-18' }], tv_results: [] },
    '/find/tt1457767': { movie_results: [{ title: 'Conjuring : Les Dossiers Warren', original_title: 'The Conjuring', release_date: '2013-07-18' }], tv_results: [] },
    '/find/tt0117571': { movie_results: [{ title: 'Scream', original_title: 'Scream', release_date: '1996-12-20' }], tv_results: [] },
    '/tv/42': { name: 'Shogun', original_name: 'Shōgun', poster_path: '/s.jpg', external_ids: { imdb_id: 'tt0000042' } }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'node-fetch') {
        return async url => {
            const route = new URL(url).pathname.replace('/3', '');
            const body = fakeTmdb[route] || (route.startsWith('/find/') ? { movie_results: [], tv_results: [] } : null);
            return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body };
        };
    }
    if (request === './addon') {
        return {
            normalizeSearchValue: value => value.normalize('NFD').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
            searchFrenchStream: async (title, type) => {
                searches.push(`${type}:${title}`);
                return fakeSearchResults[title] || [];
            }
        };
    }
    return originalLoad.apply(this, arguments);
};

process.env.TMDB_API_KEY = 'test';
const detector = require(path.join(__dirname, '..', 'language-detector.js'));

(async () => {
    // VF et VOSTFR trouves pour le meme titre -> DUB_SUB
    const monteCristo = await detector.detect('tt0000001', 'movie');
    assert.equal(monteCristo.tag, 'DUB_SUB');
    assert.equal(monteCristo.poster, 'https://image.tmdb.org/t/p/w500/a.jpg');

    // Deuxieme appel : resultat en memoire, pas de nouvelle recherche
    const before = searches.length;
    await detector.detect('tt0000001', 'movie');
    assert.equal(searches.length, before);

    // Titre proche mais different ("... 2") -> pas de badge
    assert.equal((await detector.detect('tt0000002', 'movie')).tag, 'NONE');

    // Id TMDB d'une serie -> retrouve l'IMDb
    const shogun = await detector.detect('42', 'series');
    assert.equal(shogun.tag, 'SUB');
    assert.equal(shogun.imdbId, 'tt0000042');

    // Remake : meme titre, annee differente -> pas confondu
    assert.equal((await detector.detect('tt0077651', 'movie')).tag, 'NONE');
    assert.equal((await detector.detect('tt1502407', 'movie')).tag, 'DUB');

    // "1" ajoute par French Stream -> trouve ; une suite ("Scream 2") -> non
    assert.equal((await detector.detect('tt1457767', 'movie')).tag, 'DUB');
    assert.equal((await detector.detect('tt0117571', 'movie')).tag, 'NONE');

    // Titre absent de TMDB -> NONE, sans planter
    assert.equal((await detector.detect('tt9999999', 'movie')).tag, 'NONE');

    // Les catalogues Frank renseignent directement, sans recherche
    detector.remember('tt0000077', 'DUB');
    const searchesBefore = searches.length;
    assert.equal((await detector.detect('tt0000077', 'movie')).tag, 'DUB');
    assert.equal(searches.length, searchesBefore);

    // Sans cle TMDB : detecteur desactive
    delete process.env.TMDB_API_KEY;
    assert.equal(await detector.detect('tt0000555', 'movie'), null);

    console.log('language-detector: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
